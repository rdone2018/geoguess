const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function randomCoords() {
  const bound = await db.getRandomCityBound();
  if (!bound) {
    return { lat: 0, lng: 0, label: '' };
  }
  const lat = bound.min_lat + Math.random() * (bound.max_lat - bound.min_lat);
  const lng = bound.min_lon + Math.random() * (bound.max_lon - bound.min_lon);
  return {
    lat: parseFloat(lat.toFixed(6)),
    lng: parseFloat(lng.toFixed(6)),
    label: bound.city
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
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const user = await db.createUser(username, 'admin');
    res.json({ id: user.id, username, role: 'admin' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/session', async (req, res) => {
  try {
    const { username } = req.body;
    const admin = await db.getUserByUsername(username);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Not an admin' });
    }
    await db.finishAllSessions();
    const session = await db.createSession(admin.id);
    await db.joinSession(session.id, admin.id);
    res.json({ code: session.code, status: 'lobby' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/join', async (req, res) => {
  try {
    const { code, username } = req.body;
    if (!code || !username) return res.status(400).json({ error: 'code and username required' });
    const session = await db.getSessionByCode(code);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'finished') return res.status(400).json({ error: 'Session already finished' });
    const user = await db.createUser(username, 'player');
    const userId = typeof user === 'object' ? user.id : user;
    await db.joinSession(session.id, userId);
    const players = await db.getSessionPlayers(session.id);
    const resp = { joined: true, players: players.map(p => p.username) };
    if (session.status === 'active') {
      resp.active = true;
      resp.round = session.current_round;
      resp.rounds = session.rounds;
      resp.timer = session.timer;
      const loc = await db.getSessionLocation(session.id, session.current_round);
      if (loc) { resp.lat = loc.lat; resp.lng = loc.lng; resp.label = loc.label; }
    }
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const { lat, lng, label } = await randomCoords();
    const locationId = await db.insertLocation(lat, lng, label);
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
    if (session.status !== 'active') return res.status(400).json({ error: 'Session not active' });
    const expectedRound = req.body.round || session.current_round;
    const result = await db.nextRound(session.id, expectedRound);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    if (result.already_advanced) {
      const loc = await db.getSessionLocation(session.id, result.round);
      res.json({ done: result.done, round: result.round, lat: loc?.lat, lng: loc?.lng, label: loc?.label, timer: session.timer, already_advanced: true });
      return;
    }
    if (result.done) return res.json({ done: true });
    const { lat, lng, label } = await randomCoords();
    const locationId = await db.insertLocation(lat, lng, label);
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

    const basePoints = Math.max(0, Math.round(5000 - distanceKm));
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
    await db.importCityBounds();
    console.log('Database schema initialized, land bounds imported');
  } catch (err) {
    console.warn('DB init failed:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`GeoGuess running at http://localhost:${PORT}`);
  });
}

start();
