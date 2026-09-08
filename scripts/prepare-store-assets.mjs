import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Set ATTENTION_SHARP_MODULE to an installed Sharp module path when it is not
// available as a normal project dependency. This script does not download tools.
const sharpModule = process.env.ATTENTION_SHARP_MODULE || 'sharp';
const { default: sharp } = await import(sharpModule);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const brand = await readFile(path.join(rootDir, 'docs/mark.svg'));
const iconsDir = path.join(rootDir, 'public/icons');
const assetsDir = path.join(rootDir, 'output/chrome-web-store/assets');
await mkdir(iconsDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  // Chrome Web Store's 128 px canvas holds the existing 96 px mark, with
  // 16 px of transparent space on every side. Smaller toolbar icons stay crisp.
  const inset = size === 128 ? 16 : 0;
  const markSize = size - inset * 2;
  const mark = await sharp(brand).resize(markSize, markSize).png().toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, left: inset, top: inset }])
    .png()
    .toFile(path.join(iconsDir, `icon-${size}.png`));
}

const brandData = `data:image/svg+xml;base64,${brand.toString('base64')}`;
const promo = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <rect width="440" height="280" fill="#15221b"/>
  <image x="32" y="43" width="64" height="64" href="${brandData}"/>
  <text x="112" y="91" fill="#e4eee7" font-family="Arial, Helvetica, sans-serif" font-size="43" font-weight="700">Attention</text>
  <text x="32" y="165" fill="#7bd5ad" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="700">Read what matters.</text>
  <text x="32" y="208" fill="#c2d5ca" font-family="Arial, Helvetica, sans-serif" font-size="17">Decide what to read, skim, or skip.</text>
</svg>`;
await writeFile(path.join(assetsDir, 'promo-440x280.svg'), `${promo}\n`);
await sharp(Buffer.from(promo))
  .png()
  .toFile(path.join(assetsDir, 'promo-440x280.png'));

console.log('Prepared PNG icons (16, 32, 48, 128) and 440×280 store artwork.');
