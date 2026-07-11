const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, 'images');
const OUT_DIR = path.join(__dirname, 'images', 'optimized');
const SIZES = [1600, 1024, 640];
const QUALITY = 82;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function listImages() {
  const files = await fs.readdir(IMAGES_DIR);
  return files.filter(f => /\.(jpe?g|png)$/i.test(f));
}

async function processFile(file) {
  const inputPath = path.join(IMAGES_DIR, file);
  const { name, ext } = path.parse(file);

  for (const w of SIZES) {
    const outDir = path.join(OUT_DIR, `w_${w}`);
    await ensureDir(outDir);
    const outPath = path.join(outDir, `${name}${ext.toLowerCase()}`);
    try {
      await sharp(inputPath)
        .resize({ width: w, withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toFile(outPath);
      console.log(`wrote ${path.relative(__dirname, outPath)}`);
    } catch (err) {
      console.error('error writing', outPath, err.message || err);
    }

    // write WebP variant
    const outWebp = path.join(outDir, `${name}.webp`);
    try {
      await sharp(inputPath)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: Math.max(60, Math.round(QUALITY * 0.9)) })
        .toFile(outWebp);
      console.log(`wrote ${path.relative(__dirname, outWebp)}`);
    } catch (err) {
      console.error('error writing', outWebp, err.message || err);
    }
  }
}

async function run() {
  try {
    const images = await listImages();
    if (!images.length) {
      console.log('No images found in images/ — copy your jpg/png files there first.');
      return;
    }
    console.log(`Found ${images.length} images — processing...`);
    for (const f of images) {
      await processFile(f);
    }
    console.log('Done. Optimized images are in images/optimized/w_<width>/');
  } catch (err) {
    console.error(err);
  }
}

run();
