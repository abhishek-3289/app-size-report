import { formatBytes, formatDelta, formatPercent } from './format.js';

export function evaluateThresholds({ diffBytes, diffPercent, maxIncreaseBytes, maxIncreasePercent }) {
  const reasons = [];
  if (diffBytes === null) return { exceeded: false, reasons };
  if (maxIncreaseBytes !== null && diffBytes > maxIncreaseBytes) {
    reasons.push(
      `size grew by ${formatDelta(diffBytes)} (${diffBytes} bytes), more than the allowed ${formatBytes(maxIncreaseBytes)} (${maxIncreaseBytes} bytes)`,
    );
  }
  if (maxIncreasePercent !== null && diffPercent !== null && diffPercent > maxIncreasePercent) {
    reasons.push(`size grew by ${formatPercent(diffPercent)}, more than the allowed ${formatPercent(maxIncreasePercent)}`);
  }
  return { exceeded: reasons.length > 0, reasons };
}
