const byId = (id) => document.getElementById(id);
const state = { conflicts: [], recommendations: [], sources: [], localDetails: new Map(), uploadedRecords: [] };
// Relative API calls work when served by Node/Render. The localhost fallback lets
// the visual review console work when index.html is opened directly from Finder.
const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';

function text(value) { return String(value ?? '—'); }
function currency(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value)); }
function score(value) { return value == null ? '—' : `${Number(value).toFixed(2)}`; }
function reliability(value) { return value == null ? '—' : `${Number(value).toFixed(2)}%`; }
function date(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function escapeHtml(value) { return text(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]); }

async function request(path, options) {
  const response = await fetch(`${apiBase}${path.replace(/^\/api/, '')}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function showMessage(message, kind = '') {
  const element = byId('app-message');
  element.textContent = message;
  element.className = `alert${kind ? ` is-${kind}` : ''}`;
  element.hidden = false;
}
function clearMessage() { byId('app-message').hidden = true; }
function renderRows(target, rows, renderer, colspan) {
  byId(target).innerHTML = rows.length ? rows.map(renderer).join('') : `<tr><td class="empty-row" colspan="${colspan}">No data yet. Upload two or more source CSV files to begin conflict review.</td></tr>`;
}

function render() {
  byId('conflict-count').textContent = state.conflicts.length;
  byId('recommendation-count').textContent = state.recommendations.length;
  byId('source-count').textContent = state.sources.length;
  byId('conflicts-meta').textContent = `${state.conflicts.length} detected conflict${state.conflicts.length === 1 ? '' : 's'}`;
  renderRows('conflicts-body', state.conflicts.slice(0, 20), (item) => `<tr><td>#${escapeHtml(item.conflictId)}</td><td>${escapeHtml(item.entityId)}</td><td class="cell-product">${escapeHtml(item.productName)}</td><td>${escapeHtml(item.attributeName)}</td><td><span class="status">${escapeHtml(item.status)}</span></td><td><button class="row-button" type="button" data-conflict="${escapeHtml(item.conflictId)}">Review</button></td></tr>`, 6);
  renderRows('recommendations-body', state.recommendations.slice(0, 20), (item) => `<tr><td>${escapeHtml(item.entityId)}</td><td class="cell-product">${escapeHtml(item.productName)}</td><td>${escapeHtml(item.sourceName)}</td><td>${currency(item.PRICE ?? item.price)}</td><td class="score">${score(item.trustScore)}</td><td><button class="row-button" type="button" data-conflict="${escapeHtml(item.conflictId)}">Evidence</button></td></tr>`, 6);
  renderRows('sources-body', state.sources, (item) => `<tr><td><strong>${escapeHtml(item.sourceName)}</strong></td><td>${text(item.totalRecords)}</td><td>${text(item.verifiedRecords)}</td><td>${text(item.correctRecords)}</td><td class="score">${reliability(item.reliabilityScore)}</td><td>${date(item.lastUpdated)}</td></tr>`, 6);
}

async function refresh() {
  if (window.location.protocol === 'file:') {
    byId('service-dot').className = 'status-dot is-ok';
    byId('service-status').textContent = 'Local CSV mode';
    byId('database-status').textContent = 'Not used';
    byId('database-detail').textContent = 'Nothing stored in Oracle';
    render();
    return;
  }
  clearMessage();
  const [health, database, conflicts, recommendations, sources] = await Promise.allSettled([
    request('/api/health'), request('/api/health/database'), request('/api/conflicts'), request('/api/recommendations'), request('/api/sources')
  ]);
  const serviceOk = health.status === 'fulfilled';
  const databaseOk = database.status === 'fulfilled';
  byId('service-dot').className = `status-dot ${serviceOk ? 'is-ok' : 'is-error'}`;
  byId('service-status').textContent = serviceOk ? 'Service available' : 'Service unavailable';
  byId('database-status').textContent = databaseOk ? 'Connected' : 'Unavailable';
  byId('database-detail').textContent = databaseOk ? 'Oracle reached successfully' : 'Check database configuration';
  state.conflicts = conflicts.status === 'fulfilled' ? conflicts.value : [];
  state.recommendations = recommendations.status === 'fulfilled' ? recommendations.value : [];
  state.sources = sources.status === 'fulfilled' ? sources.value : [];
  render();
  if (!databaseOk) showMessage('The interface is available, but Oracle data could not be loaded. Configure the database connection and refresh.', 'error');
}

async function openConflict(conflictId) {
  try {
    const detail = state.localDetails.get(Number(conflictId)) || await request(`/api/conflicts/${conflictId}`);
    const recommendedId = detail.recommendation?.recordId;
    byId('detail-title').textContent = detail.productName;
    byId('detail-content').innerHTML = `<p class="detail-meta">Entity ${escapeHtml(detail.entityId)} · ${escapeHtml(detail.attributeName)} conflict · ${escapeHtml(detail.category)}</p><div class="evidence">${detail.records.map((record) => `<div class="evidence-row"><div><strong>${escapeHtml(record.sourceName)}</strong><small>${escapeHtml(record.productTitle)}</small></div><div><small>Reported price</small><strong>${currency(record.PRICE ?? record.price)}</strong></div><div><small>Trust score</small><strong>${score(record.trustScore)}${Number(record.recordId) === Number(recommendedId) ? ' · Selected' : ''}</strong></div></div>`).join('')}</div>${detail.recommendation ? `<div class="reason"><strong>Why this record was selected</strong><br>${escapeHtml(detail.recommendation.reason)}</div>` : ''}`;
    byId('detail-panel').classList.add('is-open');
    byId('detail-panel').setAttribute('aria-hidden', 'false');
    byId('scrim').hidden = false;
    byId('close-detail').focus();
  } catch (error) { showMessage(error.message, 'error'); }
}
function closeDetail() { byId('detail-panel').classList.remove('is-open'); byId('detail-panel').setAttribute('aria-hidden', 'true'); byId('scrim').hidden = true; }

const requiredColumns = ['source_name', 'entity_id', 'product_name', 'product_title', 'category', 'price', 'stock'];
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); if (row.some((value) => value !== '')) rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (quoted) throw new Error('A selected CSV contains an unclosed quoted field.');
  return rows;
}
function recordsFromCsv(fileName, csvText) {
  const [header, ...rows] = parseCsv(csvText);
  if (!header || header.join(',') !== requiredColumns.join(',')) throw new Error(`${fileName} must use columns: ${requiredColumns.join(', ')}`);
  return rows.map((values, index) => {
    if (values.length !== requiredColumns.length) throw new Error(`${fileName}, row ${index + 2}: expected ${requiredColumns.length} columns.`);
    const row = Object.fromEntries(requiredColumns.map((column, columnIndex) => [column, values[columnIndex]]));
    return { sourceName: row.source_name, entityId: row.entity_id, productName: row.product_name, productTitle: row.product_title, category: row.category, price: row.price, stock: row.stock };
  });
}
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function consistency(value, reference) { return reference === 0 ? (value === 0 ? 1 : 0) : Math.max(0, 1 - Math.abs(value - reference) / Math.abs(reference)); }
function confirmation(value, reference) {
  const deviation = reference === 0 ? (value === 0 ? 0 : 1) : Math.abs(value - reference) / Math.abs(reference);
  return deviation <= .02 ? 1 : Math.max(0, 1 - (deviation - .02) / .2);
}
function processInBrowser(records) {
  const byEntity = new Map();
  for (const record of records) {
    const group = byEntity.get(Number(record.entityId)) || [];
    group.push({ ...record, entityId: Number(record.entityId), price: Number(record.price), stock: Number(record.stock) });
    byEntity.set(Number(record.entityId), group);
  }
  const totals = new Map();
  for (const group of byEntity.values()) {
    const reference = median(group.map((record) => record.price));
    for (const record of group) {
      const value = totals.get(record.sourceName) || { total: 0, agreement: 0 };
      value.total += 1; value.agreement += consistency(record.price, reference); totals.set(record.sourceName, value);
    }
  }
  const reliabilityBySource = new Map([...totals].map(([name, value]) => [name, value.agreement / value.total]));
  const conflicts = []; const recommendations = []; const details = new Map(); let conflictId = 1; let recordId = 1;
  for (const [entityId, group] of byEntity) {
    if (new Set(group.map((record) => record.price)).size < 2) continue;
    const reference = median(group.map((record) => record.price));
    const scored = group.map((record) => {
      const factors = { reliability: reliabilityBySource.get(record.sourceName) || 0, freshness: 1, verification: confirmation(record.price, reference), consistency: consistency(record.price, reference) };
      const trustScore = Math.round(100 * (.4 * factors.reliability + .2 * factors.freshness + .2 * factors.verification + .2 * factors.consistency) * 100) / 100;
      const scoredRecord = { ...record, recordId: recordId++, trustScore, factors };
      scoredRecord.reason = `Source reliability: ${factors.reliability.toFixed(2)}, freshness: ${factors.freshness.toFixed(2)}, consensus confirmation: ${factors.verification.toFixed(2)}, consistency: ${factors.consistency.toFixed(2)}. Final trust score: ${trustScore.toFixed(2)}.`;
      return scoredRecord;
    }).sort((left, right) => right.trustScore - left.trustScore || left.recordId - right.recordId);
    const winner = scored[0];
    const recommendationReason = `Record ${winner.recordId} selected because its trust score of ${winner.trustScore.toFixed(2)} is the highest for this PRICE conflict. ${winner.reason}`;
    const conflict = { conflictId, entityId, productName: winner.productName, category: winner.category, attributeName: 'PRICE', status: 'DETECTED', recordCount: scored.length };
    const recommendation = { recommendationId: conflictId, conflictId, entityId, productName: winner.productName, sourceName: winner.sourceName, recordId: winner.recordId, price: winner.price, trustScore: winner.trustScore, reason: recommendationReason };
    conflicts.push(conflict); recommendations.push(recommendation);
    details.set(conflictId, { ...conflict, records: scored, recommendation: { recordId: winner.recordId, sourceName: winner.sourceName, price: winner.price, reason: recommendationReason } });
    conflictId += 1;
  }
  state.conflicts = conflicts; state.recommendations = recommendations;
  state.sources = [...totals].map(([sourceName, value]) => ({ sourceName, totalRecords: value.total, verifiedRecords: 0, correctRecords: 0, reliabilityScore: (reliabilityBySource.get(sourceName) || 0) * 100, lastUpdated: new Date().toISOString() }));
  state.localDetails = details; state.uploadedRecords = records; render();
  byId('service-dot').className = 'status-dot is-ok'; byId('service-status').textContent = 'Local CSV mode';
  byId('database-status').textContent = 'Not used'; byId('database-detail').textContent = 'No SQL storage';
  return { totalRecords: records.length, sourceCount: state.sources.length, conflictsDetected: conflicts.length, recommendationsGenerated: recommendations.length };
}
async function uploadSources(files) {
  if (files.length < 2) throw new Error('Select at least two source CSV files to compare.');
  const fileRecords = await Promise.all([...files].map(async (file) => recordsFromCsv(file.name, await file.text())));
  const records = fileRecords.flat();
  const sourceNames = new Set(records.map((record) => record.sourceName.trim()));
  if (sourceNames.size < 2) throw new Error('The selected files must contain at least two distinct source_name values.');
  return processInBrowser(records);
}

byId('refresh-button').addEventListener('click', () => refresh().catch((error) => showMessage(error.message, 'error')));
byId('process-button').addEventListener('click', async () => {
  if (!state.uploadedRecords.length) { byId('upload-input').click(); return; }
  const report = processInBrowser(state.uploadedRecords);
  showMessage(`Processing complete: ${report.conflictsDetected} conflicts and ${report.recommendationsGenerated} recommendations generated locally.`, 'success');
});
byId('upload-button').addEventListener('click', () => byId('upload-input').click());
byId('upload-input').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  if (!input.files.length) return;
  const button = byId('upload-button'); button.disabled = true; button.textContent = 'Uploading…';
  try {
    const report = await uploadSources(input.files);
    showMessage(`Upload processed locally: ${report.totalRecords} records from ${report.sourceCount} sources. ${report.conflictsDetected} conflicts and ${report.recommendationsGenerated} recommendations generated.`, 'success');
  } catch (error) { showMessage(error.message, 'error'); }
  finally { input.value = ''; button.disabled = false; button.textContent = 'Upload source CSVs'; }
});
document.addEventListener('click', (event) => { const button = event.target.closest('[data-conflict]'); if (button) openConflict(button.dataset.conflict); });
byId('close-detail').addEventListener('click', closeDetail); byId('scrim').addEventListener('click', closeDetail);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => { document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('is-active')); link.classList.add('is-active'); }));
refresh().catch((error) => showMessage(error.message, 'error'));
