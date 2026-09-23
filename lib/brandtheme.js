// Real sites, rendered as themselves (see lib/brands.js for which sites).
//
// A generic Foogle site gets a design style; a known site gets its own look:
// its colours and typography, its wordmark (drawn here in CSS or a small SVG,
// never copied), its header, nav and rails, and the layout of the kind of page
// it is: a CNN front page is headline rails around a lead story, a Reddit
// thread is a post with vote arrows and nested comments, a Wikipedia article
// has the sidebar, tabs and infobox, an Amazon product page has a buy box.
//
// The page type comes from the URL (/wiki/Octopus is an article, /r/cooking a
// feed, /Kindle-Paperwhite/dp/B0C1 a product), so every link on the site keeps
// its look and lands on the right layout. Code renders everything that frames
// the page at once, as the generic theme does; the four section writers are
// told which site they are writing for, with briefs in that site's structure.

import { STYLE_FONTS } from "./styles.js";
import { siteForQuery } from "./brands.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Title-case, leaving words that already have their own capitals ("iPhone").
const cap = (s) => String(s).replace(/(^|\s)(\S+)/gu, (m, a, w) => a + (/\p{Lu}/u.test(w.slice(1)) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
function fnv(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function seeded(key) {
  let h = fnv(key);
  return (n) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return (h >>> 0) % n;
  };
}

// ---------- colour ----------
const rgb = (hex) => {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = [...h].map((x) => x + x).join("");
  const n = parseInt(h, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
};
const toHex = (a) => `#${a.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (hex) => { const [r, g, b] = rgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
export function hueOf(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 210;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}
const onColor = (hex) => (lum(hex) > 0.58 ? "#111111" : "#ffffff");

// Every colour a page needs, from the few a site entry names. All hex, so
// pictures can be drawn in them (see /img in server.js).
export function brandPalette(b) {
  const k = b.colors ?? {};
  const bg = k.bg ?? "#ffffff";
  const fg = k.fg ?? "#111111";
  const acc = k.acc ?? "#1a73e8";
  const dark = k.dark ?? lum(bg) < 0.35;
  const panel = k.panel ?? (dark ? mix(bg, "#ffffff", 0.07) : lum(bg) > 0.99 ? mix(bg, fg, 0.035) : "#ffffff");
  const buy = k.buy ?? acc;
  return {
    bg, fg, acc, dark, panel,
    line: k.line ?? mix(bg, fg, dark ? 0.2 : 0.14),
    muted: k.muted ?? mix(fg, bg, 0.42),
    acc2: mix(acc, fg, 0.3),
    on: onColor(acc),
    head: k.head ?? bg,
    headFg: k.headFg ?? fg,
    link: k.link ?? acc,
    buy, buyFg: k.buyFg ?? onColor(buy),
    now: k.now ?? mix(buy, "#ff6a00", 0.35),
    sub: k.sub ?? null,
    subFg: k.subFg ?? (k.sub ? onColor(k.sub) : null),
    foot: k.foot ?? (dark ? mix(bg, "#ffffff", 0.05) : mix(bg, fg, 0.04)),
    heroA: panel,
    heroB: mix(panel, acc, 0.12),
  };
}

// ---------- type ----------
const FONT_STACKS = {
  sans: `-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif`,
  serif: `"Linux Libertine","Georgia","Times",serif`,
  roboto: `Roboto,Arial,"Helvetica Neue",sans-serif`,
  franklin: `"Franklin Gothic Medium","Libre Franklin","Helvetica Neue",Arial,sans-serif`,
  blackletter: `"Old English Text MT","Engravers Old English","UnifrakturMaguntia","Luminari","Goudy Text MT",Georgia,serif`,
  script: `"Billabong","Snell Roundhand","Brush Script MT","Segoe Script","Apple Chancery",cursive`,
  cond: `"Bebas Neue","Oswald","Arial Narrow","Helvetica Neue Condensed Bold",Impact,sans-serif`,
  rounded: `ui-rounded,"SF Pro Rounded","Nunito","Varela Round","Arial Rounded MT Bold",sans-serif`,
  mono: `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`,
  didone: `Didot,"Bodoni 72","Bodoni MT",Georgia,serif`,
  ...STYLE_FONTS,
};
export const brandFont = (name) => FONT_STACKS[name] ?? FONT_STACKS.sans;

// ---------- marks ----------
// Small SVGs drawn for this project: simplified, recognisable shapes, not
// copies of anyone's logo files.
const ICONS = {
  play: (s) => `<svg width="${Math.round(s * 1.42)}" height="${s}" viewBox="0 0 30 21" aria-hidden="true"><rect width="30" height="21" rx="6" fill="#ff0000"/><path d="M12 6v9l8-4.5z" fill="#fff"/></svg>`,
  alien: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#ff4500"/><circle cx="23.3" cy="7.6" r="2.2" fill="#fff"/><path d="M16.3 12.4l1.6-6.3 5.3 1.4" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="8.4" cy="15.6" r="2.4" fill="#fff"/><circle cx="23.6" cy="15.6" r="2.4" fill="#fff"/><ellipse cx="16" cy="19.4" rx="9" ry="6.3" fill="#fff"/><circle cx="12.5" cy="18.4" r="1.7" fill="#ff4500"/><circle cx="19.5" cy="18.4" r="1.7" fill="#ff4500"/><path d="M12.6 22.2c2.2 1.4 4.6 1.4 6.8 0" stroke="#ff4500" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`,
  globe: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="bgl" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#8f8f8f"/></radialGradient></defs><circle cx="32" cy="32" r="29" fill="url(#bgl)"/><g fill="none" stroke="#444" stroke-width="1.1" opacity=".55"><ellipse cx="32" cy="32" rx="12.5" ry="29"/><path d="M3 32h58M6.5 19h51M6.5 45h51M32 3v58"/></g><g font-family="Georgia,serif" font-size="11" fill="#222" text-anchor="middle"><text x="21" y="29">W</text><text x="43" y="29">Ω</text><text x="21" y="44">维</text><text x="43" y="44">И</text></g></svg>`,
  tray: (s) => `<svg width="${Math.round(s * 0.85)}" height="${s}" viewBox="0 0 27 32" aria-hidden="true"><path d="M3 20v9h19v-9" stroke="#bcbbbb" stroke-width="3" fill="none"/><g stroke="#f48225" stroke-width="3"><path d="M7 25h11"/><path d="M7.4 20.6l10.8 2.3" /><path d="M8.7 15.6l10 4.6"/><path d="M11.5 10.6l8.6 6.8"/><path d="M15.8 6.4l6.4 8.8"/></g></svg>`,
  octo: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15.5" fill="currentColor"/><path style="fill:var(--hbg,#fff)" d="M12.2 28.4c.1-1.5.1-2.9 0-3.7-3.8.6-4.6-1.3-5.1-2.3-.3-.6-1-1.6-1.7-2 .6-.2 1.8.1 2.6 1.4.8 1.3 2.2 1.8 3.9 1.1.1-.8.5-1.5 1-1.9-4.1-.5-6.6-2.2-6.6-6.6 0-1.4.5-2.7 1.4-3.7-.3-.9-.4-2.3.2-3.8 1.5 0 3 .8 4 1.7a12 12 0 0 1 8.2 0c1-.9 2.5-1.7 4-1.7.6 1.5.5 2.9.2 3.8.9 1 1.4 2.3 1.4 3.7 0 4.4-2.6 6.1-6.6 6.6.7.6 1.1 1.6 1.1 2.9v4.5"/></svg>`,
  smile: () => `<svg class="smile" width="64" height="12" viewBox="0 0 64 12" aria-hidden="true"><path d="M3 3c14 8 36 9 52 2" stroke="#ff9900" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M50 1.5l6 3.3-4.6 5" stroke="#ff9900" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  apple: (s) => `<svg width="${Math.round(s * 0.82)}" height="${s}" viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.4 2-3.5 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9s-1.9-.9-3.2-.8C6.5 7.3 5 8.3 4.1 9.8c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.3 3-2.5.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.8-1-2.8-4.6zM13.9 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg>`,
  windows: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 22 22" aria-hidden="true"><path fill="#f25022" d="M0 0h10.5v10.5H0z"/><path fill="#7fba00" d="M11.5 0H22v10.5H11.5z"/><path fill="#00a4ef" d="M0 11.5h10.5V22H0z"/><path fill="#ffb900" d="M11.5 11.5H22V22H11.5z"/></svg>`,
  bullseye: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#cc0000"/><circle cx="16" cy="16" r="10" fill="#fff"/><circle cx="16" cy="16" r="5.2" fill="#cc0000"/></svg>`,
  spark: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><g fill="#ffc220">${[0, 60, 120, 180, 240, 300].map((a) => `<rect x="14.2" y="2" width="3.6" height="10" rx="1.8" transform="rotate(${a} 16 16)"/>`).join("")}</g></svg>`,
  in: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="5" fill="#0a66c2"/><path fill="#fff" d="M7 12.5h4v12H7zM9 6.3a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM13.6 12.5h3.8v1.7c.6-1 1.9-2 3.9-2 4.1 0 4.8 2.7 4.8 6.1v6.2h-4v-5.5c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.6h-4z"/></svg>`,
  f: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#1877f2"/><path fill="#fff" d="M18.2 32V20.2h3.7l.6-4.4h-4.3v-2.7c0-1.3.4-2.1 2.2-2.1h2.3V7.1c-.4-.1-1.8-.2-3.3-.2-3.3 0-5.5 2-5.5 5.6v3.3H10.2v4.4h3.7V32z"/></svg>`,
  x: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.2 2.3h3.4l-7.4 8.4L23 21.7h-6.8l-5.3-7-6.1 7H1.4l7.9-9L1 2.3h7l4.8 6.4zm-1.2 17.4h1.9L7.1 4.2H5.1z"/></svg>`,
  yc: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 18 18" aria-hidden="true"><rect x=".5" y=".5" width="17" height="17" fill="#ff6600" stroke="#fff"/><path d="M5 4.2l4 5.8v4.2M13 4.2L9 10" stroke="#fff" stroke-width="1.8" fill="none"/></svg>`,
  dots: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><g fill="#fa6400">${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${(16 + Math.cos(a) * 11).toFixed(1)}" cy="${(16 + Math.sin(a) * 11).toFixed(1)}" r="2.3"/>`; }).join("")}${Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 + 0.5; return `<circle cx="${(16 + Math.cos(a) * 5.5).toFixed(1)}" cy="${(16 + Math.sin(a) * 5.5).toFixed(1)}" r="1.9"/>`; }).join("")}<circle cx="16" cy="16" r="1.6"/></g></svg>`,
  peacock: (s) => `<svg width="${Math.round(s * 1.3)}" height="${s}" viewBox="0 0 40 30" aria-hidden="true">${["#fccc12", "#f37021", "#cc004c", "#6460aa", "#0089d0", "#0db14b"].map((c, i) => `<ellipse cx="20" cy="14" rx="4.2" ry="11" fill="${c}" transform="rotate(${-75 + i * 30} 20 27)"/>`).join("")}</svg>`,
  note: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#1ed760"/><g stroke="#000" stroke-linecap="round" fill="none"><path d="M8 12.5c5.5-1.6 11.5-1.1 16.4 1.5" stroke-width="2.6"/><path d="M9 17.2c4.6-1.3 9.4-.9 13.3 1.2" stroke-width="2.2"/><path d="M10 21.6c3.7-1 7.4-.7 10.4 1" stroke-width="1.8"/></g></svg>`,
  belo: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4c-1.7 0-2.7 1.3-3.6 3.2C10.4 11.4 7 18.6 6 21.4 5 24.6 7.3 28 10.4 28c2.2 0 3.9-1.5 5.6-3.4 1.7 1.9 3.4 3.4 5.6 3.4 3.1 0 5.4-3.4 4.4-6.6-1-2.8-4.4-10-6.4-14.2C18.7 5.3 17.7 4 16 4zm0 18.5c-1.8-2.2-3.1-4.5-3.1-6.3 0-1.9 1.4-3 3.1-3s3.1 1.1 3.1 3c0 1.8-1.3 4.1-3.1 6.3z" fill="none" stroke="#ff385c" stroke-width="2.4" stroke-linejoin="round"/></svg>`,
  house: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 15L16 5l12 10v2l-12-8-12 8z" fill="#006aff"/><path d="M8 16l8-5.5 8 5.5v11H8z" fill="#006aff" opacity=".85"/></svg>`,
  burst: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><g fill="#d32323">${[0, 72, 144, 216, 288].map((a) => `<rect x="13.6" y="2.5" width="4.8" height="12" rx="2.4" transform="rotate(${a} 16 16)"/>`).join("")}</g></svg>`,
  swoosh: (s) => `<svg width="${Math.round(s * 2.4)}" height="${s}" viewBox="0 0 60 25" aria-hidden="true"><path fill="currentColor" d="M59 4.5C45 10.6 21.5 20.6 14 23.2c-6.6 2.3-12 1-12.6-2.6-.4-2.4 1-5.4 4.4-9.2-1.6 3.3-1.3 5.8.9 6.8 2.3 1 6 .5 11.3-1.4C27 13.4 46 7.6 59 4.5z"/></svg>`,
  tanuki: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 29L3.5 19.8 5.9 4.6l3.8 10.5h12.6l3.8-10.5 2.4 15.2z" fill="#e24329"/><path d="M16 29l6.3-13.9h-12.6z" fill="#fc6d26"/><path d="M3.5 19.8L16 29 9.7 15.1z" fill="#fca326"/><path d="M28.5 19.8L16 29l6.3-13.9z" fill="#fca326"/></svg>`,
  knot: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.3">${[0, 60, 120, 180, 240, 300].map((a) => `<rect x="11" y="3.5" width="10" height="15" rx="5" transform="rotate(${a} 16 16)"/>`).join("")}</g></svg>`,
  nbox: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="4" fill="#fff" stroke="#111" stroke-width="2.4"/><path d="M10.5 9.5v13M10.5 9.5l11 13M21.5 9.5v13" stroke="#111" stroke-width="2.6" fill="none"/></svg>`,
  hash: (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><g stroke-width="5" stroke-linecap="round"><path d="M12 5v9" stroke="#36c5f0"/><path d="M27 12h-9" stroke="#2eb67d"/><path d="M20 27v-9" stroke="#ecb22e"/><path d="M5 20h9" stroke="#e01e5a"/><path d="M20 5v4" stroke="#2eb67d"/><path d="M27 20h-4" stroke="#ecb22e"/><path d="M12 27v-4" stroke="#e01e5a"/><path d="M5 12h4" stroke="#36c5f0"/></g></svg>`,
};

// The site's wordmark, as text styled like it (and its mark, if it has one).
export function brandLogo(b, { size = 1 } = {}) {
  const l = b.logo ?? { text: b.name };
  const text = l.text ?? b.name;
  const fs = (l.size ?? 1.3) * size;
  const font = `font-family:${brandFont(l.font ?? b.fonts?.[1] ?? "sans").replaceAll('"', "'")};font-weight:${l.weight ?? 800};${l.italic ? "font-style:italic;" : ""}letter-spacing:${l.track ?? "normal"};`;
  const letters = (s, colors) => [...s].map((ch, i) => `<span style="color:${colors[i % colors.length]}">${esc(ch)}</span>`).join("");
  const iconSize = Math.round(fs * 20);
  const icon = l.icon && ICONS[l.icon] && l.icon !== "smile" ? ICONS[l.icon](l.icon === "yc" ? Math.round(fs * 18) : iconSize) : "";
  let word = "";
  if (text) {
    if (l.style === "block") word = `<span class="lw lblock" style="${font}background:${l.bg};color:${l.fg};font-size:${fs}rem;${l.border ? `box-shadow:inset 0 0 0 2px ${l.border};` : ""}${l.stack ? "white-space:normal;width:4.6em;line-height:.95;text-align:center;" : ""}">${esc(text)}</span>`;
    else if (l.style === "blocks") word = `<span class="lw lblocks" style="${font}font-size:${fs}rem">${[...text].map((ch, i) => `<i style="background:${l.colors?.[i] ?? l.bg};color:${l.fg}">${esc(ch)}</i>`).join("")}</span>`;
    else if (l.style === "tag") word = `<span class="lw ltag" style="${font}background:${l.bg};color:${l.fg};font-size:${fs}rem">${esc(text)}</span>`;
    else if (l.style === "oval") word = `<span class="lw loval" style="${font}background:${l.bg};font-size:${fs}rem"><i style="background:${l.ring};color:${l.fg}">${esc(text)}</i></span>`;
    else if (l.style === "stack") word = `<span class="lw lstack"><b style="${font}font-size:${fs}rem">${esc(text.toUpperCase())}</b><small>${esc(l.tagline ?? "")}</small></span>`;
    else if (l.bold) word = `<span class="lw" style="${font}font-size:${fs}rem;color:${l.color ?? "inherit"}">${esc(text.replace(l.bold, "").trim())} <b style="font-weight:800">${esc(l.bold)}</b></span>`;
    else word = `<span class="lw" style="${font}font-size:${fs}rem;color:${l.color ?? "inherit"}">${l.colors ? letters(text, l.colors) : esc(text)}</span>`;
  }
  const smile = l.icon === "smile" ? ICONS.smile() : "";
  return `<span class="logo${smile ? " has-smile" : ""}">${icon}${word}${smile}</span>`;
}

// A search result's favicon: the site's mark, or its initial in its colour.
export function brandFavicon(b, size = 28) {
  const l = b.logo ?? {};
  const c = brandPalette(b);
  if (l.icon && ICONS[l.icon] && l.icon !== "smile") {
    return `<span class="bfav" style="width:${size}px;height:${size}px;color:${c.dark ? "#111" : c.fg}">${ICONS[l.icon](Math.round(size * 0.72))}</span>`;
  }
  const bg = l.style === "block" || l.style === "tag" || l.style === "oval" ? l.bg : l.style === "blocks" ? (l.colors?.[0] ?? l.bg) : c.acc;
  const fg = l.style === "block" || l.style === "blocks" || l.style === "tag" ? l.fg : "#ffffff";
  const t = (l.text || b.name).replace(/^the\s+/i, "");
  const letters = l.style === "block" && t.length <= 4 ? t : t.slice(0, 1);
  return `<span class="bfav" style="width:${size}px;height:${size}px;background:${bg};color:${fg};font:${letters.length > 2 ? 800 : 700} ${letters.length > 2 ? Math.round(size * 0.3) : Math.round(size * 0.52)}px/1 ${brandFont(l.font ?? "sans").replaceAll('"', "'")}">${esc(letters)}</span>`;
}

// ---------- URLs ----------
const q = (s) => encodeURIComponent(s).replace(/%20/g, "+");
const wikiTitle = (t) => cap(t).replace(/\s+/g, "_");

// Each archetype: which page a URL is, the kind the generic machinery treats
// it as (widget hints, facts), where its search goes, how a search for
// "<site> <topic>" deep-links into it, and how writers must form links.
const DEFAULT_NAV_PATH = (label) => (/^home$/i.test(label) ? "/" : `/${slug(label)}`);
const segs = (u) => u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
const wordsIn = (s) => String(s).replace(/\.(html?|php|aspx?)$/i, "").split(/[-_+\s]+/).filter((w) => /\p{L}/u.test(w));
const isDated = (p) => /\/(?:19|20)\d\d\/(?:\d{1,2}|[a-z]{3})\/(?:\d{1,2}\/)?/i.test(p);
const isStory = (u) => isDated(u.pathname) || /\/(?:articles?|story|stories|news\/[a-z]+-\d+|live-news|live)\//.test(u.pathname) || /\.html?$/.test(u.pathname) && !/index\.html?$/.test(u.pathname) || segs(u).some((s) => wordsIn(s).length >= 4);

const ARCH = {
  newsportal: {
    kind: "news", search: ["/search", "q"],
    find: (t, b) => [`/${slug(t)}`, `${cap(t)} | ${b.name}`],
    page: (u) => (/\/videos?\//.test(u.pathname) ? "video" : isStory(u) ? "article" : "front"),
    urls: (d) => `stories /web/${d}/2046/03/04/world/some-story-slug/index.html, sections /web/${d}/politics, videos /web/${d}/videos/some-video-slug`,
    vocab: `.breaking (a red breaking-news strip: <p class="breaking"><b>Breaking</b> <a href="…">headline</a></p>); ul.heads (a dense headline list: <ul class="heads"><li><a href="…">Headline</a> <span class="tag hot">Live</span></li>…</ul>); .story (a teaser: <div class="story"><img class="pic" …><h3><a href="…">Headline</a></h3><p class="meta">3 min read</p></div>); .kicker (small label above a headline); .vcard (video teaser: <a class="vcard" href="…"><img class="pic" …><span class="dur">3:12</span><b>Headline</b></a>)`,
  },
  newspaper: {
    kind: "news", search: ["/search", "query"],
    find: (t, b) => [`/topic/${slug(t)}`, `${cap(t)} - ${b.name}`],
    page: (u) => (isStory(u) && !/\/topic\//.test(u.pathname) ? "article" : "front"),
    urls: (d) => `stories /web/${d}/2046/03/04/science/some-story-slug.html, sections /web/${d}/section/world, topics /web/${d}/topic/some-topic`,
    vocab: `ul.heads (headline list: <ul class="heads"><li><a href="…">Headline</a><p>one-line summary</p></li>…</ul>); .story (a teaser: <div class="story"><h3><a href="…">Headline</a></h3><p>summary</p><p class="meta">5 min read</p></div>; one may hold an img.pic); .kicker (small caps label above a headline)`,
  },
  community: {
    kind: "forum", search: ["/search/", "q"],
    find: (t, b) => (wordsIn(t).length === 1 ? [`/r/${t.replace(/\W+/g, "")}/`, `r/${cap(t).replace(/\W+/g, "")} - ${b.name}`] : [`/search/?q=${q(t)}`, `${t} : ${b.name} search`]),
    page: (u) => (/\/comments\//.test(u.pathname) ? "thread" : /^\/(?:user|u)\//.test(u.pathname) ? "profile" : "feed"),
    navPath: (l) => ({ home: "/", popular: "/r/popular/", explore: "/explore/", all: "/r/all/" }[l.toLowerCase()] ?? (/^r\//i.test(l) ? `/${l}/` : DEFAULT_NAV_PATH(l))),
    urls: (d) => `threads /web/${d}/r/<subreddit>/comments/<6-char id>/<title_words_with_underscores>/, communities /web/${d}/r/<subreddit>/, users /web/${d}/user/<name>/`,
    vocab: `.post as a post card: <div class="post"><div class="who"><span class="av">SR</span><b>COMMUNITY</b><span class="meta">USER · 5h</span></div><h3><a href="…/comments/…">Title</a></h3><p>preview or body</p><div class="meta">▲ 1,204 · 💬 214 comments · Share</div></div> (write vote counts in full, like 14,712, never 14.7k); as a comment: <div class="post"><div class="who"><span class="av">QF</span><b>USER</b><span class="meta">3h</span></div><p>…</p><div class="meta">▲ 88 · Reply</div></div>, and a reply to it is a .post nested inside it`,
  },
  linkboard: {
    kind: "forum", search: ["/search", "q"],
    find: () => ["/", "Hacker News"],
    page: (u) => (/^\/item/.test(u.pathname) ? "item" : "front"),
    navPath: (l) => ({ new: "/newest", past: "/front", comments: "/newcomments", ask: "/ask", show: "/show", jobs: "/jobs", submit: "/submit" }[l.toLowerCase()] ?? DEFAULT_NAV_PATH(l)),
    urls: (d) => `discussion pages /web/${d}/item?id=<8 digits>&t=<title-as-slug>, users /web/${d}/user?id=<name>; story links go to invented outside domains`,
    vocab: `ol.hn (ranked links: <ol class="hn" start="1"><li><a href="/web/invented.tld/path">Title</a> <span class="meta">(invented.tld)</span><p class="meta">312 points by user 3 hours ago | <a href="/web/DOMAIN/item?id=…">148 comments</a></p></li>…</ol>); comments are .post blocks with .who (username, age) and nested replies`,
  },
  encyclopedia: {
    kind: "wiki", search: ["/w/index.php", "search"],
    find: (t, b) => [`/wiki/${wikiTitle(t)}`, `${cap(t)} - ${b.name}`],
    page: (u) => (u.searchParams.get("search") || /Special:Search/.test(u.pathname) ? "search" : /^\/wiki\/(?!Main_Page$)./.test(u.pathname) ? "article" : "main"),
    navPath: (l) => ({ "main page": "/wiki/Main_Page", contents: "/wiki/Wikipedia:Contents", "current events": "/wiki/Portal:Current_events", "random article": "/wiki/Special:Random", "about wikipedia": "/wiki/Wikipedia:About", "contact us": "/wiki/Wikipedia:Contact_us", help: "/wiki/Help:Contents" }[l.toLowerCase()] ?? `/wiki/${wikiTitle(l)}`),
    urls: (d) => `articles /web/${d}/wiki/Article_Title_With_Underscores (link generously within prose, like Wikipedia)`,
    vocab: `.infobox (a floated fact table: <table class="infobox"><caption>Name</caption><tr><th>Label</th><td>Value</td></tr>…</table>, may start with an img.pic row); <sup>[1]</sup> citation markers; ol.refs (references list); .hatnote (italic note at the top)`,
  },
  marketplace: {
    kind: "store", search: ["/s", "k"],
    find: (t, b) => [`/s?k=${q(t)}`, `${b.name} : ${t}`],
    page: (u) => (/\/(?:dp|gp\/product|itm|ip|listing|rooms|hotel|homedetails|biz|product|products|p|t|pd)\//.test(`${u.pathname}/`) ? "product"
      : /^\/(?:s|search|sch|b|c|browse|shop|market)(?:\/|$)/.test(u.pathname) || ["k", "q", "_nkw", "query", "search"].some((k) => u.searchParams.get(k)) ? "search"
      : segs(u).some((s) => wordsIn(s).length >= 3) ? "product" : "home"),
    urls: (d) => `products /web/${d}/Product-Name-In-Title-Case/dp/B0<8 caps/digits>, searches /web/${d}/s?k=<words+joined+by+plus>`,
    vocab: `products are .card items (an img.pic, an <h3><a href="…">keyword-rich product title</a></h3>, .stars with a .meta count, a .price and an Add to cart .btn with data-add-to-cart data-name data-price) in a .grid`,
  },
  video: {
    kind: "blog", search: ["/results", "search_query"],
    find: (t, b) => [`/results?search_query=${q(t)}`, `${t} - ${b.name}`],
    page: (u) => (/^\/(?:watch|shorts|videos?)\b/.test(u.pathname) ? "watch" : /^\/(?:results|search)/.test(u.pathname) ? "results" : /^\/(?:@|c\/|channel\/|user\/)/.test(u.pathname) || segs(u).length === 1 && !/^(?:feed|browse|directory|explore|trending)$/.test(segs(u)[0]) ? "channel" : "home"),
    urls: (d) => `videos /web/${d}/watch?v=<the-video-title-as-a-slug>, channels /web/${d}/@ChannelName`,
    vocab: `.vcard (a video: <a class="vcard" href="/web/DOMAIN/watch?v=title-slug"><img class="pic" src="/img/…" alt=""><span class="dur">12:41</span><b>Video title</b><span class="meta">Channel · 1.2M views · 3 days ago</span></a>) inside a .grid`,
  },
  codehost: {
    kind: "startup", search: ["/search", "q"],
    find: (t, b) => [`/topics/${slug(t)}`, `${t} · ${b.name} Topics · ${b.name}`],
    page: (u) => {
      const s = segs(u);
      if (!s.length) return "home";
      if (/^(?:search|topics|explore|trending|features|pricing|about|enterprise|marketplace|sponsors|collections|login|signup)$/.test(s[0])) return s[0] === "search" || s[0] === "topics" || s[0] === "explore" || s[0] === "trending" ? "search" : "home";
      if (s.length === 1) return "profile";
      return /^(?:issues|pull|discussions)$/.test(s[2] ?? "") && /^\d+$/.test(s[3] ?? "") ? "issue" : "repo";
    },
    urls: (d) => `repositories /web/${d}/<owner>/<repo>, files /web/${d}/<owner>/<repo>/blob/main/<path>, issues /web/${d}/<owner>/<repo>/issues/<number>, users /web/${d}/<login>`,
    vocab: `code blocks as <pre><code>…</code></pre>; file listings as a table (name with 📁 or 📄, last commit message, age); .tag for topics and labels`,
  },
  qa: {
    kind: "forum", search: ["/search", "q"],
    find: (t, b) => [`/questions/tagged/${slug(t)}`, `Newest '${slug(t)}' Questions - ${b.name}`],
    page: (u) => (/^\/questions\/\d+/.test(u.pathname) || /\/(?:q|answer|question)\//.test(u.pathname) || segs(u).length === 1 && wordsIn(segs(u)[0]).length >= 3 ? "question" : "list"),
    urls: (d) => `questions /web/${d}/questions/<8 digits>/<question-title-as-slug>, tags /web/${d}/questions/tagged/<tag>, users /web/${d}/users/<id>/<name>`,
    vocab: `a question or answer is a .post: <div class="post"><p>…</p><pre><code>…</code></pre><div class="row"><a class="tag" href="…">python</a></div><div class="who"><span class="av">JM</span><b>username</b><span class="meta">answered Mar 4, 2046 · 12.4k rep</span></div><div class="meta">▲ 42</div></div> (the vote count is shown beside it); add <span class="tag hot">✓ Accepted</span> to the accepted answer; list pages use .qsum (<div class="qsum"><div class="stats"><span><b>12</b> votes</span><span class="ans"><b>3</b> answers</span><span><b>1k</b> views</span></div><div><h3><a href="…">Question title</a></h3><p>excerpt</p><div class="row"><a class="tag" href="…">tag</a></div><p class="meta">user asked 2 mins ago</p></div></div>)`,
  },
  productbrand: {
    kind: "startup", search: ["/search", "q"],
    find: (t, b) => [`/${slug(t)}/`, `${cap(t)} - ${b.name}`],
    page: (u) => (segs(u).length ? "product" : "home"),
    urls: (d) => `products /web/${d}/<product-name>/, buying /web/${d}/shop/buy-<product-name>`,
    vocab: `.tile (a full-width product panel: <div class="tile"><h2>Product</h2><p class="lead">tagline</p><div class="row"><a class="btn" href="…">Learn more</a><a class="btn ghost" href="…">Buy</a></div><img class="pic" …></div>)`,
  },
  classifieds: {
    kind: "store", search: ["/search/sss", "query"],
    find: (t, b) => [`/search/sss?query=${q(t)}`, `${t} for sale - ${b.name}`],
    page: (u) => (/\/d\/.+|\/\d{7,}\.html$/.test(u.pathname) ? "posting" : /^\/search\//.test(u.pathname) ? "search" : "home"),
    urls: (d) => `category searches /web/${d}/search/<3-letter code like sss, apa, fua, jjj, cta>, postings /web/${d}/<area>/<code>/d/<title-slug>/<10 digits>.html`,
    vocab: `plain lists of small links (ul, no bullets, no cards); .price; .meta for neighbourhoods in parentheses`,
  },
  social: {
    kind: "forum", search: ["/search", "q"],
    find: (t, b) => [`/search?q=${q(t)}`, `${t} - Search / ${b.name}`],
    page: (u) => (/\/(?:status|posts|p|reel|permalink|post)\//.test(u.pathname) ? "post" : segs(u).length === 1 && !/^(?:home|explore|search|notifications|messages|feed|i|jobs|mynetwork|reels|watch|groups|marketplace)$/.test(segs(u)[0]) ? "profile" : "feed"),
    urls: (d) => `profiles /web/${d}/<handle>, posts /web/${d}/<handle>/status/<19 digits>`,
    vocab: `a post is a .post: <div class="post"><div class="who"><span class="av">MO</span><b>Display Name</b><span class="meta">@handle · 2h</span></div><p>text with #hashtags and @mentions</p><div class="meta">💬 212 · 🔁 1,204 · ♥ 8,412</div></div> (counts in full digits); it may hold one img.pic`,
  },
  streaming: {
    kind: "blog", search: ["/search", "q"],
    find: (t, b) => [`/search?q=${q(t)}`, `${cap(t)} | ${b.name}`],
    page: (u) => (/\/(?:title|watch|album|playlist|show|movie|series|artist|episode|track|name)\//.test(u.pathname) ? "title" : "home"),
    urls: (d) => `titles /web/${d}/title/<8 digits>-<title-slug>, playlists and albums /web/${d}/playlist/<title-slug>`,
    vocab: `.tile (a title card: <a class="tile" href="…"><img class="pic" …><b>Title</b><span class="meta">98% Match · 2046 · 3 Seasons</span></a>) in a .grid; track or episode lists as a table`,
  },
  landing: {
    kind: "startup", search: ["/search", "q"],
    find: (t, b) => [`/${slug(t)}`, `${cap(t)} | ${b.name}`],
    page: (u) => (segs(u).length ? "page" : "home"),
    urls: (d) => `pages /web/${d}/<section>/<page>`,
    vocab: `the standard components, in the site's own voice`,
  },
};
export const archOf = (b) => ARCH[b.arch] ?? ARCH.landing;
const navOf = (b) => (b.nav ?? []).map((n) => (Array.isArray(n) ? n : [n, (archOf(b).navPath ?? DEFAULT_NAV_PATH)(n)]));
const navPath = (b, label) => (archOf(b).navPath ?? DEFAULT_NAV_PATH)(label);

// The search result a query naming a site gets: its home page with
// sitelinks, or the page on it the query asks for.
export function siteResult({ site: b, topic }) {
  const base = `https://${b.host}`;
  if (!topic) {
    return { url: `${base}/`, title: b.title ?? b.name, snippet: b.about ?? "", home: true, links: (b.links ?? []).map((l) => [l, navPath(b, l), sitelinkNote(b, l)]) };
  }
  const label = navOf(b).find(([l]) => slug(l) === slug(topic))?.[0];
  const [path, title] = archOf(b).find(label ?? topic, b);
  return { url: base + path, title, snippet: deepSnippet(b, topic), home: false, links: [] };
}

function sitelinkNote(b, label) {
  const l = label.replace(/^r\//, "");
  return {
    newsportal: /live|tv|watch|weather|scores|fantasy/i.test(l) ? `${l} from ${b.name}: live coverage, around the clock.` : `The latest ${l} news, live updates and video from ${b.name}.`,
    newspaper: `${l} coverage and analysis from ${b.name}.`,
    community: /^r\//.test(label) ? `r/${l}: ${fnv(l) % 40 + 2}M members sharing, arguing and upvoting.` : `${l} on ${b.name}.`,
    marketplace: `Shop ${l} on ${b.name}.`,
    encyclopedia: `${l} — ${b.name}, the free encyclopedia.`,
  }[b.arch] ?? `${l} — ${b.name}.`;
}
function deepSnippet(b, topic) {
  const t = cap(topic);
  return {
    newsportal: `The latest ${t} news, analysis and video from ${b.name}, updated around the clock.`,
    newspaper: `News about ${t}, including commentary and archival articles published in ${b.name}.`,
    community: `Join the ${t} discussion on ${b.name}: threads, advice and arguments from people who care about it far too much.`,
    encyclopedia: `${t} — overview, history, notable examples and references, from ${b.name}, the free encyclopedia.`,
    marketplace: `Results for ${topic} on ${b.name}: compare prices, ratings and delivery dates.`,
    video: `Watch ${topic} videos on ${b.name}: explainers, reviews, highlights and more.`,
    codehost: `Repositories about ${topic} on ${b.name}: libraries, tools and examples.`,
    qa: `Questions tagged [${slug(topic)}] on ${b.name}, with voted answers from working developers.`,
    classifieds: `${topic} for sale near you on ${b.name}: local listings from owners and dealers.`,
    social: `See posts about ${topic} on ${b.name}.`,
    streaming: `Watch ${t} on ${b.name}.`,
  }[b.arch] ?? `${t} on ${b.name}.`;
}

// ---------- the page plan ----------
// The page's own title: the words in its URL, else the search result's title
// minus the site's name, else nothing (a site's front page has no headline).
function pageTitle(b, u, page, args) {
  const params = ["q", "k", "query", "search", "search_query", "_nkw"].map((k) => u.searchParams.get(k)).find(Boolean);
  const fromResult = String(args.title ?? "").replace(new RegExp(`\\s*[-|–—·:\\\\]+\\s*(?:${b.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${b.key})[^-|–—·]*$`, "i"), "").replace(new RegExp(`^${b.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:|–—-]\\s*`, "i"), "").trim();
  if (["front", "main", "home", "feed"].includes(page) && !segs(u).length || page === "main") return "";
  if (params && ["search", "results", "list", "feed"].includes(page)) return `“${params}”`;
  if (b.arch === "community" && page === "feed") { const r = u.pathname.match(/\/r\/([^/]+)/); if (r) return `r/${r[1]}`; }
  if (b.arch === "codehost" && page === "repo") return segs(u).slice(0, 2).join("/");
  if (b.arch === "codehost" && page === "profile") return segs(u)[0];
  if (b.arch === "video" && page === "watch") { const v = u.searchParams.get("v"); if (v && wordsIn(v).length >= 2) return cap(wordsIn(v).join(" ")); }
  const best = segs(u).filter((s) => !/^(?:index\.html?|dp|wiki|r|comments|questions|status|d|itm|p|watch|title|story|article|articles|_|id|issues|pull|topic|section|tagged|video|videos|search)$/i.test(s) && !/^[A-Z0-9]{8,}$/.test(s) && !/^\d+(?:\.html)?$/.test(s))
    .map((s) => wordsIn(s)).filter((w) => w.length).sort((a, z) => z.length - a.length)[0];
  const fromURL = best ? (b.arch === "encyclopedia" ? best.join(" ") : best.length >= 3 && best.every((w) => w === w.toLowerCase()) && b.arch !== "marketplace" ? best.join(" ").replace(/^./, (c) => c.toUpperCase()) : cap(best.join(" "))) : "";
  const label = navOf(b).find(([l]) => slug(l) === slug(fromURL))?.[0];
  if (b.arch === "codehost" && page === "issue") return (fromResult || `${segs(u).slice(0, 2).join("/")} #${segs(u)[3]}`).slice(0, 140);
  if (b.arch === "social" && page === "profile") return segs(u)[0].replace(/^@/, "");
  if (label) return label;
  if (fromResult && (!fromURL || wordsIn(fromURL).length < 3 || b.arch === "codehost")) return fromResult.slice(0, 140);
  return (fromURL || fromResult || (page === "watch" ? "Video" : "")).slice(0, 140);
}

// Section briefs for each kind of page on each archetype. Four writers, in
// document order; the layout CSS places them (a CNN front page puts the
// first section in the middle column, the second on the left…).
const BRIEFS = {
  newsportal: {
    front: { pics: [1, 0, 3, 4], briefs: [
      "The lead package (it sits in the wide middle column): start with a .breaking strip naming the biggest breaking story, then ONE big picture of it, a huge h2 headline link to the story, a one-sentence summary, and a ul.heads of 3 related headline links (one tagged Live)",
      "The left headline rail: h2 'Top headlines' then a ul.heads of 9-10 short, punchy headline links from every section, some with a .tag (Live, Analysis, Opinion)",
      "The right rail: h2 'More top stories' then 3 .story teasers, each with a small picture, a .kicker, a headline link and a .meta, then a ul.heads of 3 more",
      "A full-width video row: h2 'Featured videos' then a .grid of 4 .vcard video teasers with pictures and runtimes, then a ul.heads 'Paid partner content' of 3 lines in .meta",
    ] },
    article: { pics: [0, 1, 0, 3], briefs: [
      "The story's opening: a first paragraph beginning with an all-caps dateline and the outlet ('WASHINGTON (CNN) —' style, using this site's name), then 3-4 short paragraphs with the who, what, when and where",
      "The reporting continues: 3 paragraphs with named sources and exact numbers, one .quote with attribution, and one picture with a caption in a .meta",
      "Context and what's next: an h2 subhead, 3 short paragraphs, then a 'What we know' ul of 4 facts with numbers in <b>",
      "Below the story: h2 'More from this site' (use the site's name) and a .grid of 3 .story teasers with pictures and headline links",
    ] },
    video: { pics: [0, 0, 4, 0], briefs: [
      "The video's description under the player: 2 short paragraphs, then .meta with the air date, runtime and the show it aired on",
      "Up next: h2 'Up next' and a ul.heads of 6 video headline links, each with its runtime in .meta",
      "h2 'More videos' and a .grid of 4 .vcard video teasers with pictures and runtimes",
      "h2 'Related stories' and a ul.heads of 5 headline links",
    ] },
  },
  newspaper: {
    front: { pics: [1, 0, 1, 0], briefs: [
      "The lead story package (wide left column): a .kicker, a big h2 headline link, a 2-sentence summary, one picture with a .meta photo credit, then 2 related .story teasers (headline link and one-line summary each)",
      "The opinion column (narrow right): h2 'Opinion' then 5 .story teasers, each a columnist's name in .kicker, a headline link and a one-line summary",
      "More news (wide left): 4 .story teasers separated by rules, each with a .kicker, a headline link, a 2-sentence summary and a .meta read time; one has a picture",
      "The right column below: h2 'Most popular' as an ol of 5 headline links, then a small box of the site's own games, cooking or newsletters with 3 links",
    ] },
    article: { pics: [0, 1, 0, 0], briefs: [
      "The article's opening: 4 elegant paragraphs of reported prose that set the scene and state the news in the second paragraph",
      "The reporting continues: an h2 subhead, 3 paragraphs with named sources and numbers, and one picture with a .meta caption and photo credit",
      "Analysis and stakes: 3 paragraphs, one .quote pull quote, and a closing paragraph",
      "After the article: a short italic author note in .meta (who reported it and from where), then h2 'More on this story' as a ul.heads of 4 headline links with one-line summaries",
    ] },
  },
  community: {
    feed: { kind: "forum", pics: [0, 1, 0, 0], briefs: [
      "Three post cards (.post with the community, username and age in .who, a title link to the thread, a 1-2 sentence preview and a .meta '▲ N · 💬 N comments · Share' with N in full digits); make one a text post and one a question, and tag one with a .tag flair",
      "Three more post cards, one of them an image post with ONE picture instead of a preview; vary scores from 12 to 24k",
      "Three more post cards, including one tagged .tag.hot 'Pinned' by a moderator and one with a spicy disagreement in the title",
      "Two more post cards and a .callout from the moderators about the community's weekly thread",
    ] },
    thread: { kind: "forum", pics: [1, 0, 0, 0], briefs: [
      "The original post's body: 2-3 paragraphs in the poster's own voice with specifics (and ONE picture if it's an image post), then an 'EDIT:' line in .meta and the post's .meta '▲ N · 💬 N comments · Share' — no title, no username (both are shown above)",
      "The top comment thread: 1 highly upvoted comment (.post) with 2 nested replies (.post inside it), each with a username and age in .who and a .meta '▲ N · Reply'; one reply is from the original poster",
      "Two more top-level comment threads, one of them a joke that got more upvotes than it deserved, each with one nested reply",
      "Two more top-level comments with lower scores, one a dissent with a detailed counterpoint, one a late useful answer, then a .meta 'View more comments'",
    ] },
    profile: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "The user's recent posts: 3 .post cards in different communities",
      "The user's recent comments: 3 short .post comments, each with the thread title it replied to in .meta",
      "Trophy case: a ul of 4 trophies with dates",
      "Moderator of: a ul of 3 communities with member counts in .meta",
    ] },
  },
  linkboard: {
    front: { pics: [0, 0, 0, 0], briefs: [
      "Ranked stories 1-10 as ol.hn start=\"1\": mixed 'Show HN:', 'Ask HN:', essays, papers and launches, each with points, username, age and comment count",
      "Ranked stories 11-20 as ol.hn start=\"11\"",
      "Ranked stories 21-30 as ol.hn start=\"21\"",
      "A single .meta line: 'More' link, then a .meta line of the site's footer-style notice about an upcoming event",
    ] },
    item: { pics: [0, 0, 0, 0], briefs: [
      "The top comment thread: a .post with a long, precise, slightly contrarian comment and 2 nested .post replies",
      "A second thread: a practitioner's detailed war story as a .post with one nested reply that nitpicks it",
      "A third thread: a short sharp comment with 3 nested replies arguing",
      "Two more short top-level .post comments, one linking to prior discussion",
    ] },
  },
  encyclopedia: {
    article: { kind: "wiki", pics: [1, 0, 1, 0], briefs: [
      "The article's lead: a floated .infobox table (a picture as its first row, then 6-8 fields) and 2-3 lead paragraphs that begin with the subject's name in <b>, dense with internal links and <sup>[1]</sup> citations. No h2: the lead has no heading, so start with the infobox",
      "h2 'History' with 2 h3 subsections of encyclopedic prose, dated facts, internal links and citations",
      "h2 with the article's main descriptive section (e.g. 'Description', 'Design', 'Biology', 'Mechanism'), 2-3 paragraphs, one wikitable (a table) and one picture floated in prose with a .meta caption",
      "h2 'See also' as a ul of 4 internal links, then h2 'References' as ol.refs of 6 invented citations (author, title in quotes, publication, date, 'Retrieved' date)",
    ] },
    main: { kind: "wiki", pics: [1, 0, 0, 0], briefs: [
      "h2 'From today's featured article': one picture floated left, a paragraph summary of an invented article beginning with its name in bold, ending with '(Full article...)' link, and a .meta 'Recently featured' line of 3 links",
      "h2 'In the news': a ul of 5 one-sentence news items with bold links, then a .meta 'Ongoing: …' line and 'Recent deaths: …' line",
      "h2 'Did you know ...': a ul of 6 '... that …?' hooks, each with a bold link",
      "h2 'On this day': the date in bold, then a ul of 5 dated events with links, then a .meta line of more anniversaries",
    ] },
    search: { kind: "wiki", pics: [0, 0, 0, 0], briefs: [
      "A .meta 'Results 1 – 20 of 4,812', then 4 results, each an h3 link to an article, a 2-line snippet with <mark> on the matched words, and a .meta word count and date",
      "4 more results in the same format",
      "4 more results in the same format",
      "h3 'Related articles' as a ul of 5 links",
    ] },
  },
  marketplace: {
    home: { pics: [1, 1, 1, 1], briefs: [
      "One home-page card: an h2 like a real deal-tile headline for this site, ONE picture, 3 item links with .price, and a 'See more' link",
      "Another home-page card in a different category: h2, ONE picture, 3 item links with .price, and a 'Shop now' link",
      "Another home-page card for a seasonal or trending pick: h2, ONE picture, a short line and an 'Explore' link",
      "Another card: h2 'Deals for you' or similar, ONE picture, 3 deals with a .tag.hot percentage off and .price",
    ] },
    search: { kind: "store", pics: [3, 3, 0, 0], briefs: [
      "Search results 1-3: a .grid of 3 product .card items (picture, keyword-rich title link, .stars and rating count in .meta, .price, a delivery line in .meta, an Add to cart .btn); tag one .tag 'Best Seller' and one .tag 'Sponsored'",
      "Search results 4-6: another .grid of 3 product .card items in the same format with different price points",
      "Search results 7-10 as a compact .grid of 4 .card items without pictures (title link, .stars, .price, delivery .meta, Add to cart .btn)",
      "h2 'Related searches' as a .row of 6 .tag links, then a .callout 'Need help? Visit the help section or contact us'",
    ] },
    product: { kind: "store", pics: [0, 3, 0, 0], briefs: [
      "'About this item': a ul of 5 detailed bullets, each starting with an ALL-CAPS lead phrase in <b>, then a small table of 4 key specs (brand, material or capacity, dimensions, model). Use exactly the product and price in the page header",
      "h2 'Products related to this item' or 'Frequently bought together': a .grid of 3 product .card items with pictures, title links, .stars, .price and Add to cart .btn",
      "h2 'Product information': a two-column table of 8 technical details and additional information (customer rating, best sellers rank, date first available)",
      "h2 'Customer reviews': the overall .stars and rating count from the page header, .bars for 5 to 1 stars with percentages, then 3 review .post blocks (title in <b>, 'Verified Purchase' .tag, date, body, .meta 'Helpful N')",
    ] },
  },
  video: {
    home: { pics: [4, 4, 0, 0], briefs: [
      "A .grid of 4 .vcard videos about varied topics, each with a picture, runtime, title, channel and views · age",
      "A .grid of 4 more .vcard videos with pictures",
      "h2 'Shorts' then a .grid of 4 short .vcard items WITHOUT pictures (title, views) — vertical shorts",
      "A .grid of 4 .vcard videos WITHOUT pictures in .meta-only form, titled 'Recommended' in an h2",
    ] },
    watch: { kind: "blog", pics: [0, 0, 4, 0], briefs: [
      "The description box: a .meta line of views, upload date and 3 #hashtags, then 2 paragraphs of the creator's description and a ul of 4 chapter timestamps ('0:00 Intro')",
      "h2 with the comment count ('2,314 Comments'), then 4 comments as .post (an @handle in .who with age, text, .meta '👍 1,204 · Reply' in full digits), one pinned by the creator",
      "Up next (the right column): 4 .vcard videos with pictures, runtimes, titles, channels and views, then 3 more as text-only .vcard",
      "3 more comments as .post, one with a nested reply from the creator",
    ] },
    channel: { kind: "blog", pics: [4, 0, 0, 0], briefs: [
      "h2 'Videos' then a .grid of 4 .vcard videos with pictures",
      "h2 'Popular' then a .grid of 4 .vcard videos without pictures",
      "h2 'About' with 2 paragraphs about the channel, the join date and total views in .meta",
      "h2 'Featured channels' as a ul of 4 channel links with subscriber counts in .meta",
    ] },
    results: { kind: "blog", pics: [3, 3, 0, 0], briefs: [
      "3 search results, each a .vcard with a picture, title, views · age, channel, and a one-line description in .meta",
      "3 more .vcard results with pictures",
      "h2 'People also watched' then 3 .vcard results without pictures",
      "h2 'Searches related to this' as a .row of 6 .tag links",
    ] },
  },
  codehost: {
    repo: { kind: "startup", pics: [0, 0, 0, 0], briefs: [
      "The file list: a table of 9 rows (📁 folders first, then 📄 files like README.md, LICENSE, package.json or Cargo.toml), each with a link to /blob/main/<path> or /tree/main/<dir>, a realistic last commit message and an age in .meta. No h2",
      "The README, part 1: an h2 with the project name, a .row of 3-4 .tag badges (build passing, version, license), a one-paragraph pitch, then '### Install' as an h3 with a <pre><code> install command",
      "The README, part 2: h3 'Usage' with a short paragraph and a realistic <pre><code> example, then h3 'Features' as a ul of 5",
      "The README, part 3: h3 'Roadmap' as a ul of 3 checkbox-style items, h3 'Contributing' with one paragraph, h3 'License' with one line",
    ] },
    issue: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "The opening comment as a .post: the author's login in .who with 'commented 3 days ago', then steps to reproduce as an ol, expected vs actual behaviour, and a <pre><code> error log",
      "Two replies as .post comments: a maintainer asking a precise question, the author answering with version info",
      "A contributor's .post with a root-cause analysis and a <pre><code> diff-like snippet, then a .meta event line 'linked a pull request that will close this issue'",
      "A maintainer's closing .post thanking everyone and naming the release, then a .meta event line 'closed this as completed in #N'",
    ] },
    profile: { kind: "startup", pics: [0, 0, 0, 0], briefs: [
      "h2 'Popular repositories' then a .grid of 6 .card repos: repo link, 'Public' .tag, one-line description, language and stars in .meta",
      "h2 'Contribution activity' with a ul.timeline of 4 dated activity items (created repositories, opened pull requests, reviewed)",
      "A profile README: an h3 greeting, 2 sentences about what they build, a ul of 3 current projects",
      "h2 'Organizations' as a .row of 3 .tag links and a .meta 'Achievements' line",
    ] },
    search: { kind: "startup", pics: [0, 0, 0, 0], briefs: [
      "A .meta results count, then 3 repository results as .card items: owner/repo link, description, 3 topic .tag links, language, stars and 'Updated 2 days ago' in .meta",
      "3 more repository .card results",
      "3 more repository .card results",
      "h2 'Related topics' as a .row of 6 .tag links",
    ] },
    home: { kind: "startup", pics: [1, 0, 0, 0], briefs: [
      "The platform pitch: a .lead line, a .row of an email field and a 'Sign up' .btn, and ONE picture of a product screenshot",
      "h2 on collaboration features and a .grid of 3 .card features with short copy",
      "h2 on AI and automation with 3 .stat figures and a short <pre><code> example",
      "h2 on customers: 3 .quote testimonials from invented companies, then a pricing .callout",
    ] },
  },
  qa: {
    question: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "The question as one .post: 2 paragraphs describing the problem precisely, a <pre><code> minimal example and the exact error, 'What I tried' as a ul, a .row of 3-4 .tag tags, the asker in .who ('asked Mar 4, 2046'), and its score in the last .meta ('▲ 42'). No h2",
      "h2 with the answer count (e.g. '3 Answers'), then the accepted answer as a .post with <span class=\"tag hot\">✓ Accepted</span>, a precise explanation, a <pre><code> fix and why it works, the answerer in .who with reputation, and its score in the last .meta",
      "A second answer as a .post with an alternative approach, a <pre><code> example and a caveat, and a lower score",
      "A third, short answer as a .post with a low score, then a .callout 'Not the answer you're looking for? Browse other questions tagged …'",
    ] },
    list: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "4 question summaries as .qsum blocks (votes, answers, views; title link; one-line excerpt; tags; asker and age)",
      "4 more .qsum question summaries; one with an accepted answer",
      "4 more .qsum question summaries",
      "A .meta line with pagination links (1 2 3 … 48291 Next)",
    ] },
  },
  productbrand: {
    home: { pics: [1, 1, 1, 0], briefs: [
      "A full-width .tile for the flagship product: h2 name, a .lead tagline, 'Learn more' .btn and 'Buy' .btn.ghost links, and ONE picture of the product",
      "A second full-width .tile for another product line, same structure, with ONE picture",
      "A third .tile for a service or accessory, same structure, with ONE picture",
      "A .grid of 4 small .card tiles (name, one-line tagline, 'Learn more' link) for more of the lineup, then a .meta line of footnote-style fine print",
    ] },
    product: { kind: "startup", pics: [1, 0, 1, 0], briefs: [
      "'Get the highlights': a .grid of 3 .card highlights, each with a big claim in <b>, one sentence, and ONE picture in the first",
      "'Why upgrade': a .grid of 4 .stat figures comparing to the previous generation, then 2 sentences",
      "A .split with ONE picture beside a feature story (h2, 2 short paragraphs, a 'Learn more' link)",
      "'Which model is right for you?': a comparison table of 3 models (price from, display, chip or engine, battery or range), then 'Buy' .btn links",
    ] },
  },
  classifieds: {
    home: { pics: [0, 0, 0, 0], briefs: [
      "Directory column 1: h2 'community' with a ul of 16 category links (the classic ones plus a few futuristic ones), then h2 'services' with a ul of 14",
      "Directory column 2: h2 'housing' with a ul of 10 category links, then h2 'for sale' with a ul of 20 (include 2-3 future things like drone parts or exosuits)",
      "Directory column 3: h2 'jobs' with a ul of 16 category links, then h2 'gigs' with 8 and h2 'resumes'",
      "The right column: h2 'nearby cl' with a ul of 12 city links, then h2 'us cities' with 6 and 'cl worldwide' with 4",
    ] },
    search: { kind: "store", pics: [0, 0, 0, 0], briefs: [
      "10 listings as a plain ul: each li has a short date in .meta, a title link to the posting, a .price and the neighbourhood in .meta parentheses",
      "10 more listings in the same format",
      "8 more listings, a couple with no price",
      "A .meta line with pagination ('1 - 120 / 3,000') and 'nearby areas' links",
    ] },
    posting: { kind: "store", pics: [1, 0, 0, 0], briefs: [
      "The posting body: ONE picture, then 2-3 short, plain paragraphs written by the seller, with condition, why they're selling and pickup details",
      "The attributes as a small table (condition, make / manufacturer, model name / number, size / dimensions) and a line 'do NOT contact me with unsolicited services or offers'",
      "A reply box: a <form method=\"post\"> with name, email and message fields and a 'reply' button",
      "A .meta line with the post id, posted and updated timestamps, then 'more ads by this user' link",
    ] },
  },
  social: {
    feed: { kind: "forum", pics: [1, 0, 1, 0], briefs: [
      "3 posts (.post) from different accounts, one with ONE picture; varied lengths and counts",
      "3 more posts, one a quote-post style reply to a big account",
      "3 more posts, one with ONE picture and one a thread starter ('1/')",
      "2 more posts, including one from a verified organisation",
    ] },
    profile: { kind: "forum", pics: [1, 0, 0, 0], briefs: [
      "A pinned post by this account (.tag 'Pinned') and 2 recent posts, one with ONE picture",
      "3 more posts by this account, one a reply to another account",
      "2 reposts by this account of other accounts' posts, marked in .meta",
      "2 more posts by this account",
    ] },
    post: { kind: "forum", pics: [1, 0, 0, 0], briefs: [
      "The post itself as a large .post: text (and ONE picture if it suits), the exact time and date and view count in .meta, then the reply/repost/like counts",
      "3 replies as .post blocks from different accounts, one from the author",
      "3 more replies, one arguing, one adding a source",
      "2 more replies and a .meta 'Show more replies' line",
    ] },
  },
  streaming: {
    home: { pics: [1, 5, 0, 0], briefs: [
      "The featured title (the billboard): h2 title, a .meta line (match %, year, rating, seasons), a one-sentence synopsis, a .row of a '▶ Play' .btn and a 'More Info' .btn.ghost, and ONE wide picture of the key art",
      "h2 'Trending Now' then a .grid of 5 .tile titles with pictures",
      "h2 'New Releases' then a .grid of 6 .tile titles WITHOUT pictures (title and .meta only)",
      "h2 'Because You Watched' plus an invented title, then a .grid of 6 .tile titles WITHOUT pictures",
    ] },
    title: { kind: "blog", pics: [0, 4, 0, 0], briefs: [
      "About the title: the synopsis in 2 sentences, a .meta line of cast, genres and 'This show is: Suspenseful, Mind-bending', and a .row of '▶ Play' .btn and '+ My List' .btn.ghost",
      "h2 'More Like This' then a .grid of 4 .tile titles with pictures",
      "h2 'Episodes' (or 'Tracks') as a table of 6 rows: number, title, one-line description, duration",
      "h2 'About' with a small table of cast, creators, genres, maturity rating",
    ] },
  },
  landing: {
    home: { kind: "startup", pics: [0, 1, 0, 0], briefs: [
      "The value proposition under the hero: a .grid of 3 .card features with .icon emoji or short bold claims, in the brand's voice",
      "How it works: a .split with ONE picture beside ol.steps of 3 steps",
      "Proof: a .grid of 3 .stat figures, then 2 .quote testimonials from invented customers",
      "Pricing or getting started: a .grid of 3 plan .card items with .price and a .btn, then a short details.faq",
    ] },
    page: { kind: "startup", pics: [0, 1, 0, 0], briefs: [
      "The page's introduction: a .lead and a .grid of 3 .card points",
      "The main content: an h2 and a .split with ONE picture beside 2 paragraphs",
      "Details: a table or ol.steps with specifics",
      "A closing call to action .band with a .btn, and a short details.faq",
    ] },
  },
};
const PAGE_KINDS = { front: "news", article: "news", video: "news", feed: "forum", thread: "forum", item: "forum", article_wiki: "wiki" };

// Header facts the writers must agree with: the byline, counts and prices
// the code-rendered header already shows.
function details(plan) {
  const r = seeded(`${plan.site}|${plan.title}|${plan.page}`);
  const year = Number(String(plan.url ?? "").match(/\/(20[4-9]\d)\/\d{1,2}\//)?.[1]) || 2040 + (fnv(plan.site) % 9);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dated = String(plan.url ?? "").match(/\/(20\d\d)\/(\d{1,2})\/(\d{1,2})\//);
  const mi = dated ? Math.min(11, Number(dated[2]) - 1) : r(12), day = dated ? Number(dated[3]) : 1 + r(28);
  const people = ["Mara Okafor", "Theo Lindqvist", "Priya Raman", "Jules Ferreira", "Nadia Brandt", "Sam Achebe", "Iris Novak", "Kenji Moreau", "Lucía Paredes", "Owen Hart"];
  const handles = ["quiet_ferment", "mossbyte", "deltaSprocket", "oldharbor_", "pixelfern", "tinmouse", "saltmarsh42", "lina_k", "orbital_otter", "neon_gnocchi"];
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k` : String(n));
  const stated = String(`${plan.title} ${plan.tag} ${plan.snippet ?? ""}`).match(/\$\s?(\d[\d,]*(?:\.\d\d)?)/)?.[1];
  const unit = plan.brand.unit;
  const price = stated ? Number(stated.replace(/,/g, "")) : unit === "night" ? 80 + r(340) : plan.brand.key === "zillow.com" ? (385 + r(2100)) * 1000 : [14.99, 19.99, 24.99, 29.99, 34.99, 39.99, 49.99, 59.99, 79.99, 89.99, 99.99, 129.99, 149.99, 199.99, 249.99][r(15)];
  return {
    year, date: `${months[mi]} ${day}, ${year}`, short: `${months[mi].slice(0, 3)} ${day}, ${year}`, dow: days[r(7)], time: `${1 + r(11)}:${String(r(60)).padStart(2, "0")} ${r(2) ? "PM" : "AM"}`,
    author: people[r(people.length)], author2: people[r(people.length)], user: handles[r(handles.length)],
    hours: 1 + r(22), score: k(120 + r(24000)), comments: 40 + r(1400), members: k(20000 + r(9000000)), online: k(200 + r(40000)),
    rating: (3.9 + r(11) / 10).toFixed(1), ratings: (200 + r(48000)).toLocaleString("en-US"), price, list: Math.round(price * (1.12 + r(30) / 100)) - 0.01,
    views: k(2000 + r(4000000)), likes: k(100 + r(90000)), subs: k(5000 + r(8000000)),
    stars: k(200 + r(90000)), forks: k(20 + r(9000)), issues: 3 + r(400), pulls: 1 + r(60), watch: 10 + r(900),
    asked: 1 + r(9), viewed: (500 + r(90000)).toLocaleString("en-US"), rep: k(300 + r(90000)), qid: 70000000 + r(9000000),
    minutes: 2 + r(50), num: 100 + r(8000), lang: ["TypeScript", "Rust", "Python", "Go", "Zig", "Kotlin", "Swift", "Elixir"].find((l) => new RegExp(`\\b${l}\\b`, "i").test(`${plan.title} ${plan.topic}`)) ?? ["TypeScript", "Rust", "Python", "Go", "Zig", "Kotlin", "C++", "Elixir"][r(8)],
    channel: `${cap(wordsIn(plan.topic || plan.title || plan.site)[0] ?? "Future")} ${["Lab", "Explained", "Daily", "Works", "Studio", "Weekly"][r(6)]}`,
  };
}
const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function brandFacts(plan) {
  const d = details(plan);
  const b = plan.brand;
  const f = {
    "newsportal/article": [`Reported by ${d.author}, ${b.name}; updated ${d.time} ET, ${d.dow.slice(0, 3)} ${d.date}`],
    "newspaper/article": [`By ${d.author}; published ${d.date}, updated ${d.time} ET`],
    "community/feed": [`${plan.title || "The front page"}: ${d.members} members, ${d.online} online now`],
    "community/thread": [`Posted by ${b.key === "reddit.com" ? "u/" : ""}${d.user} ${d.hours} hours ago; score ${d.score}; ${d.comments} comments`],
    "marketplace/product": [`Price ${money(d.price)}${b.unit ? ` per ${b.unit}` : ""} (was ${money(d.list)}); rated ${d.rating} out of 5 from ${d.ratings} ratings`],
    "video/watch": [`Uploaded by ${d.channel} (${d.subs} subscribers); ${d.views} views; ${d.likes} likes`],
    "codehost/repo": [`${plan.title}: ${d.stars} stars, ${d.forks} forks, ${d.issues} open issues, ${d.pulls} pull requests; mostly ${d.lang}`],
    "codehost/issue": [`Issue opened by ${d.user} ${d.hours} days ago; ${d.comments % 40} comments`],
    "qa/question": [`Asked ${d.asked} years ago by ${d.user}; viewed ${d.viewed} times`],
    "encyclopedia/article": [`Page last edited ${d.date}`],
    "social/profile": [`${plan.title}: ${d.subs} followers`],
  }[`${b.arch}/${plan.page}`];
  return f ?? [];
}

// A plan for a page on a known site. It has the fields the generic
// machinery reads (kind, site, title, nav, secs…) plus the site itself.
export function brandPlan(args, b) {
  const u = new URL(args.url);
  const arch = archOf(b);
  const page = args.submission ? "confirm" : arch.page(u);
  const title = args.submission ? String(args.title ?? "") : pageTitle(b, u, page, args);
  const named = siteForQuery(args.query ?? "");
  const query = named?.site?.key === b.key ? named.topic : args.query;
  const topic = [title, args.snippet, query, args.siteContext?.query].filter(Boolean).join(". ") || `whatever is big on ${b.name} in the 2040s`;
  const set = BRIEFS[b.arch]?.[page] ?? Object.values(BRIEFS[b.arch] ?? BRIEFS.landing)[0];
  const c = brandPalette(b);
  return {
    kind: set.kind ?? arch.kind ?? PAGE_KINDS[page] ?? "blog",
    style: "minimal", mood: c.dark ? "dark" : "light", hue: hueOf(c.acc),
    site: b.name, title, tag: title ? String(args.snippet ?? "").slice(0, 200) : "", topic: String(query ?? "").slice(0, 100), snippet: args.snippet ?? "",
    mark: "", nav: navOf(b).map(([l]) => l).slice(0, 5),
    secs: set.briefs.map((s) => `${s}. Topic: ${topic}`),
    pics: set.pics, picShape: b.arch === "video" || b.arch === "streaming" || page === "video" ? "wide" : b.arch === "marketplace" ? "square" : undefined,
    brand: b, page, url: args.url,
  };
}

// What the section writers are told about the site they are imitating.
export function brandPrompt(plan, domain) {
  const b = plan.brand;
  const arch = archOf(b);
  return {
    intro: `You write ONE section of a page on ${b.name} (${domain}), the real, well-known website, as it will look in the 2040s. It must read exactly like ${b.name}: its real page structure, section names, labels, tone and conventions, filled with invented, futuristic content (never real current events, never real private people). The page's header, navigation, rails and footer already exist and are out of your hands.`,
    voice: b.voice ?? `${b.name}'s own voice.`,
    vocab: arch.vocab.replaceAll("DOMAIN", domain).replaceAll("COMMUNITY", b.key === "reddit.com" ? "r/sub" : "Community name").replaceAll("USER", b.key === "reddit.com" ? "u/name" : "username"),
    links: `Internal links follow ${b.name}'s real URL scheme: ${arch.urls(domain)}. Outbound links go to invented domains as /web/<domain>/<path>.`,
  };
}

// ---------- rendering ----------
const TOKENS = {
  newsportal: { fs: 16, lh: 1.45, rad: 0, shadow: "none", h2: "1.25rem", hw: 800, secgap: "22px", pill: "3px", maxw: 1280 },
  newspaper: { fs: 17, lh: 1.55, rad: 0, shadow: "none", h2: "1.3rem", hw: 700, secgap: "20px", pill: "0", maxw: 1200 },
  community: { fs: 14, lh: 1.5, rad: 16, shadow: "none", h2: "1.05rem", hw: 700, secgap: "8px", pill: "999px", maxw: 1280 },
  linkboard: { fs: 13.5, lh: 1.35, rad: 0, shadow: "none", h2: "1rem", hw: 700, secgap: "0", pill: "0", maxw: 1000 },
  encyclopedia: { fs: 14.5, lh: 1.6, rad: 0, shadow: "none", h2: "1.55rem", hw: 400, secgap: "18px", pill: "2px", maxw: 1400 },
  marketplace: { fs: 14.5, lh: 1.45, rad: 8, shadow: "none", h2: "1.3rem", hw: 700, secgap: "22px", pill: "999px", maxw: 1500 },
  video: { fs: 14, lh: 1.45, rad: 12, shadow: "none", h2: "1.2rem", hw: 700, secgap: "20px", pill: "999px", maxw: 1700 },
  codehost: { fs: 14, lh: 1.5, rad: 6, shadow: "none", h2: "1.45rem", hw: 600, secgap: "0", pill: "999px", maxw: 1280 },
  qa: { fs: 14, lh: 1.5, rad: 5, shadow: "none", h2: "1.2rem", hw: 400, secgap: "14px", pill: "4px", maxw: 1260 },
  productbrand: { fs: 17, lh: 1.47, rad: 18, shadow: "none", h1: "clamp(2.6rem,6vw,4.8rem)", h2: "clamp(2rem,4vw,3.4rem)", hw: 600, htrack: "-.02em", secgap: "12px", pill: "999px", maxw: 1260 },
  classifieds: { fs: 14, lh: 1.35, rad: 0, shadow: "none", h2: ".95rem", hw: 700, secgap: "8px", pill: "0", maxw: 1200 },
  social: { fs: 15, lh: 1.4, rad: 12, shadow: "none", h2: "1.1rem", hw: 800, secgap: "0", pill: "999px", maxw: 1280 },
  streaming: { fs: 15, lh: 1.4, rad: 6, shadow: "none", h2: "1.3rem", hw: 700, secgap: "26px", pill: "4px", maxw: 1800 },
  landing: { fs: 17, lh: 1.55, rad: 14, shadow: "0 1px 2px rgba(0,0,0,.06)", h1: "clamp(2.4rem,5.6vw,4.2rem)", h2: "clamp(1.6rem,3vw,2.3rem)", hw: 700, htrack: "-.02em", secgap: "56px", pill: "999px", maxw: 1160 },
};
export const brandTokens = (plan) => ({ pad: "16px 18px", gap: "16px", ...TOKENS[plan.brand.arch] ?? TOKENS.landing });
export const brandFonts = (plan) => [brandFont(plan.brand.fonts?.[0]), brandFont(plan.brand.fonts?.[1] ?? plan.brand.fonts?.[0])];

// Pictures on a known site are drawn in its colours and in the medium its
// content really uses (news photos, product shots, screenshots…).
const MEDIA = { newsportal: "photo", newspaper: "photo", community: "snapshot", linkboard: "screenshot", encyclopedia: "photo", marketplace: "product", video: "photo", codehost: "screenshot", qa: "diagram", productbrand: "product", classifieds: "snapshot", social: "snapshot", streaming: "poster", landing: "isometric" };
export const brandMedium = (plan) => plan.brand.media ?? MEDIA[plan.brand.arch] ?? "photo";

const imgPath = (s) => encodeURIComponent(s).replace(/['()!*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
function picture(plan, prompt, shape, cls = "art") {
  const c = brandPalette(plan.brand);
  const medium = brandMedium(plan);
  return `<img class="${cls}" src="/img/${imgPath(prompt.slice(0, 300))}?s=${medium}&amp;a=${shape}&amp;bg=${encodeURIComponent(c.panel)}&amp;fg=${encodeURIComponent(c.acc)}" alt="" onload="this.style.opacity=1">`;
}
const subject = (plan) => plan.title || plan.topic || `${plan.site} in the 2040s`;

function searchBox(plan, domain, ph, cls = "bsearch") {
  const [path, name] = archOf(plan.brand).search;
  return `<form class="${cls}" action="/web/${esc(domain)}${path}" method="get"><input name="${name}" placeholder="${esc(ph)}" aria-label="Search"><button type="submit" aria-label="Search">⌕</button></form>`;
}

// The strip above some headers: live scores, market data.
function strip(plan) {
  const b = plan.brand;
  const r = seeded(`${plan.site}|strip|${plan.title}`);
  if (b.strip === "scores") {
    const teams = ["NYG", "DAL", "KC", "SF", "BUF", "MIA", "GB", "CHI", "LAL", "BOS", "GSW", "NYK", "DEN", "PHX", "MIL", "SEA", "LAR", "PHI"];
    const games = Array.from({ length: 8 }, (_, i) => { const a = teams[r(teams.length)], h = teams[(teams.indexOf(a) + 1 + r(teams.length - 1)) % teams.length]; return `<a href="/web/${esc(b.host)}/game/_/gameId/${40100000 + r(99999)}"><span><b>${a}</b> ${r(40) + 3}</span><span><b>${h}</b> ${r(40) + 3}</span><i>${["Final", "Final/OT", `Q${1 + r(4)} ${r(15)}:${String(r(60)).padStart(2, "0")}`, `${1 + r(11)}:${r(2) ? "30" : "00"} PM`][r(4)]}</i></a>`; }).join("");
    return `<div class="bstrip scores"><div class="in"><b class="lg">${["NFL", "NBA", "NHL", "MLS"][r(4)]}</b>${games}</div></div>`;
  }
  if (b.strip === "markets") {
    const rows = [["DOW", 71204], ["S&P 500", 12433], ["NASDAQ", 41887], ["10-YR", 3.12], ["BTC", 412880], ["GOLD", 5890], ["OIL", 61.2], ["EUR/USD", 1.31]];
    return `<div class="bstrip markets"><div class="in">${rows.map(([n, v]) => { const ch = (r(300) - 150) / 100; return `<span><b>${n}</b> ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} <i class="${ch < 0 ? "dn" : "up"}">${ch < 0 ? "▼" : "▲"}${Math.abs(ch).toFixed(2)}%</i></span>`; }).join("")}</div></div>`;
  }
  return "";
}

// Header, rails and the code-built top of the page, per archetype.
function frame(plan, domain) {
  const b = plan.brand;
  const d = details(plan);
  const link = (p) => `/web/${esc(domain)}${p.startsWith("/") ? p : `/${p}`}`;
  const nav = navOf(b);
  const navHTML = (n = nav) => n.map(([l, p]) => `<a href="${link(p)}">${esc(l)}</a>`).join("");
  const logo = `<a class="blogo" href="/web/${esc(domain)}/" aria-label="${esc(b.name)}">${brandLogo(b)}</a>`;
  const title = plan.title;
  const f = { above: strip(plan), header: "", sub: "", left: "", right: "", top: "" };
  const signIn = (label = "Sign in") => `<a class="bbtn ghost" href="${link("/login")}">${label}</a>`;
  switch (b.arch) {
    case "newsportal": {
      f.header = `<div class="in"><span class="burger">☰</span>${logo}<nav class="bnav">${navHTML()}</nav><div class="bact"><a href="${link("/live-tv")}">Watch</a><a href="${link("/audio")}">Listen</a><a class="bbtn" href="${link("/subscribe")}">Subscribe</a>${signIn("Sign in")}</div></div>`;
      if (plan.page === "article") {
        const section = segs(new URL(plan.url)).find((s) => /^[a-z]+$/.test(s) && s.length > 2) ?? "world";
        f.top = `<div class="top"><div class="kicker">${esc(cap(section))}</div><h1>${esc(title)}</h1><div class="byline"><span class="av">${esc(d.author.split(" ").map((w) => w[0]).join(""))}</span><span>By <b>${esc(d.author)}</b>, ${esc(b.name)}</span><span class="meta">${d.minutes} min read · Updated ${d.time} ET, ${d.dow.slice(0, 3)} ${d.date}</span></div>${picture(plan, `${subject(plan)}, news photograph`, "wide", "art lead")}<p class="meta cap">${esc(subject(plan))}. Photo: ${esc(b.name)}</p></div>`;
      } else if (plan.page === "video") {
        f.top = `<div class="top player"><div class="screen">${picture(plan, `${subject(plan)}, broadcast video still`, "wide")}<span class="playbtn">▶</span><div class="bar"><i style="width:${10 + (d.minutes % 60)}%"></i></div></div><h1>${esc(title)}</h1></div>`;
      } else if (title) f.top = `<div class="top"><h1 class="sect">${esc(title)}</h1></div>`;
      break;
    }
    case "newspaper": {
      const l = b.logo ?? {};
      f.header = `<div class="bar1"><div class="in"><span>☰ ⌕</span><span class="eds">U.S. · International · Canada · Español</span><span class="bact"><a class="bbtn" href="${link("/subscription")}">Subscribe</a>${signIn("Log in")}</span></div></div>
<div class="mast${l.align === "right" ? " right" : ""}"><div class="in"><div class="mdate"><b>${d.dow}, ${d.date}</b><br>Today's Paper</div>${logo}<div class="mdate r">${plan.page === "article" ? "" : `${["Dow", "S&P", "Nasdaq"][d.num % 3]} <span class="up">+${(d.num % 90) / 100}%</span>`}</div></div>${l.tagline ? `<div class="tagl">${esc(l.tagline)}</div>` : ""}</div>
<nav class="bnav"><div class="in">${nav.map(([n, p], i) => `<a href="${link(p)}"${b.pillars ? ` style="--pc:${b.pillars[i % b.pillars.length]}"` : ""}>${esc(n)}</a>`).join("")}</div></nav>`;
      if (plan.page === "article") f.top = `<div class="top"><div class="kicker">${esc(cap(plan.topic || "News"))}</div><h1>${esc(title)}</h1>${plan.tag ? `<p class="deck">${esc(plan.tag)}</p>` : ""}${picture(plan, `${subject(plan)}, documentary news photograph`, "wide", "art lead")}<p class="meta cap">${esc(subject(plan))}. Photograph for ${esc(b.name)}</p><div class="byline">By <b>${esc(d.author)}</b> <span class="meta">${d.date} · Updated ${d.time} ET</span></div></div>`;
      else if (title) f.top = `<div class="top"><h1 class="sect">${esc(title)}</h1></div>`;
      break;
    }
    case "community": {
      const reddit = b.key === "reddit.com";
      f.header = `<div class="in">${logo}${searchBox(plan, domain, plan.title?.startsWith("r/") ? `Search in ${plan.title}` : `Search ${b.name}`, "bsearch pillsearch")}<div class="bact"><a class="bbtn ghost" href="${link("/app")}">Get App</a><a class="bbtn" href="${link("/login")}">Log In</a><span class="dots">⋯</span></div></div>`;
      const subs = reddit ? ["AskReddit", "worldnews", "Futurology", "science", "todayilearned", "space", "technology", "mildlyinteresting"] : [];
      f.left = `<nav class="lnav">${nav.map(([n, p]) => `<a href="${link(p)}">${{ Home: "⌂", Popular: "↗", Explore: "◎", All: "▦" }[n] ?? "•"} ${esc(n)}</a>`).join("")}${subs.length ? `<h4>Communities</h4>${subs.map((s) => `<a href="${link(`/r/${s}/`)}"><span class="rdot" style="background:hsl(${fnv(s) % 360},70%,50%)">r/</span>r/${s}</a>`).join("")}` : ""}<h4>Resources</h4>${[`About ${b.name}`, "Advertise", "Help", "Blog", "Careers"].map((s) => `<a href="${link(`/${slug(s)}`)}">${esc(s)}</a>`).join("")}</nav>`;
      const sub = plan.title?.startsWith("r/") ? plan.title : (new URL(plan.url).pathname.match(/\/r\/([^/]+)/)?.[1] ?? "").replace(/^(?=.)/, "r/");
      f.right = sub ? `<div class="rcard"><b>${esc(sub)}</b><p>${esc(plan.tag || `A community for everything ${sub.slice(2)}: questions, wins, disasters and deep dives.`)}</p><p class="meta">Created ${d.short.replace(/\d{4}$/, String(d.year - 12))} · Public</p><div class="rstats"><span><b>${d.members}</b> Members</span><span><b>${d.online}</b> Online</span></div><a class="bbtn" data-toggle="Joined" href="${link(`/${sub}/`)}">Join</a></div><div class="rcard"><h4>Rules</h4><ol><li>Be civil</li><li>Stay on topic</li><li>No low-effort posts</li><li>Flair your posts</li><li>No spam or self-promotion</li></ol></div>`
        : !reddit ? `<div class="rcard"><b>${esc(b.name)}</b><p>${esc(b.about || `The ${b.name} community.`)}</p><div class="rstats"><span><b>${d.members}</b> Members</span><span><b>${d.online}</b> Online</span></div><a class="bbtn" href="${link("/sign-up")}">Join ${esc(b.name)}</a></div>`
        : `<div class="rcard"><h4>Popular communities</h4>${subs.slice(0, 6).map((s) => `<a class="rsub" href="${link(`/r/${s}/`)}"><span class="rdot" style="background:hsl(${fnv(s) % 360},70%,50%)">r/</span><span>r/${s}<br><span class="meta">${(fnv(s) % 50) + 1}M members</span></span></a>`).join("")}</div>`;
      if (plan.page === "thread") f.top = `<div class="top tpost"><div class="who">${reddit ? `<span class="rdot" style="background:hsl(${fnv(sub) % 360},70%,50%)">r/</span>` : ""}<b>${esc(sub || (reddit ? "r/popular" : b.name))}</b><span class="meta">· ${d.hours}h · ${reddit ? "u/" : ""}${esc(d.user)}</span></div><h1>${esc(title)}</h1></div>`;
      else if (sub) f.top = `<div class="top sbanner"><div class="ban" style="background:linear-gradient(90deg,hsl(${fnv(sub) % 360},60%,45%),hsl(${(fnv(sub) + 50) % 360},60%,55%))"></div><div class="sh"><span class="ricon" style="background:hsl(${fnv(sub) % 360},70%,50%)">r/</span><h1>${esc(sub)}</h1><a class="bbtn ghost" href="${link(`/${sub}/submit`)}">+ Create Post</a><a class="bbtn" data-toggle="Joined" href="${link(`/${sub}/`)}">Join</a></div><div class="sort">Best ▾ &nbsp; ▤</div></div>`;
      else f.top = `<div class="top"><div class="sort">Best ▾ &nbsp; Everywhere ▾ &nbsp; ▤</div></div>`;
      break;
    }
    case "linkboard":
      f.header = `<div class="in">${logo}<nav class="bnav">${nav.map(([n, p]) => `<a href="${link(p)}">${esc(n)}</a>`).join(" | ")}</nav><a class="login" href="${link("/login")}">login</a></div>`;
      if (plan.page === "item") f.top = `<div class="top"><div class="hnitem"><a href="${link("/")}">${esc(title || "Discussion")}</a> <span class="meta">(${esc(slug(plan.topic || "example").split("-")[0] || "example")}.dev)</span><p class="meta">${d.num % 900 + 50} points by ${esc(d.user)} ${d.hours} hours ago | ${d.comments % 400} comments</p><textarea aria-label="Comment" rows="4"></textarea><br><button type="button">add comment</button></div></div>`;
      break;
    case "encyclopedia": {
      const tools = ["What links here", "Related changes", "Special pages", "Permanent link", "Page information", "Cite this page"];
      f.left = `<div class="wside">${logo}<nav>${nav.map(([n, p]) => `<a href="${link(p)}">${esc(n)}</a>`).join("")}<h4>Contribute</h4>${["Help", "Learn to edit", "Community portal", "Recent changes", "Upload file"].map((s) => `<a href="${link(`/wiki/${wikiTitle(s)}`)}">${s}</a>`).join("")}<h4>Tools</h4>${tools.map((s) => `<a href="${link(`/wiki/Special:${wikiTitle(s).replace(/_/g, "")}`)}">${s}</a>`).join("")}<h4>Languages</h4>${["Deutsch", "Español", "Français", "Italiano", "日本語", "Português", "Русский", "中文"].map((s) => `<a href="${link("/")}">${s}</a>`).join("")}</nav></div>`;
      f.header = `<div class="wtop"><span class="meta">Not logged in</span><a href="${link("/wiki/Special:MyTalk")}">Talk</a><a href="${link("/wiki/Special:MyContributions")}">Contributions</a><a href="${link("/wiki/Special:CreateAccount")}">Create account</a><a href="${link("/wiki/Special:UserLogin")}">Log in</a></div>
<div class="wtabs"><span class="l"><a class="on" href="${link("/")}">${plan.page === "main" ? "Main Page" : "Article"}</a><a href="${link(`/wiki/Talk:${wikiTitle(title || "Main_Page")}`)}">Talk</a></span><span class="r"><a class="on" href="${link("/")}">Read</a><a href="${link(`/w/index.php?title=${wikiTitle(title || "Main_Page")}&action=edit`)}">Edit</a><a href="${link(`/w/index.php?title=${wikiTitle(title || "Main_Page")}&action=history`)}">View history</a>${searchBox(plan, domain, "Search Wikipedia")}</span></div>`;
      f.top = plan.page === "main"
        ? `<div class="top wwelcome"><h1>Welcome to <a href="${link("/wiki/Wikipedia")}">Wikipedia</a>,</h1><p>the <a href="${link("/wiki/Free_content")}">free</a> encyclopedia that <a href="${link("/wiki/Help:Introduction")}">anyone can edit</a>.</p><p class="meta"><b>${(7400000 + d.num * 311).toLocaleString("en-US")}</b> articles in <a href="${link("/wiki/English_language")}">English</a></p></div>`
        : `<div class="top"><h1 class="wtitle">${esc(plan.page === "search" ? "Search results" : title)}</h1><div class="meta wfrom">From Wikipedia, the free encyclopedia</div></div>${plan.page === "article" ? `<nav class="toc" data-toc aria-label="Contents"><b>Contents</b></nav>` : ""}`;
      break;
    }
    case "marketplace": {
      const k = brandPalette(b);
      const cartLink = `<a class="cart" href="${link("/cart")}">🛒 <b>Cart</b></a>`;
      const account = b.key === "amazon.com" ? `<a class="acct" href="${link("/login")}"><small>Hello, sign in</small><b>Account &amp; Lists ▾</b></a><a class="acct" href="${link("/gp/css/order-history")}"><small>Returns</small><b>&amp; Orders</b></a>` : `<a class="acct" href="${link("/login")}">Sign in</a>`;
      f.header = `<div class="in">${logo}${b.key === "amazon.com" ? `<a class="acct loc" href="${link("/gp/delivery")}"><small>Deliver to</small><b>📍 Seattle 98101</b></a>` : ""}${searchBox(plan, domain, b.key === "amazon.com" ? "Search Amazon" : `Search ${b.name}`, `bsearch msearch${b.key === "amazon.com" ? " amz" : ""}`)}${account}${cartLink}</div>`;
      f.sub = `<nav class="msub"${k.sub ? ` style="background:${k.sub};color:${k.subFg}"` : ""}><div class="in">${navHTML()}</div></nav>`;
      if (plan.page === "product") {
        const brandName = cap(wordsIn(title)[0] ?? b.name);
        f.top = `<div class="gallery"><div class="thumbs">${"<i></i>".repeat(5)}</div>${picture(plan, `${subject(plan)}, e-commerce product photo on white`, "square", "art main")}</div>
<div class="pinfo"><h1>${esc(title)}</h1><a class="meta" href="${link(`/stores/${slug(brandName)}`)}">Visit the ${esc(brandName)} Store</a><div class="rate"><b>${d.rating}</b> <span class="stars" style="--r:${d.rating}"></span> <a href="#reviews">${d.ratings} ratings</a></div>${d.num % 3 ? `<span class="badge">#1 Best Seller</span>` : `<span class="badge">${b.name}'s Choice</span>`}<p class="meta">${(d.num % 9) + 1}K+ bought in past month</p><hr><div class="pp"><span class="off">-${Math.round((1 - d.price / d.list) * 100)}%</span> <span class="big">${money(d.price)}</span>${b.unit ? ` <span class="meta">/ ${b.unit}</span>` : ""}</div><p class="meta">List Price: <s>${money(d.list)}</s></p></div>
<aside class="buybox"><div class="big">${money(d.price)}</div><p>FREE delivery <b>${d.dow}, ${d.date.replace(/, \d{4}$/, "")}</b></p><p class="instock">In Stock</p><label class="meta">Quantity: <select aria-label="Quantity"><option>1</option><option>2</option><option>3</option></select></label><button class="bbuy" type="button" data-add-to-cart data-name="${esc(title)}" data-price="${d.price}">${esc(b.cta?.[0] ?? "Add to Cart")}</button><a class="bnow" href="${link("/checkout")}">${esc(b.cta?.[1] ?? "Buy Now")}</a><table class="meta"><tr><td>Ships from</td><td>${esc(b.name)}</td></tr><tr><td>Sold by</td><td>${esc(b.name)}</td></tr><tr><td>Returns</td><td>30-day refund</td></tr><tr><td>Payment</td><td>Secure transaction</td></tr></table></aside>`;
      } else if (plan.page === "search") {
        f.left = `<div class="filters"><h4>Delivery Day</h4><label><input type="checkbox"> Get It by Tomorrow</label><h4>Customer Reviews</h4><label><input type="checkbox"> <span class="stars" style="--r:4"></span> &amp; Up</label><h4>Price</h4>${["Up to $25", "$25 to $50", "$50 to $100", "$100 & above"].map((p) => `<label><input type="checkbox"> ${esc(p)}</label>`).join("")}<h4>Deals &amp; Discounts</h4><label><input type="checkbox"> All Discounts</label><label><input type="checkbox"> Today's Deals</label></div>`;
        f.top = `<div class="top rbar"><span>1-48 of over ${(d.num * 7).toLocaleString("en-US")} results for <b class="q">${esc(title || plan.topic)}</b></span><span class="meta">Sort by: Featured ▾</span></div>`;
      } else {
        f.top = `<div class="top mhero">${picture(plan, `${plan.topic || "seasonal sale"} banner, lifestyle product photography`, "wide")}</div>`;
      }
      break;
    }
    case "video": {
      f.header = `<div class="in"><span class="burger">☰</span>${logo}${searchBox(plan, domain, "Search", "bsearch vsearch")}<span class="mic">🎙</span><div class="bact"><span class="dots">⋮</span><a class="bbtn ghost" href="${link("/login")}">Sign in</a></div></div>`;
      if (plan.page !== "watch") f.left = `<nav class="guide">${nav.map(([n, p]) => `<a href="${link(p)}">${{ Home: "⌂", Shorts: "⚡", Subscriptions: "▤", You: "◉", History: "↺" }[n] ?? "•"} ${esc(n)}</a>`).join("")}<hr><h4>Explore</h4>${["Trending", "Music", "Movies", "Live", "Gaming", "News", "Sports", "Learning", "Podcasts"].map((s) => `<a href="${link(`/feed/${slug(s)}`)}">${s}</a>`).join("")}</nav>`;
      if (plan.page === "watch") {
        f.top = `<div class="top player"><div class="screen">${picture(plan, `${subject(plan)}, video frame`, "wide")}<span class="playbtn">▶</span><div class="bar"><i style="width:${8 + (d.minutes % 70)}%"></i></div></div><h1>${esc(title)}</h1><div class="chan"><span class="av">${esc(d.channel.slice(0, 2).toUpperCase())}</span><span><b>${esc(d.channel)}</b><br><span class="meta">${d.subs} subscribers</span></span><button class="bbtn dark" type="button" data-toggle="Subscribed">Subscribe</button><span class="acts"><span>👍 ${d.likes} | 👎</span><span>↗ Share</span><span>⤓ Download</span><span>⋯</span></span></div></div>`;
      } else if (plan.page === "channel") {
        f.top = `<div class="top chead">${picture(plan, `${subject(plan)} channel banner`, "wide", "art banner")}<div class="chan big"><span class="av">${esc((title || "C").replace(/^@/, "").slice(0, 2).toUpperCase())}</span><span><h1>${esc(title)}</h1><span class="meta">@${esc(slug(title))} · ${d.subs} subscribers · ${d.num % 900 + 20} videos</span></span><button class="bbtn dark" type="button" data-toggle="Subscribed">Subscribe</button></div><div class="ctabs"><b>Home</b><span>Videos</span><span>Shorts</span><span>Live</span><span>Playlists</span><span>Posts</span></div></div>`;
      } else {
        f.top = `<div class="top chips">${["All", plan.topic ? cap(plan.topic) : "Music", "Gaming", "Live", "Mixes", "News", "Podcasts", "Cooking", "Recently uploaded", "Watched", "New to you"].map((s, i) => `<a class="${i ? "" : "on"}" href="${link(`/results?search_query=${q(s)}`)}">${esc(s)}</a>`).join("")}</div>`;
      }
      break;
    }
    case "codehost": {
      f.header = `<div class="in">${logo}<nav class="bnav">${navHTML()}</nav>${searchBox(plan, domain, "Search or jump to...", "bsearch gsearch")}<div class="bact"><a class="plain" href="${link("/login")}">Sign in</a><a class="bbtn ghost" href="${link("/signup")}">Sign up</a></div></div>`;
      const [owner = d.user, repo = slug(plan.topic || "project") || "project"] = segs(new URL(plan.url));
      const repoPath = `/${owner}/${repo}`;
      const rhead = `<div class="rhead"><div class="in"><h1 class="rname">📘 <a href="${link(`/${owner}`)}">${esc(owner)}</a> / <a href="${link(repoPath)}"><b>${esc(repo)}</b></a> <span class="tag">Public</span></h1><div class="racts"><span class="gbtn">🔔 Notifications</span><span class="gbtn">⑂ Fork <b>${d.forks}</b></span><span class="gbtn" data-toggle="★ Starred">☆ Star <b>${d.stars}</b></span></div></div><nav class="rtabs"><div class="in"><a class="on" href="${link(repoPath)}">‹› Code</a><a href="${link(`${repoPath}/issues`)}">⊙ Issues <i>${d.issues}</i></a><a href="${link(`${repoPath}/pulls`)}">⇅ Pull requests <i>${d.pulls}</i></a><a href="${link(`${repoPath}/actions`)}">▷ Actions</a><a href="${link(`${repoPath}/projects`)}">▦ Projects</a><a href="${link(`${repoPath}/security`)}">⛨ Security</a><a href="${link(`${repoPath}/pulse`)}">⌁ Insights</a></div></nav></div>`;
      if (plan.page === "repo") {
        f.sub = rhead;
        const langs = [d.lang, ["Shell", "Python", "HTML", "CSS", "Dockerfile"][d.num % 5], "Other"];
        f.right = `<div class="about"><h4>About</h4><p>${esc(plan.tag || `${cap(plan.topic || repo)} for the 2040s: fast, typed and boring in the best way.`)}</p><div class="topics">${[...new Set([slug(plan.topic || repo).split("-")[0], d.lang.toLowerCase(), "cli", "open-source"])].filter(Boolean).map((t) => `<a class="tag" href="${link(`/topics/${t}`)}">${esc(t)}</a>`).join("")}</div><p class="meta">📖 Readme · ⚖ MIT license · ☆ <b>${d.stars}</b> stars · 👁 <b>${d.watch}</b> watching · ⑂ <b>${d.forks}</b> forks</p><h4>Releases <span class="tag">${d.issues % 40 + 3}</span></h4><p>🏷 <b>v${d.asked}.${d.num % 20}.${d.minutes % 10}</b> <span class="tag grn">Latest</span><br><span class="meta">${d.short}</span></p><h4>Languages</h4><div class="lbar"><i style="width:71%;background:#3178c6"></i><i style="width:19%;background:#f1e05a"></i><i style="width:10%;background:#ededed"></i></div><p class="meta">${langs.map((l, i) => `● ${l} ${[71.2, 19.3, 9.5][i]}%`).join(" &nbsp; ")}</p></div>`;
        f.top = `<div class="top branch"><span class="gbtn">⑂ main ▾</span><span class="meta">⑂ ${d.asked + 2} Branches · 🏷 ${d.issues % 40 + 3} Tags</span><span class="grow"></span><span class="gbtn">Go to file</span><span class="gbtn green">‹› Code ▾</span></div><div class="top commit"><span class="av">${esc(d.user.slice(0, 2))}</span><b>${esc(d.user)}</b> <span class="meta">Merge pull request #${d.num % 900 + 10} · ${(d.num * 7919 % 0xfffffff).toString(16).slice(0, 7)} · ${d.hours} hours ago · 🕘 ${(d.num * 3).toLocaleString("en-US")} Commits</span></div>`;
      } else if (plan.page === "issue") {
        f.sub = rhead;
        f.top = `<div class="top ihead"><h1>${esc(title.replace(/ #\d+$/, ""))} <span class="meta">#${esc(new URL(plan.url).pathname.split("/").pop())}</span></h1><p><span class="state">⊙ Open</span> <b>${esc(d.user)}</b> <span class="meta">opened this issue ${d.hours} days ago · ${d.comments % 40} comments</span></p></div>`;
        f.right = `<div class="about side">${[["Assignees", d.author2.split(" ")[0].toLowerCase()], ["Labels", `<span class="tag red">bug</span> <span class="tag">needs-triage</span>`], ["Projects", "None yet"], ["Milestone", `v${d.asked + 1}.0`], ["Development", "1 linked pull request"], ["Participants", "👤👤👤👤"]].map(([h, v]) => `<h4>${h}</h4><p class="meta">${v}</p>`).join("")}</div>`;
      } else if (plan.page === "profile") {
        const days = Array.from({ length: 53 * 7 }, (_, i) => `<i class="l${(fnv(`${title}|${i}`) % 11) > 5 ? (fnv(`${title}|${i}`) % 4) + 1 : 0}"></i>`).join("");
        f.left = `<div class="pcard"><span class="av huge">${esc(String(title).slice(0, 2).toUpperCase())}</span><h1>${esc(cap(String(title).replace(/[-_]/g, " ")))}</h1><p class="meta">${esc(title)}</p><p>${esc(plan.tag || `Building tools for ${plan.topic || "the future"}.`)}</p><a class="bbtn ghost wide" data-toggle="Following" href="${link(`/${title}`)}">Follow</a><p class="meta">👥 <b>${d.subs}</b> followers · <b>${d.num % 300}</b> following</p></div>`;
        f.top = `<div class="top contrib"><p class="meta">${(d.num * 3).toLocaleString("en-US")} contributions in the last year</p><div class="cgrid">${days}</div></div>`;
      } else if (plan.page === "home") {
        f.top = `<div class="top ghero"><h1>${esc(title || "Build and ship software on a single, collaborative platform")}</h1><p class="lead">Join the world's most widely adopted AI-powered developer platform.</p></div>`;
      } else f.top = `<div class="top"><h1 class="sect">${esc(title || "Search")}</h1></div>`;
      break;
    }
    case "qa": {
      f.header = `<div class="in">${logo}<nav class="bnav"><a href="${link("/about")}">About</a><a href="${link("/products")}">Products</a><a href="${link("/teams")}">For Teams</a></nav>${searchBox(plan, domain, "Search…", "bsearch qsearch")}<div class="bact"><a class="bbtn ghost" href="${link("/users/login")}">Log in</a><a class="bbtn" href="${link("/users/signup")}">Sign up</a></div></div>`;
      f.left = `<nav class="qnav">${nav.map(([n, p]) => `<a href="${link(p === "/home" ? "/" : p)}"${n === "Questions" ? ' class="on"' : ""}>${esc(n)}</a>`).join("")}</nav>`;
      const blog = ["The year the compilers started reviewing us back", "Why every backend team now has a latency budget", "Podcast 912: shipping on Mars time"];
      f.right = `<div class="qside"><div class="yb"><h4>The Overflow Blog</h4><ul>${blog.slice(0, 2).map((t) => `<li><a href="${link(`/blog/${slug(t)}`)}">${esc(t)}</a></li>`).join("")}</ul><h4>Featured on Meta</h4><ul><li><a href="${link("/meta/announcing")}">Community moderation, ${d.year} edition</a></li><li><a href="${link("/meta/policy")}">Policy: generated answers still need sources</a></li></ul></div><div class="hot"><h4>Hot Network Questions</h4><ul>${["How do I stop my exosuit firmware from rebooting mid-stride?", "Is it rude to cite a paper written by its own AI co-author?", "Why does orbital time drift break my cron jobs?", "What is the idiom for 'too many timelines'?", "Can a quantum RNG be seeded for tests?"].map((t) => `<li><a href="${link(`/questions/${70000000 + fnv(t) % 9000000}/${slug(t)}`)}">${esc(t)}</a></li>`).join("")}</ul></div></div>`;
      f.top = plan.page === "question"
        ? `<div class="top qhead"><h1>${esc(title)}</h1><a class="bbtn" href="${link("/questions/ask")}">Ask Question</a><p class="meta">Asked <b>${d.asked} years ago</b> · Modified <b>${d.hours} days ago</b> · Viewed <b>${d.viewed} times</b></p></div>`
        : `<div class="top qhead"><h1>${esc(title ? `Questions tagged [${title.replace(/[“”]/g, "")}]` : "Newest Questions")}</h1><a class="bbtn" href="${link("/questions/ask")}">Ask Question</a><p class="meta">${(24000000 + d.num * 97).toLocaleString("en-US")} questions <span class="qtabs"><b>Newest</b><span>Active</span><span>Bountied</span><span>Unanswered</span><span>More ▾</span></span></p></div>`;
      break;
    }
    case "productbrand":
      f.header = `<div class="in">${logo}<nav class="bnav">${navHTML()}</nav><div class="bact"><a href="${link("/search")}" aria-label="Search">⌕</a><a class="cart" href="${link("/bag")}" aria-label="Bag">🛍</a></div></div>`;
      f.above = `<div class="promo">Get credit toward a new device when you trade in an eligible one. <a href="${link("/shop/trade-in")}">Shop ›</a></div>`;
      if (plan.page === "product") {
        f.sub = `<nav class="lnav"><div class="in"><b>${esc(title)}</b><span class="grow"></span><a href="${link(`/${slug(title)}/`)}">Overview</a><a href="${link(`/${slug(title)}/specs/`)}">Tech Specs</a><a class="bbtn sm" href="${link(`/shop/buy-${slug(title)}`)}">Buy</a></div></nav>`;
        f.top = `<div class="top phero"><h1>${esc(title)}</h1>${plan.tag ? `<p class="lead">${esc(plan.tag)}</p>` : ""}<div class="row c"><a class="bbtn" href="${link(`/shop/buy-${slug(title)}`)}">Buy</a><a class="more" href="${link(`/${slug(title)}/`)}">Learn more ›</a></div>${picture(plan, `${subject(plan)}, studio product render`, "wide")}</div>`;
      }
      break;
    case "classifieds": {
      const cal = Array.from({ length: 28 }, (_, i) => `<a href="${link(`/search/eee?sale_date=${i + 1}`)}">${i + 1}</a>`).join("");
      if (plan.page === "home") {
        f.left = `<div class="clleft">${logo}<a href="${link("/post")}">create a posting</a><a href="${link("/login/home")}">my account</a>${searchBox(plan, domain, "search craigslist")}<h4>event calendar</h4><div class="cal">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<b>${x}</b>`).join("")}${cal}</div>${["help, faq, abuse, legal", "avoid scams & fraud", "personal safety tips", "terms of use", "privacy policy", "system status"].map((s) => `<a href="${link(`/about/${slug(s)}`)}">${esc(s)}</a>`).join("")}</div>`;
        f.top = `<div class="top clarea"><b>SF bay area</b> <span>sfc sby eby pen nby scz</span></div>`;
      } else {
        f.header = `<div class="in">${logo}<span class="crumb">› <a href="${link("/")}">SF bay area</a> › <a href="${link("/search/sss")}">for sale</a>${plan.page === "posting" ? " › posting" : ""}</span>${plan.page === "search" ? searchBox(plan, domain, `search ${plan.title || "for sale"}`) : ""}<a class="post" href="${link("/post")}">post</a><a href="${link("/login/home")}">account</a></div>`;
        f.top = plan.page === "posting" ? `<div class="top clpost"><h1>${esc(title)} <span class="meta">(mission district)</span></h1></div>` : `<div class="top"><span class="meta">▦ list · gallery · map &nbsp; newest ▾</span></div>`;
      }
      break;
    }
    case "social": {
      const icons = { Home: "⌂", Explore: "⌕", Search: "⌕", Notifications: "🔔", Messages: "✉", Grok: "◈", Communities: "👥", Premium: "✦", Profile: "👤", More: "⋯", Friends: "👥", Groups: "👥", Marketplace: "🏪", Watch: "▶", Memories: "↺", Saved: "🔖", Events: "📅", Reels: "▶", Create: "＋", "My Network": "👥", Jobs: "💼", Messaging: "✉" };
      f.left = `<nav class="snav">${logo}${nav.map(([n, p]) => `<a href="${link(p)}"><span>${icons[n] ?? "•"}</span> ${esc(n)}</a>`).join("")}<a class="bbtn big" href="${link("/compose/post")}">Post</a></nav>`;
      f.right = `<div class="sside">${searchBox(plan, domain, "Search", "bsearch pillsearch")}<div class="scard"><h4>What's happening</h4>${[plan.topic, "Mars harvest", "#OrbitalOpen", "Tidal grid", "Quantum weather"].filter(Boolean).slice(0, 4).map((t, i) => `<a href="${link(`/search?q=${q(t)}`)}"><span class="meta">Trending${i ? "" : " in your area"}</span><br><b>${esc(t)}</b><br><span class="meta">${(fnv(t) % 90) + 3}K posts</span></a>`).join("")}</div><div class="scard"><h4>Who to follow</h4>${["Orbital Weather", "Neon Gnocchi", "Tidewater Lab"].map((n) => `<p><span class="av">${n.split(" ").map((w) => w[0]).join("")}</span> <b>${n}</b><br><span class="meta">@${slug(n).replace(/-/g, "")}</span></p>`).join("")}</div></div>`;
      if (plan.page === "profile") f.top = `<div class="top sprof">${picture(plan, `${subject(plan)} profile banner`, "wide", "art banner")}<span class="av huge">${esc(String(title).replace(/^@/, "").slice(0, 2).toUpperCase())}</span><a class="bbtn ghost fr" data-toggle="Following" href="${link(`/${title}`)}">Follow</a><h1>${esc(cap(String(title).replace(/^@/, "").replace(/[-_]/g, " ")))}</h1><p class="meta">@${esc(String(title).replace(/^@/, ""))}</p><p>${esc(plan.tag || `Posting about ${plan.topic || "the future"}.`)}</p><p class="meta">📅 Joined ${d.short.replace(/^\w+ \d+, /, "")} · <b>${d.num % 900}</b> Following · <b>${d.subs}</b> Followers</p><div class="stabs"><b>Posts</b><span>Replies</span><span>Media</span><span>Likes</span></div></div>`;
      else if (plan.page === "post") f.top = `<div class="top shead"><b>← Post</b></div>`;
      else f.top = `<div class="top stabs"><b>For you</b><span>Following</span></div><div class="top compose"><span class="av">YO</span><span class="meta">What is happening?!</span><a class="bbtn sm" href="${link("/compose/post")}">Post</a></div>`;
      break;
    }
    case "streaming":
      f.header = `<div class="in">${logo}<nav class="bnav">${navHTML()}</nav><div class="bact"><a href="${link("/search")}" aria-label="Search">⌕</a><span>🔔</span><span class="av sq">${esc(b.name.slice(0, 1))}</span></div></div>`;
      if (b.sidebar) f.left = `<nav class="slib"><a href="${link("/")}">⌂ Home</a><a href="${link("/search")}">⌕ Search</a><h4>▤ Your Library</h4>${["Liked Songs", "Daily Mix 1", "Orbit Radio", "Deep Focus 2046", "Discover Weekly"].map((s) => `<a href="${link(`/playlist/${slug(s)}`)}"><span class="cov" style="background:hsl(${fnv(s) % 360},55%,45%)"></span>${esc(s)}<br><span class="meta">Playlist · ${esc(b.name)}</span></a>`).join("")}</nav>`;
      if (plan.page === "title") f.top = `<div class="top bill">${picture(plan, `${subject(plan)}, cinematic key art`, "wide", "art bg")}<div class="bt"><h1>${esc(title)}</h1><p class="meta"><b class="grn">${88 + (d.num % 12)}% Match</b> ${d.year} <span class="tag">TV-14</span> ${d.asked} Seasons <span class="tag">HD</span></p>${plan.tag ? `<p>${esc(plan.tag)}</p>` : ""}<div class="row"><a class="bbtn light" href="${link(`/watch/${d.num}`)}">▶ Play</a><a class="bbtn ghost" data-toggle="✓ My List" href="${link("/browse/my-list")}">＋ My List</a></div></div></div>`;
      break;
    default: {
      f.header = `<div class="in">${logo}<nav class="bnav">${navHTML()}</nav><div class="bact">${signIn("Log in")}<a class="bbtn" href="${link("/signup")}">Get started</a></div></div>`;
      f.top = `<div class="top lhero"><h1>${esc(title || b.about || b.title || b.name)}</h1>${plan.tag || (title && b.about) ? `<p class="lead">${esc(plan.tag || b.about)}</p>` : ""}<div class="row c"><a class="bbtn" href="${link("/signup")}">Get started</a><a class="bbtn ghost" href="${link("/contact-sales")}">Contact sales</a></div>${picture(plan, `${subject(plan)}, product illustration`, "wide")}</div>`;
    }
  }
  return f;
}

export function brandHeader(plan, domain) {
  const b = plan.brand;
  const f = frame(plan, domain);
  const name = b.name;
  const t = plan.title ? `${plan.title} ${b.arch === "encyclopedia" ? "- Wikipedia" : `| ${name}`}` : (b.title ?? name);
  return `<title>${esc(t.replace("- Wikipedia", `- ${name}`))}</title>
${f.above}
<header class="site bh">${f.header}</header>${f.sub}
<div class="bx bx-${b.arch} bp-${plan.page}${f.left ? " has-l" : ""}${f.right ? " has-r" : ""}">${f.left ? `<aside class="bl">${f.left}</aside>` : ""}${f.right ? `<aside class="br">${f.right}</aside>` : ""}
<main class="bm">${f.top}
`;
}

export function brandFooter(plan, domain) {
  const b = plan.brand;
  const d = details(plan);
  const link = (p) => `/web/${esc(domain)}${p}`;
  const legal = b.legal ?? b.name;
  const small = ["Terms of Use", "Privacy Policy", "Cookie Settings", "Accessibility", "Help"].map((s) => `<a href="${link(`/${slug(s)}`)}">${s}</a>`).join("");
  let body;
  if (b.arch === "encyclopedia") body = `<p>This page was last edited on ${d.date.replace(/^(\w+) (\d+),/, "$2 $1")}, at ${d.time.replace(/ [AP]M$/, "")} (UTC).</p><p>Text is available under the <a href="${link("/wiki/Wikipedia:Copyrights")}">Creative Commons Attribution-ShareAlike 5.0 License</a>; additional terms may apply. By using this site, you agree to the Terms of Use and Privacy Policy. Wikipedia® is a registered trademark of the ${esc(legal)}, a non-profit organization.</p><p class="links">${["Privacy policy", "About Wikipedia", "Disclaimers", "Contact Wikipedia", "Code of Conduct", "Developers", "Statistics", "Cookie statement", "Mobile view"].map((s) => `<a href="${link(`/wiki/Wikipedia:${wikiTitle(s)}`)}">${s}</a>`).join("")}</p>`;
  else if (b.arch === "linkboard") body = `<p class="links">${["Guidelines", "FAQ", "Lists", "API", "Security", "Legal", "Apply to YC", "Contact"].map((s) => `<a href="${link(`/${slug(s)}`)}">${s}</a>`).join(" | ")}</p>${searchBox(plan, domain, "Search")}`;
  else if (b.arch === "classifieds") body = `<p class="links">© ${d.year} craigslist <a href="${link("/about/help")}">help</a> <a href="${link("/about/safety")}">safety</a> <a href="${link("/about/privacy")}">privacy</a> <a href="${link("/about/feedback")}">feedback</a> <a href="${link("/about/terms")}">terms</a> <a href="${link("/about")}">about</a> <a href="${link("/about/app")}">craigslist app</a></p>`;
  else {
    const nav = navOf(b);
    const cols = [nav.slice(0, 4), nav.slice(4, 8), [["About", "/about"], ["Careers", "/careers"], ["Press", "/press"], ["Contact", "/contact"]]].filter((c) => c.length);
    body = `<div class="fcols"><div>${brandLogo(b, { size: 0.9 })}</div>${cols.map((c) => `<ul>${c.map(([l, p]) => `<li><a href="${link(p)}">${esc(l)}</a></li>`).join("")}</ul>`).join("")}</div><p class="links">${small}</p><p class="meta">© ${d.year} ${esc(legal)}. All Rights Reserved.</p>`;
  }
  return `</main></div>
<footer class="site bf"><div class="in">${body}</div></footer>
`;
}

// ---------- stylesheet ----------
export function brandCSS(plan, { c, bodyFont, headFont }) {
  const b = plan.brand;
  const t = brandTokens(plan);
  const head = lum(c.head) < 0.5;
  const css = [`
:root{--hbg:${c.head};--hfg:${c.headFg};--link:${c.link};--buy:${c.buy};--buyfg:${c.buyFg};--now:${c.now};--foot:${c.foot}}
body{background:var(--bg)}a{color:var(--link)}main a{color:var(--link)}
.in{max-width:${t.maxw}px;margin:0 auto;padding:0 20px}
header.site.bh{position:sticky;top:0;z-index:50;background:var(--hbg);color:var(--hfg);border-bottom:1px solid ${head ? "transparent" : c.line}}
.bh>.in{display:flex;align-items:center;gap:18px;min-height:56px;flex-wrap:wrap}
.bh a{color:inherit}.blogo{display:inline-flex;align-items:center;text-decoration:none!important;color:var(--hfg);flex:none}
.logo{display:inline-flex;align-items:center;gap:8px;line-height:1;position:relative;white-space:nowrap}
.logo .lw{display:inline-block}.lblock{padding:.28em .32em;line-height:1}.lblocks{display:inline-flex;gap:3px}.lblocks i{font-style:normal;display:inline-grid;place-items:center;width:1.25em;height:1.25em;font-size:.9em}
.ltag{padding:.35em .6em .35em .45em;clip-path:polygon(0 0,86% 0,100% 50%,86% 100%,0 100%);padding-right:1.1em}
.loval{padding:.28em .35em;display:inline-block}.loval i{font-style:normal;display:inline-block;padding:.12em .55em;border-radius:50%}
.logo .lstack{display:inline-flex;flex-direction:column;align-items:center;font-family:${brandFont("serif")}}.lstack b{font-variant:small-caps;letter-spacing:.08em;font-weight:400}.lstack small{font-size:.72rem;font-style:italic;margin-top:3px}
.has-smile{padding-bottom:9px}.has-smile .smile{position:absolute;left:2px;bottom:-2px;width:72%;height:auto}
.bnav{display:flex;gap:18px;flex-wrap:wrap;font-size:.92rem}.bnav a{color:inherit;white-space:nowrap}
.bact{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:.9rem}
.bbtn{display:inline-block;padding:.45em 1em;border-radius:${t.pill};background:var(--acc);color:var(--on)!important;font-weight:700;font-size:.88rem;border:1px solid transparent;text-decoration:none!important;cursor:pointer;font-family:inherit;white-space:nowrap}
.bbtn.ghost{background:transparent;color:inherit!important;border-color:currentColor}.bbtn.sm{padding:.3em .8em;font-size:.8rem}
.bsearch{display:flex;align-items:center;flex:1;max-width:560px;min-width:160px;background:${head ? "#fff" : c.panel};border:1px solid ${c.line};border-radius:${t.pill};overflow:hidden}
.bsearch input{flex:1;border:0;background:none;padding:.55em .9em;font:inherit;font-size:.92rem;color:${head ? "#111" : c.fg};outline:none;min-width:0}
.bsearch button{border:0;background:none;padding:0 .9em;font-size:1.05rem;cursor:pointer;color:${head ? "#111" : c.fg}}
.bx{max-width:${t.maxw}px;margin:0 auto;padding:0 20px;display:grid;grid-template-columns:minmax(0,1fr);gap:0 28px;align-items:start}
.bx.has-l{grid-template-columns:var(--lw,220px) minmax(0,1fr)}.bx.has-r{grid-template-columns:minmax(0,1fr) var(--rw,312px)}.bx.has-l.has-r{grid-template-columns:var(--lw,220px) minmax(0,1fr) var(--rw,312px)}
.bl{grid-column:1;grid-row:1;position:sticky;top:70px;padding:16px 0;font-size:.9rem;max-height:calc(100vh - 80px);overflow:auto}
.bm{grid-row:1;min-width:0;padding:18px 0 10px}.has-l .bm{grid-column:2}.br{grid-row:1;grid-column:2;padding:18px 0;font-size:.88rem;position:sticky;top:70px}.has-l.has-r .br{grid-column:3}
.bm>.top{margin-bottom:16px}.bm h1{font-family:${headFont}}
img.art{opacity:0;transition:opacity .6s;display:block;width:100%;height:auto;object-fit:cover;background:${c.panel};border-radius:${t.rad}px}
.bm img.pic{object-fit:cover}
.byline{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:.6em 0 1em;font-size:.9rem}
.kicker{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--acc);margin-bottom:.35em}
.cap{margin:.4em 0 1.2em}
footer.site.bf{background:var(--foot);color:${lum(c.foot) < 0.5 ? "#e8e8e8" : c.muted};border-top:1px solid ${c.line};margin-top:30px;padding:26px 0 36px;font-size:.84rem}
footer.bf a{color:inherit}.bf .fcols{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:14px}.bf ul{list-style:none;margin:0}.bf li{margin:.3em 0}.bf .links{display:flex;flex-wrap:wrap;gap:6px 16px;margin:.6em 0}
.bstrip{background:${mix(c.head, "#000", 0.25)};color:#ddd;font-size:.75rem;overflow:hidden;white-space:nowrap}.bstrip .in{display:flex;gap:4px;align-items:stretch}
.bstrip.scores a{display:grid;grid-template-columns:auto auto;gap:0 10px;padding:6px 12px;border-right:1px solid #444;color:#eee}.bstrip.scores a span{display:block}.bstrip.scores i{grid-column:2;grid-row:1/span 2;align-self:center;font-style:normal;color:#aaa;font-size:.7rem}
.bstrip .lg{align-self:center;padding:0 10px;color:#fff}.bstrip.markets .in{gap:22px;padding:6px 20px}.bstrip i.up{color:#3ccf6e;font-style:normal}.bstrip i.dn{color:#ff5d5d;font-style:normal}
.stars::before{background:linear-gradient(90deg,${b.arch === "marketplace" ? "#de7921" : "#f5b301"} calc(var(--r,4)*20%),${c.line} 0);-webkit-background-clip:text;background-clip:text}
ul.heads{list-style:none;margin:0 0 1em}ul.heads li{margin:0;padding:.5em 0;border-bottom:1px solid ${c.line};font-weight:700;line-height:1.3}ul.heads li p{font-weight:400;margin:.2em 0 0;color:var(--muted);font-size:.9rem}
ul.heads a,.story h3 a{color:var(--fg)}.story{margin:0 0 14px}.story h3{margin:.3em 0;font-size:1.02rem;line-height:1.25}.story img.pic{aspect-ratio:16/9;margin:0 0 .4em}
.vcard{display:block;color:var(--fg)!important;position:relative;text-decoration:none!important}.vcard img.pic{aspect-ratio:16/9;margin:0 0 .45em;border:0;border-radius:${Math.min(t.rad, 12)}px}.vcard .dur{position:absolute;right:6px;top:calc(56.25% * 0 + 6px);background:rgba(0,0,0,.8);color:#fff;font-size:.72rem;font-weight:700;padding:1px 5px;border-radius:4px}
.vcard b{display:block;line-height:1.3;font-size:.95rem}.vcard .meta{display:block}
.breaking{background:var(--acc);color:#fff;padding:10px 14px;font-weight:800;font-size:1.05rem;margin:0 0 14px}.breaking b{text-transform:uppercase;margin-right:8px;background:#fff;color:var(--acc);padding:2px 6px;font-size:.8rem;vertical-align:2px}.breaking a{color:#fff!important}
@media(max-width:980px){.bx.has-l,.bx.has-r,.bx.has-l.has-r{grid-template-columns:minmax(0,1fr)}.bl,.br{position:static;grid-column:1!important;grid-row:auto;max-height:none}.bm{grid-column:1!important;grid-row:auto}.bnav{display:none}}`];
  const A = {
    newsportal: () => `.bh>.in{min-height:64px}.bh .bnav{font-weight:700;font-size:.9rem;gap:16px}.burger{font-size:1.3rem}
.bm section>h2{font-size:1.15rem;border-bottom:3px solid var(--fg);padding-bottom:6px;margin-bottom:10px}
.bm h1{font-size:clamp(1.9rem,3.6vw,2.8rem);line-height:1.12;font-weight:800;margin:.1em 0 .2em}.bm h1.sect{border-bottom:4px solid var(--acc);display:inline-block}
.bp-front .bm{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.1fr) minmax(0,1fr);gap:0 26px;align-items:start}
.bp-front .bm>.top{grid-column:1/-1}.bp-front .bm>section:nth-of-type(1){grid-column:2;grid-row:2}.bp-front .bm>section:nth-of-type(2){grid-column:1;grid-row:2}.bp-front .bm>section:nth-of-type(3){grid-column:3;grid-row:2}.bp-front .bm>section:nth-of-type(4){grid-column:1/-1;grid-row:3}
.bp-front section:nth-of-type(1) img.pic{aspect-ratio:16/9}.bp-front section:nth-of-type(1)>h2{font-size:clamp(1.6rem,3vw,2.3rem);border:0;line-height:1.1}.bp-front section:nth-of-type(1)>h2 a{color:var(--fg)}
.bp-front section:nth-of-type(4) .grid{grid-template-columns:repeat(4,minmax(0,1fr))}
.bp-front section:nth-of-type(4){background:${c.dark ? c.panel : "#0c0c0c"};color:#fff;padding:18px;margin-top:10px}.bp-front section:nth-of-type(4) a,.bp-front section:nth-of-type(4) h2{color:#fff!important;border-color:#fff}.bp-front section:nth-of-type(4) .meta{color:#bbb}
.bp-article .bm,.bp-video .bm{max-width:780px}.bp-article .bm>section{font-size:1.08rem;line-height:1.6}.bp-article .bm>section>h2{border:0;font-size:1.3rem}
.player .screen{position:relative;background:#000;border-radius:${t.rad}px;overflow:hidden}.player .screen img{border-radius:0}.playbtn{position:absolute;inset:0;display:grid;place-items:center;font-size:3rem;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6)}.player .bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.3)}.player .bar i{display:block;height:100%;background:var(--acc)}
@media(max-width:980px){.bp-front .bm{display:block}}`,
    newspaper: () => `header.site.bh{position:static;border-bottom:0}.bar1{font-size:.75rem;border-bottom:1px solid ${c.line};font-family:${brandFont("franklin")}}.bar1 .in{display:flex;gap:18px;align-items:center;min-height:40px}.bar1 .bact{margin-left:auto}
.mast .in{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding-top:12px;padding-bottom:6px}.mast.right .in{grid-template-columns:1fr auto}.mast.right .mdate.r{display:none}.mast .blogo{justify-self:center;font-size:clamp(1.6rem,4.8vw,3.3rem)}.mast.right .blogo{justify-self:end}
.mast .logo .lw{font-size:1em!important;${b.logo?.font === "blackletter" ? "font-weight:400!important;" : ""}}.mdate{font-size:.75rem;font-family:${brandFont("franklin")};line-height:1.35}.mdate.r{text-align:right}.mdate .up{color:#1a8a3a}
.tagl{text-align:center;font-style:italic;font-size:.85rem;margin:-2px 0 8px}
nav.bnav .in{display:flex;justify-content:${b.pillars ? "flex-start" : "center"};gap:4px 20px;flex-wrap:wrap;border-top:1px solid ${head ? "rgba(255,255,255,.3)" : c.fg};border-bottom:${head ? "0" : `3px double ${c.fg}`};padding:9px 20px;font-family:${brandFont("franklin")};font-size:.8rem;font-weight:600}
${b.pillars ? `nav.bnav a{border-top:3px solid var(--pc);padding:6px 16px 4px 0;font-family:${headFont};font-size:1.05rem;font-weight:700;min-width:100px}` : ""}
.bm{padding-top:22px}.bm section>h2{font-family:${brandFont("franklin")};font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid var(--fg);padding-top:8px}
.story h3,.bm h1,.bp-front section:nth-of-type(1)>h2{font-family:${headFont};font-weight:700}.story{border-bottom:1px solid ${c.line};padding-bottom:12px}.story .meta,.kicker{font-family:${brandFont("franklin")}}
.bp-front .bm{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1fr);gap:0 30px;align-items:start}.bp-front .bm>.top{grid-column:1/-1}
.bp-front .bm>section:nth-of-type(1){grid-column:1;grid-row:2}.bp-front .bm>section:nth-of-type(2){grid-column:2;grid-row:2 / span 2;border-left:1px solid ${c.line};padding-left:24px}.bp-front .bm>section:nth-of-type(3){grid-column:1;grid-row:3}.bp-front .bm>section:nth-of-type(4){grid-column:2;grid-row:4;border-left:1px solid ${c.line};padding-left:24px}
.bp-front section:nth-of-type(1)>h2{font-size:clamp(1.6rem,3vw,2.3rem);text-transform:none;letter-spacing:0;border:0;padding:0;line-height:1.15}.bp-front section:nth-of-type(1)>h2 a{color:var(--fg)}
.bp-article .bm{max-width:680px;margin:0 auto;width:100%}.bp-article .bm h1{font-size:clamp(2rem,4vw,2.8rem);line-height:1.12;margin:.2em 0}.deck{font-size:1.2rem;color:var(--muted);margin:.4em 0 1em}.bp-article .bm>section{font-family:${bodyFont};font-size:1.18rem;line-height:1.65}
.bp-article .bm>section>h2{text-transform:none;font-size:1.3rem;letter-spacing:0;font-family:${headFont};border:0}
@media(max-width:980px){.bp-front .bm{display:block}.bp-front .bm>section{border:0!important;padding-left:0!important}}`,
    community: () => `.bx{--lw:250px;--rw:316px}.bh .bsearch{max-width:560px;margin:0 auto}.pillsearch{border-radius:999px;background:${c.dark ? c.panel : "#eaedef"};border:0}
${b.key === "reddit.com" ? ".bh .bbtn:not(.ghost){background:#d93a00}" : ""}.dots{font-size:1.2rem}
.lnav{display:flex;flex-direction:column;border-right:1px solid ${c.line};padding-right:14px}.lnav a{color:var(--fg)!important;padding:8px 12px;border-radius:8px}.lnav a:hover{background:${c.panel};text-decoration:none}.lnav h4{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:18px 12px 6px;border-top:1px solid ${c.line};padding-top:14px}
.rdot,.ricon{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;color:#fff;font-size:.62rem;font-weight:800;margin-right:8px;vertical-align:middle}.ricon{width:72px;height:72px;font-size:1.6rem;border:4px solid var(--bg);margin-top:-30px}
.rcard{background:${c.dark ? c.panel : "#f6f8f9"};border-radius:16px;padding:14px 16px;margin-bottom:14px}.rcard h4{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.6em}.rcard ol{margin:0 0 0 1.2em}.rcard li{border-bottom:1px solid ${c.line};padding:.4em 0}
.rstats{display:flex;gap:26px;margin:.6em 0}.rstats span{display:flex;flex-direction:column;font-size:.8rem;color:var(--muted)}.rstats b{font-size:1rem;color:var(--fg)}.rsub{display:flex;align-items:center;margin:.55em 0;color:var(--fg)!important}
.sbanner .ban{height:88px;border-radius:12px}.sbanner .sh{display:flex;align-items:flex-end;gap:12px;padding:0 16px}.sbanner h1{font-size:1.9rem;margin:0 auto 4px 0}.sort{font-size:.8rem;color:var(--muted);padding:12px 4px;border-bottom:1px solid ${c.line}}
.bm .post{background:transparent;border:0;border-radius:16px;padding:10px 14px;margin:0 0 4px;border-bottom:1px solid ${c.line};border-radius:0}.bm .post:hover{background:${c.panel}}
.bm .post .who{font-size:.78rem;gap:6px}.bm .post .who .av{width:22px;height:22px;font-size:.55rem}.bm .post .who .meta{margin-left:0}.bm .post h3{font-size:1.12rem;margin:.2em 0 .4em;font-weight:600}.bm .post h3 a{color:var(--fg)!important}
.bm .post>.meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:.78rem;font-weight:700}.bm .post .fw-vote,.bm .post .fw-reply{background:${c.dark ? c.panel : "#e5ebee"};border-radius:999px;padding:4px 10px;border:0}
.bm .post .post{border:0;border-left:2px solid ${c.line};border-radius:0;margin:8px 0 0 8px;padding:4px 0 4px 14px}.bm section>h2{font-size:.95rem}
.tpost h1{font-size:1.5rem;line-height:1.25;margin:.4em 0 0}.tpost .who{display:flex;align-items:center;font-size:.8rem;gap:4px}.bp-thread .bm>section:first-of-type{border-bottom:1px solid ${c.line};padding-bottom:10px}`,
    linkboard: () => `body{background:#fff}.bx,.bh .in,.bf .in{max-width:${t.maxw}px}.bh>.in{min-height:26px;gap:10px;padding:2px 4px;background:var(--hbg)}header.site.bh{background:none;position:static;border:0;padding-top:8px}
.bh .bnav{gap:0;font-size:.82rem;white-space:pre}.bh .bnav a{margin:0 4px}.login{margin-left:auto;font-size:.82rem}
.bx{background:var(--bg);padding:6px 10px}.bm{padding:4px 0}ol.hn{margin:0 0 0 2.2em;color:var(--muted)}ol.hn li{margin:0 0 .5em;color:var(--fg)}ol.hn li::marker{color:var(--muted)}ol.hn>li>a{color:var(--fg)!important;font-size:.95rem}ol.hn p{margin:0;font-size:.72rem}ol.hn p a{color:var(--muted)!important}
.bm .post{background:none;border:0;padding:4px 0;margin:0 0 10px;font-size:.85rem}.bm .post .who{font-size:.72rem;color:var(--muted);margin-bottom:2px}.bm .post .av{display:none}.bm .post .post{margin-left:40px}.bm section>h2{display:none}
.hnitem textarea{width:min(500px,100%);margin:10px 0 4px}.bf{background:var(--bg)!important;border-top:2px solid var(--acc)!important;text-align:center}.bf .links{justify-content:center}.bf .bsearch{margin:10px auto;max-width:260px}`,
    encyclopedia: () => `body{background:${c.bg}}header.site.bh{position:static;background:none;border:0}.bx{--lw:176px;max-width:none;padding:0;gap:0}
.bh{margin-left:176px}.wtop{display:flex;justify-content:flex-end;gap:14px;font-size:.78rem;padding:8px 16px}.wtabs{display:flex;justify-content:space-between;align-items:flex-end;padding:0 16px 0 0;font-size:.82rem;margin-top:14px}
.wtabs a{display:inline-block;padding:6px 10px;background:linear-gradient(#fff,#f1f5fb);border:1px solid #a7d7f9;border-bottom:0;margin-left:-1px}.wtabs .l a.on,.wtabs .r a.on{background:#fff;color:${c.fg}!important}.wtabs .r{display:flex;align-items:flex-end}.wtabs .bsearch{border-radius:2px;min-width:200px;margin:0 0 4px 10px;background:#fff;flex:none}
.bl{position:static;max-height:none;padding:10px 8px;font-size:.8rem}.wside .blogo{display:flex;justify-content:center;margin:0 0 18px;color:${c.fg}}.wside .logo{flex-direction:column;gap:4px}.wside nav a{display:block;padding:2px 6px;color:var(--link)!important}.wside h4{font-weight:400;color:#54595d;font-size:.75rem;border-bottom:1px solid #c8ccd1;margin:12px 6px 4px}
.bm{background:#fff;border:1px solid #a7d7f9;border-right:0;padding:16px 24px 20px;font-family:${bodyFont};display:flex;flex-direction:column}.bm>*{order:3}.bm>.top{order:0}.bm>section:first-of-type{order:1}.bm>.toc{order:2}.bm .lead{color:inherit;font-size:inherit}
.wtitle{font-family:${headFont};font-weight:400;font-size:1.9rem;border-bottom:1px solid ${c.line};margin:0;padding-bottom:2px}.wfrom{margin:6px 0 14px}
.bm section>h2{font-family:${headFont};font-weight:400;border-bottom:1px solid ${c.line};padding-bottom:2px;margin:.8em 0 .4em}.bm section>h2::after{content:" [edit]";font-family:${bodyFont};font-size:.55em;color:var(--link);vertical-align:middle}
.bm h3{font-size:1.05rem;font-weight:700;font-family:${bodyFont}}.infobox,table.infobox{background:#f8f9fa;border:1px solid ${c.line};border-radius:0;font-size:.82rem;width:min(290px,45%);box-shadow:none}.infobox caption{font-size:1.1rem;text-align:center}.infobox img.pic{aspect-ratio:4/3;margin:0}
.bm table:not(.infobox){width:auto;border:1px solid ${c.line};background:#f8f9fa}.bm th,.bm td{border:1px solid ${c.line};padding:.3em .6em}.bm th{color:${c.fg};text-transform:none;letter-spacing:0;font-size:.85rem;background:#eaecf0}tbody tr:nth-child(even) td{background:none}
sup{font-size:.7em;color:var(--link)}.toc{display:inline-block;align-self:flex-start;background:#f8f9fa;border:1px solid ${c.line};padding:8px 14px;margin:6px 0 14px;font-size:.85rem;min-width:220px}.toc b{display:block;text-align:center;margin-bottom:4px}.toc a{display:block;margin:2px 0}
.toc:not(:has(a)){display:none}.wwelcome{background:#f6f6f6;border:1px solid #ddd;text-align:center;padding:12px}.wwelcome h1{font-family:${headFont};font-weight:400;font-size:1.8rem;margin:0}
.bp-main .bm{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px;align-items:start}.bp-main .bm>.top{grid-column:1/-1}
.bp-main .bm>section{border:1px solid #cef2e0;background:#f5fffa;padding:0 10px 10px}.bp-main .bm>section>h2{margin:0 -10px 8px;padding:3px 8px;background:#cef2e0;border:0;font-size:1.05rem;font-family:${bodyFont};font-weight:700}.bp-main .bm>section>h2::after{content:none}
.bp-main .bm>section:nth-of-type(1){grid-column:1;grid-row:2}.bp-main .bm>section:nth-of-type(2){grid-column:2;grid-row:2;border-color:#cedff2;background:#f5faff}.bp-main .bm>section:nth-of-type(2)>h2,.bp-main .bm>section:nth-of-type(4)>h2{background:#cedff2}
.bp-main .bm>section:nth-of-type(3){grid-column:1;grid-row:3}.bp-main .bm>section:nth-of-type(4){grid-column:2;grid-row:3;border-color:#cedff2;background:#f5faff}.bp-main section img.pic{float:left;width:140px;margin:0 12px 6px 0;aspect-ratio:1}
footer.bf{margin:0 0 0 176px;background:#fff;border:1px solid #a7d7f9;border-top:0;font-size:.75rem;color:#202122}.bf .links a{color:var(--link)}
@media(max-width:980px){.bh,footer.bf{margin-left:0}.bm{border:0}}`,
    marketplace: () => `.bh>.in{max-width:none;min-height:60px;gap:12px}.bh .acct{display:flex;flex-direction:column;line-height:1.15;font-size:.82rem;color:var(--hfg)!important;padding:4px}.bh .acct small{font-size:.72rem;opacity:.85}.bh .acct b{font-size:.85rem}
.cart{color:var(--hfg)!important;font-size:.95rem;white-space:nowrap}.msearch{max-width:none;border-radius:${b.key === "amazon.com" ? "5px" : t.pill};border:${b.key === "amazon.com" ? "0" : `2px solid ${c.fg}`}}.msearch.amz button{background:#febd69;align-self:stretch;color:#111}
.msub{background:${c.sub ?? c.head};color:${c.subFg ?? c.headFg};font-size:.85rem;border-bottom:1px solid ${c.line}}.msub .in{max-width:none;display:flex;gap:18px;padding:8px 20px;overflow:hidden;white-space:nowrap}.msub a{color:inherit!important}
.bx{max-width:${t.maxw}px;--lw:230px}.bm .card{background:${c.dark ? c.panel : "#fff"};border:1px solid ${c.line};box-shadow:none}.bm .card h3{font-size:.95rem;font-weight:400;line-height:1.35}.bm .card h3 a{color:${c.fg}!important}.bm .card img.pic{aspect-ratio:1;object-fit:contain;background:#fff;border:0}
.price{font-size:1.5rem;font-weight:500}.bm .btn{background:var(--buy);color:var(--buyfg);border-radius:${t.pill};box-shadow:none;font-weight:500}.bm .btn.ghost{background:transparent;color:var(--fg);border-color:${c.line}}
.bp-home .bm{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.bp-home .bm>.top{grid-column:1/-1;margin:0 -20px -140px;position:relative;z-index:0}.mhero img{aspect-ratio:3/1;border-radius:0;mask-image:linear-gradient(#000 55%,transparent)}
.bp-home .bm>section{background:${c.dark ? c.panel : "#fff"};padding:18px;z-index:1;position:relative;margin:0;align-self:stretch}.bp-home .bm>section>h2{font-size:1.2rem}.bp-home section img.pic{aspect-ratio:1}
.bp-home{background:${b.key === "amazon.com" ? "#e3e6e6" : "transparent"};max-width:none}
.gallery{grid-column:1;grid-row:1/span 2;display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px;position:sticky;top:80px}.gallery .thumbs i{display:block;height:44px;border:1px solid ${c.line};border-radius:6px;margin-bottom:8px;background:${c.panel}}.gallery .thumbs i:first-child{border-color:#e77600;box-shadow:0 0 0 2px #fbd8b4}.gallery img{aspect-ratio:1;object-fit:contain;background:#fff}
.bp-product .bm{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr) 250px;gap:0 26px;align-items:start}.pinfo{grid-column:2;grid-row:1}.buybox{grid-column:3;grid-row:1/span 2;border:1px solid ${c.line};border-radius:8px;padding:16px;font-size:.88rem}
.bp-product .bm>section:nth-of-type(1){grid-column:2;grid-row:2}.bp-product .bm>section:nth-of-type(n+2){grid-column:1/-1;border-top:1px solid ${c.line};padding-top:16px}
.pinfo h1{font-size:1.5rem;font-weight:400;line-height:1.3;margin:0 0 .2em;font-family:${bodyFont}}.pinfo .rate{display:flex;gap:6px;align-items:center;margin:.3em 0;font-size:.9rem}.badge{display:inline-block;background:#c45500;color:#fff;font-size:.75rem;padding:3px 8px;margin:.2em 0}.pp .big,.buybox .big{font-size:1.9rem;font-weight:500}.off{color:#cc0c39;font-size:1.5rem;font-weight:300}.instock{color:#007600;font-size:1.1rem}
.bbuy,.bnow{display:block;width:100%;text-align:center;border:0;border-radius:999px;padding:9px;margin:8px 0;font:inherit;cursor:pointer;background:var(--buy);color:var(--buyfg)!important;text-decoration:none!important}.bnow{background:var(--now)}.buybox table{font-size:.78rem;margin-top:8px}.buybox td{border:0;padding:1px 4px}
.filters{font-size:.85rem}.filters h4{margin:14px 0 4px;font-size:.9rem}.filters label{display:flex;gap:6px;align-items:center;margin:4px 0}.rbar{display:flex;justify-content:space-between;border-bottom:1px solid ${c.line};padding:6px 0 10px;font-size:.9rem}.rbar .q{color:#c45500}
.bp-search .bm section .grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
@media(max-width:980px){.bp-home .bm,.bp-product .bm{display:block}.gallery{position:static}}`,
    video: () => `.bx{--lw:230px;max-width:none}.bh>.in{max-width:none;min-height:56px}.vsearch{max-width:600px;margin:0 auto;border-radius:40px}.vsearch button{background:${c.dark ? "#222" : "#f8f8f8"};border-left:1px solid ${c.line};padding:0 20px;align-self:stretch}.mic{background:${c.panel};border-radius:50%;width:40px;height:40px;display:grid;place-items:center}
.guide{display:flex;flex-direction:column}.guide a{color:var(--fg)!important;padding:8px 12px;border-radius:10px}.guide a:hover{background:${c.panel};text-decoration:none}.guide h4{margin:10px 12px 4px}.guide hr{border:0;border-top:1px solid ${c.line};margin:10px 0}
.chips{display:flex;gap:10px;overflow:hidden;flex-wrap:nowrap}.chips a{background:${c.panel};color:var(--fg)!important;padding:6px 12px;border-radius:8px;font-size:.88rem;font-weight:600;white-space:nowrap}.chips a.on{background:var(--fg);color:var(--bg)!important}
.bm .grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:24px 16px}.bm section>h2{font-size:1.2rem}.bm .vcard b{font-weight:600}
.bp-watch .bm{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:0 24px;align-items:start}.bp-watch .bm>.top{grid-column:1;grid-row:1}.bp-watch .bm>section:nth-of-type(1){grid-column:1;grid-row:2;background:${c.panel};border-radius:12px;padding:12px}
.bp-watch .bm>section:nth-of-type(2){grid-column:1;grid-row:3}.bp-watch .bm>section:nth-of-type(3){grid-column:2;grid-row:1/span 4}.bp-watch .bm>section:nth-of-type(4){grid-column:1;grid-row:4}
.bp-watch .bm>section:nth-of-type(3) .vcard{display:grid;grid-template-columns:168px minmax(0,1fr);gap:0 8px;margin-bottom:8px}.bp-watch .bm>section:nth-of-type(3) .vcard img{grid-row:1/span 3;margin:0}.bp-watch .bm>section:nth-of-type(3) .grid{display:block}
.player .screen{position:relative;background:#000;border-radius:12px;overflow:hidden}.player .screen img{border-radius:0}.playbtn{position:absolute;inset:0;display:grid;place-items:center;font-size:3.4rem;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.6)}.player .bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.3)}.player .bar i{display:block;height:100%;background:var(--acc)}
.player h1,.chead h1{font-size:1.25rem;font-weight:700;margin:12px 0 8px;font-family:${bodyFont}}.chan{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.chan .acts{margin-left:auto;display:flex;gap:8px}.chan .acts span{background:${c.panel};border-radius:999px;padding:6px 14px;font-size:.85rem;font-weight:600}
.bbtn.dark{background:var(--fg);color:var(--bg)!important;border:0}.chan.big .av{width:120px;height:120px;font-size:2.4rem}.banner{aspect-ratio:6/1;border-radius:14px;margin-bottom:12px}.ctabs{display:flex;gap:22px;border-bottom:1px solid ${c.line};padding:10px 0;margin-top:10px}
.bm .post{background:none;border:0;padding:6px 0;margin:0 0 10px}.bm .post .who .meta{margin-left:0}
@media(max-width:1100px){.bp-watch .bm{display:block}.bm .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`,
    codehost: () => `.bh>.in{max-width:none;min-height:62px}.bh .bnav{font-size:.95rem;font-weight:600;gap:20px}.gsearch{max-width:300px;background:transparent;border-color:#57606a;color:#fff}.gsearch input{color:#fff}.gsearch button{color:#aaa}.bh .plain{color:#fff!important}.bh .bbtn.ghost{border-color:#aaa;border-radius:6px}
.rhead{background:${c.dark ? c.panel : "#f6f8fa"};border-bottom:1px solid ${c.line};padding-top:16px}.rhead>.in{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.rname{font-size:1.25rem;font-weight:400;margin:0;font-family:${bodyFont}}.rname b{font-weight:600}.racts{margin-left:auto;display:flex;gap:8px}
.gbtn{display:inline-flex;gap:6px;align-items:center;border:1px solid ${c.line};background:#f6f8fa;border-radius:6px;padding:4px 12px;font-size:.82rem;font-weight:600;cursor:pointer}.gbtn b{background:#e7ecf0;border-radius:999px;padding:0 6px;font-size:.75rem}.gbtn.green{background:var(--buy);color:#fff;border-color:transparent}
.rtabs .in{display:flex;gap:4px;margin-top:10px;overflow:hidden}.rtabs a{color:var(--fg)!important;padding:8px 12px;border-bottom:2px solid transparent;font-size:.88rem;white-space:nowrap}.rtabs a.on{border-color:#fd8c73;font-weight:600}.rtabs i{font-style:normal;background:#e7ecf0;border-radius:999px;padding:0 6px;font-size:.75rem}
.bx{--rw:296px;--lw:296px}.branch,.commit{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.85rem}.grow{flex:1}.commit{background:#f6f8fa;border:1px solid ${c.line};border-radius:6px 6px 0 0;padding:10px 14px;margin:0!important}.commit .av{width:22px;height:22px;font-size:.55rem}
.bp-repo .bm>section:nth-of-type(1){border:1px solid ${c.line};border-top:0;border-radius:0 0 6px 6px;margin-bottom:22px}.bp-repo section:nth-of-type(1) table{margin:0;font-size:.88rem}.bp-repo section:nth-of-type(1) td{border-bottom:1px solid ${c.line};padding:.5em .9em}.bp-repo section:nth-of-type(1) th{display:none}.bp-repo section:nth-of-type(1) td a{color:var(--fg)!important}
.bp-repo .bm>section:nth-of-type(n+2){border:1px solid ${c.line};border-top:0;border-bottom:0;padding:4px 26px;margin:0}.bp-repo .bm>section:nth-of-type(2){border-top:1px solid ${c.line};border-radius:6px 6px 0 0;padding-top:0}.bp-repo .bm>section:nth-of-type(2)::before{content:"📖 README";display:block;margin:0 -26px 14px;padding:10px 16px;border-bottom:1px solid ${c.line};font-size:.85rem;font-weight:600}
.bp-repo .bm>section:nth-of-type(4){border-bottom:1px solid ${c.line};border-radius:0 0 6px 6px;padding-bottom:18px}.bp-repo section h2{border-bottom:1px solid ${c.line};padding-bottom:.3em;font-size:1.8rem}.bm h3{border-bottom:1px solid ${c.line};padding-bottom:.3em;font-size:1.25rem}
pre{background:#f6f8fa;border-radius:6px;padding:14px;overflow:auto;font-size:.85rem;margin:0 0 1em}pre code{background:none;border:0;padding:0}
.about{padding:18px 0;font-size:.88rem}.about h4{font-size:1rem;margin:16px 0 8px;border-top:1px solid ${c.line};padding-top:14px}.about h4:first-child{border:0;padding:0;margin-top:0}.topics{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.bm .tag,.about .tag{background:#ddf4ff;color:#0969da;border:0;text-transform:none;letter-spacing:0;font-size:.75rem;font-weight:600}.tag.grn{background:#dafbe1;color:#1a7f37}.tag.red{background:#ffebe9;color:#cf222e}
.lbar{display:flex;height:8px;border-radius:6px;overflow:hidden;margin:6px 0}.lbar i{display:block}
.ihead h1{font-size:2rem;font-weight:400;font-family:${bodyFont}}.state{background:#1f883d;color:#fff;border-radius:999px;padding:5px 12px;font-weight:600;font-size:.85rem}.bp-issue .bm .post{border:1px solid ${c.line};border-radius:6px;padding:0;background:#fff;margin-bottom:16px}.bp-issue .bm .post .who{background:#f6f8fa;border-bottom:1px solid ${c.line};padding:8px 14px;margin:0}.bp-issue .bm .post>:not(.who){margin-left:14px;margin-right:14px}.bp-issue .bm .post>p:first-of-type{margin-top:12px}
.pcard .av.huge{width:260px;height:260px;font-size:4rem;border:1px solid ${c.line}}.pcard h1{font-size:1.5rem;margin:12px 0 0;font-family:${bodyFont}}.bbtn.wide{display:block;text-align:center;border-radius:6px;background:#f6f8fa;border-color:${c.line}}
.cgrid{display:grid;grid-template-rows:repeat(7,10px);grid-auto-flow:column;gap:3px;overflow:hidden;border:1px solid ${c.line};border-radius:6px;padding:12px}.cgrid i{width:10px;height:10px;border-radius:2px;background:#ebedf0}.cgrid .l1{background:#9be9a8}.cgrid .l2{background:#40c463}.cgrid .l3{background:#30a14e}.cgrid .l4{background:#216e39}
.ghero{text-align:center;background:#0d1117;color:#fff;margin:-18px -20px 20px;padding:70px 20px}.ghero h1{font-size:clamp(2.2rem,5vw,4rem);line-height:1.08;color:#fff}.ghero .lead{color:#9198a1}
.bm .card{box-shadow:none;border-radius:6px}`,
    qa: () => `header.site.bh{border-top:3px solid var(--acc);box-shadow:0 1px 2px rgba(0,0,0,.05)}.bh>.in{min-height:50px}.qsearch{border-radius:5px;max-width:640px}.bh .bbtn{border-radius:5px;background:var(--buy);font-weight:400}.bh .bbtn.ghost{background:#e1ecf4;color:#39739d!important;border-color:#7aa7c7}
.bx{--lw:164px;--rw:300px}.qnav{display:flex;flex-direction:column;border-right:1px solid ${c.line};font-size:.85rem}.qnav a{color:#525960!important;padding:6px 8px}.qnav a.on{background:#f1f2f3;color:${c.fg}!important;font-weight:700;border-right:3px solid var(--acc)}
.qhead{display:grid;grid-template-columns:1fr auto;gap:6px 16px;border-bottom:1px solid ${c.line};padding-bottom:10px}.qhead h1{font-size:1.65rem;font-weight:400;line-height:1.3;margin:0;font-family:${bodyFont}}.qhead .meta{grid-column:1/-1;font-size:.8rem}.qhead .meta b{font-weight:400;color:${c.fg}}.qhead .bbtn{background:var(--buy);border-radius:5px;font-weight:400;align-self:start}.qtabs{float:right;display:inline-flex;border:1px solid #9fa6ad;border-radius:5px;overflow:hidden}.qtabs>*{padding:4px 9px;border-left:1px solid #9fa6ad}.qtabs b{background:#e3e6e8}
.bm .post{display:grid;grid-template-columns:52px minmax(0,1fr);gap:0 14px;background:none;border:0;border-bottom:1px solid ${c.line};border-radius:0;padding:16px 0;margin:0}.bm .post>*{grid-column:2}.bm .post>.meta:last-child{grid-column:1;grid-row:1/span 20;display:flex;flex-direction:column;align-items:center;font-size:1.3rem;color:#6a737c}
.bm .post>.meta:last-child .fw-vote{flex-direction:column;border:0;background:none;font-size:1.2rem}.bm .post .who{justify-self:end;background:#d9eaf7;padding:6px 10px;border-radius:4px;font-size:.8rem;margin-top:10px}.bm .post .who .meta{margin-left:0}
.bm .tag{background:#e1ecf4;color:#39739d;border:0;border-radius:4px;text-transform:none;letter-spacing:0;font-size:.75rem;font-family:${bodyFont};padding:.3em .55em}.bm .tag.hot{background:#2f6f44;color:#fff}.bm section>h2{font-size:1.2rem;font-weight:400;margin:14px 0 0}
pre{background:#f6f6f6;border-radius:5px;padding:12px;overflow:auto;font-size:.85rem;margin:0 0 1em}pre code{background:none;border:0;padding:0}
.qside .yb{background:#fdf7e2;border:1px solid #f1e5bc;border-radius:3px;padding:0 0 8px;margin-bottom:16px}.qside h4{background:#fbf3d5;border-bottom:1px solid #f1e5bc;padding:10px 14px;font-size:.78rem;font-weight:700;margin:0 0 6px;color:#525960}.qside ul{margin:0 14px 0 30px;font-size:.8rem}.qside .hot h4{background:none;border:0;font-size:1.1rem;font-weight:400;padding:0 0 8px;color:${c.fg}}.qside .hot ul{list-style:none;margin:0}.qside .hot li{margin:.5em 0}
.qsum{display:grid;grid-template-columns:108px minmax(0,1fr);gap:16px;border-bottom:1px solid ${c.line};padding:16px 0}.qsum .stats{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font-size:.8rem;color:#6a737c}.qsum .stats .ans{border:1px solid #2f6f44;color:#2f6f44;border-radius:3px;padding:1px 4px}.qsum h3{font-size:1.05rem;margin:0 0 .3em;font-weight:400}`,
    productbrand: () => `header.site.bh{background:color-mix(in srgb,var(--hbg) 82%,transparent);backdrop-filter:saturate(180%) blur(20px);border:0}.bh>.in{min-height:44px;justify-content:center;gap:34px;font-size:.78rem}.bh .bnav{gap:34px;font-size:.78rem;opacity:.85}.bh .bact{margin-left:0;gap:26px}
.promo{background:${c.panel};text-align:center;font-size:.85rem;padding:12px}.lnav{position:sticky;top:44px;z-index:40;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(20px);border-bottom:1px solid ${c.line}}.lnav .in{display:flex;align-items:center;gap:22px;min-height:52px;font-size:.8rem}.lnav b{font-size:1.3rem}.grow{flex:1}
.bm{padding-top:0}.bx{max-width:none;padding:0}.bm>section,.bm>.top{text-align:center}.bm .row.c{justify-content:center;gap:24px}.more{font-size:1.05rem}
.phero,.bm .tile{padding:54px 20px 0;overflow:hidden}.phero h1{font-size:clamp(3rem,8vw,5.6rem);margin:0}.phero .lead,.bm .tile .lead{font-size:clamp(1.2rem,2.4vw,1.75rem);color:${c.fg};margin:.2em 0 .8em}.phero img.art,.bm .tile img.pic{max-width:1000px;margin:26px auto 0;aspect-ratio:2/1;object-fit:cover;background:transparent;border:0}
.bm .tile h2{font-size:clamp(2.4rem,5vw,3.6rem);margin:0}.bm>section:nth-of-type(odd) .tile,.bm>section:nth-of-type(odd)>.tile{background:${c.panel}}.bm>section{margin:0 0 12px}.bm>section:nth-of-type(3) .tile{background:#000;color:#f5f5f7}.bm>section:nth-of-type(3) .tile .lead{color:#f5f5f7}
.bm .btn{background:var(--acc);border-radius:999px;box-shadow:none;font-weight:400;padding:.6em 1.3em}.bm .btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc)}.bm>section>h2{font-size:clamp(1.8rem,3.4vw,2.8rem);padding-top:40px}
.bm .grid{max-width:1260px;margin:0 auto 1.2em;padding:0 12px}.bm .card{background:${c.panel};border:0;border-radius:18px;padding:36px 24px;text-align:center}.bm .stat{background:${c.panel};border:0;border-radius:18px}.bm .stat b{color:${c.fg}}.bm table{max-width:900px;margin:0 auto 1.2em;text-align:left}`,
    classifieds: () => `header.site.bh{position:static;border:0;background:none}.bh>.in{min-height:40px;font-size:.85rem;gap:10px}.bh .post{margin-left:auto}.crumb{color:#888}
.bx{--lw:190px;--rw:170px;max-width:1200px}.bl{position:static;max-height:none}.clleft{display:flex;flex-direction:column;gap:6px;font-size:.82rem}.clleft .blogo{margin-bottom:8px}.clleft .bsearch{border-radius:0;max-width:none}.clleft h4{margin:12px 0 0;font-size:.8rem}
.cal{display:grid;grid-template-columns:repeat(7,1fr);font-size:.7rem;text-align:center;border:1px solid #ccc}.cal b{background:#eee}.cal a{padding:2px 0}
.clarea{text-align:center;font-size:.9rem}.clarea b{font-size:1.1rem}.clarea span{color:#888;font-size:.78rem;margin-left:6px}
.bp-home .bm{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0 12px;align-items:start}.bp-home .bm>.top{grid-column:1/-1}.bp-home .bm>section:nth-of-type(4){font-size:.78rem}
.bm section>h2{background:#eee;text-align:center;font-size:.85rem;font-weight:700;padding:3px;margin:10px 0 4px;border:1px solid #ddd;text-transform:lowercase}.bm ul{list-style:none;margin:0 0 .8em 0;columns:2;column-gap:10px;font-size:.8rem}.bm ul li{margin:0 0 1px;break-inside:avoid}
.bp-search .bm ul,.bp-posting .bm ul{columns:1}.bp-search .bm ul li{padding:5px 0;border-bottom:1px solid #eee;font-size:.9rem}.bm .price{font-size:.85rem;font-weight:400;color:#555;margin:0 4px;display:inline}
.clpost h1{font-size:1.2rem;font-weight:700;font-family:${bodyFont}}.bp-posting .bm img.pic{max-width:600px;aspect-ratio:4/3}.bf{background:none!important;border:0!important;text-align:center}`,
    social: () => `header.site.bh{display:none}.bx{--lw:260px;--rw:350px;max-width:1280px}.bm{border-left:1px solid ${c.line};border-right:1px solid ${c.line};padding:0;min-height:100vh}
.snav{display:flex;flex-direction:column;gap:2px;font-size:1.15rem}.snav .blogo{padding:10px 12px;margin-bottom:6px;color:var(--fg)}.snav a:not(.bbtn){color:var(--fg)!important;padding:10px 12px;border-radius:999px}.snav a:not(.bbtn):hover{background:${c.panel};text-decoration:none}.snav span{display:inline-block;width:28px}
.bbtn.big{background:var(--buy);color:var(--buyfg)!important;text-align:center;padding:.8em;margin-top:12px;font-size:1rem}.sside .scard{border:1px solid ${c.line};border-radius:16px;padding:12px 16px;margin:14px 0}.sside .scard h4{font-size:1.2rem;margin-bottom:6px}.sside .scard a{display:block;color:var(--fg)!important;padding:8px 0}.sside .pillsearch{max-width:none;border-radius:999px;background:${c.panel};border:0}
.stabs{display:flex;border-bottom:1px solid ${c.line};margin:0!important}.stabs>*{flex:1;text-align:center;padding:14px 0;color:var(--muted)}.stabs b{color:var(--fg);box-shadow:inset 0 -4px 0 var(--acc)}
.compose{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid ${c.line};margin:0!important}.compose .meta{flex:1;font-size:1.2rem}.bbtn.sm{background:var(--buy);color:var(--buyfg)!important}
.bm .post{background:${b.colors?.panel ? c.panel : "none"};border:0;border-bottom:1px solid ${c.line};border-radius:${b.colors?.panel ? "10px" : "0"};margin:0 0 ${b.colors?.panel ? "12px" : "0"};padding:12px 16px}.bm .post .who .meta{margin-left:0}.bm .post img.pic{border-radius:16px;aspect-ratio:${b.picturePosts ? "1" : "16/10"}}.bm .post>.meta{display:flex;justify-content:space-between;max-width:420px}
.bm section>h2{display:none}${b.colors?.panel ? `.bm{border:0;padding-top:16px}` : ""}
.sprof .banner{aspect-ratio:3/1;border-radius:0}.sprof .av.huge{width:120px;height:120px;font-size:2.2rem;border:4px solid var(--bg);margin:-60px 0 0 16px}.sprof h1,.sprof>p{margin-left:16px;margin-right:16px}.sprof h1{font-size:1.4rem;margin-top:8px;font-family:${bodyFont}}.fr{float:right;margin:12px 16px 0 0}.shead{padding:14px 16px;font-size:1.2rem;margin:0!important}
@media(max-width:980px){.bm{border:0}}`,
    streaming: () => `header.site.bh{background:linear-gradient(${c.head},transparent);border:0;position:sticky}.bh>.in{max-width:none;padding:0 4%;min-height:68px}.bh .bnav{font-size:.88rem;gap:20px;opacity:.9}.av.sq{border-radius:4px;width:32px;height:32px}
.bx{max-width:none;padding:0 4%}.bx.has-l{--lw:300px}.slib{background:${c.panel};border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px}.slib a{color:var(--fg)!important;font-size:.9rem;display:grid;grid-template-columns:44px 1fr;align-items:center;gap:0 10px}.slib a:not(:has(.cov)){display:block;font-weight:700}.slib .cov{grid-row:1/span 2;width:44px;height:44px;border-radius:4px}
.bm .grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.tile{display:block;color:var(--fg)!important;background:${c.panel};border-radius:6px;overflow:hidden;min-height:118px;padding:0 0 8px;transition:transform .2s}.tile:hover{transform:scale(1.04);text-decoration:none}.tile img.pic{aspect-ratio:16/9;margin:0 0 6px;border:0;border-radius:0}.tile b,.tile .meta{display:block;padding:0 10px}.tile:not(:has(img)){padding:14px 12px;background:linear-gradient(135deg,${mix(c.panel, c.acc, 0.25)},${c.panel})}
.bp-home .bm>section:nth-of-type(1){position:relative;min-height:56vh;display:flex;flex-direction:column;justify-content:flex-end;padding:0 0 40px;margin:0 -4.5% 20px;padding-left:4.5%}
.bp-home .bm>section:nth-of-type(1) img.pic{position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;margin:0;z-index:-1;border-radius:0;object-fit:cover;mask-image:linear-gradient(90deg,#000 30%,transparent),linear-gradient(transparent 60%,#000);-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,.95),rgba(0,0,0,.35))}
.bp-home .bm>section:nth-of-type(1)>h2{font-size:clamp(2.4rem,6vw,4.6rem);max-width:12ch;line-height:1}.bp-home .bm>section:nth-of-type(1)>p{max-width:46ch}.bm .btn{background:#fff;color:#000;border-radius:4px;font-weight:700;box-shadow:none}.bm .btn.ghost{background:rgba(109,109,110,.7);color:#fff;border:0}
.bill{position:relative;min-height:60vh;display:flex;align-items:flex-end;margin:0 -4.5%}.bill img.bg{position:absolute;inset:0;height:100%;border-radius:0}.bill .bt{position:relative;padding:0 4.5% 40px;max-width:640px;background:linear-gradient(90deg,${c.bg} 20%,transparent);}.bill h1{font-size:clamp(2.4rem,6vw,4.4rem);line-height:1}.bbtn.light{background:#fff;color:#000!important;border-radius:4px}.grn{color:#46d369}
.bm section>h2{font-size:1.3rem}.bm table{font-size:.9rem}.bm th{color:var(--muted)}`,
    landing: () => `.bh>.in{min-height:64px}.bh .bnav{font-size:.95rem;margin-left:12px}.bh .bbtn:not(.ghost){background:var(--buy);color:var(--buyfg)!important}
.bx{max-width:${t.maxw}px}.lhero{text-align:center;padding:60px 0 20px}.lhero h1{font-size:var(--h1);line-height:1.05;letter-spacing:-.02em;max-width:18ch;margin:0 auto .3em}.lhero .lead{font-size:1.25rem;color:var(--muted);max-width:44ch;margin:0 auto 1em}.row.c{justify-content:center}.lhero .row .bbtn{background:var(--buy);color:var(--buyfg)!important}.lhero .row .bbtn.ghost{background:transparent;color:var(--fg)!important}
.lhero img.art{max-width:1000px;margin:30px auto 0;aspect-ratio:16/9;border-radius:${t.rad + 6}px}.bm .btn{background:var(--buy);color:var(--buyfg)}.bm section>h2{text-align:center}`,
  };
  css.push(A[b.arch]?.() ?? A.landing());
  if (plan.page === "confirm") css.push(`.bm{display:block!important;max-width:800px}.bm>section{grid-column:auto!important;grid-row:auto!important}`);
  return css.join("\n");
}
