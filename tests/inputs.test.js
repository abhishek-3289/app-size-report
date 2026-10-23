import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InputError, readInputs } from '../src/inputs.js';

const env = (inputs) => Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value]));

describe('readInputs', () => {
  it('applies defaults', () => {
    assert.deepEqual(readInputs(env({ 'head-path': ' build/app-release.apk ' })), {
      headPath: 'build/app-release.apk',
      basePath: '',
      name: 'app-release.apk',
      maxIncreaseBytes: null,
      maxIncreasePercent: null,
      comment: true,
      githubToken: '',
      topFiles: 10,
    });
  });

  it('reads every input using the runner variable names', () => {
    const inputs = readInputs({
      'INPUT_HEAD-PATH': 'head/App.ipa',
      'INPUT_BASE-PATH': 'base/App.ipa',
      INPUT_NAME: 'iOS',
      'INPUT_MAX-INCREASE-BYTES': '1048576',
      'INPUT_MAX-INCREASE-PERCENT': '2.5',
      INPUT_COMMENT: 'false',
      'INPUT_GITHUB-TOKEN': 'token-value',
      'INPUT_TOP-FILES': '0',
    });
    assert.deepEqual(inputs, {
      headPath: 'head/App.ipa',
      basePath: 'base/App.ipa',
      name: 'iOS',
      maxIncreaseBytes: 1048576,
      maxIncreasePercent: 2.5,
      comment: false,
      githubToken: 'token-value',
      topFiles: 0,
    });
  });

  it('requires head-path', () => {
    assert.throws(() => readInputs(env({})), /head-path is required/);
  });

  it('rejects invalid booleans and numbers', () => {
    const head = { 'head-path': 'a.apk' };
    assert.throws(() => readInputs(env({ ...head, comment: 'yes' })), InputError);
    assert.throws(() => readInputs(env({ ...head, 'max-increase-bytes': '1.5' })), /whole number/);
    assert.throws(() => readInputs(env({ ...head, 'max-increase-bytes': '-1' })), /non-negative/);
    assert.throws(() => readInputs(env({ ...head, 'max-increase-percent': '5%' })), /non-negative number/);
    assert.throws(() => readInputs(env({ ...head, 'top-files': 'ten' })), /top-files/);
    assert.throws(() => readInputs(env({ ...head, 'max-increase-bytes': '99999999999999999999' })), /too large/);
  });

  it('accepts YAML style booleans', () => {
    assert.equal(readInputs(env({ 'head-path': 'a.apk', comment: 'TRUE' })).comment, true);
    assert.equal(readInputs(env({ 'head-path': 'a.apk', comment: 'False' })).comment, false);
  });
});
