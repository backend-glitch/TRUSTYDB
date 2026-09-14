export function median(values) {
  if (!values.length) throw new Error('Cannot calculate a median for an empty list.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function normalizedDeviation(value, reference) {
  if (reference === 0) return value === 0 ? 0 : 1;
  return Math.abs(value - reference) / Math.abs(reference);
}

export function consistency(value, reference) {
  return Math.max(0, 1 - normalizedDeviation(value, reference));
}

// This is a confirmation signal, not external ground truth. Values within 2%
// of the unweighted median receive full confirmation and it then decreases to 0 at 22%.
export function consensusVerification(value, reference) {
  const deviation = normalizedDeviation(value, reference);
  if (deviation <= 0.02) return 1;
  return Math.max(0, 1 - (deviation - 0.02) / 0.2);
}
