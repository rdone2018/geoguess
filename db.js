const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ENV_PATHS = [
  '/etc/geoguess/geoguess.env',
  path.join(__dirname, '.env')
];

function loadEnv() {
  for (const p of ENV_PATHS) {
    try {
      if (!fs.existsSync(p)) continue;
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
    } catch (e) {
      continue;
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
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      role ENUM('admin','player') NOT NULL DEFAULT 'player',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(8) NOT NULL UNIQUE,
      admin_id INT NOT NULL,
      status ENUM('lobby','active','finished') NOT NULL DEFAULT 'lobby',
      location_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP NULL,
      FOREIGN KEY (admin_id) REFERENCES users(id)
    )
  `);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS session_players (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id INT NOT NULL,
      user_id INT NOT NULL,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
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

async function createUser(username, role) {
  const conn = await getPool().getConnection();
  try {
    const [result] = await conn.execute(
      'INSERT INTO users (username, role) VALUES (?, ?)',
      [username, role]
    );
    return result.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [rows] = await conn.execute('SELECT id, role FROM users WHERE username = ?', [username]);
      return rows[0];
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function getUserByUsername(username) {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute('SELECT * FROM users WHERE username = ?', [username]);
  conn.release();
  return rows[0] || null;
}

async function createSession(adminId) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const conn = await getPool().getConnection();
  const [result] = await conn.execute(
    'INSERT INTO sessions (code, admin_id) VALUES (?, ?)',
    [code, adminId]
  );
  conn.release();
  return { id: result.insertId, code };
}

async function getSessionByCode(code) {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute(
    'SELECT s.*, u.username as admin_name FROM sessions s JOIN users u ON s.admin_id = u.id WHERE s.code = ?',
    [code]
  );
  conn.release();
  return rows[0] || null;
}

async function joinSession(sessionId, userId) {
  const conn = await getPool().getConnection();
  await conn.execute(
    'INSERT INTO session_players (session_id, user_id) VALUES (?, ?)',
    [sessionId, userId]
  );
  conn.release();
}

async function getSessionPlayers(sessionId) {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute(
    'SELECT u.username, sp.joined_at FROM session_players sp JOIN users u ON sp.user_id = u.id WHERE sp.session_id = ?',
    [sessionId]
  );
  conn.release();
  return rows;
}

async function startSession(sessionId) {
  const conn = await getPool().getConnection();
  await conn.execute(
    "UPDATE sessions SET status = 'active', started_at = NOW() WHERE id = ?",
    [sessionId]
  );
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

async function setSessionLocation(sessionId, locationId) {
  const conn = await getPool().getConnection();
  await conn.execute(
    'UPDATE sessions SET location_id = ? WHERE id = ?',
    [locationId, sessionId]
  );
  conn.release();
}

async function getSessionLocation(sessionId) {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute(
    'SELECT l.latitude, l.longitude FROM sessions s JOIN location l ON s.location_id = l.id WHERE s.id = ?',
    [sessionId]
  );
  conn.release();
  return rows[0] || null;
}

module.exports = {
  getPool, initSchema,
  createUser, getUserByUsername,
  createSession, getSessionByCode, joinSession, getSessionPlayers, startSession,
  insertLocation, getLatestLocation, setSessionLocation, getSessionLocation
};
