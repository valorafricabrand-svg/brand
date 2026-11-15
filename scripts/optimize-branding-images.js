const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const SRC_DIR = path.join(__dirname, '..', 'images', 'Branding images');
const OUT_DIR = path.join(__dirname, '..', 'images', 'optimized', 'w_640');
const WIDTH = 640;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 74;

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = JSON.parse(await fs.readFile(path.join(__dirname, 'branding-images.json'), 'utf8'));
  let totalBefore = 0;
  let totalAfter = 0;
  for (const file of files) {
    const inputPath = path.join(SRC_DIR, file);
    const basename = file.replace(/\.[^.]+$/, '');
    const isGif = /\.gif$/i.test(file);
    const before = (await fs.stat(inputPath)).size;
    totalBefore += before;

    const pipeline = () => sharp(inputPath, isGif ? { animated: false } : undefined)
      .resize({ width: WIDTH, withoutEnlargement: true });

    const jpegOut = path.join(OUT_DIR, `${basename}.jpg`);
    await pipeline().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(jpegOut);
    const webpOut = path.join(OUT_DIR, `${basename}.webp`);
    await pipeline().webp({ quality: WEBP_QUALITY }).toFile(webpOut);

    const after = (await fs.stat(jpegOut)).size;
    totalAfter += after;
    console.log(`${file} -> ${basename}.jpg (${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB)`);
  }
  console.log(`\nTotal: ${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024 / 1024).toFixed(1)}MB (jpg only; webp adds a smaller amount more)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
