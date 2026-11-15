const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const MIN_REQUEST_INTERVAL = 2000;
const lastRequestTime = new Map();

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
}

function checkRateLimit(ip, key) {
  const now = Date.now();
  const cacheKey = `${ip}:${key}`;
  
  if (lastRequestTime.has(cacheKey)) {
    const timeSinceLast = now - lastRequestTime.get(cacheKey);
    if (timeSinceLast < MIN_REQUEST_INTERVAL) {
      return { allowed: false, reason: 'too_fast' };
    }
  }
  lastRequestTime.set(cacheKey, now);
  
  if (!rateLimits.has(cacheKey)) {
    rateLimits.set(cacheKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
  }
  
  const limit = rateLimits.get(cacheKey);
  if (now > limit.resetAt) {
    rateLimits.set(cacheKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  
  limit.count++;
  if (limit.count > RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, reason: 'rate_limited' };
  }
  
  return { allowed: true };
}

function validateHoneypot(body) {
  if (body.honeypot && body.honeypot.trim() !== '') {
    return false;
  }
  return true;
}

async function randomCoords(region) {
  const street = await db.getRandomStreet(region);
  if (!street) {
    return { lat: 0, lng: 0, label: '', streetId: null, panoId: null };
  }
  return {
    lat: street.lat,
    lng: street.lon,
    label: street.city,
    streetId: street.id,
    panoId: street.pano_id || null
  };
}

app.get('/api/config', (req, res) => {
  res.json({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.get('/api/db-status', async (req, res) => {
  try {
    const conn = await db.getPool().getConnection();
    await conn.ping();
    conn.release();
    res.json({ connected: true });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.post('/api/admin/create', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(ip, 'admin_create');
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please wait before trying again.' });
    }
    if (!validateHoneypot(req.body)) {
      return res.status(400).json({ error: 'Request rejected' });
    }
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Request failed' });
    const user = await db.createUser(username, 'admin');
    res.json({ id: user.id, username, role: 'admin' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed' });
  }
});

app.post('/api/admin/session', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(ip, 'admin_session');
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please wait before trying again.' });
    }
    if (!validateHoneypot(req.body)) {
      return res.status(400).json({ error: 'Request rejected' });
    }
    const { username, region } = req.body;
    console.log('Admin session request:', { username, region });
    if (!username) return res.status(400).json({ error: 'Request failed' });
    const admin = await db.getUserByUsername(username);
    console.log('Found admin:', admin ? admin.username : 'null', 'ID:', admin?.id, 'Type:', typeof admin?.id);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Request failed' });
    }
    await db.finishAllSessions();
    console.log('Finished all sessions');
    const session = await db.createSession(admin.id);
    console.log('Created session:', session);
    const adminId = parseInt(admin.id);
    console.log('Joining with adminId:', adminId);
    
    // Check if session exists right before join
    const sessionCheck = await db.getSessionById(session.id);
    console.log('Session check before join:', sessionCheck);
    
    await db.joinSession(session.id, adminId);
    console.log('Joined session');
    const r = region === 'europe' ? 'europe' : 'world';
    console.log('Setting region to:', r);
    await db.getPool().execute('UPDATE sessions SET region = ? WHERE id = ?', [r, session.id]);
    console.log('Updated region');
    res.json({ code: session.code, status: 'lobby', region: r });
  } catch (err) {
    console.error('Admin session error:', err);
    res.status(500).json({ error: 'Request failed' });
  }
});

app.post('/api/join', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(ip, 'join');
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please wait before trying again.' });
    }
    if (!validateHoneypot(req.body)) {
      return res.status(400).json({ error: 'Request rejected' });
    }
    const { code, username } = req.body;
    if (!code || !username) return res.status(400).json({ error: 'Request failed' });
    const session = await db.getSessionByCode(code);
    if (!session || session.status === 'finished') {
      return res.status(404).json({ error: 'Invalid session code' });
    }
    const user = await db.createUser(username, 'player');
    const userId = typeof user === 'object' ? user.id : user;
    await db.joinSession(session.id, userId);
    const players = await db.getSessionPlayers(session.id);
    const resp = { joined: true, players: players.map(p => p.username), region: session.region };
    if (session.status === 'active') {
      resp.active = true;
      resp.round = session.current_round;
      resp.rounds = session.rounds;
      resp.timer = session.timer;
      const loc = await db.getSessionLocation(session.id);
      if (loc) { resp.lat = loc.latitude; resp.lng = loc.longitude; resp.label = loc.label; }
    }
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: 'Request failed' });
  }
});

app.post('/api/session/:code/start', async (req, res) => {
  try {
    const { username, rounds, timer } = req.body;
    const session = await db.getSessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const admin = await db.getUserByUsername(username);
    if (!admin || admin.id !== session.admin_id) {
      return res.status(403).json({ error: 'Not the session admin' });
    }
    if (session.status !== 'lobby') return res.status(400).json({ error: 'Session not in lobby' });
    const r = Math.min(Math.max(parseInt(rounds) || 5, 1), 10);
    const t = Math.min(Math.max(parseInt(timer) || 60, 10), 120);
    await db.updateSessionSettings(session.id, r, t);
    const coords = await randomCoords(session.region);
    console.log('START randomCoords result:', JSON.stringify(coords));
    const { lat, lng, label, streetId } = coords;
    const locationId = await db.insertLocation(lat, lng, label, streetId, session.id);
    await db.setSessionLocation(session.id, locationId);
    await db.startSession(session.id);
    res.json({ started: true, lat, lng, label, rounds: r, timer: t, round: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/session/:code/next-round', async (req, res) => {
  try {
    const session = await db.getSessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'finished') return res.json({ done: true });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
    const expectedRound = req.body.round || session.current_round;
    const result = await db.nextRound(session.id, expectedRound);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    if (result.already_advanced) {
      const loc = await db.getSessionLocation(session.id);
      res.json({ done: result.done, round: result.round, lat: loc?.latitude, lng: loc?.longitude, label: loc?.label, timer: session.timer, already_advanced: true });
      return;
    }
    if (result.done) return res.json({ done: true });
    const coords2 = await randomCoords(session.region);
    console.log('NEXT-ROUND randomCoords result:', JSON.stringify(coords2));
    const { lat, lng, label, streetId } = coords2;
    const locationId = await db.insertLocation(lat, lng, label, streetId, session.id);
    await db.setSessionLocation(session.id, locationId);
    res.json({ done: false, round: result.round, lat, lng, label, timer: session.timer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session/:code', async (req, res) => {
  try {
    const session = await db.getSessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const players = await db.getSessionPlayers(session.id);
    const loc = session.location_id ? await db.getSessionLocation(session.id) : null;
    res.json({
      code: session.code,
      status: session.status,
      admin: session.admin_name,
      players: players.map(p => p.username),
      rounds: session.rounds,
      timer: session.timer,
      current_round: session.current_round,
      region: session.region,
      location: loc ? { lat: loc.latitude, lng: loc.longitude } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/session/:code/guess', async (req, res) => {
  try {
    const { username, lat, lng, remaining_time } = req.body;
    const session = await db.getSessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
    const user = await db.getUserByUsername(username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const loc = await db.getSessionLocation(session.id);
    if (!loc) return res.status(400).json({ error: 'No location set' });

    const R = 6371;
    const dLat = (loc.latitude - lat) * Math.PI / 180;
    const dLng = (loc.longitude - lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat * Math.PI / 180) * Math.cos(loc.latitude * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const maxPoints = session.region === 'europe' ? 1000 : 5000;
    const basePoints = Math.max(0, Math.round(maxPoints - distanceKm));
    const timeBonus = basePoints > 0 ? Math.max(0, (session.timer - (remaining_time || 0)) * 10) : 0;
    const points = basePoints + timeBonus;

    await db.insertScore(session.id, user.id, session.current_round, distanceKm, Math.max(0, timeBonus), points);
    const pending = await db.getPendingPlayers(session.id, session.current_round);
    res.json({ points, distance_km: Math.round(distanceKm * 100) / 100, time_bonus: Math.max(0, timeBonus), pending, all_done: pending.length === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session/:code/scores', async (req, res) => {
  try {
    const session = await db.getSessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const scores = await db.getSessionScores(session.id);
    res.json({ scores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session/:code/round-status', async (req, res) => {
  try {
    const session = await db.getSessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'active' && session.status !== 'finished') return res.json({ pending: [], all_done: true });
    const round = req.query.round ? parseInt(req.query.round) : session.current_round;
    const pending = await db.getPendingPlayers(session.id, round);
    res.json({ pending, all_done: pending.length === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/coords', async (req, res) => {
  try {
    const loc = await db.getLatestLocation();
    if (loc) {
      return res.json({ lat: loc.latitude, lng: loc.longitude });
    }
    const { lat, lng } = await randomCoords();
    await db.insertLocation(lat, lng);
    res.json({ lat, lng });
  } catch (err) {
    console.error('Failed to get coords:', err.message);
    const { lat, lng } = await randomCoords();
    res.json({ lat, lng });
  }
});

async function start() {
  try {
    await db.initSchema();
  } catch (err) {
    console.warn('DB schema init failed:', err.message);
  }
  try {
    await db.importRandomStreets();
  } catch (err) {
    console.warn('Random streets import failed:', err.message);
  }
  try {
    await db.importEuropeRandomStreets();
  } catch (err) {
    console.warn('Europe random streets import failed:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`GeoGuess running at http://localhost:${PORT}`);
  });
}

start();
