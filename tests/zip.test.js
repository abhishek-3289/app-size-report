import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import zlib from 'node:zlib';
import { ZipError, readZip } from '../src/zip.js';
import { buildZip, bytes, crc32, tempDir, writeZip } from './helpers/zip-writer.js';

const dir = tempDir();
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('crc32 helper', () => {
  it('matches the reference check value', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  });
});

describe('readZip', () => {
  it('reads stored and deflated entry sizes', () => {
    const text = 'a'.repeat(5000);
    const random = bytes(3000);
    const file = writeZip(dir, 'mixed.zip', [
      { name: 'stored.bin', data: random, method: 'store' },
      { name: 'deflated.txt', data: text },
    ]);
    const archive = readZip(file);
    assert.equal(archive.fileSize, fs.statSync(file).size);
    assert.deepEqual(archive.entries, [
      { name: 'stored.bin', method: 0, compressedSize: 3000, uncompressedSize: 3000 },
      { name: 'deflated.txt', method: 8, compressedSize: zlib.deflateRawSync(text).length, uncompressedSize: 5000 },
    ]);
    assert.ok(archive.entries[1].compressedSize < 100);
  });

  it('reads many entries', () => {
    const files = Array.from({ length: 1500 }, (_, index) => ({ name: `res/raw/file_${index}.txt`, data: `content ${index}` }));
    const archive = readZip(writeZip(dir, 'many.zip', files));
    assert.equal(archive.entries.length, 1500);
    assert.equal(archive.entries[1499].name, 'res/raw/file_1499.txt');
    assert.equal(archive.entries[1499].uncompressedSize, 'content 1499'.length);
  });

  it('finds the end of central directory behind an archive comment', () => {
    const archive = readZip(writeZip(dir, 'comment.zip', [{ name: 'a.txt', data: 'abc' }], { comment: 'x'.repeat(2000) }));
    assert.equal(archive.entries.length, 1);
    assert.equal(archive.entries[0].uncompressedSize, 3);
  });

  it('skips directory entries', () => {
    const archive = readZip(writeZip(dir, 'dirs.zip', [
      { name: 'lib/', data: '', method: 'store' },
      { name: 'lib/x86/libx.so', data: 'so' },
    ]));
    assert.deepEqual(archive.entries.map((entry) => entry.name), ['lib/x86/libx.so']);
  });

  it('decodes UTF-8 names with and without the language encoding flag', () => {
    const flagged = readZip(writeZip(dir, 'utf8.zip', [{ name: 'res/ünïcode.txt', data: 'x' }]));
    const unflagged = readZip(writeZip(dir, 'utf8-noflag.zip', [{ name: 'res/ünïcode.txt', data: 'x' }], { utf8Flag: false }));
    assert.equal(flagged.entries[0].name, 'res/ünïcode.txt');
    assert.equal(unflagged.entries[0].name, 'res/ünïcode.txt');
  });

  it('reads ZIP64 end of central directory and extra fields', () => {
    const archive = readZip(writeZip(dir, 'zip64.zip', [
      { name: 'classes.dex', data: bytes(4096) },
      { name: 'assets/big.txt', data: 'z'.repeat(10000) },
    ], { zip64: true }));
    assert.equal(archive.entries.length, 2);
    assert.equal(archive.entries[0].uncompressedSize, 4096);
    assert.equal(archive.entries[1].uncompressedSize, 10000);
    assert.equal(archive.entries[1].compressedSize, zlib.deflateRawSync('z'.repeat(10000)).length);
  });

  it('rejects a file that is not a ZIP archive', () => {
    const file = path.join(dir, 'corrupt.apk');
    fs.writeFileSync(file, bytes(4096, 7));
    assert.throws(() => readZip(file), ZipError);
  });

  it('rejects a tiny file', () => {
    const file = path.join(dir, 'tiny.zip');
    fs.writeFileSync(file, 'PK');
    assert.throws(() => readZip(file), /too small/);
  });

  it('rejects an archive whose central directory was cut off', () => {
    const full = buildZip([{ name: 'a.txt', data: bytes(2000) }, { name: 'b.txt', data: bytes(2000, 3) }]);
    const eocd = full.subarray(full.length - 22);
    const truncated = Buffer.concat([full.subarray(0, 1000), eocd]);
    const file = path.join(dir, 'truncated.zip');
    fs.writeFileSync(file, truncated);
    assert.throws(() => readZip(file), /outside the file|corrupt|truncated/);
  });

  it('rejects ZIP64 markers without a locator', () => {
    const full = buildZip([{ name: 'a.txt', data: 'abc' }], { zip64: true });
    const withoutLocator = Buffer.concat([full.subarray(0, full.length - 22 - 20 - 56), full.subarray(full.length - 22)]);
    const file = path.join(dir, 'no-locator.zip');
    fs.writeFileSync(file, withoutLocator);
    assert.throws(() => readZip(file), /locator is missing/);
  });

  it('rejects a corrupt central directory header', () => {
    const full = buildZip([{ name: 'a.txt', data: 'abc' }]);
    const centralOffset = full.readUInt32LE(full.length - 22 + 16);
    full.writeUInt32LE(0xdeadbeef, centralOffset);
    const file = path.join(dir, 'bad-header.zip');
    fs.writeFileSync(file, full);
    assert.throws(() => readZip(file), /entry 1 of 1 is corrupt/);
  });
});
