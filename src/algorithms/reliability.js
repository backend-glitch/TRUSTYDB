import { consistency, median } from './consensus.js';

/**
 * Bootstrap reliability is the mean closeness to an unweighted per-entity median.
 * The reference is calculated before any source is scored or selected, so it is a
 * consensus estimate rather than a circular "chosen value equals truth" rule.
 */
export function bootstrapReliability(records) {
  const byEntity = new Map();
  for (const record of records) {
    const group = byEntity.get(record.entityId) || [];
    group.push(record);
    byEntity.set(record.entityId, group);
  }

  const totals = new Map();
  for (const group of byEntity.values()) {
    const reference = median(group.map((record) => record.price));
    for (const record of group) {
      const source = totals.get(record.sourceId) || { total: 0, agreement: 0 };
      source.total += 1;
      source.agreement += consistency(record.price, reference);
      totals.set(record.sourceId, source);
    }
  }

  return new Map([...totals].map(([sourceId, value]) => [sourceId, value.agreement / value.total]));
}
