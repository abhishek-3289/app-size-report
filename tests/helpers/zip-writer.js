import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip64Extra(values) {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + index * 8));
  return extra;
}

export function buildZip(files, { zip64 = false, comment = '', utf8Flag = true } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data ?? '');
    const method = file.method === 'store' ? 0 : 8;
    const payload = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const flags = utf8Flag ? 0x0800 : 0;
    const marker = 0xffffffff;
    const localExtra = zip64 ? zip64Extra([data.length, payload.length]) : Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64 ? marker : payload.length, 18);
    local.writeUInt32LE(zip64 ? marker : data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    chunks.push(local, name, localExtra, payload);

    const centralExtra = zip64 ? zip64Extra([data.length, payload.length, offset]) : Buffer.alloc(0);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(zip64 ? 45 : 20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(zip64 ? marker : payload.length, 20);
    header.writeUInt32LE(zip64 ? marker : data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(centralExtra.length, 30);
    header.writeUInt32LE(zip64 ? marker : offset, 42);
    central.push(header, name, centralExtra);
    offset += local.length + name.length + localExtra.length + payload.length;
  }
  const centralBuffer = Buffer.concat(central);
  const centralOffset = offset;
  const trailer = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(files.length), 24);
    record.writeBigUInt64LE(BigInt(files.length), 32);
    record.writeBigUInt64LE(BigInt(centralBuffer.length), 40);
    record.writeBigUInt64LE(BigInt(centralOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(centralOffset + centralBuffer.length), 8);
    locator.writeUInt32LE(1, 16);
    trailer.push(record, locator);
  }
  const commentBuffer = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(zip64 ? 0xffff : files.length, 8);
  eocd.writeUInt16LE(zip64 ? 0xffff : files.length, 10);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : centralBuffer.length, 12);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : centralOffset, 16);
  eocd.writeUInt16LE(commentBuffer.length, 20);
  return Buffer.concat([...chunks, centralBuffer, ...trailer, eocd, commentBuffer]);
}

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'app-size-report-'));
}

export function writeZip(directory, fileName, files, options) {
  const filePath = path.join(directory, fileName);
  fs.writeFileSync(filePath, buildZip(files, options));
  return filePath;
}

export function bytes(length, seed = 1) {
  const buffer = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    buffer[index] = state & 0xff;
  }
  return buffer;
}

export function apkFiles({ dexSize = 4000, extraDex = false, nativeSize = 3000, seed = 1 } = {}) {
  const files = [
    { name: 'AndroidManifest.xml', data: 'x'.repeat(500) },
    { name: 'classes.dex', data: bytes(dexSize, seed) },
    { name: 'lib/arm64-v8a/libapp.so', data: bytes(nativeSize, seed + 1), method: 'store' },
    { name: 'res/layout/main.xml', data: 'layout'.repeat(50) },
    { name: 'resources.arsc', data: bytes(1000, seed + 2), method: 'store' },
    { name: 'assets/data.json', data: '{"key":"value"}'.repeat(40) },
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\n' },
  ];
  if (extraDex) files.push({ name: 'classes2.dex', data: bytes(2000, seed + 3) });
  return files;
}
