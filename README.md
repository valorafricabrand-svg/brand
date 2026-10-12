# Valor Africa Events

Valor Africa is focused on event discovery, ticket requests, and event hosting.
The static site contains:

- `index.html` — event discovery homepage with a rotating Valor Ads showcase, location and category search, and featured events.
- `events.html` — searchable and filterable event listing.
- `host.html` — organizer form with local draft save, edit, and delete.
- `about.html` and `contact.html` — event-platform information and support.
- `styles/events.css` and `scripts/events.js` — event platform UI and interactions.

## Current demo limitations

The event listings in `scripts/events.js` are sample content. Update the `events`
array with approved live event information before publishing the site.

The Valor Ads carousel uses the animated concert artwork as its visual fallback.
To show an event video, add an `adVideo` path (for example,
`images/events/my-promo.mp4`) to that event in the `events` array in
`scripts/events.js`; optionally set `adPoster` to a still image for its loading
poster. Clips autoplay muted and loop; viewers can enable sound. The carousel
supports pause, manual navigation, reduced-motion preferences, and poster
fallback. The advertise links currently start a WhatsApp inquiry only; no ad
inventory, booking, impressions reporting, or payment is processed by this
static demo.

The hosting form currently saves drafts to the current browser's local storage.
Drafts are not uploaded, shared between devices, or published. The ticket form
creates a WhatsApp ticket request; it does not process payment or issue a ticket.
Before offering public event publishing or ticket sales, connect a server-side
event service, organizer accounts, order records, and a payment provider. The
user must receive explicit confirmation only after payment has been verified.

## Static hosting

The current site can be published as static files. Static hosting does not
provide shared organizer drafts, secure checkout, or ticket issuance. Keep the
limitations above visible until the related backend and payment integration are
implemented.

## Legacy shop backend

`backend-shop/` is the repository's earlier merchandise-store service. It is
not connected to the event site. Do not use it to process event tickets or
payments.
