import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { closePool, getConnection } from './config/database.js';
import { config } from './config/env.js';
import { runPipeline } from './services/pipelineService.js';
import { normalizeUploadedRecords } from './services/csvService.js';
import * as db from './services/databaseService.js';

const frontendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function send(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // Enables local file preview to read its own local API without affecting
    // normal same-origin Render use.
    'Access-Control-Allow-Origin': '*'
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function serveFrontend(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const requestedFile = path.resolve(frontendDirectory, relativePath);
  if (requestedFile !== frontendDirectory && !requestedFile.startsWith(`${frontendDirectory}${path.sep}`)) {
    send(response, 403, { error: 'Invalid path.' });
    return true;
  }
  try {
    const extension = path.extname(requestedFile);
    if (!contentTypes[extension]) return false;
    const content = await readFile(requestedFile);
    response.writeHead(200, { 'Content-Type': contentTypes[extension], 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 50 * 1024 * 1024) throw new Error('Upload is too large for the browser endpoint. Use TRUSTYDB_SOURCE_FILES with npm run process for very large datasets.');
  }
  try { return JSON.parse(body); }
  catch { throw new Error('Upload could not be read. Please select valid CSV files and try again.'); }
}

let processing = false;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  let connection;
  let ownsProcessingLock = false;
  try {
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return send(response, 200, { status: 'ok', service: 'trustydb-backend' });
    }
    if (request.method === 'GET' && url.pathname === '/api/health/database') {
      connection = await getConnection();
      await connection.execute('SELECT 1 FROM dual');
      return send(response, 200, { status: 'ok', database: 'reachable' });
    }
    if (request.method === 'POST' && url.pathname === '/api/process') {
      if (processing) return send(response, 409, { error: 'A processing run is already active.' });
      processing = true;
      ownsProcessingLock = true;
      connection = await getConnection();
      const report = await runPipeline(connection);
      return send(response, 200, report);
    }
    if (request.method === 'POST' && url.pathname === '/api/process/upload') {
      if (processing) return send(response, 409, { error: 'A processing run is already active.' });
      processing = true;
      ownsProcessingLock = true;
      const payload = await readJsonBody(request);
      const uploadedInput = normalizeUploadedRecords(payload.records);
      connection = await getConnection();
      const report = await runPipeline(connection, uploadedInput);
      return send(response, 200, report);
    }
    if (await serveFrontend(request, response, url.pathname)) return;
    connection = await getConnection();
    if (request.method === 'GET' && url.pathname === '/api/conflicts') return send(response, 200, await db.fetchAllConflicts(connection));
    const conflictMatch = url.pathname.match(/^\/api\/conflicts\/(\d+)$/);
    if (request.method === 'GET' && conflictMatch) {
      const conflict = await db.fetchConflictDetails(connection, Number(conflictMatch[1]));
      return send(response, conflict ? 200 : 404, conflict || { error: 'Conflict not found.' });
    }
    if (request.method === 'GET' && url.pathname === '/api/recommendations') return send(response, 200, await db.fetchRecommendations(connection));
    if (request.method === 'GET' && url.pathname === '/api/sources') return send(response, 200, await db.fetchSourcesWithHistory(connection));
    const historyMatch = url.pathname.match(/^\/api\/sources\/(\d+)\/history$/);
    if (request.method === 'GET' && historyMatch) {
      const source = (await db.fetchSourcesWithHistory(connection)).find((item) => Number(item.sourceId) === Number(historyMatch[1]));
      return send(response, source ? 200 : 404, source || { error: 'Source not found.' });
    }
    return send(response, 404, { error: 'Route not found.' });
  } catch (error) {
    console.error(error);
    return send(response, 500, { error: error.message });
  } finally {
    if (ownsProcessingLock) processing = false;
    if (connection) await connection.close();
  }
});

server.listen(config.port, () => console.log(`TRUSTYDB backend API listening at http://localhost:${config.port}`));

async function shutdown() {
  server.close();
  await closePool();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
