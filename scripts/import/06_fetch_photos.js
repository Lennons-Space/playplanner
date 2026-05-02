'use strict';

/**
 * 06_fetch_photos.js
 *
 * For every published venue in Supabase that has no approved photo:
 *   1. Search Google Places by name + lat/lng (nearby search)
 *   2. Pick the best matching place
 *   3. Fetch a photo reference from the place details
 *   4. Build a permanent photo URL via the Places Photo API
 *   5. Insert the URL into venue_photos with status='approved', is_cover=true
 *
 * Safe to re-run — skips venues that already have an approved photo.
 * Runs in batches with a 200ms delay to stay within rate limits.
 *
 * Cost: 1 Nearby Search + 1 Place Details per venue = ~$0.034 per venue.
 * For 7,642 venues: ~$260 — but Google gives $200/month free credit.
 * To reduce cost, the script caches progress to scripts/data/photos_progress.json
 * so it can resume from where it left off if interrupted.
 *
 * Prerequisites:
 *   - GOOGLE_PLACES_API_KEY in .env (root)
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (root)
 *
 * Run: node scripts/import/06_fetch_photos.js
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const GOOGLE_KEY   = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_KEY)   { console.error('Missing GOOGLE_PLACES_API_KEY in .env'); process.exit(1); }
if (!SUPABASE_URL) { console.error('Missing EXPO_PUBLIC_SUPABASE_URL in .env'); process.exit(1); }
if (!SERVICE_KEY)  { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }

const PROGRESS_FILE = path.join(__dirname, '../data/photos_progress.json');
const BATCH_SIZE    = 10;
const DELAY_MS      = 250; // stay well under 100 req/s Places API limit

const headers = {
  apikey:        SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Load already-processed venue IDs so we can resume after interruption.
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try { return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))); }
    catch { return new Set(); }
  }
  return new Set();
}

function saveProgress(done) {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...done]), 'utf8');
}

// Fetch all published venues that have no approved cover photo.
async function fetchVenuesWithoutPhotos() {
  // Get venue IDs that already have an approved photo.
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/venue_photos?select=venue_id&status=eq.approved&is_cover=eq.true`,
    { headers }
  );
  const existing = await existingRes.json();
  const coveredIds = new Set((existing ?? []).map(r => r.venue_id));

  // Fetch all published venues with coordinates.
  let allVenues = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/venues?select=id,name,latitude,longitude&is_published=eq.true&moderation_status=eq.approved&latitude=not.is.null&longitude=not.is.null&limit=${pageSize}&offset=${offset}`,
      { headers }
    );
    const page = await res.json();
    if (!page || page.length === 0) break;
    allVenues = allVenues.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return allVenues.filter(v => !coveredIds.has(v.id));
}

// Search Google Places for the best match near the venue's coordinates.
async function findPlaceId(name, lat, lng) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', '100');         // tight radius — match the exact venue
  url.searchParams.set('keyword', name);
  url.searchParams.set('key', GOOGLE_KEY);

  const res  = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== 'OK' || !data.results?.length) return null;
  return data.results[0].place_id;
}

// Get photo reference from Place Details.
async function fetchPlaceDetails(placeId) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'photos');
  url.searchParams.set('key', GOOGLE_KEY);

  const res  = await fetch(url.toString());
  const data = await res.json();
  const result = data.result ?? {};

  return {
    photoReference: result.photos?.[0]?.photo_reference ?? null,
  };
}

// Build the Places Photo URL — this is a redirect URL that serves the image directly.
function buildPhotoUrl(photoReference, maxWidth = 800) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/photo');
  url.searchParams.set('maxwidth', String(maxWidth));
  url.searchParams.set('photo_reference', photoReference);
  url.searchParams.set('key', GOOGLE_KEY);
  return url.toString();
}

// Resolve the redirect to get the final CDN URL (stable, no API key in the stored URL).
async function resolvePhotoUrl(photoUrl) {
  try {
    const res = await fetch(photoUrl, { method: 'HEAD', redirect: 'follow' });
    return res.url ?? photoUrl;
  } catch {
    // If HEAD fails, store the API URL directly — it still works but includes the key.
    return photoUrl;
  }
}

// Insert the photo URL into venue_photos.
async function insertPhoto(venueId, url) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/venue_photos`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      venue_id:   venueId,
      url,
      is_cover:   true,
      status:     'approved',
      caption:    'Photo via Google Places',
      sort_order: 0,
    }),
  });
  return res.ok;
}

async function processVenue(venue) {
  try {
    const placeId = await findPlaceId(venue.name, venue.latitude, venue.longitude);
    if (!placeId) return 'no_match';

    const { photoReference } = await fetchPlaceDetails(placeId);

    if (!photoReference) return 'no_photo';

    const rawUrl   = buildPhotoUrl(photoReference);
    const finalUrl = await resolvePhotoUrl(rawUrl);
    const inserted = await insertPhoto(venue.id, finalUrl);

    return inserted ? 'ok' : 'insert_failed';
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function main() {
  console.log('Fetching venues without photos…');
  const venues = await fetchVenuesWithoutPhotos();
  console.log(`Found ${venues.length} venues needing photos.\n`);

  if (venues.length === 0) {
    console.log('All venues already have photos. Nothing to do.');
    return;
  }

  const done     = loadProgress();
  const pending  = venues.filter(v => !done.has(v.id));
  console.log(`${done.size} already processed (resuming). ${pending.length} remaining.\n`);

  let ok = 0, noMatch = 0, noPhoto = 0, failed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (venue) => {
      const result = await processVenue(venue);
      done.add(venue.id);

      if (result === 'ok')           ok++;
      else if (result === 'no_match') noMatch++;
      else if (result === 'no_photo') noPhoto++;
      else                            failed++;
    }));

    saveProgress(done);

    const total    = i + batch.length;
    const pct      = Math.round((total / pending.length) * 100);
    process.stdout.write(`\r[${pct}%] ${total}/${pending.length} processed — ✓${ok} no_match:${noMatch} no_photo:${noPhoto} err:${failed}`);

    await sleep(DELAY_MS);
  }

  console.log('\n\n--- Photo import summary ---');
  console.log(`Photos inserted : ${ok}`);
  console.log(`No Google match : ${noMatch}`);
  console.log(`Match but no photo : ${noPhoto}`);
  console.log(`Errors          : ${failed}`);
  console.log(`\nDone. Reload the app to see venue photos.`);
}

main().catch(err => { console.error(err); process.exit(1); });
