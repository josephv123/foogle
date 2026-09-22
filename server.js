import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { streamText, generateImage, extractJSON, config } from "./lib/llm.js";
import {
  searchResultsPrompt, newsResultsPrompt, imageResultsPrompt, pagePrompt,
  searchShardPrompt, newsShardPrompt, imageShardPrompt,
  SEARCH_ANGLES, NEWS_ANGLES, IMAGE_ANGLES,
  pagePlanPrompt, pageSectionPrompt,
} from "./lib/prompts.js";
import { normalizePlan, themeCSS, themeHeader, themeFooter, heroImagePrompt } from "./lib/theme.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
// Ceiling on a generated page. Frontier models stop well short of this; small
// local models can spiral into repetition instead of closing the document, so
// this doubles as a stop-loss on a page that has stopped making progress.
const PAGE_MAX_TOKENS = parseInt(process.env.FOOGLE_PAGE_MAX_TOKENS ?? "16000", 10) || 16000;
// Ceiling per section in fast-page mode. Sections are asked for 70-130 words;
// this is the stop-loss for one that starts looping instead of closing.
const SECTION_MAX_TOKENS = parseInt(process.env.FOOGLE_SECTION_MAX_TOKENS ?? "700", 10) || 700;
// Model-drawn images on generated pages. They're the single most expensive
// asset (each is its own generation) and on a local model they compete for the
// same decode slots as the page itself, so they're off by default there — the
// themed hero/.thumb panels are pure CSS and render instantly. SERP thumbnails
// and the Images tab are unaffected.
const PAGE_IMAGES = /^(1|true|on)$/i.test(process.env.FOOGLE_PAGE_IMAGES ?? (config.isLocal ? "0" : "1"));

// ---------- caches ----------
const CACHE_MAX = 200;
const IMG_CACHE_MAX = 60;
const pageCache = new Map(); // "/domain.tld/path" -> full HTML
const serpCache = new Map(); // "<tab>:<query>" -> full HTML
const imageCache = new Map(); // image prompt -> { mime, buf }
const inflight = new Map(); // page path -> live generation entry (chunks so far)
const imageInflight = new Map(); // image prompt -> Promise<{mime, buf}>
const siteContext = new Map(); // domain -> { query, title } from first visit

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

function webHref(query, { url, title, snippet }) {
  return `${toWebPath(url)}?fq=${encodeURIComponent(query)}&ft=${encodeURIComponent(title ?? "")}&fs=${encodeURIComponent(snippet ?? "")}`;
}

const imgSrc = (prompt) => `/img/${encodeURIComponent(String(prompt ?? "").slice(0, 600))}`;

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
  for await (const delta of streamText({ ...promptSpec, model: config.resultsModel, maxTokens, temperature: config.tempResults })) {
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
<p>Set an API key for any OpenAI-compatible provider and restart:</p>
<pre style="background:#f8f9fa;padding:16px;border-radius:8px">cp .env.example .env   # then edit it
LLM_API_KEY=...        # e.g. an OpenRouter key
npm start</pre>
<p>Optional: <code>LLM_BASE_URL</code>, <code>FOOGLE_RESULTS_MODEL</code>, <code>FOOGLE_PAGE_MODEL</code>, <code>FOOGLE_IMAGE_MODEL</code>.</p>
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
];

function shell(query, active) {
  const q = esc(query);
  const eq = encodeURIComponent(query);
  const tabs =
    TABS.map(([label, href]) =>
      label === active
        ? `<a class="active" href="${href}?q=${eq}">${label}</a>`
        : `<a href="${href}?q=${eq}">${label}</a>`,
    ).join("") + `<span>Maps</span><span>Timelines</span><span>More</span>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${q} - Foogle ${active === "All" ? "Search" : active}</title>
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
.tabs a, .tabs span { padding-bottom: 10px; color: inherit; text-decoration: none; }
.tabs span { cursor: default; }
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
.grid { margin: 20px 20px 60px 182px; display: flex; flex-wrap: wrap; gap: 14px; max-width: 1100px; align-items: flex-start; }
.tile { width: 210px; text-decoration: none; color: inherit; }
.tile img { width: 210px; height: 158px; object-fit: cover; border-radius: 10px; background: #f1f3f4; display: block; }
.tcap { font-size: 13px; margin-top: 5px; line-height: 1.3; }
.tsite { font-size: 12px; color: #70757a; }
#shimmer { margin: 40px 0 0 182px; max-width: 600px; }
#shimmer .bar { height: 16px; border-radius: 4px; margin-bottom: 14px; background: linear-gradient(90deg, #f1f3f4 25%, #e3e6e8 50%, #f1f3f4 75%); background-size: 200% 100%; animation: sh 1.2s infinite; }
#shimmer .note { font-size: 13px; color: #70757a; margin-bottom: 18px; }
@keyframes sh { from { background-position: 200% 0 } to { background-position: -200% 0 } }
@media (max-width: 700px) { .tabs, .stats, .results, .news, .grid, #shimmer { margin-left: 20px; } }
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
<div id="shimmer"><div class="note">Searching the future web…</div><div class="bar" style="width:62%"></div><div class="bar" style="width:88%"></div><div class="bar" style="width:74%"></div><div class="bar" style="width:81%"></div><div class="bar" style="width:55%"></div></div>
`;
}

// Chrome prerenders /web/ links on hover — generation streams into a hidden
// page, so the click swaps in an already-rendering document. Other browsers
// fall back to the fetch-warm script below.
const SHELL_TAIL = `<script type="speculationrules">{"prerender":[{"where":{"href_matches":"/web/*"},"eagerness":"moderate"}]}</script>
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
function renderResultItem(query, r) {
  let crumbs = esc(r.url);
  try {
    const u = new URL(r.url);
    const parts = u.pathname.split("/").filter(Boolean);
    crumbs = `${esc(u.origin)}${parts.map((p) => ` <span class="crumb">› ${esc(decodeURIComponent(p))}</span>`).join("")}`;
  } catch { /* keep raw */ }
  return `<div class="result">
  <div class="url">${crumbs}</div>
  <h3><a href="${esc(webHref(query, r))}">${esc(r.title)}</a></h3>
  <div class="snippet">${esc(r.snippet)}</div>
</div>
`;
}

function renderNewsItem(query, n) {
  const url = `https://${n.domain}${n.path?.startsWith("/") ? n.path : `/${n.path ?? ""}`}`;
  const href = webHref(query, { url, title: n.headline, snippet: n.snippet });
  if (n.image) warmImage(n.image);
  const thumb = n.image ? `<img class="nthumb" src="${esc(imgSrc(n.image))}" loading="lazy" onload="this.classList.add('ld')" alt="">` : "";
  return `<a class="ncard" href="${esc(href)}">
  <div><div class="nsrc">${esc(n.outlet)}</div><div class="nhead">${esc(n.headline)}</div><div class="nsnip">${esc(n.snippet)}</div><div class="nage">${esc(n.age ?? "")}</div></div>
  ${thumb}
</a>
`;
}

function renderImageTile(query, t) {
  warmImage(t.image);
  const url = `https://${t.site}${t.path?.startsWith("/") ? t.path : `/${t.path ?? ""}`}`;
  const href = webHref(query, { url, title: t.caption });
  return `<a class="tile" href="${esc(href)}">
  <img src="${esc(imgSrc(t.image))}" loading="lazy" onload="this.classList.add('ld')" alt="${esc(t.caption)}">
  <div class="tcap">${esc(t.caption)}</div><div class="tsite">${esc(t.site)}</div>
</a>
`;
}

const statsLine = () =>
  `<div class="stats">About ${(Math.floor(Math.random() * 9_000_000) + 500_000).toLocaleString("en-US")} results (0.${Math.floor(Math.random() * 60) + 21} seconds)</div>`;

// ---------- generic streamed results route ----------
function resultsRoute({ tab, prompt, shardPrompt, angles, total, container, renderItem, validate, dedupeKey, header = () => "" }) {
  const shards = shardPrompt ? Math.min(config.resultShards, angles.length) : 1;

  // One model call writing 9 results is one decode stream: ~21 tok/s, ~25s.
  // Three calls writing 3 each run on separate slots for ~50 tok/s aggregate,
  // and the first result lands after one shard's first line rather than after
  // a ninth of the whole document.
  const itemStream = (query) => {
    if (shards < 2) return streamJSONL(prompt(query));
    return mergeAsync(
      shardCounts(total, shards).map((count, i) =>
        streamJSONL(shardPrompt(query, { count, angle: angles[i % angles.length] }), count * 140 + 150),
      ),
    );
  };

  return async (req, res) => {
    const query = String(req.query.q ?? "").trim();
    if (!query) return res.redirect("/");
    if (!config.apiKey) return res.status(500).send(setupPage());

    const cacheKey = `${tab}:${query.toLowerCase()}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (serpCache.has(cacheKey)) return res.send(serpCache.get(cacheKey));

    let html = "";
    const emit = (chunk) => {
      html += chunk;
      res.write(chunk);
    };
    emit(shell(query, tab));
    res.flushHeaders?.();

    try {
      const t0 = Date.now();
      console.log(`[${tab.toLowerCase()}] "${query}"${shards > 1 ? ` (${shards} shards)` : ""}`);
      let count = 0;
      // Shards work from different slices of the web, but they can still land on
      // the same obvious domain — drop the later one so the page never shows a
      // site twice.
      const seen = new Set();
      // Small local models intermittently run one result line on without ever
      // closing it, leaving a SERP with nothing on it. While count is 0 nothing
      // has reached the browser yet, so the ask is safe to repeat verbatim.
      for (let attempt = 1; count === 0 && attempt <= 2; attempt++) {
        try {
          for await (const item of itemStream(query)) {
            if (!validate(item)) continue;
            const key = String(dedupeKey?.(item) ?? "").toLowerCase();
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            if (count === 0) {
              console.log(`[${tab.toLowerCase()}] first result +${((Date.now() - t0) / 1000).toFixed(1)}s`);
              emit(`<style>#shimmer{display:none}</style>\n${header()}<div class="${container}">`);
            }
            emit(renderItem(query, item));
            count++;
          }
        } catch (err) {
          if (count > 0 || attempt === 2) throw err;
          console.warn(`[${tab.toLowerCase()}] ${err.message} — retrying`);
        }
      }
      console.log(`[${tab.toLowerCase()}] ${count} results in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (count === 0) throw new Error("no results returned");
      emit(`</div>\n${SHELL_TAIL}`);
      res.end();
      cachePut(serpCache, cacheKey, html);
    } catch (err) {
      console.error(`[${tab.toLowerCase()}] failed:`, err.message);
      res.end(collapseFragment(err.message));
    }
  };
}

// ---------- routes ----------
app.use(express.static(path.join(__dirname, "public")));

// "I'm Feeling Lucky": redirect off the first streamed result line.
app.get("/search", async (req, res, next) => {
  if (req.query.lucky !== "1") return next();
  const query = String(req.query.q ?? "").trim();
  if (!query) return res.redirect("/");
  if (!config.apiKey) return res.status(500).send(setupPage());
  try {
    console.log(`[lucky] "${query}"`);
    // Only the first result is ever used, so ask for exactly one rather than
    // generating nine and throwing eight away.
    const spec = config.resultShards > 1
      ? searchShardPrompt(query, { count: 1, angle: SEARCH_ANGLES[0] })
      : searchResultsPrompt(query);
    for await (const r of streamJSONL(spec, 300)) {
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
    prompt: searchResultsPrompt,
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
  }),
);

app.get(
  "/news",
  resultsRoute({
    tab: "News",
    prompt: newsResultsPrompt,
    shardPrompt: newsShardPrompt,
    angles: NEWS_ANGLES,
    total: 8,
    container: "news",
    renderItem: renderNewsItem,
    validate: (n) => n.domain && n.headline,
    dedupeKey: (n) => String(n.domain).replace(/^www\./, ""),
  }),
);

app.get(
  "/images",
  resultsRoute({
    tab: "Images",
    prompt: imageResultsPrompt,
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
// restarts (unlike pages, which are cheap-ish and fun to regenerate).
const IMG_DIR = path.join(__dirname, ".foogle-cache", "images");
await fs.mkdir(IMG_DIR, { recursive: true });

const imgFile = (prompt) =>
  path.join(IMG_DIR, createHash("sha1").update(`${config.imageApi}|${config.imageModel}|${prompt}`).digest("hex"));

async function diskGetImage(prompt) {
  try {
    const raw = JSON.parse(await fs.readFile(`${imgFile(prompt)}.json`, "utf8"));
    return { mime: raw.mime, buf: Buffer.from(raw.b64, "base64") };
  } catch {
    return null;
  }
}

function diskPutImage(prompt, img) {
  // Write-then-rename so a mid-write shutdown can't leave a corrupt cache file.
  const file = `${imgFile(prompt)}.json`;
  const tmp = `${file}.tmp`;
  fs.writeFile(tmp, JSON.stringify({ mime: img.mime, b64: img.buf.toString("base64") }))
    .then(() => fs.rename(tmp, file))
    .catch((err) => console.warn(`[image] disk cache write failed:`, err.message));
}

function getImage(prompt) {
  const cached = imageCache.get(prompt);
  if (cached) return Promise.resolve(cached);
  let task = imageInflight.get(prompt);
  if (!task) {
    task = (async () => {
      const disk = await diskGetImage(prompt);
      if (disk) {
        cachePut(imageCache, prompt, disk, IMG_CACHE_MAX);
        return disk;
      }
      console.log(`[image] ${prompt.slice(0, 80)}`);
      const img = await generateImage(prompt);
      cachePut(imageCache, prompt, img, IMG_CACHE_MAX);
      diskPutImage(prompt, img);
      return img;
    })();
    imageInflight.set(prompt, task);
    // .finally() forks a new promise chain — give it its own catch or a
    // failed generation becomes an unhandled rejection and kills the process.
    task.finally(() => imageInflight.delete(prompt)).catch(() => {});
  }
  return task;
}

// Start generating before the browser ever requests the image.
const warmImage = (rawPrompt) => {
  const prompt = normalizeImagePrompt(rawPrompt);
  if (prompt && config.apiKey) getImage(prompt).catch(() => {});
};

function placeholderSVG(prompt) {
  const hue = [...prompt].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,82%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},40%,68%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/></svg>`;
}

app.use("/img", async (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const prompt = normalizeImagePrompt(req.query.p ?? req.path.replace(/^\/+/, ""));
  if (!prompt || !config.apiKey) return res.status(404).end();

  try {
    const img = await getImage(prompt);
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
// Written the instant a non-cached page is requested, before the model's first
// byte, so the visitor gets immediate feedback instead of a blank page. The
// model's own <!DOCTYPE>/<html>/<head> arrive in body context afterwards —
// HTML parsers merge stray html/body tags and apply <style>/<title> anywhere,
// so the generated page renders normally as it streams in.
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
    let headDone = false; // leading code-fence stripped?
    let pending = ""; // hold back a small tail so a trailing fence can be stripped

    // Kick off image generation the moment the model writes an /img/ src —
    // it runs in parallel with the rest of the page stream instead of waiting
    // for the browser to parse the tag (or scroll a lazy image into view).
    let acc = "";
    const seenImgs = new Set();
    const scanImages = (chunk) => {
      acc += chunk;
      // Lookahead for a terminator so a src split across stream chunks isn't
      // warmed as a truncated prompt; it matches once the closing quote arrives.
      for (const [, p] of acc.matchAll(/\/img\/([^"'\s<>)]+)(?=["'\s<>)])/g)) {
        if (!seenImgs.has(p)) {
          seenImgs.add(p);
          warmImage(p);
        }
      }
    };

    // Style gate — the once-and-for-all fix for "text streams in unstyled,
    // then the UI snaps into place when the stylesheet finally arrives".
    // Nothing is flushed to the browser until the page's first complete
    // <style> block has been seen, so every element that appears is already
    // styled. Compliant pages (stylesheet in <head>) release within the first
    // few KB and stream progressively; a misbehaving model that writes its CSS
    // last keeps the gate closed, and the page appears fully styled at once
    // (the vibe-coding loader covers the wait). The gate also releases if the
    // stream ends without any <style> at all (e.g. purely inline styles).
    let gated = true;
    let gateBuf = "";
    const releaseGate = () => {
      if (!gated) return;
      gated = false;
      if (gateBuf) entry.chunks.push(gateBuf);
      gateBuf = "";
    };

    const emit = (chunk) => {
      if (!chunk) return;
      scanImages(chunk); // images warm immediately, even while gated
      if (gated) {
        gateBuf += chunk;
        if (/<\/style\s*>/i.test(gateBuf)) releaseGate();
      } else {
        entry.chunks.push(chunk);
      }
      notify();
    };
    try {
      for await (const delta of streamText({ ...pagePrompt(promptArgs), model: config.pageModel, maxTokens: PAGE_MAX_TOKENS, temperature: config.tempPages })) {
        pending += delta;
        if (!headDone) {
          if (pending.length < 24 && !/\S\s*\n/.test(pending)) continue;
          pending = pending.replace(/^\s*```[a-z]*\s*\n?/i, "");
          headDone = true;
        }
        const cut = Math.max(0, pending.length - 8);
        if (cut > 0) {
          emit(pending.slice(0, cut));
          pending = pending.slice(cut);
        }
      }
      emit(pending.replace(/\s*```\s*$/, ""));
      releaseGate(); // stream over — flush anything still held back
      const fullHtml = entry.chunks.join("");
      if (fullHtml.trim()) cachePut(pageCache, webPath, fullHtml);
      console.log(`[vibe-coding] done ${promptArgs.url} (${fullHtml.length} bytes)`);
    } catch (err) {
      console.error(`[vibe-coding] failed ${promptArgs.url}:`, err.message);
      releaseGate(); // show whatever exists alongside the error notice
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

app.use("/web", async (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const webPath = req.path.replace(/\/+$/, "") || "/"; // "/domain.tld/some/path"
  const domain = webPath.split("/")[1];
  if (!domain) return res.redirect("/");
  if (!config.apiKey) return res.status(500).send(setupPage());

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const cached = pageCache.get(webPath);
  if (cached) return res.send(cached);

  // Instant feedback: loading bar + badge go out before the model's first byte.
  res.write(vibePrelude(domain));
  res.flushHeaders?.();

  let entry = inflight.get(webPath);
  if (!entry) {
    const { fq: query, ft: title, fs: snippet } = req.query;
    const context = siteContext.get(domain);
    if (!context && (query || title)) siteContext.set(domain, { query, title });
    const url = `https://${domain}${webPath.slice(domain.length + 1) || "/"}`;
    entry = startPageGeneration(webPath, { url, query, title, snippet, siteContext: context });
  }
  await pipeEntry(entry, res);
});

app.listen(PORT, () => {
  console.log(`Foogle running at http://localhost:${PORT}`);
  console.log(`  provider: ${config.baseURL}`);
  console.log(`  results:  ${config.resultsModel}`);
  console.log(`  pages:    ${config.pageModel}`);
  console.log(`  images:   ${config.imageModel} (${config.imageApi} api)`);
  if (config.apiKey) {
    console.log(`  api key:  ${config.apiKey.slice(0, 8)}…${config.apiKey.slice(-4)} (${config.apiKey.length} chars)`);
  } else {
    console.warn("  ⚠ no usable API key — set LLM_API_KEY in .env to your real key (the sk-or-... placeholder doesn't count)");
  }
});
