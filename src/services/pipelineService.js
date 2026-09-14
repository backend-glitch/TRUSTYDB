import { config } from '../config/env.js';
import { bootstrapReliability } from '../algorithms/reliability.js';
import { median, consistency, consensusVerification } from '../algorithms/consensus.js';
import { freshnessFromTimestamp } from '../algorithms/freshness.js';
import { calculateTrustScore, scoreReason } from '../algorithms/trustScore.js';
import { loadCorrectedCsvs } from './csvService.js';
import * as db from './databaseService.js';

function groupByEntity(records) {
  const groups = new Map();
  for (const record of records) {
    const group = groups.get(record.entityId) || [];
    group.push(record);
    groups.set(record.entityId, group);
  }
  return groups;
}

export async function runPipeline(connection) {
  const { records: csvRecords, counts } = await loadCorrectedCsvs();
  try {
    const sourceMap = await db.getSourceMap(connection, [...counts.keys()]);
    const entitiesInserted = await db.ensureEntities(connection, csvRecords);
    const importResult = await db.importRecords(connection, csvRecords, sourceMap);
    const conflictRecords = await db.fetchPriceConflicts(connection);
    const conflicts = groupByEntity(conflictRecords);
    const reliability = bootstrapReliability(conflictRecords);
    const sourceReliability = new Map();
    for (const [sourceName, sourceId] of sourceMap) {
      const sourceRows = conflictRecords.filter((record) => record.sourceId === sourceId);
      sourceReliability.set(sourceName, await db.updateSourceHistory(connection, sourceId, sourceRows.length, reliability.get(sourceId) || 0));
    }

    const sample = { referencePrice: null, records: [], recommendation: null, productName: null, entityId: null };
    let conflictsCreated = 0;
    for (const [entityId, records] of conflicts) {
      const { conflictId, created } = await db.getOrCreateConflict(connection, entityId);
      if (created) conflictsCreated += 1;
      const reference = median(records.map((record) => record.price));
      const scored = [];
      for (const record of records) {
        const factors = {
          reliability: sourceReliability.get(record.sourceName) || 0,
          freshness: freshnessFromTimestamp(record.recordTimestamp, config.freshnessWindowDays),
          verification: consensusVerification(record.price, reference),
          consistency: consistency(record.price, reference)
        };
        const score = calculateTrustScore(factors);
        const reason = scoreReason({ ...factors, score });
        await db.replaceTrustScore(connection, record.recordId, score, reason);
        scored.push({ ...record, score, reason, factors });
      }
      scored.sort((left, right) => right.score - left.score || left.recordId - right.recordId);
      const winner = scored[0];
      const recommendationReason = `Record ${winner.recordId} selected because its final trust score of ${winner.score.toFixed(2)} is the highest for this PRICE conflict. ${winner.reason}`;
      await db.replaceRecommendation(connection, conflictId, winner.recordId, recommendationReason);
      if (!sample.entityId) Object.assign(sample, { entityId, productName: winner.productName, referencePrice: reference, records: scored, recommendation: { ...winner, reason: recommendationReason } });
    }
    await connection.commit();
    return {
      csvCounts: Object.fromEntries(counts), totalCsvRecords: csvRecords.length, entitiesInserted, importResult,
      entitiesFound: new Set(csvRecords.map((record) => record.entityId)).size, conflictsDetected: conflicts.size,
      conflictsCreated, recommendationsGenerated: conflicts.size, sourceReliability: Object.fromEntries(sourceReliability), sample
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
