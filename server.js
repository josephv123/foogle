import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { streamText, completeText, generateImage, extractJSON, config, onUsage } from "./lib/llm.js";
import { imageSpec, imageKey, imageQuery, SHAPES, NEWS_STYLES } from "./lib/images.js";
import {
  mapsResultsPrompt, timelineResultsPrompt, searchShardPrompt, newsShardPrompt, imageShardPrompt, overviewPrompt,
  SEARCH_ANGLES, NEWS_ANGLES, IMAGE_ANGLES,
} from "./lib/prompts.js";
import { generatePage } from "./lib/pages.js";
import { siteMark } from "./lib/icons.js";
import { PAGE_CSP } from "./lib/widgets.js";
import { browserBar, browserBarRoutes } from "./lib/browserbar.js";
import {
  createState, interactRoutes, visitor, replyWriter,
  submissionTitle, submissionSummary, responseBriefs, receiptSection,
} from "./lib/interact.js";
import { createLimits } from "./lib/limits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
// Per-visitor rate limits and the daily budget (lib/limits.js). Routes ask
// limits.allow() only on a cache miss, so cached responses are free.
const limits = createLimits();
onUsage(limits.record);
// ---------- caches ----------
const CACHE_MAX = 200;
const IMG_CACHE_MAX = 60;
const pageCache = new Map(); // "/domain.tld/path" -> full HTML
const serpCache = new Map(); // "<tab>:<query>" -> full HTML
const imageCache = new Map(); // imageKey(spec) -> { mime, buf }
const inflight = new Map(); // page path -> live generation entry (chunks so far)
const imageInflight = new Map(); // imageKey(spec) -> Promise<{mime, buf}>
const siteContext = new Map(); // domain -> { query, title } from first visit
// Carts, logins, comments and form submissions on the fake sites.
const siteState = createState({ reply: replyWriter(completeText) });

// Pages for the top results of a search start generating as soon as those
// results render, so the likeliest clicks open instantly.
const PREFETCH_PAGES = 2;
// Search, News and Images split their results over this many concurrent calls.
const SHARDS = 3;

function cachePut(cache, key, value, max = CACHE_MAX) {
  if (cache.size >= max) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Turn an invented absolute URL into a browsable /web/ path.
function toWebPath(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `/web/${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return `/web/${String(rawUrl).replace(/^\/+/, "")}`;
  }
}

function webHref(query, { url, title, snippet, kind }) {
  return `${toWebPath(url)}?fq=${encodeURIComponent(query)}&ft=${encodeURIComponent(title ?? "")}&fs=${encodeURIComponent(snippet ?? "")}${kind ? `&fk=${encodeURIComponent(kind)}` : ""}`;
}

// A picture's medium and shape ride in its URL (see lib/images.js); without
// them /img infers a style from the description.
const imgSrc = (prompt, spec) => `/img/${encodeURIComponent(String(prompt ?? "").slice(0, 600))}${spec ? `?${imageQuery(spec)}` : ""}`;

// Parse one streamed JSONL line. Tolerates array framing ("[", "],", trailing commas).
function parseJSONLine(line) {
  line = line.trim().replace(/,\s*$/, "");
  if (!line.startsWith("{")) return null;
  try {
    const obj = JSON.parse(line);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

// Stream a JSONL prompt, yielding objects as each line completes.
// If the model ignored the line format entirely, salvages with a whole-text parse at the end.
async function* streamJSONL(promptSpec, maxTokens = 2500) {
  let buffer = "";
  let raw = "";
  let count = 0;
  for await (const delta of streamText({ ...promptSpec, maxTokens, temperature: config.tempResults })) {
    buffer += delta;
    raw += delta;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const obj = parseJSONLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (obj) {
        count++;
        yield obj;
      }
    }
  }
  const last = parseJSONLine(buffer);
  if (last) {
    count++;
    yield last;
  }
  if (count === 0) {
    for (const obj of [].concat(extractJSON(raw))) {
      if (obj && typeof obj === "object") yield obj;
    }
  }
}

// Interleave several async iterables, yielding whichever produces next. A shard
// that throws is dropped rather than taking the page down with it — eight
// results from three shards beats an error page because one shard ran on.
async function* mergeAsync(iterables) {
  const its = iterables.map((it) => it[Symbol.asyncIterator]());
  const pending = new Map();
  const pull = (i) => pending.set(i, its[i].next().then((r) => ({ i, r }), (err) => ({ i, err })));
  its.forEach((_, i) => pull(i));
  while (pending.size) {
    const { i, r, err } = await Promise.race(pending.values());
    pending.delete(i);
    if (err) {
      console.warn(`[shard ${i}] ${err.message}`);
      continue;
    }
    if (r.done) continue;
    pull(i);
    yield r.value;
  }
}

// Spread `total` items over `shards` workers as evenly as possible.
const shardCounts = (total, shards) =>
  Array.from({ length: shards }, (_, i) => Math.floor(total / shards) + (i < total % shards ? 1 : 0)).filter((n) => n > 0);

function setupPage() {
  return `<!DOCTYPE html><html><head><title>Foogle — setup</title></head>
<body style="font-family:arial,sans-serif;max-width:600px;margin:80px auto;color:#202124">
<h1 style="font-weight:500"><span style="color:#4285f4">F</span><span style="color:#ea4335">o</span><span style="color:#fbbc05">o</span><span style="color:#4285f4">g</span><span style="color:#34a853">l</span><span style="color:#ea4335">e</span> isn't connected yet</h1>
<p>Set your OpenRouter key and restart:</p>
<pre style="background:#f8f9fa;padding:16px;border-radius:8px">cp .env.example .env   # then edit it
OPENROUTER_API_KEY=...
npm start</pre>
<p>Optional: <code>TYPESAFE_API_KEY</code> lets Jev pick each site's layout.</p>
</body></html>`;
}

function collapseFragment(message) {
  return `<div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#202124;color:#fff;font-family:arial,sans-serif;font-size:14px;padding:14px 22px;border-radius:24px;box-shadow:0 4px 12px rgba(0,0,0,.3);z-index:99999">
This corner of the future web collapsed mid-construction (${esc(message)}). <a href="javascript:history.back()" style="color:#8ab4f8">Go back</a></div></body></html>`;
}

// ---------- shared results-page shell ----------
const TABS = [
  ["All", "/search"],
  ["Images", "/images"],
  ["News", "/news"],
  ["Maps", "/maps"],
  ["Timelines", "/timelines"],
];

function shell(query, active, page = 1, { aside = false } = {}) {
  const q = esc(query);
  const eq = encodeURIComponent(query);
  const tabs =
    TABS.map(([label, href]) =>
      label === active
        ? `<a class="active" href="${href}?q=${eq}">${label}</a>`
        : `<a href="${href}?q=${eq}">${label}</a>`,
    ).join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${q} - Foogle ${active === "All" ? "Search" : active}${page > 1 ? ` (page ${page})` : ""}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: arial, sans-serif; color: #202124; }
.header { padding: 20px 0 0 20px; display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
.logo { font-size: 28px; font-weight: 500; letter-spacing: -1.5px; text-decoration: none; }
.logo .b1{color:#4285f4}.logo .r{color:#ea4335}.logo .y{color:#fbbc05}.logo .g{color:#34a853}
.searchbox { display: flex; align-items: center; width: min(584px, 90vw); height: 44px; border: 1px solid #dfe1e5; border-radius: 22px; padding: 0 16px; box-shadow: 0 1px 6px rgba(32,33,36,.18); }
.searchbox input { flex: 1; border: none; outline: none; font-size: 16px; }
.searchbox button { border: none; background: none; cursor: pointer; padding: 0 0 0 10px; }
.tabs { display: flex; gap: 24px; margin: 16px 0 0 182px; font-size: 13px; color: #5f6368; border-bottom: 1px solid #ebebeb; }
.tabs a { padding-bottom: 10px; color: inherit; text-decoration: none; }
.tabs .active { color: #1a73e8; border-bottom: 3px solid #1a73e8; font-weight: 500; }
.stats { margin: 14px 0 6px 182px; font-size: 13px; color: #70757a; }
.results { margin: 0 20px 60px 182px; max-width: 600px; }
.result { margin-top: 26px; }
.result .url { font-size: 13px; color: #202124; }
.result .url .crumb { color: #5f6368; }
.result h3 { font-size: 20px; font-weight: 400; margin: 4px 0 3px; }
.result h3 a { color: #1a0dab; text-decoration: none; }
.result h3 a:visited { color: #609; }
.result h3 a:hover { text-decoration: underline; }
.result .snippet { font-size: 14px; line-height: 1.57; color: #4d5156; }
.news { margin: 20px 20px 60px 182px; max-width: 652px; }
.ncard { display: flex; justify-content: space-between; gap: 16px; border: 1px solid #dadce0; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; text-decoration: none; color: inherit; }
.ncard:hover { box-shadow: 0 1px 6px rgba(32,33,36,.18); }
.nsrc { font-size: 12px; }
.nhead { font-size: 16px; margin: 4px 0; color: #1a0dab; line-height: 1.3; }
.nsnip { font-size: 13px; color: #4d5156; line-height: 1.4; }
.nage { font-size: 12px; color: #70757a; margin-top: 6px; }
.nthumb { width: 112px; height: 112px; border-radius: 8px; object-fit: cover; background: #f1f3f4; flex-shrink: 0; }
.nthumb, .tile img { opacity: 0; transition: opacity .5s; }
.nthumb.ld, .tile img.ld { opacity: 1; }
.grid { margin: 20px 20px 60px 182px; display: flex; flex-wrap: wrap; gap: 18px 12px; max-width: 1180px; align-items: flex-start; }
.grid::after { content: ""; flex: 1e4 1 0; }
.tile { flex: 1.333 1 240px; min-width: 0; text-decoration: none; color: inherit; }
.tile img { width: 100%; height: auto; aspect-ratio: 4/3; object-fit: cover; border-radius: 10px; background: #f1f3f4; display: block; }
.tcap { font-size: 13px; margin-top: 5px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tsite { font-size: 12px; color: #70757a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.maps { margin: 20px 20px 60px 182px; display: flex; gap: 28px; align-items: flex-start; max-width: 1100px; }
.places { flex: 1; max-width: 560px; }
.place { display: flex; gap: 14px; padding: 16px 0; border-bottom: 1px solid #ebebeb; text-decoration: none; color: inherit; }
.place:hover .pname { text-decoration: underline; }
.pin { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: #ea4335; color: #fff; font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center; }
.pin b { transform: rotate(45deg); }
.pname { font-size: 18px; color: #1a0dab; }
.prate { font-size: 14px; color: #70757a; margin: 3px 0; }
.prate .stars { color: #fbbc05; letter-spacing: 1px; }
.pmeta, .pblurb { font-size: 14px; color: #4d5156; line-height: 1.45; }
.pmeta .open { color: #188038; } .pmeta .closed { color: #d93025; }
.pblurb { font-style: italic; margin-top: 4px; }
.map { order: 2; flex: 0 0 480px; height: 400px; position: sticky; top: 20px; border-radius: 12px; border: 1px solid #dadce0; background: #f1f3f4; object-fit: cover; opacity: 0; transition: opacity .5s; }
.map.ld { opacity: 1; }
.timeline { margin: 26px 20px 60px 182px; max-width: 640px; border-left: 2px solid #dadce0; padding-left: 26px; }
.event { position: relative; display: block; margin-bottom: 26px; text-decoration: none; color: inherit; }
.event::before { content: ""; position: absolute; left: -34px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #1a73e8; }
.event.future::before { background: #1a73e8; }
.edate { font-size: 13px; font-weight: bold; color: #1a73e8; letter-spacing: .02em; }
.ehead { font-size: 18px; color: #1a0dab; margin: 3px 0; }
.event:hover .ehead { text-decoration: underline; }
.edetail { font-size: 14px; color: #4d5156; line-height: 1.5; }
.esrc { font-size: 12px; color: #70757a; margin-top: 4px; }
.pager { margin: 10px 20px 60px 182px; max-width: 600px; display: flex; flex-direction: column; align-items: center; }
.pager .word { font-size: 30px; font-weight: 500; letter-spacing: -1.5px; user-select: none; }
.pager .nums { display: flex; gap: 14px; font-size: 14px; margin-top: 4px; }
.pager .nums a { color: #1a0dab; text-decoration: none; } .pager .nums a:hover { text-decoration: underline; }
.pager .nums b { color: #202124; }
.pager .word .b1{color:#4285f4}.pager .word .r{color:#ea4335}.pager .word .y{color:#fbbc05}.pager .word .g{color:#34a853}
#shimmer { margin: 40px 0 0 182px; max-width: 600px; }
.bar { height: 16px; border-radius: 4px; margin-bottom: 14px; background: linear-gradient(90deg, #f1f3f4 25%, #e3e6e8 50%, #f1f3f4 75%); background-size: 200% 100%; animation: sh 1.2s infinite; }
#shimmer .note { font-size: 13px; color: #70757a; margin-bottom: 18px; }
@keyframes sh { from { background-position: 200% 0 } to { background-position: -200% 0 } }
.result .src { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.result .mark { flex-shrink: 0; display: block; }
.sname { font-size: 14px; color: #202124; line-height: 1.3; }
.result .src .url { font-size: 12px; color: #4d5156; line-height: 1.3; }
.result .src .url .crumb { color: #4d5156; }
.rdate { color: #70757a; }
.rmeta { font-size: 13px; color: #70757a; margin-top: 5px; }
.rkind { display: inline-block; border: 1px solid #dadce0; border-radius: 10px; padding: 0 8px; margin-right: 6px; font-size: 12px; color: #4d5156; }
.rmeta .star { color: #e7a900; }
.sitelinks { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sitelinks a { font-size: 14px; color: #1a0dab; text-decoration: none; border: 1px solid #dadce0; border-radius: 16px; padding: 5px 13px; }
.sitelinks a:hover { background: #f1f3f4; }
.serp.has-aside { display: grid; grid-template-columns: minmax(0, 652px) 372px; column-gap: 64px; margin: 0 20px 0 182px; align-items: start; }
.serp.has-aside > * { grid-column: 1; margin-left: 0; margin-right: 0; }
.serp.has-aside > #shimmer { margin-left: 0; }
.serp.has-aside > .kp { grid-column: 2; grid-row: 1 / span 40; margin-top: 24px; }
.kp-card { border: 1px solid #dadce0; border-radius: 14px; padding: 18px 20px; margin-bottom: 16px; }
.kp-label { font-size: 13px; color: #5f6368; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
.kp-label b { background: linear-gradient(90deg, #4285f4, #9b72cb, #d96570); -webkit-background-clip: text; background-clip: text; color: transparent; font-size: 16px; }
.kp h2 { font-size: 26px; font-weight: 400; line-height: 1.2; }
.kp-sub { font-size: 14px; color: #70757a; margin: 2px 0 12px; }
.kp-sum { font-size: 14px; line-height: 1.62; color: #202124; }
.kp-facts { margin-top: 12px; border-top: 1px solid #ebebeb; padding-top: 8px; font-size: 14px; line-height: 1.5; }
.kp-facts div { padding: 3px 0; } .kp-facts dt { display: inline; font-weight: bold; } .kp-facts dt::after { content: ": "; } .kp-facts dd { display: inline; color: #4d5156; }
.kp h3 { font-size: 18px; font-weight: 400; margin-bottom: 4px; }
.kp details { border-top: 1px solid #ebebeb; }
.kp summary { cursor: pointer; padding: 12px 0; font-size: 15px; list-style: none; display: flex; justify-content: space-between; gap: 12px; }
.kp summary::-webkit-details-marker { display: none; }
.kp summary::after { content: "⌄"; color: #5f6368; transition: transform .2s; }
.kp details[open] summary::after { transform: rotate(180deg); }
.kp details p { font-size: 14px; color: #4d5156; line-height: 1.55; padding-bottom: 12px; }
.kp.ld .kp-card { animation: kpin .35s ease-out both; }
@keyframes kpin { from { opacity: 0; transform: translateY(6px); } }
.related { margin: 34px 0 10px; max-width: 600px; }
.related h3 { font-size: 20px; font-weight: 400; margin-bottom: 14px; }
.related .chips { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.related a { display: flex; align-items: center; gap: 12px; background: #f1f3f4; border-radius: 22px; padding: 10px 16px; color: #202124; text-decoration: none; font-size: 14px; }
.related a:hover { background: #e8eaed; }
.related a svg { flex-shrink: 0; }
@media (max-width: 1100px) { .serp.has-aside { display: flex; flex-direction: column; } .serp.has-aside > .kp { order: 9; margin-top: 0; max-width: 600px; } .serp.has-aside > .related, .serp.has-aside > .pager { order: 10; } }
@media (max-width: 700px) { .serp.has-aside { margin-left: 20px; } .related .chips { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .tabs, .stats, .results, .news, .grid, .maps, .timeline, .pager, #shimmer { margin-left: 20px; } .maps { flex-direction: column; } .map { order: 0; flex-basis: auto; width: 100%; height: 280px; position: static; } }
</style></head><body>
<div class="header">
  <a class="logo" href="/"><span class="b1">F</span><span class="r">o</span><span class="y">o</span><span class="b1">g</span><span class="g">l</span><span class="r">e</span></a>
  <form action="${TABS.find(([l]) => l === active)?.[1] ?? "/search"}" method="get" style="flex:1;min-width:280px;max-width:584px">
    <div class="searchbox">
      <input type="text" name="q" value="${q}" autocomplete="off">
      <button type="submit" aria-label="Search"><svg height="22" width="22" viewBox="0 0 24 24"><path fill="#4285f4" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></button>
    </div>
  </form>
</div>
<div class="tabs">${tabs}</div>
<div class="serp${aside ? " has-aside" : ""}">${aside ? KP_LOADING : ""}
<div id="shimmer"><div class="note">Searching the future web…</div><div class="bar" style="width:62%"></div><div class="bar" style="width:88%"></div><div class="bar" style="width:74%"></div><div class="bar" style="width:81%"></div><div class="bar" style="width:55%"></div></div>
`;
}

// Chrome prerenders /web/ links on hover — generation streams into a hidden
// page, so the click swaps in an already-rendering document. Other browsers
// fall back to the fetch-warm script below.
const SHELL_TAIL = `</div>
<script type="speculationrules">{"prerender":[{"where":{"href_matches":"/web/*"},"eagerness":"moderate"}]}</script>
<script>
(() => {
  const seen = new Set();
  const warm = (a) => { if (seen.has(a.href)) return; seen.add(a.href); fetch(a.href).catch(() => {}); };
  let t;
  document.addEventListener("mouseover", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="/web/"]');
    if (!a) return;
    clearTimeout(t);
    t = setTimeout(() => warm(a), 150);
  });
  document.addEventListener("mouseout", () => clearTimeout(t));
  document.addEventListener("touchstart", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="/web/"]');
    if (a) warm(a);
  }, { passive: true });
})();
</script>
</body></html>`;

// ---------- per-tab item renderers ----------
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const RESULT_KINDS = {
  guide: "Guide", forum: "Forum", store: "Store", tool: "Tool", video: "▶ Video", wiki: "Wiki", news: "News", blog: "Blog",
  gov: "Official", paper: "Paper", recipe: "Recipe", event: "Event", map: "Map", archive: "Archive",
};

function renderResultItem(query, r) {
  let crumbs = esc(r.url);
  let host = "";
  try {
    const u = new URL(r.url);
    host = u.host.replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    crumbs = `${esc(u.origin)}${parts.map((p) => ` <span class="crumb">› ${esc(decodeURIComponent(p))}</span>`).join("")}`;
  } catch { /* keep raw */ }
  const name = String(r.site || host || r.title).trim();
  const kind = RESULT_KINDS[String(r.kind ?? "").toLowerCase()];
  const href = esc(webHref(query, r));
  const meta = [kind && `<span class="rkind">${esc(kind)}</span>`, r.meta && esc(r.meta).replace(/★/g, '<span class="star">★</span>')].filter(Boolean).join("");
  const links = Array.isArray(r.links) && host
    ? r.links.slice(0, 4).filter((l) => slugify(l)).map((l) => `<a href="${esc(webHref(query, { url: siteURL(host, `/${slugify(l)}`), title: `${l} — ${name}`, kind: r.kind }))}">${esc(l)}</a>`).join("")
    : "";
  return `<div class="result">
  <a class="src" href="${href}" tabindex="-1">${siteMark(host || name, { kind: r.kind })}<div><div class="sname">${esc(name)}</div><div class="url">${crumbs}</div></div></a>
  <h3><a href="${href}">${esc(r.title)}</a></h3>
  <div class="snippet">${r.date ? `<span class="rdate">${esc(r.date)} — </span>` : ""}${esc(r.snippet)}</div>
  ${meta ? `<div class="rmeta">${meta}</div>` : ""}${links ? `<div class="sitelinks">${links}</div>` : ""}
</div>
`;
}

// ---------- Foogle Overview (right-hand panel on the All tab) ----------
const KP_LOADING = `<aside id="kp" class="kp"><div class="kp-card"><div class="kp-label"><b>✦</b> Foogle Overview</div><div class="bar" style="width:60%"></div><div class="bar" style="width:92%"></div><div class="bar" style="width:84%"></div><div class="bar" style="width:70%"></div></div></aside>`;

async function fetchOverview(query) {
  const text = await completeText({ ...overviewPrompt(query), maxTokens: 900, temperature: config.tempPages });
  const o = extractJSON(text);
  if (!o || typeof o !== "object" || !o.summary) throw new Error("overview missing summary");
  return o;
}

function renderOverview(query, o) {
  const facts = (Array.isArray(o.facts) ? o.facts : []).filter((f) => Array.isArray(f) && f.length >= 2).slice(0, 5);
  const asks = (Array.isArray(o.ask) ? o.ask : []).filter((a) => a?.q && a?.a).slice(0, 4);
  const card = `<div class="kp-card"><div class="kp-label"><b>✦</b> Foogle Overview</div>
<h2>${esc(o.title || query)}</h2>${o.subtitle ? `<div class="kp-sub">${esc(o.subtitle)}</div>` : ""}
<p class="kp-sum">${esc(o.summary)}</p>
${facts.length ? `<dl class="kp-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}</div>`;
  const paa = asks.length
    ? `<div class="kp-card"><h3>People also ask</h3>${asks.map((a) => `<details><summary>${esc(a.q)}</summary><p>${esc(a.a)} <a href="/search?q=${encodeURIComponent(a.q)}">More results</a></p></details>`).join("")}</div>`
    : "";
  // Streamed out of order: the panel's slot went out with the page shell, and
  // this fills it whenever the overview lands, without moving the results.
  return `<template id="kpt">${card}${paa}</template><script>(()=>{const t=document.getElementById("kpt"),k=document.getElementById("kp");k.replaceChildren(t.content);k.classList.add("ld");t.remove()})()</script>\n`;
}

const SEARCH_ICON = `<svg height="18" width="18" viewBox="0 0 24 24"><path fill="#5f6368" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
function relatedSearches(o) {
  const related = (Array.isArray(o?.related) ? o.related : []).map(String).filter(Boolean).slice(0, 8);
  if (!related.length) return "";
  return `<div class="related"><h3>People also search for</h3><div class="chips">${related.map((q) => `<a href="/search?q=${encodeURIComponent(q)}">${SEARCH_ICON}${esc(q)}</a>`).join("")}</div></div>`;
}

function renderNewsItem(query, n) {
  const url = `https://${n.domain}${n.path?.startsWith("/") ? n.path : `/${n.path ?? ""}`}`;
  const href = webHref(query, { url, title: n.headline, snippet: n.snippet });
  const pic = n.image && imageSpec(normalizeImagePrompt(n.image), { s: NEWS_STYLES.includes(n.style) ? n.style : "photo", a: "square" });
  if (pic) warmImage(pic);
  const thumb = pic ? `<img class="nthumb" src="${esc(imgSrc(n.image, pic))}" loading="lazy" onload="this.classList.add('ld')" alt="">` : "";
  return `<a class="ncard" href="${esc(href)}">
  <div><div class="nsrc">${esc(n.outlet)}</div><div class="nhead">${esc(n.headline)}</div><div class="nsnip">${esc(n.snippet)}</div><div class="nage">${esc(n.age ?? "")}</div></div>
  ${thumb}
</a>
`;
}

// Tiles keep their picture's aspect ratio and grow in proportion to it, so
// each row of the grid is one height and fills the width, like Google Images.
const TILE_HEIGHT = 180;
function renderImageTile(query, t) {
  const pic = imageSpec(normalizeImagePrompt(t.image), { s: t.style, a: t.shape });
  warmImage(pic);
  const [w, h] = SHAPES[pic.shape];
  const url = `https://${t.site}${t.path?.startsWith("/") ? t.path : `/${t.path ?? ""}`}`;
  const href = webHref(query, { url, title: t.caption });
  return `<a class="tile" href="${esc(href)}" style="flex:${(w / h).toFixed(3)} 1 ${Math.round((TILE_HEIGHT * w) / h)}px">
  <img src="${esc(imgSrc(t.image, pic))}" style="aspect-ratio:${w}/${h}" loading="lazy" onload="this.classList.add('ld')" alt="${esc(t.caption)}">
  <div class="tcap">${esc(t.caption)}</div><div class="tsite">${esc(t.site)}</div>
</a>
`;
}

const siteURL = (domain, p) => `https://${domain}${p?.startsWith("/") ? p : `/${p ?? ""}`}`;

// Map pins are lettered like Google's local pack; the generated map is asked to
// use the same letters.
const PIN_LETTERS = "ABCDEFGHIJ";

function renderPlace(query, p, i) {
  const href = webHref(query, { url: siteURL(p.domain, p.path), title: p.name, snippet: p.blurb });
  const rating = Math.min(5, Math.max(0, Number(p.rating) || 0));
  const stars = rating ? `<span class="stars">${"★".repeat(Math.round(rating))}${"☆".repeat(5 - Math.round(rating))}</span> ${rating.toFixed(1)}` : "";
  const reviews = Number(p.reviews) ? ` (${Number(p.reviews).toLocaleString("en-US")})` : "";
  const [state, ...rest] = String(p.status ?? "").split("·");
  const status = p.status
    ? `<span class="${/^\s*open/i.test(state) ? "open" : "closed"}">${esc(state.trim())}</span>${rest.length ? ` · ${esc(rest.join("·").trim())}` : ""}`
    : "";
  return `<a class="place" href="${esc(href)}">
  <div class="pin"><b>${PIN_LETTERS[i] ?? "•"}</b></div>
  <div><div class="pname">${esc(p.name)}</div>
  <div class="prate">${stars}${reviews}${p.category ? ` · ${esc(p.category)}` : ""}</div>
  <div class="pmeta">${esc(p.address ?? "")}${p.address && status ? " · " : ""}${status}</div>
  ${p.blurb ? `<div class="pblurb">“${esc(p.blurb)}”</div>` : ""}</div>
</a>
`;
}

function renderEvent(query, e) {
  const href = webHref(query, { url: siteURL(e.source, e.path), title: e.headline, snippet: e.detail });
  const year = parseInt(String(e.date).match(/\d{4}/)?.[0], 10);
  const future = year > new Date().getFullYear();
  return `<a class="event${future ? " future" : ""}" href="${esc(href)}">
  <div class="edate">${esc(e.date)}</div>
  <div class="ehead">${esc(e.headline)}</div>
  <div class="edetail">${esc(e.detail ?? "")}</div>
  <div class="esrc">${esc(e.source)}</div>
</a>
`;
}

// The map goes out before any place is known, so it starts generating
// immediately rather than after the list finishes.
const mapsHeader = (query) => {
  const prompt = `Top-down street map of the neighborhood for "${query}": a few streets and blocks, a park or river, and pins marked A to F`;
  const pic = imageSpec(prompt, { s: "map", a: "landscape" });
  warmImage(pic);
  return `<div class="maps"><img class="map" src="${esc(imgSrc(prompt, pic))}" onload="this.classList.add('ld')" alt="Map">`;
};

const statsLine = (query, page) =>
  `<div class="stats">${page > 1 ? `Page ${page} of about` : "About"} ${(Math.floor(Math.random() * 9_000_000) + 500_000).toLocaleString("en-US")} results (0.${Math.floor(Math.random() * 60) + 21} seconds)</div>`;

// "Foooooogle" with one o per page, like the real thing.
const PAGES = 10;
function pager(href, query, page) {
  const link = (n, label) => `<a href="${href}?q=${encodeURIComponent(query)}${n > 1 ? `&page=${n}` : ""}">${label}</a>`;
  const os = Array.from({ length: PAGES }, (_, i) => `<span class="${i % 2 ? "r" : "y"}">o</span>`).join("");
  const nums = Array.from({ length: PAGES }, (_, i) => (i + 1 === page ? `<b>${i + 1}</b>` : link(i + 1, i + 1))).join("");
  return `<div class="pager"><div class="word"><span class="b1">F</span>${os}<span class="b1">g</span><span class="g">l</span><span class="r">e</span></div>
<div class="nums">${page > 1 ? link(page - 1, "‹ Previous") : ""}${nums}${page < PAGES ? link(page + 1, "Next ›") : ""}</div></div>`;
}

// ---------- generic streamed results route ----------
function resultsRoute({ tab, prompt, shardPrompt, angles, total, container, renderItem, validate, dedupeKey, header = () => "", footer = () => "", paged = false, aside, prefetch }) {
  const shards = shardPrompt ? Math.min(SHARDS, angles.length) : 1;

  const itemStream = (query, page) => {
    if (shards < 2) return streamJSONL(prompt(query, { page }));
    return mergeAsync(
      shardCounts(total, shards).map((count, i) =>
        streamJSONL(shardPrompt(query, { count, angle: angles[i % angles.length], page }), count * 140 + 150),
      ),
    );
  };

  return async (req, res) => {
    const query = String(req.query.q ?? "").trim();
    if (!query) return res.redirect("/");
    if (!config.apiKey) return res.status(500).send(setupPage());

    const page = paged ? Math.min(PAGES, Math.max(1, parseInt(req.query.page, 10) || 1)) : 1;
    const cacheKey = `${tab}:${page}:${query.toLowerCase()}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (serpCache.has(cacheKey)) return res.send(browserBar(req) + serpCache.get(cacheKey));
    if (!limits.allow(req, res, tab === "All" ? "search" : tab.toLowerCase())) return;

    let html = "";
    const emit = (chunk) => {
      html += chunk;
      res.write(chunk);
    };
    // The side panel generates alongside the results and is streamed into its
    // slot whenever it lands. Once the page has ended it is simply dropped.
    const side = aside && page === 1;
    let sideData = null;
    let sideDone = !side;
    const sideTask = side
      ? aside.load(query).then(
          (data) => {
            sideData = data;
            if (!res.writableEnded) emit(aside.render(query, data));
          },
          (err) => console.warn(`[${tab.toLowerCase()}] side panel: ${err.message}`),
        ).finally(() => { sideDone = true; })
      : null;
    res.write(browserBar(req, { loading: true }));
    emit(shell(query, tab, page, { aside: side }));
    res.flushHeaders?.();

    try {
      const t0 = Date.now();
      console.log(`[${tab.toLowerCase()}] "${query}"${page > 1 ? ` page ${page}` : ""}${shards > 1 ? ` (${shards} shards)` : ""}`);
      let count = 0;
      // Shards work from different slices of the web, but they can still land on
      // the same obvious domain — drop the later one so the page never shows a
      // site twice.
      const seen = new Set();
      // A model occasionally runs one result line on without ever closing it,
      // leaving a SERP with nothing on it. While count is 0 nothing has reached
      // the browser yet, so the ask is safe to repeat verbatim.
      for (let attempt = 1; count === 0 && attempt <= 2; attempt++) {
        try {
          for await (const item of itemStream(query, page)) {
            if (!validate(item)) continue;
            const key = String(dedupeKey?.(item) ?? "").toLowerCase();
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            if (count === 0) {
              console.log(`[${tab.toLowerCase()}] first result +${((Date.now() - t0) / 1000).toFixed(1)}s`);
              emit(`<style>#shimmer{display:none}</style>\n${header(query, page)}<div class="${container}">`);
            }
            emit(renderItem(query, item, count));
            if (count < PREFETCH_PAGES) prefetch?.(query, item);
            count++;
          }
        } catch (err) {
          if (count > 0 || attempt === 2) throw err;
          console.warn(`[${tab.toLowerCase()}] ${err.message} — retrying`);
        }
      }
      console.log(`[${tab.toLowerCase()}] ${count} results in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (count === 0) throw new Error("no results returned");
      // Give a slow panel a little longer, then hide its placeholder.
      if (sideTask) await Promise.race([sideTask, new Promise((r) => setTimeout(r, 6000))]);
      if (!sideDone) emit(`<style>#kp{display:none}</style>`);
      emit(`</div>\n${footer(query, page, sideData)}${SHELL_TAIL}`);
      res.end();
      cachePut(serpCache, cacheKey, html);
    } catch (err) {
      console.error(`[${tab.toLowerCase()}] failed:`, err.message);
      res.end(collapseFragment(err.message));
    }
  };
}

// ---------- routes ----------
// The interactive-component runtime is versioned by content (see widgetHead),
// so browsers keep it for good and pages never wait on it twice.
app.use("/fw", express.static(path.join(__dirname, "public", "fw"), { maxAge: "1y", immutable: true }));
app.use(browserBarRoutes());
app.use(express.static(path.join(__dirname, "public")));
// Posting a comment is free; the reply someone writes to it is a model call.
// Over the limit, the comment still posts and just gets no reply.
app.post("/fw/comments", (req, res, next) => {
  req.noReply = !limits.check(req, "comment").ok;
  next();
});
app.use(interactRoutes(siteState));

// With an empty box, "I'm Feeling Lucky" is a trip somewhere random.
const LUCKY_QUERIES = [
  "underwater hotel reviews", "moon base job listings", "haunted lighthouse forum", "time travel travel insurance",
  "sentient houseplant care", "1970s robot cookbook", "cloud city real estate", "retired superhero support group",
  "mars colony local news", "antique teleporter repair", "dragon egg incubator", "museum of lost sounds",
  "orbital farmers market", "dream recording app", "subterranean jazz club", "weather control complaints",
];

// "I'm Feeling Lucky": redirect off the first streamed result line.
app.get("/search", async (req, res, next) => {
  if (req.query.lucky !== "1") return next();
  const query = String(req.query.q ?? "").trim() || LUCKY_QUERIES[Math.floor(Math.random() * LUCKY_QUERIES.length)];
  if (!config.apiKey) return res.status(500).send(setupPage());
  if (!limits.allow(req, res, "lucky")) return;
  try {
    console.log(`[lucky] "${query}"`);
    // Only the first result is ever used, so ask for exactly one rather than
    // generating nine and throwing eight away.
    for await (const r of streamJSONL(searchShardPrompt(query, { count: 1, angle: SEARCH_ANGLES[0] }), 300)) {
      if (r.url && r.title) return res.redirect(webHref(query, r));
    }
    throw new Error("no results returned");
  } catch (err) {
    console.error(`[lucky] failed:`, err.message);
    return res.redirect(`/search?q=${encodeURIComponent(query)}`);
  }
});

app.get(
  "/search",
  resultsRoute({
    tab: "All",
    shardPrompt: searchShardPrompt,
    angles: SEARCH_ANGLES,
    total: 9,
    container: "results",
    renderItem: renderResultItem,
    validate: (r) => r.url && r.title,
    dedupeKey: (r) => {
      try {
        return new URL(r.url).host.replace(/^www\./, "");
      } catch {
        return r.title;
      }
    },
    header: statsLine,
    footer: (query, page, overview) => `${relatedSearches(overview)}${pager("/search", query, page)}`,
    paged: true,
    aside: { load: fetchOverview, render: renderOverview },
    prefetch: (query, r) => {
      try {
        const u = new URL(r.url);
        ensurePage(`/${u.host}${u.pathname}`.replace(/\/+$/, ""), "", { query, title: r.title, snippet: r.snippet, resultKind: r.kind });
      } catch { /* unparseable url: nothing to warm */ }
    },
  }),
);

app.get(
  "/news",
  resultsRoute({
    tab: "News",
    shardPrompt: newsShardPrompt,
    angles: NEWS_ANGLES,
    total: 8,
    container: "news",
    renderItem: renderNewsItem,
    validate: (n) => n.domain && n.headline,
    dedupeKey: (n) => String(n.domain).replace(/^www\./, ""),
    footer: (query, page) => pager("/news", query, page),
    paged: true,
  }),
);

app.get(
  "/maps",
  resultsRoute({
    tab: "Maps",
    prompt: mapsResultsPrompt,
    total: 6,
    container: "places",
    renderItem: renderPlace,
    validate: (p) => p.name && p.domain,
    dedupeKey: (p) => String(p.domain).replace(/^www\./, ""),
    header: mapsHeader,
    footer: () => "</div>",
  }),
);

// Unsharded on purpose: one stream is the only way to keep events in order.
app.get(
  "/timelines",
  resultsRoute({
    tab: "Timelines",
    prompt: timelineResultsPrompt,
    total: 10,
    container: "timeline",
    renderItem: renderEvent,
    validate: (e) => e.date && e.headline && e.source,
    dedupeKey: (e) => `${e.date}|${e.headline}`,
  }),
);

app.get(
  "/images",
  resultsRoute({
    tab: "Images",
    shardPrompt: imageShardPrompt,
    angles: IMAGE_ANGLES,
    total: 12,
    container: "grid",
    renderItem: renderImageTile,
    validate: (t) => t.site && t.image,
    dedupeKey: (t) => `${t.site}|${t.caption}`,
  }),
);

// ---------- generated images ----------
// One shared entry point: /img requests, SERP thumbnails, and the page-stream
// scanner all dedupe through the same cache + inflight map.
function normalizeImagePrompt(raw) {
  let s = String(raw ?? "");
  try {
    s = decodeURIComponent(s);
  } catch { /* use raw */ }
  return s.trim().slice(0, 600);
}

// Disk cache: images are the most expensive asset, so they persist across
// restarts (unlike pages, which are cheap-ish and fun to regenerate). On hosts
// with an ephemeral or read-only filesystem (e.g. Render's free tier) it just
// starts empty or stays unused; reads and writes below already fail softly.
const IMG_DIR = process.env.FOOGLE_IMAGE_CACHE || path.join(__dirname, ".foogle-cache", "images");
await fs.mkdir(IMG_DIR, { recursive: true }).catch((err) => console.warn(`[image] disk cache unavailable:`, err.message));

const imgFile = (prompt) =>
  path.join(IMG_DIR, createHash("sha1").update(`svg|${config.model}|${prompt}`).digest("hex"));

async function diskGetImage(prompt) {
  try {
    const raw = JSON.parse(await fs.readFile(`${imgFile(prompt)}.json`, "utf8"));
    return { mime: raw.mime, buf: Buffer.from(raw.b64, "base64") };
  } catch {
    return null;
  }
}

const isImageOnDisk = (prompt) => fs.access(`${imgFile(prompt)}.json`).then(() => true, () => false);

function diskPutImage(prompt, img) {
  // Write-then-rename so a mid-write shutdown can't leave a corrupt cache file.
  const file = `${imgFile(prompt)}.json`;
  const tmp = `${file}.tmp`;
  fs.writeFile(tmp, JSON.stringify({ mime: img.mime, b64: img.buf.toString("base64") }))
    .then(() => fs.rename(tmp, file))
    .catch((err) => console.warn(`[image] disk cache write failed:`, err.message));
}

function getImage(spec) {
  const key = imageKey(spec);
  const cached = imageCache.get(key);
  if (cached) return Promise.resolve(cached);
  let task = imageInflight.get(key);
  if (!task) {
    task = (async () => {
      const disk = await diskGetImage(key);
      if (disk) {
        cachePut(imageCache, key, disk, IMG_CACHE_MAX);
        return disk;
      }
      console.log(`[image] ${spec.style}/${spec.shape} ${spec.description.slice(0, 70)}`);
      const img = await generateImage(spec);
      cachePut(imageCache, key, img, IMG_CACHE_MAX);
      diskPutImage(key, img);
      return img;
    })();
    imageInflight.set(key, task);
    // .finally() forks a new promise chain — give it its own catch or a
    // failed generation becomes an unhandled rejection and kills the process.
    task.finally(() => imageInflight.delete(key)).catch(() => {});
  }
  return task;
}

// Start generating before the browser ever requests the image. `query` is
// built from the same description and query as the src, so the warmed image
// is the one the browser will ask for.
const warmImage = (spec) => {
  if (spec.description && config.apiKey) getImage(spec).catch(() => {});
};

function placeholderSVG(prompt) {
  const hue = [...prompt].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,82%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},40%,68%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/></svg>`;
}

// ?s=&a= pick the picture's medium and shape; ?bg=&fg= carry a generated
// site's palette, which the picture is drawn with.
app.use("/img", async (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const prompt = normalizeImagePrompt(req.query.p ?? req.path.replace(/^\/+/, ""));
  if (!prompt || !config.apiKey) return res.status(404).end();
  // Opened directly, an SVG is a document: nothing in it may run or load.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  const spec = imageSpec(prompt, req.query);
  const key = imageKey(spec);
  if (!imageCache.has(key) && !imageInflight.has(key) && !(await isImageOnDisk(key)) && !limits.allow(req, res, "img")) return;

  try {
    const img = await getImage(spec);
    res.setHeader("Content-Type", img.mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(img.buf);
  } catch (err) {
    console.error(`[image] failed:`, err.message);
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-store"); // don't cache failures; retry next load
    res.send(placeholderSVG(prompt));
  }
});

// ---------- the fake web ----------
// Written the instant a non-cached page is requested, before the first
// generated byte, so the visitor gets immediate feedback instead of a blank
// page. The page's own <!DOCTYPE>/<html>/<head> arrive in body context
// afterwards — HTML parsers merge stray html/body tags and apply
// <style>/<title> anywhere, so the page renders normally as it streams in.
function vibePrelude(domain) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<div id="__fvb" style="position:fixed;top:0;left:0;height:3px;width:100%;z-index:2147483647;background:linear-gradient(90deg,#4285f4,#ea4335,#fbbc05,#34a853,#4285f4);background-size:200% 100%;animation:__fv 1s linear infinite"></div>
<div id="__fvc" style="position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#202124;color:#fff;font:13px arial,sans-serif;padding:10px 16px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.35)">⚡ vibe-coding <b>${esc(domain)}</b><span id="__fvd"></span></div>
<style>@keyframes __fv{from{background-position:0 0}to{background-position:200% 0}}#__fvd::after{content:"";animation:__fvd 1.2s steps(4) infinite}@keyframes __fvd{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}</style>
`;
}
const VIBE_CLEANUP = `<style>#__fvb,#__fvc{display:none!important}</style>`;

// A generation entry is shared by every request for the same path: the first
// request starts it, later ones (double-click, hover prefetch then click)
// replay the chunks so far and then follow the live stream.
function startPageGeneration(webPath, promptArgs) {
  const entry = { chunks: [], done: false, error: null, waiters: new Set() };
  const notify = () => {
    for (const w of entry.waiters) w();
    entry.waiters.clear();
  };

  (async () => {
    console.log(`[vibe-coding] ${promptArgs.url}`);
    // Kick off image generation the moment a page writes an /img/ src — it
    // runs in parallel with the rest of the page (and for prefetched pages,
    // before anyone is looking) instead of waiting for the browser to parse it.
    let acc = "";
    const seenImgs = new Set();
    const scanImages = (chunk) => {
      acc += chunk;
      // Lookahead for a terminator so a src split across stream chunks isn't
      // warmed as a truncated prompt; it matches once the closing quote arrives.
      for (const [src, p, q = ""] of acc.matchAll(/\/img\/([^"'\s<>)?]+)(?:(\?[^"'\s<>]*)(?=["'\s<>])|(?=["'\s<>)]))/g)) {
        if (!seenImgs.has(src)) {
          seenImgs.add(src);
          warmImage(imageSpec(normalizeImagePrompt(p), Object.fromEntries(new URLSearchParams(q.replaceAll("&amp;", "&")))));
        }
      }
    };
    try {
      for await (const chunk of generatePage(promptArgs)) {
        scanImages(chunk);
        entry.chunks.push(chunk);
        notify();
      }
      const fullHtml = entry.chunks.join("");
      cachePut(pageCache, webPath, fullHtml);
      console.log(`[vibe-coding] done ${promptArgs.url} (${fullHtml.length} bytes)`);
    } catch (err) {
      console.error(`[vibe-coding] failed ${promptArgs.url}:`, err.message);
      entry.error = err;
    } finally {
      entry.done = true;
      notify();
      inflight.delete(webPath);
    }
  })();

  inflight.set(webPath, entry);
  return entry;
}

async function pipeEntry(entry, res) {
  let i = 0;
  for (;;) {
    while (i < entry.chunks.length) res.write(entry.chunks[i++]);
    if (entry.done) break;
    await new Promise((resolve) => entry.waiters.add(resolve));
  }
  if (entry.error) res.end(VIBE_CLEANUP + collapseFragment(entry.error.message));
  else res.end(VIBE_CLEANUP);
}

// Generated sites often have forms. One that does something (checkout, sign
// up, book, contact) is recorded and answered by a confirmation page at its
// own URL (?order=4821, ?ref=K7Q2). A query form (search, filters) becomes a
// GET with the fields in the query string, so the result page is bookmarkable
// and gets generated like any other.
app.post(/^\/web\//, express.urlencoded({ extended: false, limit: "20kb" }), (req, res) => {
  const fields = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)]));
  const [, , domain = "", ...rest] = req.path.split("/");
  const done = domain && siteState.submit(visitor(req, res), domain, `/${rest.join("/")}`.replace(/\/+$/, ""), fields);
  if (done) return res.redirect(303, done.location);
  const params = new URLSearchParams(Object.entries(fields).filter(([k]) => !k.startsWith("_")));
  res.redirect(303, `${req.path}${params.size ? `?${params}` : ""}`);
});

app.use("/web", async (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  // "/domain.tld/some/path", plus any query string that isn't Foogle's own
  // fq/ft/fs context — /search?q=lamps and /search?q=tents are different pages.
  const params = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
  for (const k of ["fq", "ft", "fs", "fk"]) params.delete(k);
  const search = params.size ? `?${params}` : "";
  const webPath = (req.path.replace(/\/+$/, "") || "/") + search;
  const domain = webPath.split("/")[1];
  if (!domain) return res.redirect("/");
  if (!config.apiKey) return res.status(500).send(setupPage());

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Generated pages share Foogle's origin: only Foogle's own scripts may run.
  res.setHeader("Content-Security-Policy", PAGE_CSP);

  const cached = pageCache.get(webPath);
  if (cached) return res.send(browserBar(req) + cached);
  if (!inflight.has(webPath) && !limits.allow(req, res, "web")) return;

  // Instant feedback: loading bar + badge go out before the model's first byte.
  res.write(browserBar(req, { loading: true }) + vibePrelude(domain));
  res.flushHeaders?.();

  const { fq: query, fs: snippet, fk: resultKind } = req.query;
  let { ft: title } = req.query;
  // A confirmation page: the form the visitor just submitted is its subject.
  const sub = siteState.submission(domain, params);
  const submission = sub && { summary: submissionSummary(sub), briefs: responseBriefs(sub), receipt: receiptSection(sub, domain) };
  if (sub) title = submissionTitle(sub);
  await pipeEntry(ensurePage(webPath, search, { query, title, snippet, resultKind, submission }), res);
});

// Join the live generation of a page, or start one. Shared by visits, hover
// warming and search-result prefetch, so a page is only ever generated once.
function ensurePage(webPath, search, { query, title, snippet, resultKind, submission }) {
  const existing = inflight.get(webPath);
  if (existing || pageCache.has(webPath)) return existing;
  const domain = webPath.split("/")[1];
  const context = siteContext.get(domain);
  if (!context && !submission && (query || title)) siteContext.set(domain, { query, title });
  const pathname = webPath.slice(domain.length + 1, webPath.length - search.length);
  const url = `https://${domain}${pathname || "/"}${search}`;
  return startPageGeneration(webPath, { url, query, title, snippet, resultKind, siteContext: context, submission });
}

const listener = app.listen(PORT, () => {
  console.log(`Foogle running at http://localhost:${listener.address().port}`);
  console.log(`  model:    ${config.model} (OpenRouter)`);
  console.log(`  layouts:  ${process.env.TYPESAFE_API_KEY ? "Jev" : "default (set TYPESAFE_API_KEY for Jev)"}`);
  if (!config.apiKey) console.warn("  ⚠ no usable API key — set OPENROUTER_API_KEY in .env to your real key (the sk-or-... placeholder doesn't count)");
});
