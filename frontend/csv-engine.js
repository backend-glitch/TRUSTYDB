/* TRUSTYDB browser-only CSV parsing and conflict engine. */
(function attachTrustyCsvEngine(root) {
  const sourceAliases = ['source', 'sourcename', 'vendor', 'vendorname', 'merchant', 'seller', 'provider', 'supplier'];
  const entityAliases = ['entityid', 'entity', 'clusterid', 'cluster', 'productid', 'productcode', 'itemid', 'itemcode', 'sku', 'id', 'code', 'name', 'title', 'productname'];
  const labelAliases = ['productname', 'producttitle', 'title', 'name', 'itemname', 'description'];
  const normalizedName = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const canonicalValue = (value) => String(value).trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const normalizeEntityId = (value) => canonicalValue(value).replace(/^0+(?=\d)/, '');
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
    if (quoted) throw new Error('CSV contains an unclosed quoted field.');
    return rows;
  }
  function columnIndex(headers, aliases) {
    const normalizedHeaders = headers.map(normalizedName);
    return aliases.map((alias) => normalizedHeaders.indexOf(alias)).find((index) => index >= 0) ?? -1;
  }
  function sourceFromFileName(fileName) {
    return fileName.replace(/\.csv$/i, '').replace(/(?:^|[_ -])(source|data|records?)(?:[_ -]|$)/gi, ' ').replace(/[_-]+/g, ' ').trim() || 'Uploaded source';
  }
  function numericValue(value) {
    const cleaned = String(value).trim().replace(/[,$₹£€]/g, '').replace(/,/g, '');
    return cleaned && /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
  }
  function parseCsvText(fileName, csvText) {
    const [header, ...rows] = parseCsv(csvText);
    if (!header || !header.length) throw new Error(`${fileName} does not contain a header row.`);
    const headers = header.map((value) => value.trim());
    if (new Set(headers.map(normalizedName)).size !== headers.length) throw new Error(`${fileName} has duplicate column names.`);
    const sourceColumn = columnIndex(headers, sourceAliases);
    const entityColumn = columnIndex(headers, entityAliases);
    if (entityColumn < 0) throw new Error(`${fileName}: unable to identify an entity column. Use an ID, SKU, product code, name, or title column.`);
    const labelColumn = columnIndex(headers, labelAliases);
    const records = []; const warnings = { missingEntityIds: 0, invalidPrices: 0, sourceFallbacks: 0 };
    rows.forEach((values, index) => {
      if (values.length !== headers.length) throw new Error(`${fileName}, row ${index + 2}: expected ${headers.length} columns.`);
      const entityId = normalizeEntityId(values[entityColumn]);
      if (!entityId) { warnings.missingEntityIds += 1; return; }
      const sourceCell = sourceColumn >= 0 ? values[sourceColumn].trim() : '';
      const sourceName = sourceCell || sourceFromFileName(fileName);
      if (!sourceCell) warnings.sourceFallbacks += 1;
      const attributes = Object.fromEntries(headers.map((column, columnIndex) => [column, values[columnIndex].trim()]));
      if (sourceColumn >= 0) delete attributes[headers[sourceColumn]];
      delete attributes[headers[entityColumn]];
      const priceHeader = headers.find((column) => normalizedName(column) === 'price');
      if (priceHeader && attributes[priceHeader] && numericValue(attributes[priceHeader]) === null) warnings.invalidPrices += 1;
      const label = labelColumn >= 0 ? values[labelColumn].trim() : '';
      records.push({ sourceName, entityId, productName: label || entityId, productTitle: label || entityId, attributes, fileName, rowNumber: index + 2 });
    });
    return { records, warnings };
  }
  function median(values) { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
  function mode(values) {
    const counts = new Map(); values.forEach((value) => counts.set(canonicalValue(value), (counts.get(canonicalValue(value)) || 0) + 1));
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
  }
  function referenceFor(values) { const numeric = values.map(numericValue); return numeric.every((value) => value !== null) ? { value: median(numeric), numeric: true } : { value: mode(values), numeric: false }; }
  function consistency(value, reference, isNumeric) {
    if (!isNumeric) return canonicalValue(value) === canonicalValue(reference) ? 1 : 0;
    const number = numericValue(value); return reference === 0 ? (number === 0 ? 1 : 0) : Math.max(0, 1 - Math.abs(number - reference) / Math.abs(reference));
  }
  function confirmation(value, reference, isNumeric) {
    if (!isNumeric) return canonicalValue(value) === canonicalValue(reference) ? 1 : 0;
    const number = numericValue(value); const deviation = reference === 0 ? (number === 0 ? 0 : 1) : Math.abs(number - reference) / Math.abs(reference);
    return deviation <= .02 ? 1 : Math.max(0, 1 - (deviation - .02) / .2);
  }
  function observationsFor(group, attributeName) {
    const isPrice = normalizedName(attributeName) === 'price';
    return group.filter((record) => {
      const value = record.attributes[attributeName];
      return value !== '' && value != null && (!isPrice || numericValue(value) !== null);
    }).map((record) => ({ record, value: record.attributes[attributeName] }));
  }
  function processRecords(inputRecords) {
    const validation = { missingEntityIds: 0, invalidPrices: 0, duplicateRecords: 0, unrecognizedSources: 0 };
    const records = []; const seen = new Set();
    for (const record of inputRecords) {
      const entityId = normalizeEntityId(record.entityId);
      const sourceName = String(record.sourceName || '').trim();
      if (!entityId) { validation.missingEntityIds += 1; continue; }
      if (!sourceName) { validation.unrecognizedSources += 1; continue; }
      const signature = `${sourceName}\u0000${entityId}\u0000${JSON.stringify(record.attributes)}`;
      if (seen.has(signature)) { validation.duplicateRecords += 1; continue; }
      seen.add(signature); records.push({ ...record, entityId, sourceName });
    }
    const byEntity = new Map(); const sourceStats = new Map();
    for (const record of records) {
      const group = byEntity.get(record.entityId) || [];
      group.push(record); byEntity.set(record.entityId, group);
      const stats = sourceStats.get(record.sourceName) || { records: 0, total: 0, agreement: 0 };
      stats.records += 1; sourceStats.set(record.sourceName, stats);
    }
    for (const group of byEntity.values()) {
      const attributes = new Set(group.flatMap((record) => Object.keys(record.attributes)));
      for (const attributeName of attributes) {
        const observations = observationsFor(group, attributeName);
        if (observations.length < 2 || new Set(observations.map((item) => item.record.sourceName)).size < 2) continue;
        const reference = referenceFor(observations.map((item) => item.value));
        for (const { record, value } of observations) {
          const stats = sourceStats.get(record.sourceName); stats.total += 1; stats.agreement += consistency(value, reference.value, reference.numeric);
        }
      }
    }
    const reliability = new Map([...sourceStats].map(([name, stats]) => [name, stats.total ? stats.agreement / stats.total : 0]));
    const conflicts = []; const recommendations = []; const details = new Map(); let conflictId = 1; let recordId = 1; let mathSample = null;
    for (const [entityId, group] of byEntity) {
      const attributes = new Set(group.flatMap((record) => Object.keys(record.attributes)));
      for (const attributeName of attributes) {
        const observations = observationsFor(group, attributeName);
        if (observations.length < 2 || new Set(observations.map((item) => item.record.sourceName)).size < 2 || new Set(observations.map((item) => canonicalValue(item.value))).size < 2) continue;
        const reference = referenceFor(observations.map((item) => item.value));
        const scored = observations.map(({ record, value }) => {
          const factors = { reliability: reliability.get(record.sourceName) ?? 0, freshness: 1, verification: confirmation(value, reference.value, reference.numeric), consistency: consistency(value, reference.value, reference.numeric) };
          const trustScore = Math.round(100 * (.4 * factors.reliability + .2 * factors.freshness + .2 * factors.verification + .2 * factors.consistency) * 100) / 100;
          const scoredRecord = { ...record, recordId: recordId++, selectedValue: value, trustScore, factors };
          scoredRecord.reason = `Source reliability: ${factors.reliability.toFixed(2)}, freshness: ${factors.freshness.toFixed(2)}, consensus confirmation: ${factors.verification.toFixed(2)}, consistency: ${factors.consistency.toFixed(2)}. Final trust score: ${trustScore.toFixed(2)}.`;
          return scoredRecord;
        }).sort((left, right) => right.trustScore - left.trustScore || left.recordId - right.recordId);
        const winner = scored[0]; const readableAttribute = displayName(attributeName);
        const recommendationReason = `Value "${winner.selectedValue}" from ${winner.sourceName} was selected because its trust score of ${winner.trustScore.toFixed(2)} is the highest for the ${readableAttribute} conflict. ${winner.reason}`;
        const conflict = { conflictId, entityId, productName: winner.productName, attributeName: readableAttribute, status: 'DETECTED', recordCount: scored.length };
        const recommendation = { recommendationId: conflictId, conflictId, entityId, productName: winner.productName, attributeName: readableAttribute, sourceName: winner.sourceName, recordId: winner.recordId, selectedValue: winner.selectedValue, trustScore: winner.trustScore, reason: recommendationReason };
        conflicts.push(conflict); recommendations.push(recommendation);
        details.set(conflictId, { ...conflict, records: scored, recommendation: { recordId: winner.recordId, sourceName: winner.sourceName, selectedValue: winner.selectedValue, reason: recommendationReason } });
        // Prefer a price decision for the explainer when available: numeric values
        // make the real trust calculation easiest to inspect.
        if (!mathSample || (normalizedName(attributeName) === 'price' && mathSample.normalizedAttribute !== 'price')) {
          mathSample = {
            conflictId,
            entityId,
            productName: winner.productName,
            attributeName: readableAttribute,
            normalizedAttribute: normalizedName(attributeName),
            reference,
            values: observations.map((item) => item.value),
            winner
          };
        }
        conflictId += 1;
      }
    }
    return { records, conflicts, recommendations, details, mathSample, validation, sources: [...sourceStats].map(([sourceName, stats]) => ({ sourceName, totalRecords: stats.records, verifiedRecords: 0, correctRecords: 0, reliabilityScore: (reliability.get(sourceName) || 0) * 100, lastUpdated: new Date().toISOString() })) };
  }
  root.TrustyCsvEngine = { parseCsvText, processRecords };
})(typeof globalThis === 'undefined' ? window : globalThis);
