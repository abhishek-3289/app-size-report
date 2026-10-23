import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { run } from '../src/main.js';
import { recordingFetch } from './helpers/fetch-stub.js';
import { apkFiles, bytes, tempDir, writeZip } from './helpers/zip-writer.js';

const root = tempDir();
after(() => fs.rmSync(root, { recursive: true, force: true }));

let workspace;
let logs;
const log = (line) => logs.push(line);

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(root, 'ws-'));
  fs.mkdirSync(path.join(workspace, 'head'));
  fs.mkdirSync(path.join(workspace, 'base'));
  logs = [];
});

function parseOutputs(file) {
  const text = fs.readFileSync(file, 'utf8');
  const outputs = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc) {
      const [, name, delimiter] = heredoc;
      const value = [];
      index++;
      while (lines[index] !== delimiter) value.push(lines[index++]);
      outputs[name] = value.join('\n');
    } else if (line.includes('=')) {
      const at = line.indexOf('=');
      outputs[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return outputs;
}

function setup({ inputs = {}, event = null, eventName = 'pull_request' } = {}) {
  const env = {
    GITHUB_WORKSPACE: workspace,
    GITHUB_OUTPUT: path.join(workspace, 'output.txt'),
    GITHUB_STEP_SUMMARY: path.join(workspace, 'summary.md'),
    GITHUB_REPOSITORY: 'octo/app',
    GITHUB_API_URL: 'https://api.github.com',
    GITHUB_EVENT_NAME: eventName,
    'INPUT_GITHUB-TOKEN': 'test-token',
    'INPUT_TOP-FILES': '10',
    INPUT_COMMENT: 'true',
  };
  for (const [name, value] of Object.entries(inputs)) env[`INPUT_${name.toUpperCase()}`] = value;
  if (event) {
    env.GITHUB_EVENT_PATH = path.join(workspace, 'event.json');
    fs.writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify(event));
  }
  return env;
}

function buildPair() {
  const base = writeZip(path.join(workspace, 'base'), 'app-release.apk', apkFiles({ dexSize: 4000 }));
  const head = writeZip(path.join(workspace, 'head'), 'app-release.apk', apkFiles({ dexSize: 9000, extraDex: true }));
  return { base, head, diff: fs.statSync(head).size - fs.statSync(base).size, baseSize: fs.statSync(base).size };
}

const prEvent = { number: 7, pull_request: { number: 7 } };

describe('run', () => {
  it('writes outputs and the step summary without commenting outside pull requests', async () => {
    const { diff, baseSize } = buildPair();
    const stub = recordingFetch([]);
    const env = setup({
      inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk' },
      event: { ref: 'refs/heads/main' },
      eventName: 'push',
    });
    const code = await run({ env, fetchImpl: stub.fetch, log });
    assert.equal(code, 0);
    assert.equal(stub.calls.length, 0);
    const outputs = parseOutputs(env.GITHUB_OUTPUT);
    assert.equal(outputs['head-size'], String(fs.statSync(path.join(workspace, 'head/app-release.apk')).size));
    assert.equal(outputs['base-size'], String(baseSize));
    assert.equal(outputs['diff-bytes'], String(diff));
    assert.equal(outputs['diff-percent'], ((diff / baseSize) * 100).toFixed(2));
    assert.equal(outputs.exceeded, 'false');
    assert.match(outputs.report, /### 📦 App size: `app-release\.apk`/);
    assert.match(outputs.report, /\| `classes2\.dex` \| added \|/);
    assert.match(outputs.report, /\| `classes\.dex` \| changed \|/);
    assert.equal(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), `${outputs.report}\n`);
    assert.ok(logs.includes('Not a pull request event, skipping the pull request comment.'));
  });

  it('creates a sticky comment on a pull request', async () => {
    buildPair();
    const stub = recordingFetch([
      { status: 200, body: [{ id: 1, body: 'unrelated' }] },
      { status: 201, body: { id: 50, html_url: 'https://github.com/octo/app/pull/7#issuecomment-50' } },
    ]);
    const env = setup({
      inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk', name: 'Android release' },
      event: prEvent,
    });
    const code = await run({ env, fetchImpl: stub.fetch, log });
    assert.equal(code, 0);
    assert.deepEqual(stub.calls.map((call) => [call.method, call.url]), [
      ['GET', 'https://api.github.com/repos/octo/app/issues/7/comments?per_page=100&page=1'],
      ['POST', 'https://api.github.com/repos/octo/app/issues/7/comments'],
    ]);
    const body = stub.calls[1].body.body;
    assert.ok(body.startsWith('<!-- app-size-report:Android release -->\n### 📦 App size: `Android release`'));
    assert.equal(body, `<!-- app-size-report:Android release -->\n${parseOutputs(env.GITHUB_OUTPUT).report}`);
  });

  it('updates the existing sticky comment', async () => {
    buildPair();
    const stub = recordingFetch([
      { status: 200, body: [{ id: 31, body: '<!-- app-size-report:app-release.apk -->\nold' }] },
      { status: 200, body: { id: 31, html_url: 'url' } },
    ]);
    const env = setup({ inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk' }, event: prEvent });
    assert.equal(await run({ env, fetchImpl: stub.fetch, log }), 0);
    assert.equal(stub.calls[1].method, 'PATCH');
    assert.equal(stub.calls[1].url, 'https://api.github.com/repos/octo/app/issues/comments/31');
    assert.match(stub.calls[1].body.body, /^<!-- app-size-report:app-release\.apk -->\n/);
  });

  it('does not comment when comment is false', async () => {
    buildPair();
    const stub = recordingFetch([]);
    const env = setup({
      inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk', comment: 'false' },
      event: prEvent,
    });
    assert.equal(await run({ env, fetchImpl: stub.fetch, log }), 0);
    assert.equal(stub.calls.length, 0);
  });

  it('keeps going with a warning when the comment cannot be written', async () => {
    buildPair();
    const stub = recordingFetch([{ status: 403, body: { message: 'Resource not accessible by integration' } }]);
    const env = setup({ inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk' }, event: prEvent });
    assert.equal(await run({ env, fetchImpl: stub.fetch, log }), 0);
    assert.ok(logs.some((line) => line.startsWith('::warning::Could not write the pull request comment: GitHub API list comments failed with HTTP 403')));
  });

  it('reports the head only when the baseline is missing', async () => {
    buildPair();
    const stub = recordingFetch([]);
    const env = setup({
      inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/missing.apk', 'max-increase-bytes': '0', comment: 'false' },
    });
    assert.equal(await run({ env, fetchImpl: stub.fetch, log }), 0);
    const outputs = parseOutputs(env.GITHUB_OUTPUT);
    assert.equal(outputs['base-size'], '');
    assert.equal(outputs['diff-bytes'], '');
    assert.equal(outputs['diff-percent'], '');
    assert.equal(outputs.exceeded, 'false');
    assert.match(outputs.report, /No baseline artifact was found at `base\/missing\.apk`/);
    assert.ok(logs.some((line) => line.startsWith('::notice::No baseline artifact at base/missing.apk')));
  });

  it('reports the head only when base-path is empty', async () => {
    buildPair();
    const env = setup({ inputs: { 'head-path': 'head/app-release.apk', comment: 'false' } });
    assert.equal(await run({ env, fetchImpl: recordingFetch([]).fetch, log }), 0);
    assert.match(parseOutputs(env.GITHUB_OUTPUT).report, /No baseline artifact was found, so/);
  });

  it('fails after commenting when a limit is exceeded', async () => {
    buildPair();
    const stub = recordingFetch([
      { status: 200, body: [] },
      { status: 201, body: { id: 1, html_url: 'url' } },
    ]);
    const env = setup({
      inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk', 'max-increase-percent': '1' },
      event: prEvent,
    });
    assert.equal(await run({ env, fetchImpl: stub.fetch, log }), 1);
    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[1].body.body, /\[!CAUTION\]/);
    assert.equal(parseOutputs(env.GITHUB_OUTPUT).exceeded, 'true');
    assert.ok(logs.some((line) => /^::error::app-release\.apk: size grew by \+\d+\.\d\d%25, more than the allowed \+1\.00%25$/.test(line)));
  });

  it('passes when growth is within the byte limit', async () => {
    const { diff } = buildPair();
    const env = setup({
      inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk', 'max-increase-bytes': String(diff), comment: 'false' },
    });
    assert.equal(await run({ env, fetchImpl: recordingFetch([]).fetch, log }), 0);
    assert.equal(parseOutputs(env.GITHUB_OUTPUT).exceeded, 'false');
  });

  it('fails when head-path does not exist', async () => {
    const env = setup({ inputs: { 'head-path': 'head/nope.apk' } });
    assert.equal(await run({ env, fetchImpl: recordingFetch([]).fetch, log }), 1);
    assert.deepEqual(logs, ['::error::head-path head/nope.apk does not exist or is not a file']);
    assert.equal(fs.existsSync(env.GITHUB_OUTPUT), false);
  });

  it('fails on a corrupt head artifact', async () => {
    fs.writeFileSync(path.join(workspace, 'head/app-release.apk'), bytes(2048, 9));
    const env = setup({ inputs: { 'head-path': 'head/app-release.apk' } });
    assert.equal(await run({ env, fetchImpl: recordingFetch([]).fetch, log }), 1);
    assert.match(logs[0], /^::error::could not read head artifact .*app-release\.apk: end of central directory record not found/);
  });

  it('fails on a corrupt baseline artifact', async () => {
    buildPair();
    fs.writeFileSync(path.join(workspace, 'base/app-release.apk'), bytes(100, 3));
    const env = setup({ inputs: { 'head-path': 'head/app-release.apk', 'base-path': 'base/app-release.apk' } });
    assert.equal(await run({ env, fetchImpl: recordingFetch([]).fetch, log }), 1);
    assert.match(logs[0], /^::error::could not read base artifact/);
  });

  it('fails on invalid inputs', async () => {
    buildPair();
    const env = setup({ inputs: { 'head-path': 'head/app-release.apk', 'top-files': '-3' } });
    assert.equal(await run({ env, fetchImpl: recordingFetch([]).fetch, log }), 1);
    assert.match(logs[0], /^::error::top-files must be a non-negative whole number/);
  });

  it('categorises an IPA', async () => {
    const ipa = (binarySize) => [
      { name: 'Payload/Example.app/Example', data: bytes(binarySize, 5), method: 'store' },
      { name: 'Payload/Example.app/Frameworks/Lib.framework/Lib', data: bytes(1500, 6), method: 'store' },
      { name: 'Payload/Example.app/Assets.car', data: bytes(800, 7), method: 'store' },
      { name: 'Payload/Example.app/en.lproj/Localizable.strings', data: '"a" = "b";'.repeat(20) },
      { name: 'iTunesMetadata.plist', data: '<plist/>' },
    ];
    writeZip(path.join(workspace, 'base'), 'Example.ipa', ipa(3000));
    writeZip(path.join(workspace, 'head'), 'Example.ipa', ipa(3500));
    const env = setup({ inputs: { 'head-path': 'head/Example.ipa', 'base-path': 'base/Example.ipa', comment: 'false' } });
    assert.equal(await run({ env, fetchImpl: recordingFetch([]).fetch, log }), 0);
    const outputs = parseOutputs(env.GITHUB_OUTPUT);
    assert.equal(outputs['diff-bytes'], '500');
    assert.match(outputs.report, /iOS IPA is/);
    assert.match(outputs.report, /\| binary \| 2\.9 KB \| 3\.4 KB \| \+500 B \(\+16\.67%\) \|/);
    assert.match(outputs.report, /\| frameworks \| 1\.5 KB \| 1\.5 KB \| 0 B \(0\.00%\) \|/);
    assert.match(outputs.report, /\| assets \| 800 B \| 800 B \| 0 B \(0\.00%\) \|/);
  });
});
