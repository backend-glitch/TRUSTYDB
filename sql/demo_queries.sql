-- TRUSTYDB Review-2 SQL*Plus demonstration queries
SET LINESIZE 220
SET PAGESIZE 60
COLUMN source_name FORMAT A12
COLUMN product_name FORMAT A42
COLUMN product_title FORMAT A48
COLUMN attribute_name FORMAT A10
COLUMN status FORMAT A10
COLUMN reliability_score FORMAT 990.00
COLUMN trust_score FORMAT 990.00
COLUMN reason FORMAT A75 WORD_WRAPPED

PROMPT 1. Sources
SELECT source_id, source_name FROM sources ORDER BY source_id;

PROMPT 2. Imported-record counts by source
SELECT s.source_name, COUNT(*) AS record_count
FROM sources s LEFT JOIN records r ON r.source_id = s.source_id
GROUP BY s.source_name ORDER BY s.source_name;

PROMPT 3. Detected PRICE conflicts
SELECT c.conflict_id, c.entity_id, e.product_name, c.attribute_name, c.status
FROM conflicts c JOIN entities e ON e.entity_id = c.entity_id
WHERE c.attribute_name = 'PRICE'
ORDER BY c.conflict_id FETCH FIRST 15 ROWS ONLY;

PROMPT 4. Three source values for one conflicted entity (change 1 if needed)
SELECT r.entity_id, s.source_name, r.product_title, r.price, r.stock, r.record_timestamp
FROM records r JOIN sources s ON s.source_id = r.source_id
WHERE r.entity_id = 1 ORDER BY s.source_id;

PROMPT 5. Trust scores with generated explanations
SELECT r.entity_id, s.source_name, r.price, ts.trust_score, ts.reason
FROM trust_scores ts JOIN records r ON r.record_id = ts.record_id
JOIN sources s ON s.source_id = r.source_id
WHERE r.entity_id = 1 ORDER BY ts.trust_score DESC;

PROMPT 6. Recommendations
SELECT c.conflict_id, e.product_name, s.source_name AS recommended_source,
       r.price AS recommended_price, ts.trust_score, rec.reason
FROM recommendations rec JOIN conflicts c ON c.conflict_id = rec.conflict_id
JOIN records r ON r.record_id = rec.record_id JOIN sources s ON s.source_id = r.source_id
JOIN entities e ON e.entity_id = c.entity_id LEFT JOIN trust_scores ts ON ts.record_id = r.record_id
ORDER BY c.conflict_id FETCH FIRST 15 ROWS ONLY;

PROMPT 7. Current source reliability (bootstrap until verified outcomes exist)
SELECT s.source_id, s.source_name, h.total_records, h.verified_records,
       h.correct_records, h.reliability_score, h.last_updated
FROM sources s LEFT JOIN source_history h ON h.history_id = (
  SELECT h2.history_id FROM source_history h2 WHERE h2.source_id = s.source_id
  ORDER BY h2.last_updated DESC, h2.history_id DESC FETCH FIRST 1 ROW ONLY
)
ORDER BY s.source_id;
