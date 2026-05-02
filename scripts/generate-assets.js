#!/usr/bin/env node
/**
 * Generates app store / EAS-build assets from assets/design/Logo.png.
 * Run: node scripts/generate-assets.js
 *
 * Outputs:
 *   assets/images/icon.png              1024×1024  solid #4ECDC4 bg, logo centred
 *   assets/images/adaptive-icon.png     1024×1024  transparent bg, logo at 64% safe zone
 *   assets/images/splash.png            1284×2778  solid #4ECDC4 bg, logo centred (tall portrait)
 *   assets/images/notification-icon.png   96×96    white silhouette on transparent bg
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'design', 'Logo.png');
const OUT = path.join(ROOT, 'assets', 'images');

// Brand colour used as background in app.json splash + icon
const BG = { r: 78, g: 205, b: 196, alpha: 1 }; // #4ECDC4

async function run() {
  if (!fs.existsSync(SRC)) {
    console.error('Source not found:', SRC);
    process.exit(1);
  }

  const src = sharp(SRC);
  const meta = await src.metadata();
  console.log(`Source: ${meta.width}×${meta.height} px  (${(fs.statSync(SRC).size / 1024).toFixed(0)} KB)`);

  // ── 1. icon.png  1024×1024  solid bg ──────────────────────────────────────
  {
    const CANVAS = 1024;
    // Fit logo inside 820×820 (≈80%) — leaves visible padding on all sides
    const logoSize = 820;
    // Source is 1024×1536 → fitting to 820 wide gives height 820*(1536/1024) = 1230 → too tall
    // Use 'contain' inside 820×820 box (sharp will letterbox; we then composite on bg)
    const resized = await sharp(SRC)
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const resizedMeta = await sharp(resized).metadata();
    const left = Math.round((CANVAS - resizedMeta.width) / 2);
    const top = Math.round((CANVAS - resizedMeta.height) / 2);

    await sharp({
      create: { width: CANVAS, height: CANVAS, channels: 3, background: BG },
    })
      .composite([{ input: resized, left, top }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'icon.png'));

    await verify('icon.png', CANVAS, CANVAS);
  }

  // ── 2. adaptive-icon.png  1024×1024  transparent bg, 64% safe zone ────────
  {
    const CANVAS = 1024;
    // Android safe zone ≈ 66% of canvas = 676 px; use 640 to be conservative
    const logoSize = 640;

    const resized = await sharp(SRC)
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const resizedMeta = await sharp(resized).metadata();
    const left = Math.round((CANVAS - resizedMeta.width) / 2);
    const top = Math.round((CANVAS - resizedMeta.height) / 2);

    await sharp({
      create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: resized, left, top }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'adaptive-icon.png'));

    await verify('adaptive-icon.png', CANVAS, CANVAS);
  }

  // ── 3. splash.png  1284×2778  solid bg, logo centred ──────────────────────
  {
    const W = 1284;
    const H = 2778;
    // Logo at 55% of width = 706 px wide; resizeMode:contain + bg colour fills the rest
    const logoSize = 706;

    const resized = await sharp(SRC)
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const resizedMeta = await sharp(resized).metadata();
    const left = Math.round((W - resizedMeta.width) / 2);
    const top = Math.round((H - resizedMeta.height) / 2);

    await sharp({
      create: { width: W, height: H, channels: 3, background: BG },
    })
      .composite([{ input: resized, left, top }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'splash.png'));

    await verify('splash.png', W, H);
  }

  // ── 4. notification-icon.png  96×96  white silhouette, transparent bg ─────
  {
    const SIZE = 96;

    // Convert to white silhouette: greyscale → threshold → recolour white → transparent bg
    const silhouette = await sharp(SRC)
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .greyscale()
      .linear(2, -128)          // increase contrast to push mid-tones toward white
      .toColorspace('b-w')
      .png()
      .toBuffer();

    // Recolour: any non-transparent pixel → white, keep alpha
    const raw = await sharp(silhouette)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = raw;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha > 10) {
        data[i] = 255;     // R
        data[i + 1] = 255; // G
        data[i + 2] = 255; // B
        // keep alpha as-is so partial transparency is preserved
      }
    }

    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'notification-icon.png'));

    await verify('notification-icon.png', SIZE, SIZE);
  }

  console.log('\nAll assets generated successfully.');
  console.log('app.json paths do not need updating — they already reference assets/images/.');
}

async function verify(filename, expectedW, expectedH) {
  const file = path.join(OUT, filename);
  const meta = await sharp(file).metadata();
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  const ok = meta.width === expectedW && meta.height === expectedH;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark}  ${filename.padEnd(26)} ${meta.width}×${meta.height} px  ${kb} KB`);
  if (!ok) {
    console.error(`     Expected ${expectedW}×${expectedH}`);
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
