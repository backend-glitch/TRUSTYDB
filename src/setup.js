import { closePool, getConnection } from './config/database.js';
import { ensureTrustySchema } from './services/schemaService.js';

let connection;
try {
  connection = await getConnection();
  const created = await ensureTrustySchema(connection);
  await connection.commit();
  console.log(created.length ? `TRUSTYDB schema ready. Created: ${created.join(', ')}` : 'TRUSTYDB schema is already ready. No tables changed.');
} catch (error) {
  console.error(`TRUSTYDB setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
  await closePool();
}
