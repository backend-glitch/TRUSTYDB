import oracledb from 'oracledb';

const OUT_FORMAT = { outFormat: oracledb.OUT_FORMAT_OBJECT };

export async function ensureSourceMap(connection, sourceNames) {
  const result = await connection.execute(
    `SELECT source_id AS "sourceId", source_name AS "sourceName"
       FROM sources
      WHERE source_name IN (${sourceNames.map((_, index) => `:name${index}`).join(', ')})`,
    Object.fromEntries(sourceNames.map((name, index) => [`name${index}`, name])),
    OUT_FORMAT
  );
  const sourceMap = new Map(result.rows.map((row) => [row.sourceName, row.sourceId]));
  const missing = sourceNames.filter((name) => !sourceMap.has(name));
  if (missing.length) {
    const maximum = await connection.execute('SELECT NVL(MAX(source_id), 0) AS "maxId" FROM sources', {}, OUT_FORMAT);
    let nextId = Number(maximum.rows[0].maxId);
    for (const sourceName of missing) {
      nextId += 1;
      await connection.execute(
        'INSERT INTO sources (source_id, source_name) VALUES (:sourceId, :sourceName)',
        { sourceId: nextId, sourceName }
      );
      sourceMap.set(sourceName, nextId);
    }
  }
  return sourceMap;
}

export async function fetchExistingInputSummary(connection) {
  const [sources, counts, entities] = await Promise.all([
    connection.execute('SELECT source_id AS "sourceId", source_name AS "sourceName" FROM sources ORDER BY source_id', {}, OUT_FORMAT),
    connection.execute(`SELECT s.source_name AS "sourceName", COUNT(r.record_id) AS "recordCount"
      FROM sources s JOIN records r ON r.source_id = s.source_id GROUP BY s.source_name`, {}, OUT_FORMAT),
    connection.execute('SELECT COUNT(DISTINCT entity_id) AS "entityCount" FROM records', {}, OUT_FORMAT)
  ]);
  const sourceMap = new Map(sources.rows.map((row) => [row.sourceName, row.sourceId]));
  const sourceCounts = new Map(counts.rows.map((row) => [row.sourceName, Number(row.recordCount)]));
  if (sourceMap.size < 2) throw new Error('Database mode requires at least two sources in SOURCES.');
  return { sourceMap, counts: sourceCounts, entitiesFound: Number(entities.rows[0].entityCount) };
}

export async function ensureEntities(connection, records) {
  const entityById = new Map();
  for (const record of records) if (!entityById.has(record.entityId)) entityById.set(record.entityId, record);
  let inserted = 0;
  for (const record of entityById.values()) {
    const exists = await connection.execute(
      'SELECT 1 FROM entities WHERE entity_id = :entityId', { entityId: record.entityId }, OUT_FORMAT
    );
    if (!exists.rows.length) {
      await connection.execute(
        `INSERT INTO entities (entity_id, product_name, category)
         VALUES (:entityId, :productName, :category)`,
        { entityId: record.entityId, productName: record.productName, category: record.category }
      );
      inserted += 1;
    }
  }
  return inserted;
}

export async function importRecords(connection, records, sourceMap) {
  let inserted = 0;
  let skipped = 0;
  for (const record of records) {
    const sourceId = sourceMap.get(record.sourceName);
    const binds = { sourceId, entityId: record.entityId, productTitle: record.productTitle, price: record.price, stock: record.stock };
    const existing = await connection.execute(
      `SELECT record_id AS "recordId" FROM records
        WHERE source_id = :sourceId AND entity_id = :entityId AND product_title = :productTitle
          AND price = :price AND stock = :stock FETCH FIRST 1 ROW ONLY`,
      binds, OUT_FORMAT
    );
    if (existing.rows.length) { skipped += 1; continue; }
    await connection.execute(
      `INSERT INTO records (source_id, entity_id, product_title, price, stock)
       VALUES (:sourceId, :entityId, :productTitle, :price, :stock)`, binds
    );
    inserted += 1;
  }
  return { inserted, skipped };
}

export async function fetchPriceConflicts(connection) {
  const result = await connection.execute(
    `SELECT r.record_id AS "recordId", r.source_id AS "sourceId", r.entity_id AS "entityId",
            r.product_title AS "productTitle", r.price AS "price", r.stock AS "stock",
            r.record_timestamp AS "recordTimestamp", s.source_name AS "sourceName",
            e.product_name AS "productName", e.category AS "category"
       FROM records r
       JOIN sources s ON s.source_id = r.source_id
       JOIN entities e ON e.entity_id = r.entity_id
      WHERE r.entity_id IN (
        SELECT entity_id FROM records GROUP BY entity_id HAVING COUNT(DISTINCT price) > 1
      )
      ORDER BY r.entity_id, r.source_id, r.record_id`,
    {}, OUT_FORMAT
  );
  return result.rows.map((row) => ({ ...row, price: Number(row.price), stock: Number(row.stock) }));
}

export async function getOrCreateConflict(connection, entityId) {
  const existing = await connection.execute(
    `SELECT conflict_id AS "conflictId" FROM conflicts
      WHERE entity_id = :entityId AND attribute_name = 'PRICE'
      ORDER BY conflict_id FETCH FIRST 1 ROW ONLY`, { entityId }, OUT_FORMAT
  );
  if (existing.rows.length) {
    await connection.execute(`UPDATE conflicts SET status = 'DETECTED' WHERE conflict_id = :conflictId`, existing.rows[0]);
    return { conflictId: existing.rows[0].conflictId, created: false };
  }
  const inserted = await connection.execute(
    `INSERT INTO conflicts (entity_id, attribute_name, status)
     VALUES (:entityId, 'PRICE', 'DETECTED') RETURNING conflict_id INTO :conflictId`,
    { entityId, conflictId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
  );
  return { conflictId: inserted.outBinds.conflictId[0], created: true };
}

export async function replaceTrustScore(connection, recordId, score, reason) {
  await connection.execute('DELETE FROM trust_scores WHERE record_id = :recordId', { recordId });
  await connection.execute(
    `INSERT INTO trust_scores (record_id, trust_score, reason)
     VALUES (:recordId, :score, :reason)`, { recordId, score, reason }
  );
}

export async function replaceRecommendation(connection, conflictId, recordId, reason) {
  await connection.execute('DELETE FROM recommendations WHERE conflict_id = :conflictId', { conflictId });
  await connection.execute(
    `INSERT INTO recommendations (conflict_id, record_id, reason)
     VALUES (:conflictId, :recordId, :reason)`, { conflictId, recordId, reason }
  );
}

export async function updateSourceHistory(connection, sourceId, totalRecords, bootstrapScore) {
  const history = await connection.execute(
    `SELECT history_id AS "historyId", total_records AS "totalRecords", verified_records AS "verifiedRecords",
            correct_records AS "correctRecords"
       FROM source_history WHERE source_id = :sourceId ORDER BY last_updated DESC, history_id DESC FETCH FIRST 1 ROW ONLY`,
    { sourceId }, OUT_FORMAT
  );
  const current = history.rows[0];
  const verified = Number(current?.verifiedRecords || 0);
  const correct = Number(current?.correctRecords || 0);
  // Verified outcomes, once supplied later, take precedence over bootstrap consensus.
  const score = verified > 0 ? correct / verified : bootstrapScore;
  const historyBinds = { totalRecords, verified, correct, score };
  if (current) {
    // The UPDATE has exactly five named placeholders. Do not pass sourceId here:
    // it was used only by the preceding SELECT and caused Oracle NJS-098.
    await connection.execute(
      `UPDATE source_history
          SET total_records = :totalRecords, verified_records = :verified, correct_records = :correct,
              reliability_score = :score * 100, last_updated = CURRENT_TIMESTAMP
        WHERE history_id = :historyId`, { ...historyBinds, historyId: current.historyId }
    );
  } else {
    await connection.execute(
      `INSERT INTO source_history (source_id, total_records, verified_records, correct_records, reliability_score)
       VALUES (:sourceId, :totalRecords, :verified, :correct, :score * 100)`, { sourceId, ...historyBinds }
    );
  }
  return score;
}

export async function fetchAllConflicts(connection) {
  const result = await connection.execute(
    `SELECT c.conflict_id AS "conflictId", c.entity_id AS "entityId", c.attribute_name AS "attributeName", c.status,
            e.product_name AS "productName", COUNT(r.record_id) AS "recordCount"
       FROM conflicts c JOIN entities e ON e.entity_id = c.entity_id
       LEFT JOIN records r ON r.entity_id = c.entity_id
      WHERE c.attribute_name = 'PRICE'
      GROUP BY c.conflict_id, c.entity_id, c.attribute_name, c.status, e.product_name
      ORDER BY c.conflict_id`, {}, OUT_FORMAT
  );
  return result.rows;
}

export async function fetchConflictDetails(connection, conflictId) {
  const conflict = await connection.execute(
    `SELECT c.conflict_id AS "conflictId", c.entity_id AS "entityId", c.attribute_name AS "attributeName", c.status,
            e.product_name AS "productName", e.category
       FROM conflicts c JOIN entities e ON e.entity_id = c.entity_id WHERE c.conflict_id = :conflictId`,
    { conflictId }, OUT_FORMAT
  );
  if (!conflict.rows.length) return null;
  const records = await connection.execute(
    `SELECT r.record_id AS "recordId", s.source_name AS "sourceName", r.product_title AS "productTitle", r.price,
            r.stock, ts.trust_score AS "trustScore", ts.reason
       FROM records r JOIN sources s ON s.source_id = r.source_id
       LEFT JOIN trust_scores ts ON ts.record_id = r.record_id
      WHERE r.entity_id = :entityId ORDER BY r.source_id, r.record_id`, { entityId: conflict.rows[0].entityId }, OUT_FORMAT
  );
  const recommendation = await connection.execute(
    `SELECT r.record_id AS "recordId", s.source_name AS "sourceName", r.price, rec.reason
       FROM recommendations rec JOIN records r ON r.record_id = rec.record_id
       JOIN sources s ON s.source_id = r.source_id WHERE rec.conflict_id = :conflictId`, { conflictId }, OUT_FORMAT
  );
  return { ...conflict.rows[0], records: records.rows, recommendation: recommendation.rows[0] || null };
}

export async function fetchRecommendations(connection) {
  const result = await connection.execute(
    `SELECT rec.recommendation_id AS "recommendationId", c.conflict_id AS "conflictId", e.entity_id AS "entityId",
            e.product_name AS "productName", s.source_name AS "sourceName", r.record_id AS "recordId", r.price,
            ts.trust_score AS "trustScore", rec.reason
       FROM recommendations rec JOIN conflicts c ON c.conflict_id = rec.conflict_id
       JOIN records r ON r.record_id = rec.record_id JOIN sources s ON s.source_id = r.source_id
       JOIN entities e ON e.entity_id = c.entity_id LEFT JOIN trust_scores ts ON ts.record_id = r.record_id
      ORDER BY c.conflict_id`, {}, OUT_FORMAT
  );
  return result.rows;
}

export async function fetchSourcesWithHistory(connection) {
  const result = await connection.execute(
    `SELECT s.source_id AS "sourceId", s.source_name AS "sourceName", h.total_records AS "totalRecords",
            h.verified_records AS "verifiedRecords", h.correct_records AS "correctRecords",
            h.reliability_score AS "reliabilityScore", h.last_updated AS "lastUpdated"
       FROM sources s LEFT JOIN source_history h ON h.history_id = (
         SELECT h2.history_id FROM source_history h2 WHERE h2.source_id = s.source_id
         ORDER BY h2.last_updated DESC, h2.history_id DESC FETCH FIRST 1 ROW ONLY
       ) ORDER BY s.source_id`, {}, OUT_FORMAT
  );
  return result.rows;
}
