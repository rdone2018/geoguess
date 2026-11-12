const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ENV_PATHS = [
  '/etc/geoguess/geoguess.env',
  path.join(__dirname, '.env')
];

function loadEnv() {
  for (const p of ENV_PATHS) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      return p;
    }
  }
  throw new Error(`No env file found. Looked in: ${ENV_PATHS.join(', ')}`);
}

let pool;

function getPool() {
  if (!pool) {
    const envPath = loadEnv();
    console.log(`Loaded DB credentials from: ${envPath}`);
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'geoguess',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return pool;
}

async function initSchema() {
  const conn = await getPool().getConnection();
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS location (
      id INT AUTO_INCREMENT PRIMARY KEY,
      latitude DOUBLE NOT NULL,
      longitude DOUBLE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  conn.release();
}

async function insertLocation(lat, lng) {
  const conn = await getPool().getConnection();
  const [result] = await conn.execute(
    'INSERT INTO location (latitude, longitude) VALUES (?, ?)',
    [lat, lng]
  );
  conn.release();
  return result.insertId;
}

async function getLatestLocation() {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute(
    'SELECT * FROM location ORDER BY id DESC LIMIT 1'
  );
  conn.release();
  return rows[0] || null;
}

module.exports = { getPool, initSchema, insertLocation, getLatestLocation };
