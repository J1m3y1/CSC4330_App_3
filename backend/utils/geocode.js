'use strict';

// Free-text address → { lat, lon } via OpenStreetMap's Nominatim. No API key
// needed, but their usage policy requires a descriptive User-Agent and caps
// us at ~1 request/sec — fine for this app's volume (profile-location saves
// and the occasional geofence add), not something to route bulk traffic through.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'FantasiApp/1.0 (contact: support@fantasi.app)';

async function geocode(address) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Geocoding service returned ${res.status}`);
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

module.exports = { geocode };
