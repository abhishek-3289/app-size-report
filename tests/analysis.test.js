import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compare, summarize } from '../src/analysis.js';

const entry = (name, compressedSize, uncompressedSize = compressedSize * 2) => ({ name, compressedSize, uncompressedSize });

const baseArchive = {
  fileSize: 10000,
  entries: [
    entry('classes.dex', 4000),
    entry('lib/arm64-v8a/libold.so', 1500),
    entry('res/layout/main.xml', 300),
    entry('assets/data.json', 200),
    entry('AndroidManifest.xml', 100),
  ],
};

const headArchive = {
  fileSize: 12500,
  entries: [
    entry('classes.dex', 4800),
    entry('classes2.dex', 2000),
    entry('res/layout/main.xml', 300),
    entry('assets/data.json', 150),
    entry('AndroidManifest.xml', 100, 999),
  ],
};

describe('summarize', () => {
  it('totals sizes and groups compressed size by category', () => {
    const summary = summarize(baseArchive, 'apk');
    assert.equal(summary.kind, 'apk');
    assert.equal(summary.fileSize, 10000);
    assert.equal(summary.compressed, 6100);
    assert.equal(summary.uncompressed, 12200);
    assert.equal(summary.entryCount, 5);
    assert.deepEqual(summary.categories, { dex: 4000, native: 1500, resources: 300, assets: 200, other: 100 });
  });

  it('adds up duplicate entry names', () => {
    const summary = summarize({ fileSize: 10, entries: [entry('a.txt', 3, 5), entry('a.txt', 4, 6)] }, 'apk');
    assert.deepEqual(summary.files.get('a.txt'), { compressed: 7, uncompressed: 11 });
  });

  it('uses iOS categories for IPA files', () => {
    const summary = summarize({ fileSize: 10, entries: [entry('Payload/A.app/A', 7)] }, 'ipa');
    assert.deepEqual(summary.categories, { binary: 7, frameworks: 0, assets: 0, resources: 0, other: 0 });
  });
});

describe('compare', () => {
  const head = summarize(headArchive, 'apk');
  const base = summarize(baseArchive, 'apk');

  it('computes file size difference and percent', () => {
    const result = compare(head, base, 10);
    assert.equal(result.hasBaseline, true);
    assert.equal(result.diffBytes, 2500);
    assert.equal(result.diffPercent, 25);
  });

  it('computes category deltas', () => {
    const result = compare(head, base, 10);
    assert.deepEqual(result.categories, [
      { name: 'dex', head: 6800, base: 4000, diff: 2800 },
      { name: 'native', head: 0, base: 1500, diff: -1500 },
      { name: 'resources', head: 300, base: 300, diff: 0 },
      { name: 'assets', head: 150, base: 200, diff: -50 },
      { name: 'other', head: 100, base: 100, diff: 0 },
    ]);
  });

  it('lists added, removed and changed entries by absolute compressed change', () => {
    const result = compare(head, base, 10);
    assert.equal(result.changedEntryCount, 5);
    assert.deepEqual(result.entries, [
      { name: 'classes2.dex', status: 'added', head: 2000, base: null, diff: 2000 },
      { name: 'lib/arm64-v8a/libold.so', status: 'removed', head: null, base: 1500, diff: -1500 },
      { name: 'classes.dex', status: 'changed', head: 4800, base: 4000, diff: 800 },
      { name: 'assets/data.json', status: 'changed', head: 150, base: 200, diff: -50 },
      { name: 'AndroidManifest.xml', status: 'changed', head: 100, base: 100, diff: 0 },
    ]);
  });

  it('limits the entry list to top-files', () => {
    const result = compare(head, base, 2);
    assert.equal(result.entries.length, 2);
    assert.equal(result.changedEntryCount, 5);
    assert.equal(compare(head, base, 0).entries.length, 0);
  });

  it('reports no changes for identical archives', () => {
    const result = compare(base, summarize(baseArchive, 'apk'), 10);
    assert.equal(result.diffBytes, 0);
    assert.equal(result.diffPercent, 0);
    assert.deepEqual(result.entries, []);
    assert.equal(result.changedEntryCount, 0);
  });

  it('lists the largest head entries without a baseline', () => {
    const result = compare(head, null, 2);
    assert.equal(result.hasBaseline, false);
    assert.equal(result.diffBytes, null);
    assert.equal(result.diffPercent, null);
    assert.equal(result.changedEntryCount, null);
    assert.deepEqual(result.categories[0], { name: 'dex', head: 6800, base: null, diff: null });
    assert.deepEqual(result.entries.map((change) => change.name), ['classes.dex', 'classes2.dex']);
  });
});
