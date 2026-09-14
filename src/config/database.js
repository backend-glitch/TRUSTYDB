import oracledb from 'oracledb';
import { assertDatabaseConfig, config } from './env.js';

let pool;

export async function getConnection() {
  assertDatabaseConfig();
  if (!pool) {
    if (config.oracleClientLibDir) {
      // Optional: use only when the local Oracle client requires Thick mode.
      oracledb.initOracleClient({ libDir: config.oracleClientLibDir });
    }
    pool = await oracledb.createPool({
      user: config.oracleUser,
      password: config.oraclePassword,
      connectString: config.oracleConnectString,
      poolMin: 1,
      poolMax: 4,
      poolIncrement: 1
    });
  }
  return pool.getConnection();
}

export async function closePool() {
  if (pool) {
    await pool.close(10);
    pool = undefined;
  }
}
