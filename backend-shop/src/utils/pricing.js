const db = require('../db');

// Returns all offers that are currently active (flag on + within date window, if set)
function getActiveOffers() {
  const now = new Date().toISOString();
  const offers = db.prepare('SELECT * FROM offers WHERE active = 1').all();
  return offers.filter((o) => {
    if (o.starts_at && o.starts_at > now) return false;
    if (o.ends_at && o.ends_at < now) return false;
    return true;
  });
}

// Given a product row and the list of active offers, compute best applicable discount.
// If multiple offers apply, the one giving the largest discount wins (simple, predictable rule).
function applyOffers(product, activeOffers) {
  const applicable = activeOffers.filter(
    (o) => o.applies_to === 'all' || Number(o.applies_to) === product.id
  );

  if (applicable.length === 0) {
    return {
      ...product,
      original_price_cents: product.price_cents,
      final_price_cents: product.price_cents,
      applied_offer: null
    };
  }

  let best = null;
  let bestDiscount = 0;

  for (const offer of applicable) {
    let discount = 0;
    if (offer.type === 'percent') {
      discount = Math.round(product.price_cents * (offer.value / 100));
    } else if (offer.type === 'fixed') {
      discount = Math.round(offer.value);
    }
    discount = Math.min(discount, product.price_cents); // never go negative
    if (discount > bestDiscount) {
      bestDiscount = discount;
      best = offer;
    }
  }

  return {
    ...product,
    original_price_cents: product.price_cents,
    final_price_cents: product.price_cents - bestDiscount,
    applied_offer: best
      ? { id: best.id, name: best.name, type: best.type, value: best.value }
      : null
  };
}

module.exports = { getActiveOffers, applyOffers };
