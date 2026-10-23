import fs from 'node:fs';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_LENGTH = 22;
const ZIP64_LOCATOR_LENGTH = 20;
const ZIP64_EOCD_LENGTH = 56;
const CENTRAL_HEADER_LENGTH = 46;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_EXTRA_ID = 0x0001;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const UTF8_FLAG = 0x0800;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const read = fs.readSync(fd, buffer, filled, length - filled, position + filled);
    if (read === 0) break;
    filled += read;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

function toSafeNumber(value, what) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError(`${what} is larger than ${Number.MAX_SAFE_INTEGER} bytes and cannot be represented`);
  }
  return Number(value);
}

function findEndOfCentralDirectory(fd, fileSize) {
  if (fileSize < EOCD_LENGTH) {
    throw new ZipError('file is too small to be a ZIP archive');
  }
  const tailLength = Math.min(fileSize, EOCD_LENGTH + MAX_COMMENT_LENGTH);
  const tailStart = fileSize - tailLength;
  const tail = readAt(fd, tailStart, tailLength);
  for (let index = tail.length - EOCD_LENGTH; index >= 0; index--) {
    if (tail.readUInt32LE(index) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(index + 20);
    if (index + EOCD_LENGTH + commentLength > tail.length) continue;
    return { offset: tailStart + index, record: tail.subarray(index, index + EOCD_LENGTH) };
  }
  throw new ZipError('end of central directory record not found; the file is not a ZIP archive or is truncated');
}

function readZip64Directory(fd, eocdOffset) {
  if (eocdOffset < ZIP64_LOCATOR_LENGTH) return null;
  const locator = readAt(fd, eocdOffset - ZIP64_LOCATOR_LENGTH, ZIP64_LOCATOR_LENGTH);
  if (locator.length < ZIP64_LOCATOR_LENGTH || locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) return null;
  const recordOffset = toSafeNumber(locator.readBigUInt64LE(8), 'ZIP64 end of central directory offset');
  const record = readAt(fd, recordOffset, ZIP64_EOCD_LENGTH);
  if (record.length < ZIP64_EOCD_LENGTH || record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
    throw new ZipError('ZIP64 end of central directory record is missing or corrupt');
  }
  return {
    entryCount: toSafeNumber(record.readBigUInt64LE(32), 'ZIP64 entry count'),
    size: toSafeNumber(record.readBigUInt64LE(40), 'ZIP64 central directory size'),
    offset: toSafeNumber(record.readBigUInt64LE(48), 'ZIP64 central directory offset'),
  };
}

function locateCentralDirectory(fd, fileSize) {
  const eocd = findEndOfCentralDirectory(fd, fileSize);
  const record = eocd.record;
  const classic = {
    entryCount: record.readUInt16LE(10),
    size: record.readUInt32LE(12),
    offset: record.readUInt32LE(16),
  };
  const usesZip64Markers =
    classic.entryCount === UINT16_MAX || classic.size === UINT32_MAX || classic.offset === UINT32_MAX;
  const zip64 = readZip64Directory(fd, eocd.offset);
  if (!zip64 && usesZip64Markers) {
    throw new ZipError('archive uses ZIP64 markers but the ZIP64 end of central directory locator is missing');
  }
  const directory = zip64 ?? classic;
  if (directory.offset + directory.size > fileSize) {
    throw new ZipError('central directory points outside the file; the archive is truncated or corrupt');
  }
  return directory;
}

function applyZip64Extra(extra, entry) {
  let position = 0;
  while (position + 4 <= extra.length) {
    const id = extra.readUInt16LE(position);
    const length = extra.readUInt16LE(position + 2);
    const data = extra.subarray(position + 4, position + 4 + length);
    if (id === ZIP64_EXTRA_ID) {
      let cursor = 0;
      const next = (what) => {
        if (cursor + 8 > data.length) {
          throw new ZipError(`ZIP64 extra field of "${entry.name}" is too short for the ${what}`);
        }
        const value = toSafeNumber(data.readBigUInt64LE(cursor), `${what} of "${entry.name}"`);
        cursor += 8;
        return value;
      };
      if (entry.uncompressedSize === UINT32_MAX) entry.uncompressedSize = next('uncompressed size');
      if (entry.compressedSize === UINT32_MAX) entry.compressedSize = next('compressed size');
      return;
    }
    position += 4 + length;
  }
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function decodeName(bytes, flags) {
  if (flags & UTF8_FLAG) return bytes.toString('utf8');
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

function parseCentralDirectory(buffer, entryCount) {
  const entries = [];
  let position = 0;
  for (let index = 0; index < entryCount; index++) {
    if (position + CENTRAL_HEADER_LENGTH > buffer.length || buffer.readUInt32LE(position) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipError(`central directory entry ${index + 1} of ${entryCount} is corrupt`);
    }
    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const uncompressedSize = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const nameStart = position + CENTRAL_HEADER_LENGTH;
    const extraStart = nameStart + nameLength;
    const end = extraStart + extraLength + commentLength;
    if (end > buffer.length) {
      throw new ZipError(`central directory entry ${index + 1} of ${entryCount} is truncated`);
    }
    const entry = {
      name: decodeName(buffer.subarray(nameStart, extraStart), flags),
      method,
      compressedSize,
      uncompressedSize,
    };
    applyZip64Extra(buffer.subarray(extraStart, extraStart + extraLength), entry);
    if (!entry.name.endsWith('/')) entries.push(entry);
    position = end;
  }
  return entries;
}

export function readZip(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const directory = locateCentralDirectory(fd, fileSize);
    const buffer = readAt(fd, directory.offset, directory.size);
    if (buffer.length < directory.size) {
      throw new ZipError('central directory is truncated');
    }
    return { fileSize, entries: parseCentralDirectory(buffer, directory.entryCount) };
  } finally {
    fs.closeSync(fd);
  }
}
