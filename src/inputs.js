import path from 'node:path';

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

const TRUE_VALUES = new Set(['true', 'True', 'TRUE']);
const FALSE_VALUES = new Set(['false', 'False', 'FALSE']);

export function getInput(env, name) {
  return (env[`INPUT_${name.toUpperCase()}`] ?? '').trim();
}

function parseBoolean(env, name, fallback) {
  const value = getInput(env, name);
  if (value === '') return fallback;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new InputError(`${name} must be true or false, got '${value}'`);
}

function parseLimit(env, name, { integer }) {
  const value = getInput(env, name);
  if (value === '') return null;
  const pattern = integer ? /^\d+$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(value)) {
    throw new InputError(`${name} must be a non-negative ${integer ? 'whole number' : 'number'}, got '${value}'`);
  }
  const number = Number(value);
  if (integer && !Number.isSafeInteger(number)) {
    throw new InputError(`${name} is too large, got '${value}'`);
  }
  return number;
}

export function readInputs(env) {
  const headPath = getInput(env, 'head-path');
  if (headPath === '') throw new InputError('head-path is required');
  return {
    headPath,
    basePath: getInput(env, 'base-path'),
    name: getInput(env, 'name') || path.basename(headPath),
    maxIncreaseBytes: parseLimit(env, 'max-increase-bytes', { integer: true }),
    maxIncreasePercent: parseLimit(env, 'max-increase-percent', { integer: false }),
    comment: parseBoolean(env, 'comment', true),
    githubToken: getInput(env, 'github-token'),
    topFiles: parseLimit(env, 'top-files', { integer: true }) ?? 10,
  };
}
