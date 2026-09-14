# TRUSTYDB backend

This is the Node.js + Oracle implementation for Review 2. It deliberately contains no frontend. It imports the three corrected CSVs, detects PRICE conflicts, calculates data-driven bootstrap reliability, produces explainable trust scores, and persists recommendations in Oracle.

## Prerequisites and setup

Use Node.js 20 or later and an Oracle Database reachable through SQL*Plus. The database must already contain the tables named in the project brief (`SOURCES`, `ENTITIES`, `RECORDS`, `CONFLICTS`, `TRUST_SCORES`, `RECOMMENDATIONS`, `SOURCE_HISTORY`) and the three `SOURCE_A`/`SOURCE_B`/`SOURCE_C` rows.

```bash
cd "/Users/ayushsahu/Desktop/DBS Project/backend"
cp .env.example .env
# edit .env with the real Oracle password
npm install
npm run process
```

The official `oracledb` package uses Thin mode by default. If the local setup needs Oracle Thick mode, set `ORACLE_CLIENT_LIB_DIR` in `.env` to the Instant Client directory. Credentials never belong in source control; `.env` is intentionally not supplied.

Run the automated, database-free formula tests with:

```bash
npm test
```

## Processing pipeline

`npm run process` uses one transaction. It validates the CSV header and values, then:

1. Maps CSV source names to existing `SOURCES` IDs and ensures missing `ENTITIES` are inserted.
2. Imports each record only when the same source, entity, title, price and stock combination is not already present.
3. Detects a PRICE conflict whenever an entity has more than one distinct price and reuses its existing `CONFLICTS` row when present.
4. Creates an unweighted median price for each conflicted entity as its consensus reference.
5. Calculates bootstrap reliability, trust scores and recommendations, then commits all results together. A failure rolls back the run.

This makes repeated normal runs safe: records are skipped, conflicts are reused, and the current trust score/recommendation for a conflict is replaced instead of duplicated. Original `RECORDS` are never deleted or overwritten.

## Explainable trust model

The initial data has no external price verification, so this backend does **not** claim ground truth. Its bootstrap score is a consensus-based estimate:

```text
reference price(entity) = unweighted median of reported prices
source bootstrap reliability = mean(max(0, 1 - |price - reference| / reference))
```

The median is computed before sources are scored or records are selected. It is therefore a transparent reference, not a circular rule saying a selected record is correct. `SOURCE_HISTORY.reliability_score` stores this result on a **0–100** scale until verified outcomes are added. When a source history row has `verified_records > 0`, its reliability instead becomes `correct_records / verified_records`; this takes precedence over bootstrap consensus.

Every conflicting record receives a 0–100 trust score:

```text
100 × (0.40 × source reliability
     + 0.20 × freshness
     + 0.20 × consensus confirmation
     + 0.20 × consistency)
```

- Freshness is calculated from `RECORDS.record_timestamp`: `max(0, 1 - age_in_days / 30)`. Change the 30-day window using `FRESHNESS_WINDOW_DAYS`; the CSV is never used for freshness.
- Consistency is `max(0, 1 - normalized price deviation from the median)`.
- Consensus confirmation is a separate, initial verification signal: it is 1 when price is within 2% of the median and falls linearly to 0 by 22% deviation. It is explicitly not external verification.

The highest trust score is stored in `RECOMMENDATIONS`. Ties are stable: the smaller generated `record_id` wins, and the reason text explains every factor.

## API

Start the backend API with `npm start`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check without a database connection |
| POST | `/api/process` | Runs the same import-and-trust pipeline as the CLI |
| GET | `/api/conflicts` | Lists PRICE conflicts |
| GET | `/api/conflicts/:id` | Conflict records, scores, and recommendation |
| GET | `/api/recommendations` | Lists selected records |
| GET | `/api/sources` | Sources and latest reliability history |
| GET | `/api/sources/:id/history` | Latest history for a source |

For example: `curl http://localhost:3000/api/health`.

## SQL*Plus demonstration

After processing, run the supplied queries from SQL*Plus:

```sql
@/Users/ayushsahu/Desktop/DBS\ Project/backend/sql/demo_queries.sql
```

The script demonstrates sources, imported record counts, conflicts, three competing source values, trust-score reasons, recommendations, and source reliability. No schema alteration is required: freshness is calculated dynamically from the existing timestamp column.
