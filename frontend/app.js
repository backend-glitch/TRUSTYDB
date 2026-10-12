const byId = (id) => document.getElementById(id);
const state = { conflicts: [], recommendations: [], sources: [] };
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
  byId(target).innerHTML = rows.length ? rows.map(renderer).join('') : `<tr><td class="empty-row" colspan="${colspan}">No data is available yet. Run processing after Oracle is configured.</td></tr>`;
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
    const detail = await request(`/api/conflicts/${conflictId}`);
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

byId('refresh-button').addEventListener('click', () => refresh().catch((error) => showMessage(error.message, 'error')));
byId('process-button').addEventListener('click', async () => {
  if (!window.confirm('Run the import, conflict detection, trust evaluation, and recommendation pipeline now?')) return;
  const button = byId('process-button'); button.disabled = true; button.textContent = 'Processing…';
  try { const report = await request('/api/process', { method: 'POST' }); showMessage(`Processing complete: ${report.conflictsDetected} conflicts and ${report.recommendationsGenerated} recommendations evaluated.`, 'success'); await refresh(); }
  catch (error) { showMessage(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = 'Run processing'; }
});
document.addEventListener('click', (event) => { const button = event.target.closest('[data-conflict]'); if (button) openConflict(button.dataset.conflict); });
byId('close-detail').addEventListener('click', closeDetail); byId('scrim').addEventListener('click', closeDetail);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => { document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('is-active')); link.classList.add('is-active'); }));
refresh().catch((error) => showMessage(error.message, 'error'));
