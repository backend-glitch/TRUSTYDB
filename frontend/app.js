const byId = (id) => document.getElementById(id);
const state = { conflicts: [], recommendations: [], sources: [], localDetails: new Map(), uploadedRecords: [], mathSample: null };

function text(value) { return String(value ?? '—'); }
function currency(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value)); }
function score(value) { return value == null ? '—' : `${Number(value).toFixed(2)}`; }
function reliability(value) { return value == null ? '—' : `${Number(value).toFixed(2)}%`; }
function date(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function escapeHtml(value) { return text(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]); }

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
  renderRows('recommendations-body', state.recommendations.slice(0, 20), (item) => `<tr><td>${escapeHtml(item.entityId)}</td><td class="cell-product">${escapeHtml(item.productName)}</td><td>${escapeHtml(item.attributeName)}</td><td>${escapeHtml(item.selectedValue)}</td><td class="score">${score(item.trustScore)}</td><td><button class="row-button" type="button" data-conflict="${escapeHtml(item.conflictId)}">Evidence</button></td></tr>`, 6);
  renderRows('sources-body', state.sources, (item) => `<tr><td><strong>${escapeHtml(item.sourceName)}</strong></td><td>${text(item.totalRecords)}</td><td>${text(item.verifiedRecords)}</td><td>${text(item.correctRecords)}</td><td class="score">${reliability(item.reliabilityScore)}</td><td>${date(item.lastUpdated)}</td></tr>`, 6);
  renderMathWorking();
}

function refresh() {
  clearMessage();
  byId('service-dot').className = 'status-dot is-ok';
  byId('service-status').textContent = 'Ready for CSV analysis';
  byId('analysis-status').textContent = 'Local';
  byId('analysis-detail').textContent = 'CSV analysis in this browser';
  render();
}

async function openConflict(conflictId) {
  try {
    const detail = state.localDetails.get(Number(conflictId));
    if (!detail) throw new Error('Upload CSV files first to view conflict evidence.');
    const recommendedId = detail.recommendation?.recordId;
    byId('detail-title').textContent = detail.productName;
    byId('detail-content').innerHTML = `<p class="detail-meta">Entity ${escapeHtml(detail.entityId)} · ${escapeHtml(detail.attributeName)} conflict</p><div class="evidence">${detail.records.map((record) => `<div class="evidence-row"><div><strong>${escapeHtml(record.sourceName)}</strong><small>${escapeHtml(record.productTitle)}</small></div><div><small>Reported value</small><strong>${escapeHtml(record.selectedValue)}</strong></div><div><small>Trust score</small><strong>${score(record.trustScore)}${Number(record.recordId) === Number(recommendedId) ? ' · Selected' : ''}</strong></div></div>`).join('')}</div>${detail.recommendation ? `<div class="reason"><strong>Why this value was selected</strong><br>${escapeHtml(detail.recommendation.reason)}</div>` : ''}`;
    byId('detail-panel').classList.add('is-open');
    byId('detail-panel').setAttribute('aria-hidden', 'false');
    byId('scrim').hidden = false;
    byId('close-detail').focus();
  } catch (error) { showMessage(error.message, 'error'); }
}
function closeDetail() { byId('detail-panel').classList.remove('is-open'); byId('detail-panel').setAttribute('aria-hidden', 'true'); byId('scrim').hidden = true; }

function decisionVisual(sample) {
  const detail = state.localDetails.get(Number(sample.conflictId));
  if (!detail) return '';
  const selectedId = Number(detail.recommendation?.recordId);
  const safeScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));
  const bars = detail.records.map((record) => {
    const selected = Number(record.recordId) === selectedId;
    const confidence = safeScore(record.trustScore);
    return `<li class="decision-source${selected ? ' is-selected' : ''}">
      <div class="decision-source-label"><strong>${escapeHtml(record.sourceName)}</strong><span>${escapeHtml(record.selectedValue)}</span></div>
      <div class="decision-bar" role="progressbar" aria-label="${escapeHtml(record.sourceName)} trust score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${confidence}"><span style="width:${confidence}%"></span></div>
      <output>${score(record.trustScore)}</output>
    </li>`;
  }).join('');
  const factorRows = [
    ['Source reliability', sample.winner.factors.reliability, 40],
    ['Freshness', sample.winner.factors.freshness, 20],
    ['Consensus confirmation', sample.winner.factors.verification, 20],
    ['Reference consistency', sample.winner.factors.consistency, 20]
  ].map(([label, value, weight]) => {
    const contribution = (Number(value) || 0) * weight;
    return `<li><span>${label} <small>(${weight}%)</small></span><div class="factor-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(value) * 100 || 0))}%"></span></div><strong>${contribution.toFixed(2)}</strong></li>`;
  }).join('');
  return `<section class="decision-visual" aria-labelledby="decision-visual-title">
    <div class="decision-visual-heading"><div><p class="eyebrow">Decision simulation</p><h3 id="decision-visual-title">Why ${escapeHtml(sample.winner.sourceName)} is selected</h3></div><p>Trust score out of 100</p></div>
    <div class="decision-scale" aria-hidden="true"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    <ol class="decision-sources">${bars}</ol>
    <div class="factor-summary"><div><p class="eyebrow">Selected record score</p><strong>${score(sample.winner.trustScore)}</strong><span>Weighted result</span></div><ol>${factorRows}</ol></div>
  </section>`;
}

function renderMathWorking() {
  const target = byId('math-content');
  const sample = state.mathSample;
  if (!sample) {
    target.innerHTML = '<p>Upload source CSV files to see the complete calculation for a real conflicting record.</p>';
    return;
  }
  const { winner, reference, values } = sample;
  const { reliability: sourceReliability, freshness, verification, consistency: consistencyValue } = winner.factors;
  const reportedValues = values.join(', ');
  const referenceValue = reference.numeric ? String(reference.value) : reference.value;
  const referenceMethod = reference.numeric ? 'median' : 'most frequent value';
  const consistencyFormula = reference.numeric
    ? `max(0, 1 − |${winner.selectedValue} − ${referenceValue}| / ${referenceValue}) = ${consistencyValue.toFixed(4)}`
    : `1 when the value matches the ${referenceMethod}, otherwise 0 = ${consistencyValue.toFixed(4)}`;
  target.innerHTML = `<p><strong>Sample entity ${escapeHtml(sample.entityId)}:</strong> ${escapeHtml(sample.productName)} · ${escapeHtml(sample.attributeName)}</p>
    <div class="math-grid"><div><small>Reported values</small><strong>${escapeHtml(reportedValues)}</strong></div><div><small>Reference (${referenceMethod})</small><strong>${escapeHtml(referenceValue)}</strong></div><div><small>Selected source</small><strong>${escapeHtml(winner.sourceName)}</strong></div></div>
    ${decisionVisual(sample)}
    <pre class="formula">1. Reference value = ${referenceMethod}(${reportedValues}) = ${referenceValue}
2. Source reliability = average consistency for ${winner.sourceName} across uploaded records = ${sourceReliability.toFixed(4)}
3. Freshness = 1.0000 (the selected CSV was just uploaded)
4. Consensus confirmation = ${verification.toFixed(4)}
5. Consistency = ${consistencyFormula}

Trust score = 100 × (0.40 × ${sourceReliability.toFixed(4)} + 0.20 × ${freshness.toFixed(4)} + 0.20 × ${verification.toFixed(4)} + 0.20 × ${consistencyValue.toFixed(4)})
            = ${winner.trustScore.toFixed(2)}</pre>
    <p class="math-note">The record with the highest score is recommended. The median is calculated before scoring, so the result is not based on a hard-coded preferred source.</p>`;
}

function processInBrowser(records, parseWarnings = {}) {
  const result = window.TrustyCsvEngine.processRecords(records);
  state.conflicts = result.conflicts; state.recommendations = result.recommendations; state.sources = result.sources;
  state.localDetails = result.details; state.mathSample = result.mathSample; state.uploadedRecords = result.records; render();
  byId('service-dot').className = 'status-dot is-ok'; byId('service-status').textContent = 'Local CSV mode';
  byId('analysis-status').textContent = 'Local'; byId('analysis-detail').textContent = 'CSV analysis in this browser';
  return { totalRecords: result.records.length, sourceCount: result.sources.length, conflictsDetected: result.conflicts.length, recommendationsGenerated: result.recommendations.length, validation: { ...parseWarnings, ...result.validation } };
}
async function uploadSources(files) {
  if (files.length < 2) throw new Error('Select at least two source CSV files to compare.');
  const parsedFiles = await Promise.all([...files].map(async (file) => window.TrustyCsvEngine.parseCsvText(file.name, await file.text())));
  const records = parsedFiles.flatMap((file) => file.records);
  const sourceNames = new Set(records.map((record) => record.sourceName.trim()));
  if (sourceNames.size < 2) throw new Error('Unable to identify at least two distinct sources. Add a source/vendor column or use distinct filenames.');
  const parseWarnings = parsedFiles.reduce((result, file) => Object.fromEntries(Object.keys(result).map((key) => [key, result[key] + file.warnings[key]])), { missingEntityIds: 0, invalidPrices: 0, sourceFallbacks: 0 });
  return processInBrowser(records, parseWarnings);
}

byId('refresh-button').addEventListener('click', refresh);
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
    const notices = [];
    if (report.validation.missingEntityIds) notices.push(`${report.validation.missingEntityIds} row(s) skipped: missing entity ID`);
    if (report.validation.invalidPrices) notices.push(`${report.validation.invalidPrices} invalid price value(s) ignored for price conflicts`);
    if (report.validation.duplicateRecords) notices.push(`${report.validation.duplicateRecords} duplicate row(s) skipped`);
    if (report.validation.sourceFallbacks) notices.push(`${report.validation.sourceFallbacks} row(s) used a filename-derived source`);
    showMessage(`Upload processed locally: ${report.totalRecords} records from ${report.sourceCount} sources. ${report.conflictsDetected} conflicts and ${report.recommendationsGenerated} recommendations generated.${notices.length ? ` Notice: ${notices.join('; ')}.` : ''}`, 'success');
  } catch (error) { showMessage(error.message, 'error'); }
  finally { input.value = ''; button.disabled = false; button.textContent = 'Upload source CSVs'; }
});
document.addEventListener('click', (event) => { const button = event.target.closest('[data-conflict]'); if (button) openConflict(button.dataset.conflict); });
byId('close-detail').addEventListener('click', closeDetail); byId('scrim').addEventListener('click', closeDetail);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
const navigationLinks = [...document.querySelectorAll('.nav-link')];
const navigationSections = navigationLinks
  .map((link) => ({ link, section: document.querySelector(link.getAttribute('href')) }))
  .filter((item) => item.section);
function setActiveSection(sectionId) {
  navigationLinks.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${sectionId}`));
}
navigationLinks.forEach((link) => link.addEventListener('click', () => setActiveSection(link.getAttribute('href').slice(1))));
const sectionObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting);
  if (!visible.length) return;
  visible.sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
  setActiveSection(visible[0].target.id);
}, { rootMargin: '-18% 0px -62% 0px', threshold: 0 });
navigationSections.forEach(({ section }) => sectionObserver.observe(section));
refresh();
