import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compare, summarize } from './analysis.js';
import { detectKind } from './categories.js';
import { commentMarker, formatBytes, formatDelta, formatPercent, renderReport } from './format.js';
import { pullRequestNumber, upsertStickyComment } from './github.js';
import { readInputs } from './inputs.js';
import { evaluateThresholds } from './thresholds.js';
import { readZip } from './zip.js';

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function escapeCommand(message) {
  return String(message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function writeOutputs(env, outputs, log) {
  const lines = [];
  for (const [name, value] of Object.entries(outputs)) {
    if (value.includes('\n')) {
      const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
      lines.push(`${name}<<${delimiter}`, value, delimiter);
    } else {
      lines.push(`${name}=${value}`);
    }
  }
  const text = `${lines.join('\n')}\n`;
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, text);
  } else {
    log(text);
  }
}

function readArchive(label, filePath) {
  try {
    return readZip(filePath);
  } catch (error) {
    throw new Error(`could not read ${label} artifact ${filePath}: ${error.message}`, { cause: error });
  }
}

async function postComment({ env, inputs, fetchImpl, report, log }) {
  if (!inputs.comment) return;
  const issueNumber = pullRequestNumber(env);
  if (issueNumber === null) {
    log('Not a pull request event, skipping the pull request comment.');
    return;
  }
  if (!inputs.githubToken) {
    log('::warning::github-token is empty, skipping the pull request comment.');
    return;
  }
  if (!env.GITHUB_REPOSITORY) {
    log('::warning::GITHUB_REPOSITORY is not set, skipping the pull request comment.');
    return;
  }
  const marker = commentMarker(inputs.name);
  try {
    const result = await upsertStickyComment({
      fetchImpl,
      apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
      token: inputs.githubToken,
      repository: env.GITHUB_REPOSITORY,
      issueNumber,
      marker,
      body: `${marker}\n${report}`,
    });
    log(`Pull request comment ${result.action}: ${result.url ?? result.id}`);
  } catch (error) {
    log(`::warning::${escapeCommand(`Could not write the pull request comment: ${error.message}`)}`);
  }
}

export async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  try {
    const inputs = readInputs(env);
    const workspace = env.GITHUB_WORKSPACE || process.cwd();
    const headPath = path.resolve(workspace, inputs.headPath);
    if (!isFile(headPath)) {
      throw new Error(`head-path ${inputs.headPath} does not exist or is not a file`);
    }
    const headArchive = readArchive('head', headPath);
    const kind = detectKind(headPath, headArchive.entries);
    const head = summarize(headArchive, kind);

    let base = null;
    const basePath = inputs.basePath ? path.resolve(workspace, inputs.basePath) : '';
    if (basePath && isFile(basePath)) {
      base = summarize(readArchive('base', basePath), kind);
    } else {
      log(`::notice::${escapeCommand(`No baseline artifact${inputs.basePath ? ` at ${inputs.basePath}` : ''}; reporting the head build only.`)}`);
    }

    const comparison = compare(head, base, inputs.topFiles);
    const limits = { maxIncreaseBytes: inputs.maxIncreaseBytes, maxIncreasePercent: inputs.maxIncreasePercent };
    const thresholds = evaluateThresholds({ diffBytes: comparison.diffBytes, diffPercent: comparison.diffPercent, ...limits });
    const report = renderReport({
      name: inputs.name,
      head,
      base,
      basePath: inputs.basePath,
      comparison,
      thresholds,
      limits,
      topFiles: inputs.topFiles,
    });

    log(
      base
        ? `${inputs.name}: ${formatBytes(head.fileSize)} (${formatDelta(comparison.diffBytes)}, ${formatPercent(comparison.diffPercent)})`
        : `${inputs.name}: ${formatBytes(head.fileSize)} (no baseline)`,
    );

    writeOutputs(
      env,
      {
        'head-size': String(head.fileSize),
        'base-size': base ? String(base.fileSize) : '',
        'diff-bytes': base ? String(comparison.diffBytes) : '',
        'diff-percent': comparison.diffPercent === null ? '' : comparison.diffPercent.toFixed(2),
        report,
        exceeded: String(thresholds.exceeded),
      },
      log,
    );

    if (env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${report}\n`);
    }

    await postComment({ env, inputs, fetchImpl, report, log });

    if (thresholds.exceeded) {
      for (const reason of thresholds.reasons) {
        log(`::error::${escapeCommand(`${inputs.name}: ${reason}`)}`);
      }
      return 1;
    }
    return 0;
  } catch (error) {
    log(`::error::${escapeCommand(error.message)}`);
    return 1;
  }
}
