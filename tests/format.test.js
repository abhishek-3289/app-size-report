import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compare, summarize } from '../src/analysis.js';
import { commentMarker, formatBytes, formatDelta, formatPercent, percentOf, renderReport } from '../src/format.js';
import { evaluateThresholds } from '../src/thresholds.js';

describe('formatBytes', () => {
  const cases = [
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048524, '1023.9 KB'],
    [1048575, '1.0 MB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [1.25 * 1024 ** 3, '1.3 GB'],
    [-2048, '-2.0 KB'],
    [-500, '-500 B'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => assert.equal(formatBytes(input), expected));
  }
});

describe('formatDelta', () => {
  it('signs positive, negative and zero deltas', () => {
    assert.equal(formatDelta(2048), '+2.0 KB');
    assert.equal(formatDelta(-3 * 1024 * 1024), '-3.0 MB');
    assert.equal(formatDelta(12), '+12 B');
    assert.equal(formatDelta(0), '0 B');
    assert.equal(formatDelta(null), 'n/a');
  });
});

describe('formatPercent', () => {
  it('formats with two decimals and a sign', () => {
    assert.equal(formatPercent(5), '+5.00%');
    assert.equal(formatPercent(-1.234), '-1.23%');
    assert.equal(formatPercent(0.004), '0.00%');
    assert.equal(formatPercent(-0.004), '0.00%');
    assert.equal(formatPercent(null), 'n/a');
    assert.equal(formatPercent(Infinity), 'n/a');
  });

  it('computes percent of a base size', () => {
    assert.equal(percentOf(50, 200), 25);
    assert.equal(percentOf(50, 0), null);
    assert.equal(percentOf(null, 10), null);
  });
});

describe('commentMarker', () => {
  it('embeds the name in a hidden HTML comment', () => {
    assert.equal(commentMarker('app-release.apk'), '<!-- app-size-report:app-release.apk -->');
  });

  it('strips sequences that would close the comment early', () => {
    assert.equal(commentMarker('evil --> <b>'), '<!-- app-size-report:evil - b -->');
  });
});

const entry = (name, compressedSize) => ({ name, compressedSize, uncompressedSize: compressedSize * 2 });
const base = summarize(
  { fileSize: 1024 * 1024, entries: [entry('classes.dex', 400000), entry('lib/arm64-v8a/libold.so', 100000)] },
  'apk',
);
const head = summarize(
  {
    fileSize: 1024 * 1024 + 51200,
    entries: [entry('classes.dex', 450000), entry('assets/new|file`.bin', 2048)],
  },
  'apk',
);
const noLimits = { maxIncreaseBytes: null, maxIncreasePercent: null };

function render({ withBase = true, limits = noLimits, topFiles = 10 } = {}) {
  const comparison = compare(head, withBase ? base : null, topFiles);
  const thresholds = evaluateThresholds({ diffBytes: comparison.diffBytes, diffPercent: comparison.diffPercent, ...limits });
  return renderReport({
    name: 'app-release.apk',
    head,
    base: withBase ? base : null,
    basePath: withBase ? 'base/app-release.apk' : 'missing/app-release.apk',
    comparison,
    thresholds,
    limits,
    topFiles,
  });
}

describe('renderReport', () => {
  it('renders an overview, categories and changed entries with a baseline', () => {
    const report = render();
    assert.match(report, /^### 📦 App size: `app-release\.apk`\n/);
    assert.match(report, /Android APK is \*\*1\.0 MB\*\*, \+50\.0 KB \(\+4\.88%\) compared to the baseline\./);
    assert.match(report, /\| \*\*File size\*\* \| 1\.0 MB \| \*\*1\.0 MB\*\* \| \*\*\+50\.0 KB \(\+4\.88%\)\*\* \|/);
    assert.match(report, /\| Entry count \| 2 \| 2 \| 0 \|/);
    assert.match(report, /\| dex \| 390\.6 KB \| 439\.5 KB \| \+48\.8 KB \(\+12\.50%\) \|/);
    assert.match(report, /\| native \| 97\.7 KB \| 0 B \| -97\.7 KB \(-100\.00%\) \|/);
    assert.match(report, /#### 3 changed entries \(compressed\)/);
    assert.match(report, /\| `lib\/arm64-v8a\/libold\.so` \| removed \| 97\.7 KB \| - \| -97\.7 KB \|/);
    assert.match(report, /\| `assets\/new\\\|file'\.bin` \| added \| - \| 2\.0 KB \| \+2\.0 KB \|/);
    assert.doesNotMatch(report, /app-size-report:/);
    assert.doesNotMatch(report, /CAUTION/);
  });

  it('says how many changed entries were left out', () => {
    assert.match(render({ topFiles: 1 }), /#### Top 1 of 3 changed entries \(compressed\)/);
  });

  it('omits the entry table when top-files is 0', () => {
    assert.doesNotMatch(render({ topFiles: 0 }), /changed entries/);
  });

  it('renders head only when there is no baseline', () => {
    const report = render({ withBase: false });
    assert.match(report, /No baseline artifact was found at `missing\/app-release\.apk`/);
    assert.match(report, /\| \| Head \|/);
    assert.match(report, /\| dex \| 439\.5 KB \|/);
    assert.match(report, /#### Largest 2 entries \(compressed\)/);
    assert.doesNotMatch(report, /\| Base \|/);
  });

  it('shows a caution block when a limit is exceeded', () => {
    const report = render({ limits: { maxIncreaseBytes: 1024, maxIncreasePercent: 1 } });
    assert.match(report, /> \[!CAUTION\]\n> Size limit exceeded:\n> - size grew by \+50\.0 KB \(51200 bytes\)/);
    assert.match(report, /> - size grew by \+4\.88%, more than the allowed \+1\.00%/);
  });

  it('confirms the limits when they are respected', () => {
    const report = render({ limits: { maxIncreaseBytes: 1024 * 1024, maxIncreasePercent: 10 } });
    assert.match(report, /Within the allowed increase of 1\.0 MB and \+10\.00%\./);
  });

  it('labels App Bundles and IPAs', () => {
    const ipa = summarize({ fileSize: 2048, entries: [entry('Payload/A.app/A', 1000)] }, 'ipa');
    const comparison = compare(ipa, null, 5);
    const report = renderReport({
      name: 'A.ipa',
      head: ipa,
      base: null,
      basePath: '',
      comparison,
      thresholds: { exceeded: false, reasons: [] },
      limits: noLimits,
      topFiles: 5,
    });
    assert.match(report, /iOS IPA is \*\*2\.0 KB\*\*\. No baseline artifact was found, so/);
    assert.match(report, /\| binary \| 1000 B \|/);
  });
});
