const LOGO_URL = 'https://valorafrica.co.ke/images/valor-africa-logo.png';

function emailBrandHeader() {
  return `<div style="margin:0 0 24px;text-align:center">
    <img src="${LOGO_URL}" alt="Valor Africa Events &amp; Tickets" width="220" style="display:block;width:220px;max-width:100%;height:auto;margin:auto;border:0">
  </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { emailBrandHeader, escapeHtml };
