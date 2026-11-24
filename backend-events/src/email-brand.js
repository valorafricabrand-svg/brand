const LOGO_URL = 'https://valorafrica.co.ke/images/valor-africa-logo-light.png';

function emailBrandHeader() {
  return `<div style="margin:0 0 24px;text-align:center;background-color:#10251f;padding:22px 16px;border-radius:12px">
    <img src="${LOGO_URL}" alt="Valor Africa Events &amp; Tickets" width="200" style="display:block;width:200px;max-width:100%;height:auto;margin:auto;border:0">
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
