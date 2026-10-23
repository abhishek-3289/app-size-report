const UNITS = ['KB', 'MB', 'GB', 'TB'];

const KIND_LABELS = { apk: 'Android APK', aab: 'Android App Bundle', ipa: 'iOS IPA' };

export function formatBytes(bytes) {
  const magnitude = Math.abs(bytes);
  if (magnitude < 1024) return `${bytes} B`;
  let value = magnitude / 1024;
  let unit = 0;
  while (Number(value.toFixed(1)) >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${bytes < 0 ? '-' : ''}${value.toFixed(1)} ${UNITS[unit]}`;
}

export function formatDelta(bytes) {
  if (bytes === null || bytes === undefined) return 'n/a';
  if (bytes === 0) return '0 B';
  return bytes > 0 ? `+${formatBytes(bytes)}` : formatBytes(bytes);
}

export function formatPercent(percent) {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 'n/a';
  const rounded = Math.round(percent * 100) / 100;
  if (rounded === 0) return '0.00%';
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`;
}

export function percentOf(diff, base) {
  if (diff === null || base === null || base === 0) return null;
  return (diff / base) * 100;
}

function formatChange(diff, base) {
  if (diff === null) return 'n/a';
  const percent = percentOf(diff, base);
  return percent === null ? formatDelta(diff) : `${formatDelta(diff)} (${formatPercent(percent)})`;
}

function sizeCell(bytes) {
  return bytes === null || bytes === undefined ? '-' : formatBytes(bytes);
}

function entryCell(name) {
  return `\`${name.replaceAll('`', "'").replaceAll('|', '\\|')}\``;
}

function signedCount(diff) {
  return diff > 0 ? `+${diff}` : `${diff}`;
}

export function commentMarker(name) {
  const safe = name.replace(/-{2,}/g, '-').replace(/[<>]/g, '');
  return `<!-- app-size-report:${safe} -->`;
}

function overviewTable(head, base) {
  if (!base) {
    return [
      '| | Head |',
      '|:--|--:|',
      `| **File size** | **${formatBytes(head.fileSize)}** |`,
      `| Compressed entries | ${formatBytes(head.compressed)} |`,
      `| Uncompressed entries | ${formatBytes(head.uncompressed)} |`,
      `| Entry count | ${head.entryCount} |`,
    ];
  }
  return [
    '| | Base | Head | Change |',
    '|:--|--:|--:|--:|',
    `| **File size** | ${formatBytes(base.fileSize)} | **${formatBytes(head.fileSize)}** | **${formatChange(head.fileSize - base.fileSize, base.fileSize)}** |`,
    `| Compressed entries | ${formatBytes(base.compressed)} | ${formatBytes(head.compressed)} | ${formatChange(head.compressed - base.compressed, base.compressed)} |`,
    `| Uncompressed entries | ${formatBytes(base.uncompressed)} | ${formatBytes(head.uncompressed)} | ${formatChange(head.uncompressed - base.uncompressed, base.uncompressed)} |`,
    `| Entry count | ${base.entryCount} | ${head.entryCount} | ${signedCount(head.entryCount - base.entryCount)} |`,
  ];
}

function categoryTable(comparison) {
  if (!comparison.hasBaseline) {
    return [
      '| Category | Head |',
      '|:--|--:|',
      ...comparison.categories.map((category) => `| ${category.name} | ${formatBytes(category.head)} |`),
    ];
  }
  return [
    '| Category | Base | Head | Change |',
    '|:--|--:|--:|--:|',
    ...comparison.categories.map(
      (category) =>
        `| ${category.name} | ${formatBytes(category.base)} | ${formatBytes(category.head)} | ${formatChange(category.diff, category.base)} |`,
    ),
  ];
}

function entriesSection(comparison, topFiles) {
  if (topFiles === 0) return [];
  if (!comparison.hasBaseline) {
    if (comparison.entries.length === 0) return [];
    return [
      '',
      `#### Largest ${comparison.entries.length} entries (compressed)`,
      '',
      '| Entry | Head |',
      '|:--|--:|',
      ...comparison.entries.map((entry) => `| ${entryCell(entry.name)} | ${formatBytes(entry.head)} |`),
    ];
  }
  if (comparison.entries.length === 0) {
    return ['', '#### Changed entries', '', 'No entries changed.'];
  }
  const shown = comparison.entries.length;
  const total = comparison.changedEntryCount;
  const heading = shown < total ? `Top ${shown} of ${total} changed entries` : `${total} changed entries`;
  return [
    '',
    `#### ${heading} (compressed)`,
    '',
    '| Entry | Status | Base | Head | Change |',
    '|:--|:--|--:|--:|--:|',
    ...comparison.entries.map(
      (entry) =>
        `| ${entryCell(entry.name)} | ${entry.status} | ${sizeCell(entry.base)} | ${sizeCell(entry.head)} | ${formatDelta(entry.diff)} |`,
    ),
  ];
}

function thresholdSection(thresholds, limits) {
  const configured = limits.maxIncreaseBytes !== null || limits.maxIncreasePercent !== null;
  if (thresholds.exceeded) {
    return ['', '> [!CAUTION]', '> Size limit exceeded:', ...thresholds.reasons.map((reason) => `> - ${reason}`)];
  }
  if (!configured) return [];
  const parts = [];
  if (limits.maxIncreaseBytes !== null) parts.push(formatBytes(limits.maxIncreaseBytes));
  if (limits.maxIncreasePercent !== null) parts.push(formatPercent(limits.maxIncreasePercent));
  return ['', `Within the allowed increase of ${parts.join(' and ')}.`];
}

export function renderReport({ name, head, base, basePath, comparison, thresholds, limits, topFiles }) {
  const lines = [`### 📦 App size: ${entryCell(name)}`, ''];
  const kind = KIND_LABELS[head.kind] ?? head.kind;
  if (base) {
    lines.push(
      `${kind} is **${formatBytes(head.fileSize)}**, ${formatChange(comparison.diffBytes, base.fileSize)} compared to the baseline.`,
    );
  } else {
    const where = basePath ? ` at ${entryCell(basePath)}` : '';
    lines.push(`${kind} is **${formatBytes(head.fileSize)}**. No baseline artifact was found${where}, so there is nothing to compare against.`);
  }
  lines.push('', ...overviewTable(head, base));
  lines.push('', '#### By category (compressed)', '', ...categoryTable(comparison));
  lines.push(...entriesSection(comparison, topFiles));
  lines.push(...thresholdSection(thresholds, limits));
  return `${lines.join('\n')}\n`;
}
