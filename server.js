const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

function randomCoords() {
  const lat = (Math.random() * 180 - 90).toFixed(6);
  const lng = (Math.random() * 360 - 180).toFixed(6);
  return { lat: parseFloat(lat), lng: parseFloat(lng) };
}

app.get('/api/coords', async (req, res) => {
  try {
    const game = await db.getLatestGame();
    if (game) {
      return res.json({ lat: game.latitude, lng: game.longitude });
    }
    const { lat, lng } = randomCoords();
    await db.insertGame(lat, lng);
    res.json({ lat, lng });
  } catch (err) {
    console.error('Failed to get coords:', err.message);
    const { lat, lng } = randomCoords();
    res.json({ lat, lng });
  }
});

app.get('/api/new-game', async (req, res) => {
  try {
    const { lat, lng } = randomCoords();
    await db.insertGame(lat, lng);
    res.json({ lat, lng });
  } catch (err) {
    console.error('Failed to create new game:', err.message);
    const { lat, lng } = randomCoords();
    res.json({ lat, lng });
  }
});

async function start() {
  try {
    await db.initSchema();
    console.log('Database schema initialized');
  } catch (err) {
    console.warn('DB init failed (will retry on request):', err.message);
  }

  const { lat, lng } = randomCoords();
  try {
    await db.insertGame(lat, lng);
    console.log(`Generated random coordinates: ${lat}, ${lng}`);
  } catch (err) {
    console.warn(`DB insert failed, coords in memory only: ${lat}, ${lng}`);
  }

  app.listen(PORT, () => {
    console.log(`GeoGuess running at http://localhost:${PORT}`);
  });
}

start();
