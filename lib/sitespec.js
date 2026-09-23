// A real, well-known site's design, written by the model once per domain.
//
// Foogle keeps no list of real sites and no per-site templates. When a search
// result is marked real, or Jev says a visited domain is a real, well-known
// site, the model writes that site's design spec: its colours, type and
// wordmark, its header and rails, the structure of its pages and its URL
// scheme, and a few scoped CSS rules for the final touches. lib/design.js
// renders any spec with one generic set of primitives.
//
// The spec streams as JSON lines, ordered by when a page needs them: what the
// section writers need first, then the look and the header, then the URL
// scheme, and last the icon and CSS, which a page already on screen adopts
// when they arrive. Specs are cached in memory and on disk, so every page of a
// site shares one look and later visits are instant.

import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { streamText, config, extractJSON, sanitizeSVG } from "./llm.js";
import { OFFLINE } from "./fake-llm.js";

// Bump when the prompt or the schema changes: old specs on disk are ignored.
export const SPEC_VERSION = 6;

// The site structures lib/design.js renders, and the page types of each.
export const ARCH_PAGES = {
  news: ["front", "article", "video"],
  newspaper: ["front", "article"],
  community: ["feed", "thread", "profile"],
  linkboard: ["front", "item"],
  encyclopedia: ["main", "article", "search"],
  marketplace: ["home", "search", "product"],
  video: ["home", "watch", "channel", "results"],
  codehost: ["home", "repo", "issue", "profile", "search"],
  qa: ["list", "question"],
  productbrand: ["home", "product"],
  classifieds: ["home", "search", "posting"],
  social: ["feed", "profile", "post"],
  streaming: ["home", "title"],
  landing: ["home", "page"],
};
export const ARCHES = Object.keys(ARCH_PAGES);

const ARCH_ABOUT = {
  news: "a TV or online news portal: headline rails around a lead story, video",
  newspaper: "a print newspaper's site: masthead, columns, opinion",
  community: "topic communities of posts with votes and nested comments",
  linkboard: "one dense ranked list of links with points and comments",
  encyclopedia: "reference articles with a sidebar, tabs, contents and an infobox",
  marketplace: "a shop or marketplace: search, listings, product pages with a buy box",
  video: "a video platform: a grid of videos, watch pages with a player",
  codehost: "code hosting: repositories, issues, profiles",
  qa: "questions and voted answers",
  productbrand: "a maker marketing its own products in full-width panels",
  classifieds: "a plain-text directory of listings",
  social: "a feed of short posts from accounts",
  streaming: "dark rows of titles to watch or play",
  landing: "a company's or service's marketing site",
};

// Font feels a spec may name; lib/design.js maps them to system stacks (no web
// fonts, which would cost a request before the first styled paint).
export const FONTS = ["sans", "helvetica", "arial", "arialblack", "segoe", "roboto", "verdana", "georgia", "serif", "times", "franklin", "blackletter", "cond", "rounded", "mono", "avenir", "futura", "script", "didone"];
const LOGO_STYLES = ["word", "block", "blocks", "tag", "oval", "stack"];

// The hooks the renderer's markup offers a spec's CSS (see lib/design.js).
export const CSS_HOOKS = "header.site (the header bar), .d-in (a header row), .d-logo, .d-nav a, .d-acts, .d-btn (header buttons; .d-btn.ghost the outlined one), .d-search, .d-sub (second nav row), .d-page (the grid under the header), .d-left and .d-right (rails), .d-main (the main column), .d-top (the page's heading block: title, byline, gallery, player…), .d-main section > h2, .card, .post, .story, .heads, .buybox, .price, .tag, .btn, .infobox, .toc, footer.site";

// The spec is written in parts by concurrent calls, so a page waits only for
// the few lines it needs rather than for one long reply: what the site is (the
// section writers start on it), how it looks and its header (the header waits
// for both), and its icon, all at once; then its URL scheme and CSS, written
// knowing the look so the two agree, which a page adopts when they arrive.
export const SPEC_PARTS = ["about", "look", "header", "icon", "style"];

const SPEC_INTRO = `You are the design desk of Foogle, a search engine for the web of the 2040s. When a visitor opens a page on a real, well-known website, Foogle renders it as that site will look in the 2040s: its own colours, typography, wordmark, header, navigation and page layout, filled with invented content. You describe the site so Foogle's renderer can draw it. Describe its look; never copy its assets or its text.

If the domain is not a real website that many people know and visit today (an invented, parked or obscure domain), output exactly {"real": false} and nothing else.`;

const SPEC_FORMAT = (lines) => `Otherwise output exactly ${lines.length} line${lines.length > 1 ? "s" : ""}, each one complete JSON object on one line, in this order, and nothing else (no code fences, no commentary):\n${lines.join("\n")}`;

const PART_PROMPTS = {
  about: () => `${SPEC_FORMAT([`{"real": true, "name": "…", "arch": "…", "page": "…", "tagline": "…", "voice": "…"}`])}

- name: its own brand name, cased as the site writes it.
- arch: the structure its pages have, one of: ${ARCHES.map((a) => `${a} (${ARCH_ABOUT[a]})`).join("; ")}.
- page: which kind of page the given URL is, one of its arch's page types: ${ARCHES.map((a) => `${a}: ${ARCH_PAGES[a].join(", ")}`).join(" · ")}.
- tagline: how it describes itself, under 12 words. voice: one sentence on how its content reads: tone, recurring labels, formats.`,
  look: () => `${SPEC_FORMAT([`{"colors": {…}, "fonts": ["…", "…"], "logo": {…}}`])}

- colors: its real colours as #rrggbb: {"bg": page, "text": body text, "accent": brand colour, "header": header bar, "headerText": text on the header, "link": links, "button": main buttons, "footer": footer, "subnav": second nav bar or ""}.
- fonts: [body, headings], each one of: ${FONTS.join(", ")}.
- logo: its wordmark: {"text": the letters, "style": word (styled text) | block (text on a solid box) | blocks (each letter in its own box) | tag (text in a tag shape) | oval | stack (small caps over a small line), "color", "bg" and "fg" (box colours), "font", "weight" (100-900), "italic", "case" (none, lower or upper), "tracking" (em, e.g. -0.04), "size" (1 normal, up to 2), "colors" (only when the letters themselves are in different colours: one per letter), "sub" (optional small line under the wordmark)}.`,
  header: () => `${SPEC_FORMAT([
    `{"nav": […], "actions": […], "search": "…", "subnav": […], "location": "…", "promo": "…", "strip": "…"}`,
    `{"left": […], "right": […], "prefix": "…", "user": "…", "buttons": […]}`,
  ])}

Line 1, its header:
- nav: its real top navigation, 4-10 labels; write ["Label", "/path"] when the path isn't the label as a slug.
- actions: the utility links at the header's end, in its own words; a leading * marks the one styled as a button; a link shown on two lines is written "small line|big line".
- search: the search box's placeholder, or "" if the header has none. subnav: a second row of links under the header, or [].
- location: a location chip (a delivery address, an edition, a city) as "small line|big line", or "". promo: a thin announcement bar's text, or "". strip: "scores" or "markets" for a live ticker above the header, or "".

Line 2, its rails:
- left and right: the site-wide groups its side rails list on every page that has them (navigation, tools, communities, promotions; never one page's own contents), as [["Heading", ["Item", "Item"]]]; a heading may be ""; up to 3 groups of up to 8 items; [] for none.
- prefix and user: the prefixes it writes before a community's and a user's name, or "". buttons: its product page's two purchase buttons, in its own words, or [].`,
  icon: () => `${SPEC_FORMAT([`{"icon": "…"}`])}

- icon: the symbol the site shows beside its wordmark (a mascot, a globe, a play button…), as a tiny SVG: viewBox="0 0 32 32", at most 8 simple shapes in its own colours, no text, no images, no styles or scripts. Never letters or the wordmark again: when the logo is just lettering, even on a coloured box, the icon is "".`,
  style: (arch) => `${SPEC_FORMAT([`{"routes": {…}, "legal": "…"}`, `{"css": "…"}`])}

The message says which structure the site has and how it looks; everything you write must agree with that.

Line 1, its URL scheme:
- routes: {"page type": "/pattern"} for its kinds of page other than the home page, with :name for a variable segment and a query when a parameter picks the page, e.g. {"thread": "/c/:community/posts/:id/:slug", "feed": "/c/:community", "search": "/search?q=:query"}. Name each kind of page with one of: ${(ARCH_PAGES[arch] ?? [...new Set(Object.values(ARCH_PAGES).flat())]).join(", ")}. Always include "search", its search results URL.
- legal: the company name in its footer.

Line 2, css: up to 30 short CSS rules for the site's own finishing touches on top of the renderer (borders, radii, type, weights, spacing, and colours beyond the ones given), using only these hooks: ${CSS_HOOKS}; and the variables --bg, --fg, --acc, --link, --line, --panel, --muted. Keep to the colours in the message: the page's background and text are already those. The renderer already lays out every page: never set widths, margins, display, grid or position on the header, rails or main column. Name fonts by these keywords: ${FONTS.join(", ")}. No url(), @import or @font-face.`,
};

// `known` is what earlier parts said (the style part is written knowing the
// site's structure and look).
export function siteSpecPrompt({ domain, url, part = "about", known = null }) {
  const look = known && JSON.stringify({ name: known.name, arch: known.arch, colors: known.colors, fonts: known.fonts, logo: known.logo });
  return {
    system: `${SPEC_INTRO}\n\n${PART_PROMPTS[part](known?.arch)}`,
    user: `Domain: ${domain}\nURL: ${url || `https://${domain}/`}\nPart: ${part}${look ? `\nThe site: ${look}` : ""}`,
  };
}

// ---------- validation ----------
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const hex = (v) => (HEX.test(String(v ?? "").trim()) ? expandHex(String(v).trim().toLowerCase()) : null);
const expandHex = (h) => (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join("")}` : h);
const text = (s, n) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : d);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// A site path: relative, no scheme, no quotes; "Home" is the root.
const sitePath = (p, label = "") => {
  const s = String(p ?? "").trim();
  if (/^\/(?!\/)[^\s"'<>\\]*$/.test(s)) return s.slice(0, 160);
  return /^home$/i.test(label) ? "/" : `/${slug(label)}`;
};
export const hostKey = (h) => String(h ?? "").toLowerCase().replace(/:\d+$/, "").replace(/^(?:www|m|mobile|amp)\./, "").replace(/\.$/, "");

const links = (list, max, n = 40) => (Array.isArray(list) ? list : []).map((item) => {
  const [label, p] = Array.isArray(item) ? item : [item];
  const l = text(label, n);
  return l ? [l, sitePath(p, l)] : null;
}).filter(Boolean).slice(0, max);

const rails = (groups) => (Array.isArray(groups) ? groups : []).map((g) => {
  if (!Array.isArray(g)) return null;
  const items = links(g[1], 8, 48);
  return items.length ? { title: text(g[0], 40), items } : null;
}).filter(Boolean).slice(0, 3);

// "/r/:community/comments/:id/:slug/" -> a matcher. :name and * are one
// segment, ** any number; a query "?v=:id" requires that parameter.
export function compileRoute(pattern) {
  const [p, q = ""] = String(pattern).split("?");
  const segs = p.split("/").filter(Boolean);
  if (segs.length > 12 || !p.startsWith("/")) return null;
  const parts = segs.map((s, i) => {
    if (s === "**") return i === segs.length - 1 ? { rest: true } : { any: true };
    if (/^:[\w-]+$/.test(s) || s === "*") return { any: true };
    if (/[:*]/.test(s)) return { re: new RegExp(`^${s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[\w-]+|\*/g, "[^/]+?")}$`, "i") };
    return { lit: s.toLowerCase() };
  });
  const params = q.split("&").map((kv) => kv.split("=")[0]).filter((k) => /^[\w-]+$/.test(k));
  return { parts, params, literals: parts.filter((x) => x.lit || x.re).length };
}

export function matchRoute(route, u) {
  if (route.params.some((k) => !u.searchParams.get(k))) return false;
  const segs = u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  let i = 0;
  for (const part of route.parts) {
    if (part.rest) return true;
    const s = segs[i++];
    if (s === undefined) return false;
    if (part.lit && s.toLowerCase() !== part.lit) return false;
    if (part.re && !part.re.test(s)) return false;
  }
  return i === segs.length;
}

function routes(raw, arch) {
  const types = new Set([...(ARCH_PAGES[arch] ?? []), "search"]);
  return Object.entries(raw && typeof raw === "object" ? raw : {}).map(([type, pattern]) => {
    const t = String(type).toLowerCase();
    if (!types.has(t) || typeof pattern !== "string") return null;
    const r = compileRoute(pattern.trim());
    return r && { type: t, pattern: pattern.trim().slice(0, 120), ...r };
  }).filter(Boolean)
    // Most specific first: more fixed segments, then more segments.
    .sort((a, z) => z.literals - a.literals || z.parts.length - a.parts.length);
}

// An icon becomes a standalone SVG document: sanitized, no <style> (inline, it
// would style the whole page), sized, and small.
export function cleanIcon(svg) {
  if (typeof svg !== "string" || !svg.includes("<svg")) return "";
  let s;
  try { s = sanitizeSVG(svg); } catch { return ""; }
  s = s.replace(/<(style|image|use|a|text|textPath)\b[\s\S]*?(?:<\/\1\s*>|\/>)/gi, "").replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
  if (!/viewBox=/.test(s)) s = s.replace(/^<svg\b/, '<svg viewBox="0 0 32 32"');
  s = s.replace(/^<svg\b[^>]*>/, (open) => open.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/g, "").replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"').replace(/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"(?=[^>]*\sxmlns=)/, ""));
  return s.length <= 4000 && /<(?:path|circle|rect|ellipse|polygon|polyline|line)\b/.test(s) ? s : "";
}

// ---------- the spec's CSS ----------
// Model-written CSS reaches the page only through here: no fetches (url(),
// @import, @font-face), no escapes or markup that could end the <style>, no
// rules aimed at Foogle's own UI, nothing fixed over the page, and every
// selector scoped under `scope` (html, body and :root become the scope).
const BAD_VALUE = /url\s*\(|image-set|image\s*\(|element\s*\(|expression|javascript:|vbscript:|@import|behavior|binding|attr\s*\(/i;
const BAD_SELECTOR = /__fv|\bfw-|\.fw\b|#__|\[data-fw|@/i;
const SAFE_AT = /^@(?:media|supports)\b/i;
const KEYFRAMES = /^@(?:-webkit-)?keyframes\s+[\w-]+$/i;

function splitTop(s, sep) {
  const out = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

function declarations(body, { allowFixed = false, structure = false } = {}) {
  return splitTop(body, ";").map((d) => {
    const at = d.indexOf(":");
    if (at === -1) return null;
    const prop = d.slice(0, at).trim().toLowerCase();
    const value = d.slice(at + 1).trim();
    if (!/^(?:--[a-z0-9-]{1,40}|-?[a-z][a-z-]{1,40})$/.test(prop) || !value || value.length > 300) return null;
    if (BAD_VALUE.test(value) || /[{}]/.test(value)) return null;
    if (prop === "position" && /fixed/i.test(value) && !allowFixed) return null;
    if (structure && GEOMETRY.test(prop)) return null;
    return `${prop}:${value}`;
  }).filter(Boolean).join(";");
}

// The renderer owns the page's structure: a spec's CSS may restyle the header,
// rails and main column (colours, borders, type, spacing) but not resize,
// move or re-lay them out, or the layouts the renderer builds would break.
const STRUCTURE = /(?:\.d-(?:page|main|left|right|in|head|foot)|header\.site|footer\.site|^\.dz)(?:[.:#[][^\s>+~]*)?$/;
const GEOMETRY = /^(?:(?:max-|min-)?width|margin(?:-left|-right|-inline.*)?|display|grid(?:-.*)?|float|position|flex(?:-.*)?|order|columns|column-count|left|right|inset|transform|zoom|contain)$/;

function scopeSelector(sel, scope) {
  const s = sel.trim().replace(/\s+/g, " ");
  if (!s || s.length > 200 || BAD_SELECTOR.test(s) || !/^[\w\s.#:>+~*[\]="'()^$|%,-]+$/.test(s)) return null;
  const root = s.match(/^(?:html|:root)(?:\s*>?\s*body)?|^body/i);
  if (root) {
    const rest = s.slice(root[0].length);
    return /^[\s>+~]|^$/.test(rest) ? `${scope}${rest}` : null;
  }
  return `${scope} ${s}`;
}

// Returns [css, rulesKept]. Top-level rules and @media/@supports blocks are
// read with a small brace matcher; anything it can't read is dropped.
function scopeBlock(css, scope, depth) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    let prelude = css.slice(i, open).trim();
    // Declarations written with no selector ("--acc:#c00;header.site{…}")
    // belong to the page as a whole.
    const bare = prelude.lastIndexOf(";");
    if (bare !== -1 && !prelude.startsWith("@")) {
      const decl = declarations(prelude.slice(0, bare), { structure: true });
      if (decl && depth === 0) out.push(`${scope}{${decl}}`);
      prelude = prelude.slice(bare + 1).trim();
    }
    let level = 1, j = open + 1;
    for (; j < css.length && level; j++) { if (css[j] === "{") level++; else if (css[j] === "}") level--; }
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (prelude.startsWith("@")) {
      if (SAFE_AT.test(prelude) && depth < 2 && /^[@\w\s():,.\-%>=<]*$/.test(prelude.replace(/[<>]/g, ""))) {
        const inner = scopeBlock(body, scope, depth + 1);
        if (inner) out.push(`${prelude.replace(/\s+/g, " ")}{${inner}}`);
      } else if (KEYFRAMES.test(prelude) && depth === 0) {
        const frames = [...body.matchAll(/([\w%,\s.]+)\{([^{}]*)\}/g)].map(([, sel, decl]) => `${sel.trim()}{${declarations(decl)}}`).join("");
        if (frames) out.push(`${prelude.replace(/\s+/g, " ")}{${frames}}`);
      }
      continue;
    }
    if (/[{}]/.test(body)) continue;
    const sels = splitTop(prelude, ",").map((s) => scopeSelector(s, scope)).filter(Boolean);
    for (const structure of [false, true]) {
      const group = sels.filter((s) => STRUCTURE.test(s) === structure);
      const decl = group.length && declarations(body, { structure });
      if (decl) out.push(`${group.join(",")}{${decl}}`);
    }
  }
  return out.join("\n");
}

export function sanitizeCSS(css, { scope = ".dz", max = 9000 } = {}) {
  const clean = String(css ?? "")
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
    .replace(/<|\\|&#|@(?:import|charset|namespace)[^;{]*;?/gi, "");
  const out = scopeBlock(clean, scope, 0);
  return out.length > max ? out.slice(0, out.lastIndexOf("}", max) + 1) : out;
}

// ---------- merging a spec's lines ----------
// Each line adds fields; the spec is usable from its first line (the rest have
// defaults), and each later line adds to it. Everything is checked here, so a
// spec from disk or from a test is as safe as one from the model.
export function normalizeSpec(raw, domain) {
  if (!raw || typeof raw !== "object" || raw.real !== true) return null;
  const arch = ARCHES.includes(raw.arch) ? raw.arch : "landing";
  const name = text(raw.name, 40) || hostKey(domain).split(".")[0];
  const c = raw.colors && typeof raw.colors === "object" ? raw.colors : {};
  const l = raw.logo && typeof raw.logo === "object" ? raw.logo : {};
  const font = (f) => (FONTS.includes(f) ? f : null);
  const fonts = Array.isArray(raw.fonts) ? raw.fonts.map(font) : [];
  const caseOf = ["lower", "upper"].includes(l.case) ? l.case : "none";
  const logoText = text(l.text, 40) || name;
  return {
    v: SPEC_VERSION,
    real: true,
    domain: String(domain).toLowerCase(),
    key: hostKey(domain),
    // The URL the spec was written for; `page` is that page's type.
    url: typeof raw.url === "string" ? raw.url.slice(0, 500) : "",
    name,
    arch,
    page: ARCH_PAGES[arch].includes(raw.page) ? raw.page : null,
    tagline: text(raw.tagline, 140),
    voice: text(raw.voice, 300),
    legal: text(raw.legal, 60),
    // Present once the look has arrived; the renderer waits for it.
    look: Boolean(raw.colors || raw.logo),
    colors: {
      bg: hex(c.bg), fg: hex(c.text ?? c.fg), acc: hex(c.accent ?? c.acc), head: hex(c.header), headFg: hex(c.headerText),
      link: hex(c.link), buy: hex(c.button), foot: hex(c.footer), sub: hex(c.subnav),
    },
    fonts: [fonts[0] ?? "sans", fonts[1] ?? fonts[0] ?? "sans"],
    logo: {
      text: caseOf === "lower" ? logoText.toLowerCase() : caseOf === "upper" ? logoText.toUpperCase() : logoText,
      style: LOGO_STYLES.includes(l.style) ? l.style : "word",
      color: hex(l.color), bg: hex(l.bg), fg: hex(l.fg),
      font: font(l.font), weight: Math.round(num(l.weight, 100, 900, 800) / 100) * 100, italic: l.italic === true,
      track: num(l.tracking, -0.2, 0.5, 0), size: num(l.size, 0.6, 2, 1.3),
      colors: (Array.isArray(l.colors) ? l.colors.map(hex).filter(Boolean) : []).slice(0, 12),
      sub: text(l.sub, 40),
    },
    // Present once the header has arrived.
    header: Array.isArray(raw.nav),
    nav: links(raw.nav, 10, 32),
    actions: (Array.isArray(raw.actions) ? raw.actions : []).map((a) => {
      const [label, p] = Array.isArray(a) ? a : [a];
      const s = text(label, 48);
      if (!s || /^\*?\s*(?:small|small line)\s*\|\s*(?:big|big line)$/i.test(s) || s === text(raw.location, 48)) return null;
      const primary = s.startsWith("*");
      const [small, big] = s.replace(/^\*\s*/, "").split("|").map((x) => x.trim());
      return { small: big ? small : "", label: big || small, primary, path: sitePath(p, big || small) };
    }).filter(Boolean).slice(0, 5),
    search: raw.search === "" ? "" : text(raw.search, 48) || null,
    subnav: links(raw.subnav, 12, 32),
    location: text(raw.location, 48),
    promo: text(raw.promo, 140),
    strip: ["scores", "markets"].includes(raw.strip) ? raw.strip : "",
    left: rails(raw.left),
    right: rails(raw.right),
    prefix: text(raw.prefix, 4),
    user: text(raw.user, 4),
    buttons: (Array.isArray(raw.buttons) ? raw.buttons : []).map((b) => text(b, 24)).filter(Boolean).slice(0, 2),
    routes: routes(raw.routes, arch),
    icon: raw.icon === undefined ? null : cleanIcon(raw.icon),
    css: raw.css === undefined ? null : sanitizeCSS(raw.css),
  };
}

// ---------- the registry ----------
// One entry per site: the spec as far as it has streamed, and promises for the
// stages a page waits on: `writers` once the first line says what the site is
// (or that it isn't real), `look` once colours and wordmark are in, `header`
// once the header is, then `routes`, `icon`, `css` and `done`. A part that
// fails still counts as done, so no page waits on it forever. A spec whose
// first part fails is forgotten (a later page may try again); one that says
// "not a real site" is kept.
const STAGES = ["writers", "look", "header", "routes", "icon", "css", "done"];
const HAS = {
  writers: (r) => r.real === false || (r.real === true && r.arch !== undefined),
  look: (r) => r.real === false || r.colors !== undefined || r.logo !== undefined,
  header: (r) => r.real === false || r.nav !== undefined,
  routes: (r) => r.real === false || r.routes !== undefined,
  icon: (r) => r.real === false || r.icon !== undefined,
  css: (r) => r.real === false || r.css !== undefined,
};
const PART_STAGES = { about: ["writers"], look: ["look"], header: ["header"], icon: ["icon"], style: ["routes", "css"] };

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPEC_DIR = OFFLINE ? null : process.env.FOOGLE_SPEC_CACHE || path.join(here, "..", ".foogle-cache", "sites");

export function createSiteSpecs({ stream = streamText, dir = SPEC_DIR, max = 500, log = console } = {}) {
  const entries = new Map(); // hostKey -> entry
  const file = (key) => path.join(dir, `${createHash("sha1").update(`${SPEC_VERSION}|${config.model}|${key}`).digest("hex")}.json`);
  let dirReady = null;

  function remember(key, entry) {
    if (entries.size >= max) entries.delete(entries.keys().next().value);
    entries.set(key, entry);
  }

  function makeEntry(key, domain) {
    const entry = { key, domain, raw: {}, spec: null, real: null, failed: false, stage: new Set(), waiters: [], listeners: new Set() };
    const signal = () => {
      for (const s of STAGES) if (!entry.stage.has(s) && s !== "done" && HAS[s](entry.raw)) entry.stage.add(s);
      entry.real = entry.raw.real === true ? true : entry.raw.real === false ? false : null;
      entry.spec = entry.real ? normalizeSpec(entry.raw, domain) : null;
      entry.waiters = entry.waiters.filter((w) => { if (entry.stage.has(w.stage) || entry.stage.has("done")) { w.resolve(); return false; } return true; });
      for (const fn of entry.listeners) fn(entry);
    };
    entry.add = (obj) => { Object.assign(entry.raw, obj); signal(); };
    entry.partDone = (part) => { for (const st of PART_STAGES[part] ?? []) entry.stage.add(st); signal(); };
    entry.finish = (failed = false) => {
      entry.failed = failed;
      entry.stage.add("done");
      signal();
    };
    // Resolves when the stage is reached or the spec ends (check entry.real).
    entry.at = (stage) => (entry.stage.has(stage) || entry.stage.has("done") ? Promise.resolve() : new Promise((resolve) => entry.waiters.push({ stage, resolve })));
    return entry;
  }

  async function fromDisk(key, domain) {
    if (!dir) return null;
    try {
      const saved = JSON.parse(await fs.readFile(file(key), "utf8"));
      if (saved.v !== SPEC_VERSION || !saved.raw) return null;
      const entry = makeEntry(key, domain);
      entry.add(saved.raw);
      entry.finish();
      return entry;
    } catch { return null; }
  }

  function toDisk(key, raw) {
    if (!dir) return;
    dirReady ??= fs.mkdir(dir, { recursive: true }).catch(() => {});
    const f = file(key);
    dirReady.then(() => fs.writeFile(`${f}.tmp`, JSON.stringify({ v: SPEC_VERSION, raw })).then(() => fs.rename(`${f}.tmp`, f)))
      .catch((err) => log.warn(`[site] disk cache write failed: ${err.message}`));
  }

  // One part of the spec, streamed line by line into the entry. Only the
  // "about" part may say whether the site is real; the others stop as soon
  // as it says it isn't.
  async function writePart(entry, part, url, known = null) {
    let buf = "", all = "";
    const take = (line) => {
      const l = line.trim().replace(/^```\w*|```$/g, "").replace(/,\s*$/, "");
      if (!l.startsWith("{")) return;
      let obj;
      try { obj = JSON.parse(l); } catch { return; } // a broken line; the rest still count
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
      if (part !== "about") delete obj.real;
      entry.add(obj);
    };
    for await (const delta of stream({ ...siteSpecPrompt({ domain: entry.domain, url, part, known }), maxTokens: part === "style" ? 1400 : 600, temperature: 0.3 })) {
      buf += delta;
      all += delta;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      if (entry.raw.real === false) return;
    }
    take(buf);
    // A model that ignored the line format still counts, as one object.
    if (part === "about" && entry.raw.real === undefined) {
      try { const o = extractJSON(all); if (o && typeof o === "object") entry.add(o); } catch { /* nothing usable */ }
    }
    if (part === "about" && entry.raw.real === undefined) throw new Error("no spec in the reply");
  }

  async function generate(entry, { url }) {
    const t0 = Date.now();
    entry.add({ url });
    const run = (part, known) => writePart(entry, part, url, known).finally(() => entry.partDone(part));
    const first = ["about", "look", "header", "icon"].map((part) => run(part));
    // The style part starts once the site's structure and look are known.
    const style = Promise.allSettled(first.slice(0, 2)).then(() => (entry.raw.real === true ? run("style", entry.raw) : entry.partDone("style")));
    const results = await Promise.allSettled([...first, style]);
    const failed = results.map((r, i) => r.status === "rejected" && `${SPEC_PARTS[i]}: ${r.reason?.message}`).filter(Boolean);
    if (entry.raw.real === undefined) {
      log.warn(`[site] ${entry.key}: ${failed.join("; ")}`);
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
      entry.finish(true);
      return;
    }
    log.log(`[site] ${entry.key}: ${entry.real ? `${entry.spec.name} (${entry.spec.arch}), ${((Date.now() - t0) / 1000).toFixed(1)}s` : "not a real site"}${failed.length ? ` (failed: ${failed.join("; ")})` : ""}`);
    entry.finish(failed.length > 0);
    // A spec missing a part is used, but not kept: the next server tries again.
    if (!failed.length) toDisk(entry.key, entry.raw);
  }

  return {
    // The entry for a domain if one exists in memory (never starts one).
    peek: (domain) => entries.get(hostKey(domain)) ?? null,
    // The spec so far, if the site is known to be real.
    spec: (domain) => entries.get(hostKey(domain))?.spec ?? null,
    // The entry in memory or on disk, or null.
    async lookup(domain) {
      const key = hostKey(domain);
      const hit = entries.get(key);
      if (hit) return hit;
      const disk = await fromDisk(key, domain);
      if (disk && !entries.has(key)) remember(key, disk);
      return entries.get(key) ?? null;
    },
    // Join the spec for a domain, or start writing it.
    start(domain, { url } = {}) {
      const key = hostKey(domain);
      const hit = entries.get(key);
      if (hit) return hit;
      const entry = makeEntry(key, String(domain).toLowerCase());
      remember(key, entry);
      (async () => {
        const disk = await fromDisk(key, domain);
        if (disk) { entry.add(disk.raw); entry.finish(); return; }
        await generate(entry, { url: url || `https://${domain}/` });
      })();
      return entry;
    },
    // For tests: a finished spec.
    put(domain, raw) {
      const key = hostKey(domain);
      const entry = makeEntry(key, domain);
      entry.add(raw);
      entry.finish();
      remember(key, entry);
      return entry;
    },
    clear: () => entries.clear(),
  };
}

export const siteSpecs = createSiteSpecs();
