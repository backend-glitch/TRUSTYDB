import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(currentDirectory, '../../.env');

// Keeps the project dependency-light. Existing environment values take priority.
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export const config = {
  oracleUser: process.env.ORACLE_USER,
  oraclePassword: process.env.ORACLE_PASSWORD,
  oracleConnectString: process.env.ORACLE_CONNECT_STRING,
  oracleClientLibDir: process.env.ORACLE_CLIENT_LIB_DIR,
  port: Number(process.env.PORT || 3000),
  freshnessWindowDays: Number(process.env.FRESHNESS_WINDOW_DAYS || 30),
  inputMode: (process.env.TRUSTYDB_INPUT_MODE || 'csv').toLowerCase(),
  dataDirectory: process.env.TRUSTYDB_DATA_DIR,
  sourceFiles: process.env.TRUSTYDB_SOURCE_FILES
};

export function assertDatabaseConfig() {
  const missing = ['ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING']
    .filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing Oracle configuration: ${missing.join(', ')}. Copy .env.example to .env.`);
  }
  if (!['csv', 'database'].includes(config.inputMode)) {
    throw new Error('TRUSTYDB_INPUT_MODE must be either "csv" or "database".');
  }
}
