# TRUSTYDB backend

This is the Node.js + Oracle implementation for Review 2. It includes a functional browser-based review console served by the same Node.js service, so it needs no separate frontend deployment. The backend imports the three corrected CSVs, detects PRICE conflicts, calculates data-driven bootstrap reliability, produces explainable trust scores, and persists recommendations in Oracle.

## Prerequisites and setup

Use Node.js 20 or later and any Oracle Database account reachable through SQL*Plus. The user supplies their own credentials in `.env`; they are never entered in or stored by the browser.

```bash
cd "/Users/ayushsahu/Desktop/DBS Project/backend"
cp .env.example .env
# edit .env with the real Oracle password
npm install
# Creates only missing TRUSTYDB tables; existing tables are left unchanged.
npm run setup
npm run process
npm start
```

Open `http://localhost:3000/` for the review console. `npm run process` also runs the safe schema bootstrap automatically, so `npm run setup` is useful as an explicit first-run check but is not required.

The official `oracledb` package uses Thin mode by default. If the local setup needs Oracle Thick mode, set `ORACLE_CLIENT_LIB_DIR` in `.env` to the Instant Client directory. Credentials never belong in source control; `.env` is intentionally not supplied.

Run the automated, database-free formula tests with:

```bash
npm test
```

## Use your own Oracle data

TRUSTYDB is portable, but it needs a clear data contract rather than guessing the meaning of arbitrary database columns.

### Option 1: import your own source CSV files

Set `TRUSTYDB_INPUT_MODE=csv` (the default). Every source file must have these columns, in this order:

```text
source_name,entity_id,product_name,product_title,category,price,stock
```

Each file represents one source, but the source can have any name such as `MERCHANT_NORTH` or `SUPPLIER_PORTAL`. Configure either a directory or explicit comma-separated filenames:

```env
TRUSTYDB_DATA_DIR=/Users/me/my-product-sources
# or
TRUSTYDB_SOURCE_FILES=north.csv,south.csv,partner.csv
```

The processor discovers the source names, creates missing `SOURCES` rows, preserves every original record, detects PRICE conflicts, then writes its trust scores and recommendations. At least two sources are required.

### Option 2: evaluate an existing TRUSTYDB database

Set `TRUSTYDB_INPUT_MODE=database` when a user already has populated `SOURCES`, `ENTITIES`, and `RECORDS` tables using the TRUSTYDB schema. No CSV is read or inserted; the processor automatically examines the records already in Oracle and refreshes conflicts, scores, recommendations, and history.

For a fresh Oracle account, the backend creates only the missing TRUSTYDB tables. It never drops tables, deletes original `RECORDS`, or alters existing columns. The Oracle account must have `CREATE TABLE` permission only if the tables do not exist yet.

## Processing pipeline

`npm run process` uses one transaction. It validates the CSV header and values, then:

1. Safely creates missing TRUSTYDB tables and maps detected source names to `SOURCES` IDs.
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
| GET | `/` | Functional TRUSTYDB review console |
| GET | `/api/health` | Health check without a database connection |
| GET | `/api/health/database` | Verifies the configured Oracle connection |
| POST | `/api/process` | Runs the same import-and-trust pipeline as the CLI |
| POST | `/api/process/upload` | Imports browser-uploaded source CSV rows and runs the pipeline |
| GET | `/api/conflicts` | Lists PRICE conflicts |
| GET | `/api/conflicts/:id` | Conflict records, scores, and recommendation |
| GET | `/api/recommendations` | Lists selected records |
| GET | `/api/sources` | Sources and latest reliability history |
| GET | `/api/sources/:id/history` | Latest history for a source |

For example: `curl http://localhost:3000/api/health`.

The review console at `/` includes **Upload source CSVs**. Select two or more
CSV files with the documented header; the files are parsed in the browser,
sent to the user’s own locally configured backend, imported into their Oracle
database, and processed immediately. Oracle credentials are never uploaded
through the UI.

## Browser-only CSV review

When opening `frontend/index.html` directly, **Upload source CSVs** works
without Node.js, Oracle, or SQL*Plus. The selected CSV files stay in the
browser: TRUSTYDB groups rows by `entity_id`, detects entities with different
PRICE values, calculates median-consensus reliability and trust scores, and
shows a recommendation. Refreshing or closing the page clears the uploaded
data. This mode does not insert, update, or delete anything in any database.

## Deploy the CSV review console on Vercel

This repository includes `vercel.json` for the browser-only review console.
It deploys only `frontend/`: no Oracle credentials, Node server, uploaded CSV,
or database data is sent to Vercel. CSV analysis continues to run entirely in
the visitor's browser.

1. Push this repository to GitHub and import it into Vercel.
2. Keep the repository root as the Vercel Root Directory.
3. Vercel reads `vercel.json`; no environment variables, install step, or
   build command are required for this static deployment.
4. Deploy, then open the Vercel URL and select two or more CSV files.

The Oracle-backed API is deliberately not deployed to Vercel. If you need the
database API as well, deploy the Node service separately (for example, with
the included Render configuration) and keep Oracle credentials only in that
service's secret environment variables.

## Run with Docker

The Docker image contains the API and the three corrected CSV files. It uses
the Oracle Node.js driver's Thin mode, so it does not need Oracle Instant
Client installed in the container.

1. Copy and complete the local configuration if you have not already:

   ```bash
   cd "/Users/ayushsahu/Desktop/DBS Project/backend"
   cp .env.example .env
   ```

2. If Oracle is running on your computer, set `ORACLE_CONNECT_STRING` in
   `backend/.env` to `host.docker.internal:1521/FREEPDB1` (replace the service
   name as appropriate). `127.0.0.1` inside the API container refers to the
   container itself. If Oracle runs elsewhere, use its hostname instead.

3. From the project directory, build and start the API:

   ```bash
   cd "/Users/ayushsahu/Desktop/DBS Project"
   docker compose up --build -d
   curl http://localhost:3000/api/health
   ```

The Oracle database is intentionally not included in Compose. On first process
run, TRUSTYDB creates only missing tables; then it imports configured CSVs or
evaluates existing TRUSTYDB records according to `TRUSTYDB_INPUT_MODE`.
Credentials remain in `backend/.env`, which is excluded from both Git and the
Docker build context. View logs with `docker compose logs -f trustydb-api`;
stop the API with `docker compose down`. To publish the image, tag it with your
registry name after building, for example:

```bash
docker tag dbs-project-trustydb-api your-dockerhub-user/trustydb-api:latest
docker push your-dockerhub-user/trustydb-api:latest
```

## Deploy on Render

The repository includes `render.yaml`, so select **New + → Blueprint** in Render and connect the GitHub repository. Render installs dependencies with `npm ci`, starts the API with `npm start`, and checks `GET /api/health`. This health endpoint deliberately does not open a database connection, so a transient Oracle outage does not cause Render to restart a healthy HTTP process. Use `GET /api/health/database` to check actual Oracle reachability.

Set these secret environment variables in the Render dashboard (they are intentionally not committed):

| Variable | Example / purpose |
| --- | --- |
| `ORACLE_USER` | Oracle application username |
| `ORACLE_PASSWORD` | Oracle application password |
| `ORACLE_CONNECT_STRING` | A Render-reachable Oracle endpoint, such as `db.example.com:1521/FREEPDB1` |

Do **not** set `ORACLE_CONNECT_STRING` to `127.0.0.1:1521/FREEPDB1` on Render: that address refers to the Render container, not the Oracle database on your computer. The database must be hosted publicly or connected through a secure network path that permits inbound traffic from Render. Restrict access at the database/firewall layer and use TLS or an Oracle Cloud wallet where your hosting setup supports it.

The three corrected prototype CSV files are included in this repository so `POST /api/process` can run after deployment. Run it once after configuring Oracle, then verify `/api/conflicts`, `/api/recommendations`, and `/api/sources`. The process endpoint is intentionally not run during each deploy, preventing automatic reprocessing of your database.

## SQL*Plus demonstration

After processing, run the supplied queries from SQL*Plus:

```sql
@/Users/ayushsahu/Desktop/DBS\ Project/backend/sql/demo_queries.sql
```

The script demonstrates sources, imported record counts, conflicts, three competing source values, trust-score reasons, recommendations, and source reliability. No schema alteration is required: freshness is calculated dynamically from the existing timestamp column.
