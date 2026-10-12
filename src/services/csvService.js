import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';

const REQUIRED_COLUMNS = ['source_name', 'entity_id', 'product_name', 'product_title', 'category', 'price', 'stock'];
const serviceDirectory = path.dirname(fileURLToPath(import.meta.url));
// Support both the current coursework layout (backend/ beside the CSV files) and
// a normal repository clone with the backend files at repository root.
const dataDirectories = [
  ...(config.dataDirectory ? [path.resolve(config.dataDirectory)] : []),
  path.resolve(serviceDirectory, '../../..'),
  path.resolve(serviceDirectory, '../..')
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = []; field = '';
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  return rows;
}

function validateRow(row, fileName, rowNumber) {
  const entityId = Number(row.entity_id);
  const price = Number(row.price);
  const stock = Number(row.stock);
  if (!Number.isInteger(entityId) || entityId <= 0) throw new Error(`${fileName}, row ${rowNumber}: entity_id must be a positive integer.`);
  if (!Number.isFinite(price) || price < 0) throw new Error(`${fileName}, row ${rowNumber}: price must be a non-negative number.`);
  if (!Number.isInteger(stock) || stock < 0) throw new Error(`${fileName}, row ${rowNumber}: stock must be a non-negative integer.`);
  if (!row.source_name || !row.product_name || !row.product_title || !row.category) {
    throw new Error(`${fileName}, row ${rowNumber}: source_name, product_name, product_title and category are required.`);
  }
  return { sourceName: row.source_name.trim(), entityId, productName: row.product_name.trim(), productTitle: row.product_title.trim(), category: row.category.trim(), price, stock };
}

export function normalizeUploadedRecords(records) {
  if (!Array.isArray(records) || !records.length) throw new Error('Upload at least one non-empty CSV file.');
  const normalized = records.map((record, index) => validateRow({
    source_name: record.sourceName,
    entity_id: record.entityId,
    product_name: record.productName,
    product_title: record.productTitle,
    category: record.category,
    price: record.price,
    stock: record.stock
  }, 'uploaded data', index + 1));
  const counts = new Map();
  for (const record of normalized) counts.set(record.sourceName, (counts.get(record.sourceName) || 0) + 1);
  if (counts.size < 2) throw new Error('Upload data must contain at least two distinct source_name values.');
  return { records: normalized, counts };
}

async function discoverFiles() {
  if (config.sourceFiles) {
    const requestedFiles = config.sourceFiles.split(',').map((file) => file.trim()).filter(Boolean);
    if (requestedFiles.length < 2) throw new Error('TRUSTYDB_SOURCE_FILES must list at least two CSV files.');
    return requestedFiles.map((file) => {
      if (path.isAbsolute(file)) return file;
      const found = dataDirectories.map((directory) => path.join(directory, file)).find(existsSync);
      if (!found) throw new Error(`Configured source CSV was not found: ${file}`);
      return found;
    });
  }
  for (const directory of dataDirectories) {
    if (!existsSync(directory)) continue;
    const files = (await fs.readdir(directory))
      .filter((file) => /^TRUSTYDB_SOURCE_.*\.csv$/i.test(file))
      .map((file) => path.join(directory, file));
    if (files.length >= 2) return files.sort();
  }
  throw new Error(`No source CSV files were found. Set TRUSTYDB_DATA_DIR or TRUSTYDB_SOURCE_FILES. Looked in: ${dataDirectories.join(', ')}`);
}

export async function loadSourceCsvs() {
  const files = await discoverFiles();
  const allRecords = [];
  const counts = new Map();
  for (const file of files) {
    const fileName = path.basename(file);
    let text;
    try { text = await fs.readFile(file, 'utf8'); }
    catch { throw new Error(`Required CSV file was not found: ${file}`); }
    const [header, ...rows] = parseCsv(text);
    if (!header || header.join(',') !== REQUIRED_COLUMNS.join(',')) {
      throw new Error(`${fileName}: expected columns exactly: ${REQUIRED_COLUMNS.join(', ')}`);
    }
    const records = rows.map((values, index) => {
      if (values.length !== REQUIRED_COLUMNS.length) throw new Error(`${fileName}, row ${index + 2}: expected ${REQUIRED_COLUMNS.length} columns.`);
      return validateRow(Object.fromEntries(REQUIRED_COLUMNS.map((column, columnIndex) => [column, values[columnIndex]])), fileName, index + 2);
    });
    const sourceNames = new Set(records.map((record) => record.sourceName));
    if (!sourceNames.size) throw new Error(`${fileName}: the file contains no data rows.`);
    if (sourceNames.size !== 1) throw new Error(`${fileName}: each CSV file must contain exactly one source_name.`);
    const sourceName = [...sourceNames][0];
    counts.set(sourceName, (counts.get(sourceName) || 0) + records.length);
    allRecords.push(...records);
  }
  if (counts.size < 2) throw new Error('At least two distinct sources are required to detect conflicts.');
  return { records: allRecords, counts };
}

// Kept as a compatibility alias for existing callers.
export const loadCorrectedCsvs = loadSourceCsvs;
