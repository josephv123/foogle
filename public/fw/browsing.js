// What Foogle's browser knows about addresses, shared by the server
// (lib/browserbar.js) and the browser's own script (browserbar.js): the URL a
// real browser would show for a Foogle path, what typing in the address bar
// does, and the suggestions under it. No DOM and no Node APIs, so both can
// import it.

export const FOOGLE_HOST = "www.foogle.com";

// ---------- a Foogle path -> the URL a real browser would show ----------
// Foogle's context on a result link (see webHref in server.js); not part of
// the site's own URL.
const CONTEXT = new Set(["fq", "ft", "fs", "fk"]);
const paramName = (pair) => {
  try { return decodeURIComponent(pair.split("=")[0].replace(/\+/g, " ")); } catch { return pair; }
};

// Percent-escaped UTF-8 is shown as the characters it spells, as address
// bars do; escaped ASCII (%20, %2F, %26) stays escaped, so the URL still
// means the same thing when copied.
const readable = (s) => s.replace(/(?:%[89a-f][\da-f])+/gi, (run) => {
  try { return decodeURIComponent(run); } catch { return run; }
});

// "/web/crumbforum.net/threads/x?fq=…" -> { host: "crumbforum.net", path: "/threads/x", site: true }
// "/search?q=bread" -> { host: "www.foogle.com", path: "/search?q=bread", site: false }
export function addressOf(foogleUrl) {
  let raw = String(foogleUrl || "/");
  const hashAt = raw.indexOf("#");
  const hash = hashAt === -1 ? "" : raw.slice(hashAt);
  if (hashAt !== -1) raw = raw.slice(0, hashAt);
  const at = raw.indexOf("?");
  const pathname = at === -1 ? raw : raw.slice(0, at);
  let search = at === -1 ? "" : raw.slice(at + 1);
  const web = pathname.match(/^\/web\/([^/]+)(\/.*)?$/);
  if (!web) return { host: FOOGLE_HOST, path: readable(`${pathname}${search ? `?${search}` : ""}${hash}`), site: false };
  search = search.split("&").filter((p) => p && !CONTEXT.has(paramName(p))).join("&");
  return { host: readable(web[1]).toLowerCase(), path: readable(`${web[2] || "/"}${search ? `?${search}` : ""}${hash}`), site: true };
}

export const displayURL = (foogleUrl) => {
  const { host, path } = addressOf(foogleUrl);
  return `https://${host}${path}`;
};

// Foogle's homepage, which the browser treats as its new-tab page.
export const isHome = (foogleUrl) => /^\/(?:#.*)?$/.test(String(foogleUrl));

// The same, the way a suggestion or a tab shows it: no scheme, no lone "/".
const shortURL = (foogleUrl) => {
  const { host, path } = addressOf(foogleUrl);
  return `${host}${path === "/" ? "" : path}`;
};

// What a tab says until its page's <title> arrives: the result title the
// visitor clicked, or the address, as a browser shows while a page loads.
const FOOGLE_TABS = { "/search": "Search", "/images": "Images", "/news": "News", "/maps": "Maps", "/timelines": "Timelines" };
export function tabTitle(foogleUrl) {
  const u = new URL(String(foogleUrl || "/"), "http://foogle.invalid");
  if (addressOf(foogleUrl).site) return u.searchParams.get("ft") || shortURL(foogleUrl);
  const q = u.searchParams.get("q");
  return q && FOOGLE_TABS[u.pathname] ? `${q} - Foogle ${FOOGLE_TABS[u.pathname]}` : "Foogle";
}

export const svgImage = (svg) =>
  `data:image/svg+xml,${encodeURIComponent(svg.replace(/^<svg (?!xmlns)/, '<svg xmlns="http://www.w3.org/2000/svg" '))}`;
export const FOOGLE_ICON = svgImage(`<svg viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#fff"/><path fill="#4285f4" d="M4 2h3v12H4z"/><path fill="#ea4335" d="M4 2h8.5v3H4z"/><path fill="#fbbc05" d="M7 7h4.5v3H7z"/><path fill="#34a853" d="M4 12h3v2H4z"/></svg>`);

// ---------- what typing in the address bar does ----------
// Like Chrome with Google: something shaped like a URL or a domain goes to
// that site (on the fake web), anything else is a Foogle search. Targets are
// always paths on Foogle's own origin, never absolute or protocol-relative.
const LABEL = /^(?!-)[\p{L}\p{N}-]{1,63}(?<!-)$/u;
const TLD = /^(?:\p{L}{2,63}|xn--[a-z\d-]{1,59})$/iu;
// "node.js" and "notes.txt" are file names people search for, not sites.
const FILE_TYPES = new Set(("js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp cs php sh bat ps1 json yml yaml toml xml ini " +
  "md txt csv log html htm css scss pdf doc docx xls xlsx ppt pptx png jpg jpeg gif svg webp heic mp3 wav mp4 mov avi mkv zip tar gz exe dmg apk iso").split(" "));

function looksLikeHost(host) {
  const name = host.replace(/:\d{1,5}$/, "").toLowerCase();
  if (name === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(name) || /^\[[\da-f:.]+\]$/.test(name)) return true;
  const labels = name.split(".");
  return labels.length > 1 && labels.every((l) => LABEL.test(l)) && TLD.test(labels.at(-1));
}

export const searchPath = (q) => (q ? `/search?${new URLSearchParams({ q })}` : "/");

// -> { kind: "url" | "search" | "empty", target }. `here` is the host Foogle
// is being browsed on (localhost:3000, a LAN address): a pasted Foogle link
// stays on Foogle.
export function classify(input, { here = "" } = {}) {
  const text = String(input ?? "").trim();
  const search = (q) => ({ kind: q ? "search" : "empty", target: searchPath(q) });
  if (!text) return search("");
  if (text.startsWith("?")) return search(text.slice(1).trim()); // "?term" forces a search
  if (/^\/(?![/\\])[^\s\\]*$/.test(text)) return { kind: "url", target: text }; // a path on Foogle itself
  const scheme = text.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1].toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return search(text);
  const rest = scheme ? text.slice(scheme.length + 3) : text;
  const host = rest.split(/[/?#]/)[0];
  if (!scheme) {
    if (/\s/.test(text) || host.includes("@") || !looksLikeHost(host)) return search(text);
    const labels = host.split(".");
    if (host === rest && labels.length === 2 && FILE_TYPES.has(labels[1].toLowerCase())) return search(text);
  }
  let url;
  try { url = new URL(`https://${rest}`); } catch { return search(text); }
  if (!url.hostname) return search(text);
  const pathname = url.pathname.replace(/^\/+/, "/");
  const tail = `${url.search}${url.hash}`;
  if (url.host === String(here).toLowerCase() || /^(?:www\.)?foogle\.com$/.test(url.hostname)) return { kind: "url", target: `${pathname}${tail}` };
  return { kind: "url", target: `/web/${url.host}${pathname === "/" ? "" : pathname}${tail}` };
}

export const omniboxTarget = (input, opts) => classify(input, opts).target;

// ---------- suggestions ----------
// Known sites the text names come from the server (/api/sites, built on
// lib/brands.js); the rest are worked out here.
// A suggestion row: { kind: "url" | "search" | "recent" | "site", label, detail, fill, target }.
// `fill` is what the address field shows while the row is picked with the
// arrow keys.

// The first rows, the first being what plain Enter does: go to the URL when
// the text is one, otherwise search.
export function primaryRows(input, { here = "" } = {}) {
  const text = String(input ?? "").trim();
  const { kind, target } = classify(text, { here });
  if (kind === "empty") return [];
  const search = { kind: "search", label: `Search Foogle for "${text}"`, detail: "", fill: text, target: searchPath(text) };
  return kind === "url" ? [{ kind: "url", label: shortURL(target), detail: "", fill: text, target }, search] : [search];
}

// The visitor's recent searches (newest first) that start with the text.
export function recentRows(input, recent, limit = 3) {
  const key = String(input ?? "").trim().toLowerCase();
  if (!key || !Array.isArray(recent)) return [];
  return recent.filter((q) => typeof q === "string" && q.trim() && q.toLowerCase().startsWith(key)).slice(0, limit)
    .map((q) => ({ kind: "recent", label: q, detail: "", fill: q, target: searchPath(q) }));
}

// `recent` with `query` moved to the front, once, case-insensitively.
export function rememberSearch(recent, query, max = 20) {
  const q = String(query ?? "").trim();
  const rest = (Array.isArray(recent) ? recent : []).filter((r) => typeof r === "string" && r.toLowerCase() !== q.toLowerCase());
  return q ? [q, ...rest].slice(0, max) : rest;
}
