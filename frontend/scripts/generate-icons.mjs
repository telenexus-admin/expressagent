import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public');
const source = resolve(__dirname, 'nexa-logo.png');
mkdirSync(outDir, { recursive: true });

const BRAND_BG = '#FFFFFF';

async function emitResized(name, size) {
  const out = resolve(outDir, name);
  await sharp(source)
    .resize(size, size, { fit: 'contain', background: BRAND_BG })
    .png()
    .toFile(out);
  console.log('wrote', out);
}

async function emitMaskable(name, size) {
  const out = resolve(outDir, name);
  const inner = Math.round(size * 0.7);
  const pad = Math.round((size - inner) / 2);
  const resized = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: BRAND_BG })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([{ input: resized, top: pad, left: pad }])
    .png()
    .toFile(out);
  console.log('wrote', out);
}

async function emitFaviconSvg(name, size = 128) {
  const out = resolve(outDir, name);
  const png = await sharp(source)
    .resize(size, size, { fit: 'contain', background: BRAND_BG })
    .png()
    .toBuffer();
  const b64 = png.toString('base64');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <image href="data:image/png;base64,${b64}" width="${size}" height="${size}"/>
</svg>`;
  writeFileSync(out, svg);
  console.log('wrote', out);
}

await emitResized('pwa-192x192.png', 192);
await emitResized('pwa-512x512.png', 512);
await emitMaskable('pwa-maskable-512x512.png', 512);
await emitResized('apple-touch-icon.png', 180);
await emitResized('favicon-32x32.png', 32);
await emitResized('favicon-16x16.png', 16);
await emitFaviconSvg('favicon.svg', 128);
