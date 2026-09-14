import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_COLUMNS = ['source_name', 'entity_id', 'product_name', 'product_title', 'category', 'price', 'stock'];
const serviceDirectory = path.dirname(fileURLToPath(import.meta.url));
// Support both the current coursework layout (backend/ beside the CSV files) and
// a normal repository clone with the backend files at repository root.
const dataDirectories = [
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

export async function loadCorrectedCsvs() {
  const names = ['A', 'B', 'C'];
  const fileNames = names.map((name) => `TRUSTYDB_SOURCE_${name}_CORRECTED.csv`);
  const dataDirectory = dataDirectories.find((directory) => fileNames.every((fileName) => existsSync(path.join(directory, fileName))));
  if (!dataDirectory) {
    throw new Error(`Required CSV files were not found. Looked in: ${dataDirectories.join(', ')}`);
  }
  const files = fileNames.map((fileName) => path.join(dataDirectory, fileName));
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
    const expectedSource = `SOURCE_${path.basename(file).match(/SOURCE_([ABC])/)?.[1]}`;
    if (records.some((record) => record.sourceName !== expectedSource)) throw new Error(`${fileName}: source_name must be ${expectedSource}.`);
    counts.set(records[0]?.sourceName || expectedSource, records.length);
    allRecords.push(...records);
  }
  return { records: allRecords, counts };
}
