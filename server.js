const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const CITIES = [
  { lat: 40.7128, lng: -74.0060 },
  { lat: 51.5074, lng: -0.1278 },
  { lat: 48.8566, lng: 2.3522 },
  { lat: 35.6762, lng: 139.6503 },
  { lat: 55.7558, lng: 37.6173 },
  { lat: 41.0082, lng: 28.9784 },
  { lat: 37.7749, lng: -122.4194 },
  { lat: 40.4168, lng: -3.7038 },
  { lat: 52.5200, lng: 13.4050 },
  { lat: 41.9028, lng: 12.4964 },
  { lat: 34.0522, lng: -118.2437 },
  { lat: 41.8781, lng: -87.6298 },
  { lat: 52.2297, lng: 21.0122 },
  { lat: 47.3769, lng: 8.5417 },
  { lat: 45.4642, lng: -73.5821 },
  { lat: 43.6532, lng: -79.3832 },
  { lat: 59.3293, lng: 18.0686 },
  { lat: 60.1699, lng: 24.9384 },
  { lat: 59.9139, lng: 10.7522 },
  { lat: 55.6761, lng: 12.5683 },
  { lat: 39.9271, lng: 116.3975 },
  { lat: 31.2304, lng: 121.4737 },
  { lat: 37.5665, lng: 126.9780 },
  { lat: 1.3521, lng: 103.8198 },
  { lat: 13.7563, lng: 100.5018 },
  { lat: 14.5995, lng: 120.9842 },
  { lat: 6.5244, lng: 3.3792 },
  { lat: -22.9068, lng: -43.1729 },
  { lat: -33.8688, lng: -70.6693 },
  { lat: -34.6037, lng: -58.3816 },
  { lat: -23.5505, lng: -46.6333 },
  { lat: 19.4326, lng: -99.1332 },
  { lat: 25.2048, lng: 55.2708 },
  { lat: 28.6139, lng: 77.2090 },
  { lat: 19.0760, lng: 72.8777 },
  { lat: 23.0225, lng: 72.5714 },
  { lat: 27.7172, lng: 85.3240 },
  { lat: 30.0444, lng: 31.2357 },
  { lat: 33.8938, lng: 35.5018 },
  { lat: 41.0082, lng: 28.9784 },
  { lat: 39.9334, lng: 32.8597 },
  { lat: 47.1419, lng: 8.2275 },
  { lat: 45.8150, lng: 15.9819 },
  { lat: 42.3601, lng: 14.5044 },
  { lat: 43.7696, lng: 11.2558 },
  { lat: 45.4408, lng: 12.3155 },
  { lat: 50.0755, lng: 14.4378 },
  { lat: 48.2082, lng: 16.3738 },
  { lat: 47.4979, lng: 19.0402 },
  { lat: 44.4322, lng: 26.1052 },
  { lat: 42.6977, lng: 23.3219 },
  { lat: 37.9838, lng: 23.7275 },
  { lat: 41.0153, lng: 28.9795 },
  { lat: -1.2921, lng: 36.8219 },
  { lat: -1.2864, lng: 36.8172 },
  { lat: -26.2041, lng: 28.0473 },
  { lat: -33.9249, lng: 18.4241 },
  { lat: 4.7106, lng: -74.0721 },
  { lat: 9.9342, lng: -84.0776 },
  { lat: 20.5853, lng: -155.5783 },
  { lat: -41.2866, lng: 174.7756 },
  { lat: -37.8136, lng: 144.9631 },
  { lat: 21.3069, lng: -157.8583 },
  { lat: 10.8301, lng: -84.0576 },
  { lat: 14.6042, lng: -121.0115 },
  { lat: 47.6062, lng: -122.3321 },
  { lat: 29.7604, lng: -95.3698 },
  { lat: 42.3601, lng: -71.0589 },
  { lat: 47.6062, lng: -122.3321 },
  { lat: 36.1627, lng: -86.7816 },
  { lat: 33.4484, lng: -112.0740 },
  { lat: 39.7392, lng: -104.9903 },
  { lat: 44.9778, lng: -93.2650 },
  { lat: 25.7617, lng: -80.1918 },
  { lat: 32.7157, lng: -117.1611 },
  { lat: 45.5152, lng: -122.6784 },
  { lat: 38.9072, lng: -77.0369 },
  { lat: 42.3314, lng: -83.0458 },
  { lat: 38.6270, lng: -90.1994 },
  { lat: 35.1495, lng: -90.0490 },
  { lat: 27.9506, lng: -82.4572 },
  { lat: 36.1627, lng: -86.7816 },
  { lat: 39.9526, lng: -75.1652 },
  { lat: 40.4406, lng: -79.9959 },
  { lat: 41.8240, lng: -87.7509 },
  { lat: 38.2975, lng: -85.9098 },
  { lat: 36.1974, lng: -86.7917 },
  { lat: 34.8697, lng: -111.6978 },
  { lat: 35.5951, lng: -105.9378 },
  { lat: 39.1031, lng: -84.5120 },
  { lat: 37.2089, lng: -89.6167 },
  { lat: 36.7378, lng: -119.7871 },
  { lat: 34.0530, lng: -118.2437 },
  { lat: 32.7157, lng: -117.1611 },
  { lat: 35.0844, lng: -106.6504 },
  { lat: 33.4484, lng: -112.0740 },
  { lat: 39.7392, lng: -104.9903 },
  { lat: 47.6588, lng: -122.3122 },
  { lat: 45.5152, lng: -122.6784 },
  { lat: 44.0521, lng: -123.0868 },
  { lat: 41.8781, lng: -87.6298 },
  { lat: 38.6270, lng: -90.1994 },
  { lat: 39.0997, lng: -94.5786 },
  { lat: 32.7767, lng: -96.7970 },
  { lat: 29.4241, lng: -98.4936 },
  { lat: 31.5493, lng: -97.1467 },
  { lat: 30.2672, lng: -97.7431 },
  { lat: 27.4713, lng: -82.5509 },
  { lat: 25.7907, lng: -80.1300 },
  { lat: 23.7104, lng: -102.2670 },
  { lat: 19.4326, lng: -103.3505 },
  { lat: 20.6733, lng: -103.3489 },
  { lat: 25.6866, lng: -100.3161 },
  { lat: 28.6356, lng: -106.0888 },
  { lat: 31.7683, lng: -106.4849 },
  { lat: 35.6870, lng: -105.9378 },
  { lat: 38.8339, lng: -104.8214 },
  { lat: 40.7608, lng: -111.8910 },
  { lat: 41.5904, lng: -93.6202 },
  { lat: 41.8781, lng: -87.6298 },
  { lat: 42.3314, lng: -83.0458 },
  { lat: 43.0389, lng: -87.9065 },
  { lat: 43.6150, lng: -79.3733 },
  { lat: 43.6532, lng: -79.3832 },
  { lat: 45.4215, lng: -75.6972 },
  { lat: 46.8139, lng: -71.2080 },
  { lat: 47.6062, lng: -122.3321 },
  { lat: 48.4284, lng: -104.6153 },
  { lat: 49.2827, lng: -123.1207 },
  { lat: 50.4501, lng: -104.6179 },
  { lat: 53.5445, lng: -113.4938 },
  { lat: 58.4427, lng: -104.6153 },
  { lat: 61.2181, lng: -149.9003 },
  { lat: 64.2807, lng: -149.6004 },
  { lat: 68.3419, lng: -149.5824 },
  { lat: 71.2906, lng: -156.7887 },
  { lat: 53.9383, lng: -1.7218 },
  { lat: 54.9783, lng: -1.6174 },
  { lat: 55.8642, lng: -4.2518 },
  { lat: 57.1497, lng: -2.0943 },
  { lat: 58.4627, lng: -3.1140 },
  { lat: 59.1533, lng: -2.0932 },
  { lat: 51.4545, lng: -2.5879 },
  { lat: 52.4862, lng: -1.8904 },
  { lat: 53.2308, lng: -0.5331 },
  { lat: 53.4808, lng: -2.2426 },
  { lat: 53.7266, lng: -1.4175 },
  { lat: 54.9783, lng: -1.6174 },
  { lat: 55.3800, lng: -3.1424 },
  { lat: 55.9533, lng: -3.1883 },
  { lat: 56.8609, lng: -4.2500 },
  { lat: 57.4778, lng: -4.2247 },
  { lat: 58.6212, lng: -3.6346 },
  { lat: 59.1533, lng: -2.0932 },
  { lat: 59.4924, lng: -1.7658 },
  { lat: 60.0864, lng: -1.4734 },
  { lat: 60.8398, lng: -1.1069 },
  { lat: 62.5902, lng: -1.9344 },
  { lat: 63.4316, lng: -5.0665 },
  { lat: 64.1413, lng: -2.0991 },
  { lat: 68.5832, lng: -13.5023 },
  { lat: 64.9631, lng: -19.0208 },
  { lat: 66.5193, lng: -18.6333 },
  { lat: 68.3415, lng: -13.6588 },
  { lat: 63.5327, lng: -19.5116 },
  { lat: 64.1466, lng: -21.9426 },
  { lat: 65.0064, lng: -18.6333 },
  { lat: 68.3500, lng: -13.5988 },
  { lat: 64.9167, lng: -23.5119 },
  { lat: 63.3781, lng: -18.8774 },
  { lat: 64.2549, lng: -21.8580 },
  { lat: 64.9812, lng: -17.8808 },
  { lat: 65.6851, lng: -18.0777 },
  { lat: 66.0188, lng: -17.7938 },
  { lat: 68.3500, lng: -13.5988 },
  { lat: 64.9631, lng: -19.0208 },
  { lat: 66.5193, lng: -18.6333 },
  { lat: 68.3415, lng: -13.6588 },
  { lat: 63.5327, lng: -19.5116 },
  { lat: 64.1466, lng: -21.9426 },
  { lat: 65.0064, lng: -18.6333 },
  { lat: 68.3500, lng: -13.5988 },
  { lat: 64.9167, lng: -23.5119 },
  { lat: 63.3781, lng: -18.8774 },
  { lat: 64.2549, lng: -21.8580 },
  { lat: 64.9812, lng: -17.8808 },
  { lat: 65.6851, lng: -18.0777 },
  { lat: 66.0188, lng: -17.7938 },
];

function randomCoords() {
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const latOffset = (Math.random() - 0.5) * 0.05;
  const lngOffset = (Math.random() - 0.5) * 0.05;
  return {
    lat: parseFloat((city.lat + latOffset).toFixed(6)),
    lng: parseFloat((city.lng + lngOffset).toFixed(6))
  };
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
