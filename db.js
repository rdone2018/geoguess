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
      rounds INT NOT NULL DEFAULT 5,
      timer INT NOT NULL DEFAULT 60,
      current_round INT NOT NULL DEFAULT 1,
      location_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP NULL,
      FOREIGN KEY (admin_id) REFERENCES users(id)
    )
  `);
  await conn.execute(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rounds INT NOT NULL DEFAULT 5`);
  await conn.execute(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS timer INT NOT NULL DEFAULT 60`);
  await conn.execute(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS current_round INT NOT NULL DEFAULT 1`);
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
      session_id INT DEFAULT NULL,
      latitude DOUBLE NOT NULL,
      longitude DOUBLE NOT NULL,
      label VARCHAR(200) DEFAULT NULL,
      street_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS scores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id INT NOT NULL,
      user_id INT NOT NULL,
      round INT NOT NULL,
      distance_km DOUBLE NOT NULL,
      time_bonus INT NOT NULL DEFAULT 0,
      points INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS world_random_streets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      city VARCHAR(100) NOT NULL,
      country VARCHAR(100) NOT NULL,
      street VARCHAR(200) NOT NULL,
      highway_type VARCHAR(50) DEFAULT NULL,
      lat DOUBLE NOT NULL,
      lon DOUBLE NOT NULL
    )
  `);
  await conn.execute('ALTER TABLE location ADD COLUMN IF NOT EXISTS street_id INT DEFAULT NULL');
  await conn.execute('ALTER TABLE location ADD COLUMN IF NOT EXISTS session_id INT DEFAULT NULL');
  conn.release();
}

async function importRandomStreets() {
  const conn = await getPool().getConnection();
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS world_random_streets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      city VARCHAR(100) NOT NULL,
      country VARCHAR(100) NOT NULL,
      street VARCHAR(200) NOT NULL,
      highway_type VARCHAR(50) DEFAULT NULL,
      lat DOUBLE NOT NULL,
      lon DOUBLE NOT NULL
    )
  `);
  const [count] = await conn.execute('SELECT COUNT(*) AS c FROM world_random_streets');
  if (count[0].c > 0) { conn.release(); console.log('world_random_streets already populated:', count[0].c); return; }
  const csvPath = path.join(__dirname, 'world_random_streets.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1);
  let imported = 0;
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 7) continue;
    const city = parts[1].trim();
    const country = parts[2].trim();
    const street = parts[3].trim();
    const highwayType = parts[4].trim();
    const lat = parseFloat(parts[5]);
    const lon = parseFloat(parts[6]);
    await conn.execute(
      'INSERT INTO world_random_streets (city, country, street, highway_type, lat, lon) VALUES (?, ?, ?, ?, ?, ?)',
      [city, country, street, highwayType, lat, lon]
    );
    imported++;
  }
  conn.release();
  console.log('Imported', imported, 'random streets');
}

async function getRandomStreet(sessionId) {
  const conn = await getPool().getConnection();
  let rows;
  try {
    if (sessionId) {
      const [r] = await conn.execute(
        `SELECT ws.* FROM world_random_streets ws
         WHERE ws.id NOT IN (
           SELECT street_id FROM location
           WHERE session_id = ? AND street_id IS NOT NULL
         ) ORDER BY RAND() LIMIT 1`,
        [sessionId]
      );
      rows = r[0];
      if (rows.length === 0) {
        const [fallback] = await conn.execute('SELECT * FROM world_random_streets ORDER BY RAND() LIMIT 1');
        rows = fallback[0];
      }
    } else {
      const [r] = await conn.execute('SELECT * FROM world_random_streets ORDER BY RAND() LIMIT 1');
      rows = r[0];
    }
  } catch (err) {
    console.error('getRandomStreet error:', err.message);
    const [r] = await conn.execute('SELECT * FROM world_random_streets ORDER BY RAND() LIMIT 1');
    rows = r[0];
  }
  conn.release();
  if (!rows || rows.length === 0) console.warn('getRandomStreet: no rows found, sessionId=', sessionId);
  return rows[0] || null;
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
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  const conn = await getPool().getConnection();
  const [result] = await conn.execute(
    'INSERT INTO sessions (code, admin_id) VALUES (?, ?)',
    [code, adminId]
  );
  conn.release();
  return { id: result.insertId, code };
}

async function finishAllSessions() {
  const conn = await getPool().getConnection();
  await conn.execute("UPDATE sessions SET status = 'finished' WHERE status != 'finished'");
  conn.release();
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

async function updateSessionSettings(sessionId, rounds, timer) {
  const conn = await getPool().getConnection();
  await conn.execute(
    'UPDATE sessions SET rounds = ?, timer = ? WHERE id = ?',
    [rounds, timer, sessionId]
  );
  conn.release();
}

async function nextRound(sessionId, expectedRound) {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute('SELECT current_round, rounds FROM sessions WHERE id = ?', [sessionId]);
  if (rows.length === 0) { conn.release(); return null; }
  const session = rows[0];
  if (session.current_round !== expectedRound) {
    conn.release();
    return { done: session.current_round > session.rounds, round: session.current_round, already_advanced: true };
  }
  if (session.current_round >= session.rounds) {
    await conn.execute("UPDATE sessions SET status = 'finished' WHERE id = ?", [sessionId]);
    conn.release();
    return { done: true };
  }
  await conn.execute('UPDATE sessions SET current_round = current_round + 1 WHERE id = ?', [sessionId]);
  conn.release();
  return { done: false, round: session.current_round + 1 };
}

async function insertLocation(lat, lng, label, streetId, sessionId) {
  const conn = await getPool().getConnection();
  const [result] = await conn.execute(
    'INSERT INTO location (latitude, longitude, label, street_id, session_id) VALUES (?, ?, ?, ?, ?)',
    [lat, lng, label || null, streetId || null, sessionId || null]
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

async function insertScore(sessionId, userId, round, distanceKm, timeBonus, points) {
  const conn = await getPool().getConnection();
  await conn.execute(
    'INSERT INTO scores (session_id, user_id, round, distance_km, time_bonus, points) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, userId, round, distanceKm, timeBonus, points]
  );
  conn.release();
}

async function getSessionScores(sessionId) {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute(
    `SELECT u.username, SUM(s.points) AS total, MAX(s.round) AS last_round
     FROM scores s JOIN users u ON s.user_id = u.id
     WHERE s.session_id = ?
     GROUP BY s.user_id, u.username
     ORDER BY total DESC`,
    [sessionId]
  );
  conn.release();
  return rows;
}

async function getPendingPlayers(sessionId, round) {
  const conn = await getPool().getConnection();
  const [rows] = await conn.execute(
    `SELECT u.username FROM session_players sp
     JOIN users u ON sp.user_id = u.id
     WHERE sp.session_id = ? AND u.id NOT IN (
       SELECT user_id FROM scores WHERE session_id = ? AND round = ?
     )`,
    [sessionId, sessionId, round]
  );
  conn.release();
  return rows.map(r => r.username);
}

module.exports = {
  getPool, initSchema, importRandomStreets, getRandomStreet,
  createUser, getUserByUsername,
  createSession, getSessionByCode, joinSession, getSessionPlayers, startSession, finishAllSessions,
  updateSessionSettings, nextRound,
  insertLocation, getLatestLocation, setSessionLocation, getSessionLocation,
  insertScore, getSessionScores, getPendingPlayers
};
