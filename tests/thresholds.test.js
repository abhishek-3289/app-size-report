import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateThresholds } from '../src/thresholds.js';

const evaluate = (overrides) =>
  evaluateThresholds({ diffBytes: 2048, diffPercent: 4, maxIncreaseBytes: null, maxIncreasePercent: null, ...overrides });

describe('evaluateThresholds', () => {
  it('never triggers without limits', () => {
    assert.deepEqual(evaluate({}), { exceeded: false, reasons: [] });
  });

  it('never triggers without a baseline', () => {
    assert.deepEqual(evaluate({ diffBytes: null, diffPercent: null, maxIncreaseBytes: 0, maxIncreasePercent: 0 }), {
      exceeded: false,
      reasons: [],
    });
  });

  it('triggers on the byte limit', () => {
    const result = evaluate({ maxIncreaseBytes: 1024 });
    assert.equal(result.exceeded, true);
    assert.deepEqual(result.reasons, ['size grew by +2.0 KB (2048 bytes), more than the allowed 1.0 KB (1024 bytes)']);
  });

  it('allows growth equal to the byte limit', () => {
    assert.equal(evaluate({ maxIncreaseBytes: 2048 }).exceeded, false);
  });

  it('triggers on the percent limit', () => {
    const result = evaluate({ maxIncreasePercent: 3.5 });
    assert.equal(result.exceeded, true);
    assert.deepEqual(result.reasons, ['size grew by +4.00%, more than the allowed +3.50%']);
  });

  it('allows growth equal to the percent limit', () => {
    assert.equal(evaluate({ maxIncreasePercent: 4 }).exceeded, false);
  });

  it('triggers when either limit is exceeded', () => {
    assert.equal(evaluate({ maxIncreaseBytes: 1000, maxIncreasePercent: 50 }).exceeded, true);
    assert.equal(evaluate({ maxIncreaseBytes: 100000, maxIncreasePercent: 1 }).exceeded, true);
    assert.equal(evaluate({ maxIncreaseBytes: 1000, maxIncreasePercent: 1 }).reasons.length, 2);
    assert.equal(evaluate({ maxIncreaseBytes: 100000, maxIncreasePercent: 50 }).exceeded, false);
  });

  it('treats a zero limit as no growth allowed and ignores shrinking', () => {
    assert.equal(evaluate({ diffBytes: 1, diffPercent: 0.01, maxIncreaseBytes: 0 }).exceeded, true);
    assert.equal(evaluate({ diffBytes: -500, diffPercent: -2, maxIncreaseBytes: 0, maxIncreasePercent: 0 }).exceeded, false);
  });
});
