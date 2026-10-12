import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(testDirectory, '../frontend/csv-engine.js');
const fixtureDirectory = path.resolve(testDirectory, 'fixtures/TRUSTYDB_10_conflicting_CSVs_with_conflicts');

async function loadEngine() {
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(await fs.readFile(enginePath, 'utf8'), context);
  return context.globalThis.TrustyCsvEngine;
}

test('the browser engine recognizes all 10 uploaded sources and detects their price conflicts', async () => {
  const engine = await loadEngine();
  const fileNames = (await fs.readdir(fixtureDirectory)).filter((file) => file.endsWith('.csv')).sort();
  assert.equal(fileNames.length, 10);
  const parsed = await Promise.all(fileNames.map(async (fileName) => engine.parseCsvText(fileName, await fs.readFile(path.join(fixtureDirectory, fileName), 'utf8'))));
  const records = parsed.flatMap((file) => file.records);
  const result = engine.processRecords(records);

  assert.equal(records.length, 1057);
  assert.equal(result.sources.length, 10);
  assert.deepEqual([...new Set(result.sources.map((source) => source.sourceName))].sort(), ['SOURCE_A', 'SOURCE_B', 'SOURCE_C', 'SOURCE_D', 'SOURCE_E', 'SOURCE_F', 'SOURCE_G', 'SOURCE_H', 'SOURCE_I', 'SOURCE_J']);
  assert.ok(result.conflicts.length > 0);
  assert.equal(result.conflicts.length, result.recommendations.length);
  assert.equal(result.mathSample.normalizedAttribute, 'price', 'the math view should use a real price conflict when available');

  const entity100PriceConflict = result.conflicts.find((conflict) => conflict.entityId === '100' && conflict.attributeName === 'price');
  assert.ok(entity100PriceConflict, 'entity 100 should have a price conflict');
  const detail = result.details.get(entity100PriceConflict.conflictId);
  const values = new Map(detail.records.map((record) => [record.sourceName, record.selectedValue]));
  assert.equal(values.get('SOURCE_B'), '42752.74');
  assert.equal(values.get('SOURCE_D'), '44198.49');
});

test('invalid prices are excluded from PRICE conflict detection while valid values remain comparable', async () => {
  const engine = await loadEngine();
  const result = engine.processRecords([
    { sourceName: 'A', entityId: '001', productName: 'Item', productTitle: 'Item', attributes: { price: '100', colour: 'red' } },
    { sourceName: 'B', entityId: '1', productName: 'Item', productTitle: 'Item', attributes: { price: 'invalid', colour: 'red' } },
    { sourceName: 'C', entityId: '1', productName: 'Item', productTitle: 'Item', attributes: { price: '110', colour: 'red' } }
  ]);
  assert.ok(result.conflicts.some((conflict) => conflict.attributeName === 'price'));
  const priceConflict = result.conflicts.find((conflict) => conflict.attributeName === 'price');
  assert.equal(result.details.get(priceConflict.conflictId).records.length, 2);
});
