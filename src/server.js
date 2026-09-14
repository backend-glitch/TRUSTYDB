import http from 'node:http';
import { closePool, getConnection } from './config/database.js';
import { config } from './config/env.js';
import { runPipeline } from './services/pipelineService.js';
import * as db from './services/databaseService.js';

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

let processing = false;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  let connection;
  let ownsProcessingLock = false;
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return send(response, 200, { status: 'ok', service: 'trustydb-backend' });
    }
    if (request.method === 'POST' && url.pathname === '/api/process') {
      if (processing) return send(response, 409, { error: 'A processing run is already active.' });
      processing = true;
      ownsProcessingLock = true;
      connection = await getConnection();
      const report = await runPipeline(connection);
      return send(response, 200, report);
    }
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
