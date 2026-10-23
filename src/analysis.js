import { categorize, categoriesFor } from './categories.js';

export function summarize(archive, kind) {
  const categories = Object.fromEntries(categoriesFor(kind).map((name) => [name, 0]));
  const files = new Map();
  let compressed = 0;
  let uncompressed = 0;
  for (const entry of archive.entries) {
    compressed += entry.compressedSize;
    uncompressed += entry.uncompressedSize;
    categories[categorize(entry.name, kind)] += entry.compressedSize;
    const previous = files.get(entry.name) ?? { compressed: 0, uncompressed: 0 };
    files.set(entry.name, {
      compressed: previous.compressed + entry.compressedSize,
      uncompressed: previous.uncompressed + entry.uncompressedSize,
    });
  }
  return {
    kind,
    fileSize: archive.fileSize,
    compressed,
    uncompressed,
    entryCount: archive.entries.length,
    categories,
    files,
  };
}

function byMagnitude(a, b) {
  return Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name);
}

function changedEntries(head, base) {
  const names = new Set([...head.files.keys(), ...base.files.keys()]);
  const changes = [];
  for (const name of names) {
    const after = head.files.get(name);
    const before = base.files.get(name);
    if (after && before && after.compressed === before.compressed && after.uncompressed === before.uncompressed) {
      continue;
    }
    const status = !before ? 'added' : !after ? 'removed' : 'changed';
    const headSize = after ? after.compressed : null;
    const baseSize = before ? before.compressed : null;
    changes.push({ name, status, head: headSize, base: baseSize, diff: (headSize ?? 0) - (baseSize ?? 0) });
  }
  return changes.sort(byMagnitude);
}

function largestEntries(head) {
  return [...head.files.entries()]
    .map(([name, size]) => ({ name, status: 'present', head: size.compressed, base: null, diff: size.compressed }))
    .sort(byMagnitude);
}

export function compare(head, base, topFiles) {
  const categories = Object.keys(head.categories).map((name) => {
    const headSize = head.categories[name];
    const baseSize = base ? (base.categories[name] ?? 0) : null;
    return { name, head: headSize, base: baseSize, diff: base ? headSize - baseSize : null };
  });
  const allChanges = base ? changedEntries(head, base) : largestEntries(head);
  const diffBytes = base ? head.fileSize - base.fileSize : null;
  const diffPercent = base && base.fileSize > 0 ? (diffBytes / base.fileSize) * 100 : null;
  return {
    hasBaseline: Boolean(base),
    diffBytes,
    diffPercent,
    categories,
    entries: allChanges.slice(0, topFiles),
    changedEntryCount: base ? allChanges.length : null,
  };
}
