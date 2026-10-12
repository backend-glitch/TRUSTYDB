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
    <pre class="formula">1. Reference value = ${referenceMethod}(${reportedValues}) = ${referenceValue}
2. Source reliability = average consistency for ${winner.sourceName} across uploaded records = ${sourceReliability.toFixed(4)}
3. Freshness = 1.0000 (the selected CSV was just uploaded)
4. Consensus confirmation = ${verification.toFixed(4)}
5. Consistency = ${consistencyFormula}

Trust score = 100 × (0.40 × ${sourceReliability.toFixed(4)} + 0.20 × ${freshness.toFixed(4)} + 0.20 × ${verification.toFixed(4)} + 0.20 × ${consistencyValue.toFixed(4)})
            = ${winner.trustScore.toFixed(2)}</pre>
    <p class="math-note">The record with the highest score is recommended. The median is calculated before scoring, so the result is not based on a hard-coded preferred source.</p>`;
}

const sourceAliases = ['source', 'sourcename', 'vendor', 'vendorname', 'merchant', 'seller', 'provider', 'supplier'];
const entityAliases = ['entityid', 'entity', 'clusterid', 'cluster', 'productid', 'productcode', 'itemid', 'itemcode', 'sku', 'id', 'code', 'name', 'title', 'productname'];
const labelAliases = ['productname', 'producttitle', 'title', 'name', 'itemname', 'description'];
const normalizedName = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const displayName = (value) => String(value).trim().replace(/[_-]+/g, ' ');
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
function columnIndex(headers, aliases) {
  const normalizedHeaders = headers.map(normalizedName);
  return aliases.map((alias) => normalizedHeaders.indexOf(alias)).find((index) => index >= 0) ?? -1;
}
function sourceFromFileName(fileName) {
  return fileName.replace(/\.csv$/i, '').replace(/(?:^|[_ -])(source|data|records?)(?:[_ -]|$)/gi, ' ').replace(/[_-]+/g, ' ').trim() || 'Uploaded source';
}
function recordsFromCsv(fileName, csvText) {
  const [header, ...rows] = parseCsv(csvText);
  if (!header || !header.length) throw new Error(`${fileName} does not contain a header row.`);
  const headers = header.map((value) => value.trim());
  if (new Set(headers.map(normalizedName)).size !== headers.length) throw new Error(`${fileName} has duplicate column names.`);
  const sourceColumn = columnIndex(headers, sourceAliases);
  const entityColumn = columnIndex(headers, entityAliases);
  if (entityColumn < 0) throw new Error(`${fileName}: unable to identify an entity column. Include an ID, SKU, product code, name, or title column.`);
  const labelColumn = columnIndex(headers, labelAliases);
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`${fileName}, row ${index + 2}: expected ${headers.length} columns.`);
    const attributes = Object.fromEntries(headers.map((column, columnIndex) => [column, values[columnIndex].trim()]));
    const entityId = values[entityColumn].trim();
    if (!entityId) throw new Error(`${fileName}, row ${index + 2}: entity value is blank.`);
    const sourceName = sourceColumn >= 0 && values[sourceColumn].trim() ? values[sourceColumn].trim() : sourceFromFileName(fileName);
    delete attributes[headers[sourceColumn]];
    delete attributes[headers[entityColumn]];
    return { sourceName, entityId, productName: labelColumn >= 0 ? values[labelColumn].trim() || entityId : entityId, productTitle: labelColumn >= 0 ? values[labelColumn].trim() || entityId : entityId, attributes };
  });
}
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function numericValue(value) {
  const cleaned = String(value).trim().replace(/[,$₹£€]/g, '').replace(/,/g, '');
  return cleaned && /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}
function canonicalValue(value) { return String(value).trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function mode(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(canonicalValue(value), (counts.get(canonicalValue(value)) || 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
}
function referenceFor(values) {
  const numeric = values.map(numericValue);
  return numeric.every((value) => value !== null) ? { value: median(numeric), numeric: true } : { value: mode(values), numeric: false };
}
function consistency(value, reference, isNumeric) {
  if (!isNumeric) return canonicalValue(value) === canonicalValue(reference) ? 1 : 0;
  const number = numericValue(value);
  return reference === 0 ? (number === 0 ? 1 : 0) : Math.max(0, 1 - Math.abs(number - reference) / Math.abs(reference));
}
function confirmation(value, reference, isNumeric) {
  if (!isNumeric) return canonicalValue(value) === canonicalValue(reference) ? 1 : 0;
  const number = numericValue(value);
  const deviation = reference === 0 ? (number === 0 ? 0 : 1) : Math.abs(number - reference) / Math.abs(reference);
  return deviation <= .02 ? 1 : Math.max(0, 1 - (deviation - .02) / .2);
}
function processInBrowser(records) {
  state.mathSample = null;
  const byEntity = new Map();
  for (const record of records) {
    const group = byEntity.get(Number(record.entityId)) || [];
    group.push(record);
    byEntity.set(record.entityId, group);
  }
  const totals = new Map();
  for (const group of byEntity.values()) {
    const attributes = new Set(group.flatMap((record) => Object.keys(record.attributes)));
    for (const attributeName of attributes) {
      const observations = group.filter((record) => record.attributes[attributeName] !== '').map((record) => ({ record, value: record.attributes[attributeName] }));
      if (observations.length < 2) continue;
      const reference = referenceFor(observations.map((item) => item.value));
      for (const { record, value } of observations) {
        const total = totals.get(record.sourceName) || { total: 0, agreement: 0 };
        total.total += 1; total.agreement += consistency(value, reference.value, reference.numeric); totals.set(record.sourceName, total);
      }
    }
  }
  const reliabilityBySource = new Map([...totals].map(([name, value]) => [name, value.agreement / value.total]));
  const conflicts = []; const recommendations = []; const details = new Map(); let conflictId = 1; let recordId = 1;
  for (const [entityId, group] of byEntity) {
    const attributes = new Set(group.flatMap((record) => Object.keys(record.attributes)));
    for (const attributeName of attributes) {
      const observations = group.filter((record) => record.attributes[attributeName] !== '').map((record) => ({ record, value: record.attributes[attributeName] }));
      if (observations.length < 2 || new Set(observations.map((item) => canonicalValue(item.value))).size < 2) continue;
      const reference = referenceFor(observations.map((item) => item.value));
      const scored = observations.map(({ record, value }) => {
        const factors = { reliability: reliabilityBySource.get(record.sourceName) ?? 0, freshness: 1, verification: confirmation(value, reference.value, reference.numeric), consistency: consistency(value, reference.value, reference.numeric) };
        const trustScore = Math.round(100 * (.4 * factors.reliability + .2 * factors.freshness + .2 * factors.verification + .2 * factors.consistency) * 100) / 100;
        const scoredRecord = { ...record, recordId: recordId++, selectedValue: value, trustScore, factors };
        scoredRecord.reason = `Source reliability: ${factors.reliability.toFixed(2)}, freshness: ${factors.freshness.toFixed(2)}, consensus confirmation: ${factors.verification.toFixed(2)}, consistency: ${factors.consistency.toFixed(2)}. Final trust score: ${trustScore.toFixed(2)}.`;
        return scoredRecord;
      }).sort((left, right) => right.trustScore - left.trustScore || left.recordId - right.recordId);
      const winner = scored[0];
      const recommendationReason = `Value "${winner.selectedValue}" from ${winner.sourceName} was selected because its trust score of ${winner.trustScore.toFixed(2)} is the highest for the ${displayName(attributeName)} conflict. ${winner.reason}`;
      const conflict = { conflictId, entityId, productName: winner.productName, attributeName: displayName(attributeName), status: 'DETECTED', recordCount: scored.length };
      const recommendation = { recommendationId: conflictId, conflictId, entityId, productName: winner.productName, attributeName: displayName(attributeName), sourceName: winner.sourceName, recordId: winner.recordId, selectedValue: winner.selectedValue, trustScore: winner.trustScore, reason: recommendationReason };
      conflicts.push(conflict); recommendations.push(recommendation);
      details.set(conflictId, { ...conflict, records: scored, recommendation: { recordId: winner.recordId, sourceName: winner.sourceName, selectedValue: winner.selectedValue, reason: recommendationReason } });
      if (!state.mathSample) state.mathSample = { entityId, productName: winner.productName, attributeName: displayName(attributeName), reference, values: observations.map((item) => item.value), winner };
      conflictId += 1;
    }
  }
  state.conflicts = conflicts; state.recommendations = recommendations;
  state.sources = [...totals].map(([sourceName, value]) => ({ sourceName, totalRecords: value.total, verifiedRecords: 0, correctRecords: 0, reliabilityScore: (reliabilityBySource.get(sourceName) || 0) * 100, lastUpdated: new Date().toISOString() }));
  state.localDetails = details; state.uploadedRecords = records; render();
  byId('service-dot').className = 'status-dot is-ok'; byId('service-status').textContent = 'Local CSV mode';
  byId('analysis-status').textContent = 'Local'; byId('analysis-detail').textContent = 'CSV analysis in this browser';
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
    showMessage(`Upload processed locally: ${report.totalRecords} records from ${report.sourceCount} sources. ${report.conflictsDetected} conflicts and ${report.recommendationsGenerated} recommendations generated.`, 'success');
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
