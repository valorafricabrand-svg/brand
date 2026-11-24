const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

const SYMBOL_PATH = path.join(__dirname, 'brand-assets', 'valor-africa-symbol.png');
const WORDMARK_PATH = path.join(__dirname, 'brand-assets', 'valor-africa-logo-light.png');

const CARD_WIDTH = 440;
const HEADER_HEIGHT = 108;
const QR_SIZE = 320;
const QR_TOP = HEADER_HEIGHT + 54;
const BADGE_SIZE = 86;
const BADGE_ICON_SIZE = 62;
const CODE_TOP = QR_TOP + QR_SIZE + 40;
const FOOTER_TOP = CODE_TOP + 44;
const CARD_HEIGHT = FOOTER_TOP + 52;

let brandAssets = null;

function loadBrandAssets() {
  if (!brandAssets) {
    brandAssets = [fs.readFileSync(SYMBOL_PATH), fs.readFileSync(WORDMARK_PATH)];
  }
  return brandAssets;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function frameSvg(ticketCode) {
  const centerX = CARD_WIDTH / 2;
  const tearY = CODE_TOP - 22;
  return Buffer.from(`
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="20" fill="#ffffff"/>
      <path d="M0 20 A20 20 0 0 1 20 0 H${CARD_WIDTH - 20} A20 20 0 0 1 ${CARD_WIDTH} 20 V${HEADER_HEIGHT} H0 Z" fill="#10251f"/>
      <text x="${centerX}" y="${QR_TOP - 22}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" letter-spacing="2" fill="#087f5b">VALID ENTRY PASS</text>
      <circle cx="0" cy="${tearY}" r="12" fill="#f4f6f5"/>
      <circle cx="${CARD_WIDTH}" cy="${tearY}" r="12" fill="#f4f6f5"/>
      <line x1="26" y1="${tearY}" x2="${CARD_WIDTH - 26}" y2="${tearY}" stroke="#dbe4e0" stroke-width="2" stroke-dasharray="7,7"/>
      <text x="${centerX}" y="${CODE_TOP + 16}" text-anchor="middle" font-family="'Courier New', monospace" font-size="19" font-weight="700" letter-spacing="3" fill="#10251f">${escapeXml(ticketCode)}</text>
      <text x="${centerX}" y="${FOOTER_TOP + 14}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#596a60">Valor Africa · Scan at the gate · One-time use</text>
    </svg>
  `);
}

async function badgeImage(symbolBuffer) {
  const ring = Buffer.from(`
    <svg width="${BADGE_SIZE}" height="${BADGE_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${BADGE_SIZE / 2}" cy="${BADGE_SIZE / 2}" r="${BADGE_SIZE / 2 - 2}" fill="#ffffff" stroke="#10251f" stroke-width="2"/>
    </svg>
  `);
  const icon = await sharp(symbolBuffer).resize(BADGE_ICON_SIZE, BADGE_ICON_SIZE).png().toBuffer();
  const iconOffset = Math.round((BADGE_SIZE - BADGE_ICON_SIZE) / 2);
  return sharp(ring).composite([{ input: icon, top: iconOffset, left: iconOffset }]).png().toBuffer();
}

async function renderTicketImage(url, ticketCode) {
  const [symbolBuffer, wordmarkBuffer] = loadBrandAssets();
  const qrBuffer = await QRCode.toBuffer(url, { errorCorrectionLevel: 'H', margin: 1, width: QR_SIZE });

  const wordmarkMeta = await sharp(wordmarkBuffer).metadata();
  const wordmarkWidth = 180;
  const wordmarkHeight = Math.round(wordmarkWidth * (wordmarkMeta.height / wordmarkMeta.width));
  const wordmarkPng = await sharp(wordmarkBuffer).resize(wordmarkWidth, wordmarkHeight).png().toBuffer();

  const badge = await badgeImage(symbolBuffer);
  const badgeOffset = Math.round((QR_SIZE - BADGE_SIZE) / 2);

  return sharp({ create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: '#ffffff' } })
    .composite([
      { input: frameSvg(ticketCode), top: 0, left: 0 },
      { input: wordmarkPng, top: Math.round((HEADER_HEIGHT - wordmarkHeight) / 2), left: Math.round((CARD_WIDTH - wordmarkWidth) / 2) },
      { input: qrBuffer, top: QR_TOP, left: Math.round((CARD_WIDTH - QR_SIZE) / 2) },
      { input: badge, top: QR_TOP + badgeOffset, left: Math.round((CARD_WIDTH - BADGE_SIZE) / 2) }
    ])
    .png()
    .toBuffer();
}

module.exports = { renderTicketImage };
