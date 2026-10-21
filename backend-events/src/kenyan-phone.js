'use strict';

function normalizeKenyanPhone(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}

module.exports = { normalizeKenyanPhone };
