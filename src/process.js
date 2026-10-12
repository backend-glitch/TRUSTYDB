import { closePool, getConnection } from './config/database.js';
import { runPipeline } from './services/pipelineService.js';

function divider(title = '') { console.log(`\n${'='.repeat(58)}${title ? `\n${title}` : ''}\n${'='.repeat(58)}`); }

let connection;
try {
  divider('TRUSTYDB BACKEND');
  console.log('Connecting to Oracle and preparing TRUSTYDB...');
  connection = await getConnection();
  const report = await runPipeline(connection);
  for (const [source, count] of Object.entries(report.csvCounts)) console.log(`✓ ${source}: ${count} records`);
  if (report.inputMode === 'csv') {
    console.log(`\nTotal CSV records processed: ${report.totalCsvRecords}`);
    console.log(`New records inserted: ${report.importResult.inserted}; duplicate imports skipped: ${report.importResult.skipped}`);
  } else {
    console.log('\nUsing existing TRUSTYDB records from Oracle (database input mode).');
  }
  if (report.schemaCreated.length) console.log(`Schema bootstrap created: ${report.schemaCreated.join(', ')}`);
  console.log(`Entities found: ${report.entitiesFound}`);
  console.log(`\nConflict Detection\n------------------\nConflicts detected: ${report.conflictsDetected} (${report.conflictsCreated} new)`);
  console.log('\nTrust Evaluation\n----------------');
  for (const [source, score] of Object.entries(report.sourceReliability)) console.log(`${source} bootstrap reliability: ${(score * 100).toFixed(2)}%`);
  console.log(`\nRecommendations generated: ${report.recommendationsGenerated}`);
  const sample = report.sample;
  if (sample.entityId) {
    console.log(`\nSample Conflict\n---------------\nEntity ID: ${sample.entityId}\nProduct: ${sample.productName}`);
    for (const record of sample.records) console.log(`${record.sourceName} → ₹${record.price.toFixed(2)} | trust ${record.score.toFixed(2)}`);
    console.log(`Reference (unweighted median): ₹${sample.referencePrice.toFixed(2)}`);
    console.log(`Recommended: ${sample.recommendation.sourceName} → ₹${sample.recommendation.price.toFixed(2)}`);
    console.log(`Reason: ${sample.recommendation.reason}`);
  }
  divider('PROCESSING COMPLETE');
} catch (error) {
  console.error(`\nTRUSTYDB processing failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
  await closePool();
}
