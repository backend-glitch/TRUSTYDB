import test from 'node:test';
import assert from 'node:assert/strict';
import { median, consistency, consensusVerification } from '../src/algorithms/consensus.js';
import { bootstrapReliability } from '../src/algorithms/reliability.js';
import { freshnessFromTimestamp } from '../src/algorithms/freshness.js';
import { calculateTrustScore } from '../src/algorithms/trustScore.js';
import { updateSourceHistory } from '../src/services/databaseService.js';

test('median is an unweighted consensus reference', () => {
  assert.equal(median([80000, 85000, 74000]), 80000);
});

test('consistency and confirmation decrease with deviation', () => {
  assert.equal(consistency(80000, 80000), 1);
  assert.ok(consistency(74000, 80000) < 1);
  assert.equal(consensusVerification(80000, 80000), 1);
  assert.ok(consensusVerification(74000, 80000) < 1);
});

test('freshness uses timestamps rather than a CSV column', () => {
  const now = new Date('2026-01-31T00:00:00Z');
  assert.equal(freshnessFromTimestamp(new Date('2026-01-01T00:00:00Z'), 30, now), 0);
  assert.equal(freshnessFromTimestamp(now, 30, now), 1);
});

test('bootstrap reliability is derived from consensus agreement', () => {
  const reliability = bootstrapReliability([
    { entityId: 1, sourceId: 1, price: 100 }, { entityId: 1, sourceId: 2, price: 105 }, { entityId: 1, sourceId: 3, price: 90 },
    { entityId: 2, sourceId: 1, price: 200 }, { entityId: 2, sourceId: 2, price: 205 }, { entityId: 2, sourceId: 3, price: 180 }
  ]);
  assert.equal(reliability.get(1), 1);
  assert.ok(reliability.get(2) < reliability.get(1));
  assert.ok(reliability.get(3) < reliability.get(2));
});

test('trust score is stored on a 0–100 scale', () => {
  assert.equal(calculateTrustScore({ reliability: 1, freshness: 1, verification: 1, consistency: 1 }), 100);
  assert.equal(calculateTrustScore({ reliability: 0, freshness: 0, verification: 0, consistency: 0 }), 0);
});

test('source history update passes exactly the five binds present in its UPDATE SQL', async () => {
  const calls = [];
  const connection = {
    async execute(sql, binds) {
      calls.push({ sql, binds });
      if (sql.startsWith('SELECT history_id')) {
        return { rows: [{ historyId: 12, verifiedRecords: 8, correctRecords: 7 }] };
      }
      return { rows: [] };
    }
  };
  const score = await updateSourceHistory(connection, 1, 400, 0.75);
  const update = calls[1];
  assert.equal(score, 7 / 8);
  assert.match(update.sql, /:totalRecords.*:verified.*:correct.*:score.*:historyId/s);
  assert.deepEqual(Object.keys(update.binds).sort(), ['correct', 'historyId', 'score', 'totalRecords', 'verified']);
});

test('source history insert retains its required five binds', async () => {
  const calls = [];
  const connection = {
    async execute(sql, binds) {
      calls.push({ sql, binds });
      return { rows: [] };
    }
  };
  await updateSourceHistory(connection, 2, 400, 0.8);
  const insert = calls[1];
  assert.deepEqual(Object.keys(insert.binds).sort(), ['correct', 'score', 'sourceId', 'totalRecords', 'verified']);
});
