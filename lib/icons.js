// Logo marks for invented sites, drawn in code: no model call, no request,
// nothing to wait for. The domain seeds the shape and colours, so a site's
// favicon on the results page matches the mark in its own header.

// 24×24 stroke glyphs, one per kind of site (search-result kinds and page
// archetypes both map in here).
const GLYPHS = {
  forum: "M4 5h16v11H9l-5 4z",
  store: "M5 8h14l-1.5 12h-11zM9 8V6a3 3 0 0 1 6 0v2",
  tool: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  video: "M8 5.5v13l10.5-6.5z",
  wiki: "M4 5h5.5A2.5 2.5 0 0 1 12 7.5V19a2 2 0 0 0-2-2H4zM20 5h-5.5A2.5 2.5 0 0 0 12 7.5V19a2 2 0 0 1 2-2h6z",
  news: "M4 5h12v14H6a2 2 0 0 1-2-2zM16 9h4v8a2 2 0 0 1-4 0M7 9h6M7 12.5h6M7 16h4",
  blog: "M5 19l3.5-.8L19 7.7 16.3 5 5.8 15.5zM14.5 6.8l2.7 2.7",
  gov: "M3 9l9-5 9 5M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3 20h18",
  paper: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  recipe: "M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7zM2.5 11h19M9 8c0-2 1.5-2 1.5-4M13.5 8c0-2 1.5-2 1.5-4",
  event: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5",
  map: "M12 21s-6.5-6-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  archive: "M3 5h18v4H3zM5 9v11h14V9M10 13h4",
  guide: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  startup: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  zine: "M12 3l2.3 5.6 6 .5-4.6 3.9 1.4 5.9L12 15.8 6.9 18.9l1.4-5.9-4.6-3.9 6-.5z",
};
GLYPHS.shop = GLYPHS.store;

// Abstract marks for sites of no particular kind — chosen by hash, so they
// still look like logos rather than a letter in a circle.
const ABSTRACT = [
  "M9 12a4.5 4.5 0 1 0 0 .01M15 12a4.5 4.5 0 1 0 0 .01",
  "M4 15c2.7-4 5.3-4 8 0s5.3 4 8 0M4 9c2.7-4 5.3-4 8 0s5.3 4 8 0",
  "M12 3c1 5 4 8 9 9-5 1-8 4-9 9-1-5-4-8-9-9 5-1 8-4 9-9z",
  "M6 18C6 10 10 6 18 6c0 8-4 12-12 12zM6 18l7-7",
  "M5 19V5l7 7 7-7v14",
  "M4 12h4l2-6 4 12 2-6h4",
];

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// The site's signature hue; also used for the SERP's tint of that result.
export const markHue = (domain) => hash(String(domain).replace(/^www\./, "")) % 360;

export function siteMark(domain, { kind, size = 28, hue } = {}) {
  const key = String(domain ?? "").replace(/^www\./, "");
  const h = hash(key);
  const base = hue ?? h % 360;
  const id = `m${h.toString(36)}`;
  const glyph = GLYPHS[String(kind ?? "").toLowerCase()] ?? ABSTRACT[(h >>> 9) % ABSTRACT.length];
  const filled = glyph === GLYPHS.video || glyph === GLYPHS.startup || glyph === GLYPHS.zine;
  // Background shape: circle, rounded square, squircle or hexagon.
  const shape = [
    `<circle cx="16" cy="16" r="16" fill="url(#${id})"/>`,
    `<rect width="32" height="32" rx="7" fill="url(#${id})"/>`,
    `<rect width="32" height="32" rx="11" fill="url(#${id})"/>`,
    `<path d="M16 0l14 8v16l-14 8-14-8V8z" fill="url(#${id})"/>`,
  ][(h >>> 5) % 4];
  const angle = [0, 45, 90, 135][(h >>> 13) % 4];
  const sat = 55 + ((h >>> 17) % 25);
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="hsl(${base},${sat}%,52%)"/><stop offset="1" stop-color="hsl(${(base + 38) % 360},${sat + 10}%,38%)"/></linearGradient></defs>${shape}<g transform="translate(5 5) scale(.917)"><path d="${glyph}" fill="${filled ? "#fff" : "none"}" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}
