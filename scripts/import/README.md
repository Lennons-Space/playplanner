# PlayPlanner UK Venue Import Pipeline

This pipeline imports family-friendly venue data from OpenStreetMap (OSM) into the PlayPlanner Supabase database. It is a set of standalone Node.js scripts that run from the command line on a developer's machine — they are not part of the app itself.

All imported venues are created with `is_published = false` and `moderation_status = pending`. They do not appear in the app until a moderator reviews and publishes them.

---

## Prerequisites

1. **Node 18 or newer** — check with `node --version`
2. **Install dependencies** — run from the PlayPlanner project root:
   ```
   npm install
   npm install fuse.js --legacy-peer-deps
   npm install dotenv --legacy-peer-deps
   ```
3. **Create `scripts/.env`** — copy from the example file:
   ```
   cp scripts/.env.example scripts/.env
   ```
   Then open `scripts/.env` and fill in your Supabase project URL and **service role key** (found in Supabase dashboard → Settings → API). The service role key bypasses Row Level Security and must never be committed to git or used in the app.

4. **Database migrations** — ensure migration `013_radius_and_osm_id.sql` has been applied (adds the `osm_id` column to the `venues` table).

---

## Run order

Run each script in sequence from the **PlayPlanner project root**:

```bash
node scripts/import/01_fetch_osm.js
node scripts/import/02_transform_osm.js
node scripts/import/03_deduplicate.js
node scripts/import/04_geocode.js
node scripts/import/05_insert.js
```

### Script descriptions

| Script | What it does |
|--------|-------------|
| `01_fetch_osm.js` | Queries the Overpass API across a 110-cell UK grid (1° × 1° cells). Saves raw JSON for each cell to `scripts/data/raw/osm/`. Takes ~6 minutes. |
| `02_transform_osm.js` | Reads all cell files, maps OSM tags to PlayPlanner category slugs, and outputs `scripts/data/transformed/venues_osm.json`. |
| `03_deduplicate.js` | Removes near-duplicate venues (same postcode, similar name) using fuzzy matching. Outputs `venues_deduped.json`. |
| `04_geocode.js` | Fills in missing coordinates for venues that have a postcode but no lat/lng. Uses the free postcodes.io API. Outputs `venues_geocoded.json`. |
| `05_insert.js` | Reads the geocoded file and upserts all venues into Supabase in batches of 50. Resolves category slugs to UUIDs at runtime. |

---

## Expected output at each stage

```
scripts/data/
  raw/osm/
    cell_50.0_-8.0.json    ← one file per grid cell (110 files)
    cell_50.0_-7.0.json
    ...
  transformed/
    venues_osm.json         ← after step 02 (e.g. ~25,000 records)
    venues_deduped.json     ← after step 03 (duplicates removed)
    venues_geocoded.json    ← after step 04 (coords filled in)
```

The `scripts/data/` directory is gitignored. Do not commit raw or transformed data files.

---

## Re-running safely

- **Step 01** is resumable. If it is interrupted, just run it again. Any cell whose file already exists and is non-empty will be skipped automatically.
- **Steps 02–04** are idempotent — they read from file and write to file, overwriting the previous output.
- **Step 05** uses `upsert` on the `osm_id` column, so running it again updates existing records rather than creating duplicates.

---

## Attribution

This pipeline imports data from OpenStreetMap contributors under the **Open Database Licence (ODbL-1.0)**.

You are required to:
1. Display attribution in the PlayPlanner app (e.g. "Map data © OpenStreetMap contributors").
2. Keep the `data_source = 'osm'` and `license = 'ODbL-1.0'` fields on all imported records.
3. Make the full dataset available if you distribute a product built on it (the ODbL share-alike requirement).

See https://www.openstreetmap.org/copyright for full licence terms.
