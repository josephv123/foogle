// Screenshots of a fixed set of representative pages at desktop and phone
// widths, plus one contact sheet — for checking layout, UI and interactivity
// changes in seconds without driving a browser by hand.
//
//   npm run shots                        fake model (FOOGLE_FAKE_LLM), free, ~seconds
//   npm run shots -- --only "store|cart"  just the pages whose name matches
//   npm run shots -- --live              the real model (costs money; keep --only tight)
//   npm run shots -- --url http://localhost:3000   an already-running Foogle
//   npm run shots -- --out /tmp/shots     where the PNGs go (default .shots/)
//
// Unless --url is given it starts its own server on a free port and stops it
// afterwards. Pages can carry a few scripted steps (click, fill, wait…) that
// run before the screenshot, for flows like add-to-cart and checkout.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values: opts } = parseArgs({
  options: {
    only: { type: "string" },
    url: { type: "string" },
    live: { type: "boolean", default: false },
    out: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (opts.help) {
  // The usage is this file's opening comment.
  console.log((await fs.readFile(fileURLToPath(import.meta.url), "utf8")).split("\n\n")[0].replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

// A /web/ page as if clicked from a search result: fq is the query, ft the
// result title, fk the kind of result.
const web = (site, { q, title, kind } = {}) => {
  const p = new URLSearchParams({ ...(q && { fq: q }), ...(title && { ft: title }), ...(kind && { fk: kind }) });
  return `/web/${site}${p.size ? `?${p}` : ""}`;
};
const STORE = web("lanternworks.shop/storm-lanterns", { q: "storm lanterns", title: "Storm Lanterns — Lanternworks", kind: "store" });
const addToCart = [{ click: "[data-add-to-cart]" }, { wait: ".fw-toast" }, { click: "a.cart:visible, .fw-cartfab:visible" }, { wait: ".fw-drawer[open]" }];

// name, path, and optional steps; full: false shoots the viewport only (for
// dialogs and drawers, which sit over the page). Steps run in the page, inside
// Foogle's browser (lib/browserbar.js); with browser: true they run in the
// browser around it instead (its tabs and address bar).
const PAGES = [
  { name: "home", path: "/" },
  { name: "doodles", path: "/doodles" },
  { name: "search", path: "/search?q=storm%20lanterns" },
  { name: "images", path: "/images?q=storm%20lanterns" },
  { name: "news", path: "/news?q=harbor%20festival" },
  { name: "maps", path: "/maps?q=late%20night%20ramen" },
  { name: "timelines", path: "/timelines?q=lighthouses" },
  { name: "store", path: STORE },
  { name: "forum", path: web("crumbforum.net/t/starter-smells-like-nail-polish", { q: "sourdough starter", title: "Starter smells like nail polish — help?", kind: "forum" }) },
  { name: "news-site", path: web("harborledger.news/2026/09/harbor-festival-returns", { q: "harbor festival", title: "Harbor Festival Returns After Six Years", kind: "news" }) },
  { name: "wiki", path: web("fogpedia.org/wiki/fog-signal", { q: "fog signals", title: "Fog signal", kind: "wiki" }) },
  // Invented sites' other page types, reached by their own links: a forum's
  // feed, a news front page, a shop's product page (lib/design.js).
  { name: "forum-feed", path: "/web/crumbforum.net/latest" },
  { name: "news-front", path: "/web/harborledger.news/" },
  { name: "store-product", path: web("lanternworks.shop/products/kestrel-storm-lantern-mk-ii", { q: "storm lanterns", title: "Kestrel Storm Lantern Mk II — $89", kind: "store" }) },
  // A search naming a real site, and real sites' pages in their own look.
  { name: "real-search", path: "/search?q=cnn" },
  { name: "real-news", path: web("www.cnn.com/", { q: "cnn", title: "CNN: Breaking News, Latest News and Videos" }) },
  { name: "real-forum", path: web("www.reddit.com/r/sourdough/", { q: "reddit sourdough", title: "r/Sourdough" }) },
  { name: "real-wiki", path: web("en.wikipedia.org/wiki/Octopus", { q: "wikipedia octopus", title: "Octopus - Wikipedia" }) },
  { name: "real-product", path: web("www.amazon.com/Kindle-Paperwhite-16GB-Glare-Free/dp/B0CFPJYX7P", { q: "amazon kindle paperwhite", title: "Amazon.com: Kindle Paperwhite 16GB" }) },
  { name: "real-paper", path: web("www.nytimes.com/", { q: "nytimes", title: "The New York Times - Breaking News, US News, World News and Videos" }) },
  { name: "real-repo", path: web("github.com/facebook/react", { q: "github react", title: "facebook/react: The library for web and native user interfaces" }) },
  { name: "real-film", path: web("letterboxd.com/", { q: "letterboxd", title: "Letterboxd • Social film discovery." }) },
  { name: "real-music", path: web("bandcamp.com/", { q: "bandcamp", title: "Bandcamp" }) },
  // With the fake model, a style named in the URL is the one the site gets.
  { name: "zine-retro", path: web("staticbloom.net/web1996/issue-12", { q: "cassette culture", title: "Static Bloom #12: Tape Hiss Forever", kind: "zine" }) },
  // A long domain as the wordmark of a centred header: on a phone it wraps between words, never between letters.
  { name: "luxury-store", path: web("ember-and-oak-candles.com/luxury/candles", { q: "hand poured candles", title: "Hand-Poured Candles", kind: "store" }) },
  { name: "startup-calc", path: web("sunpatch.energy/solar-savings-calculator", { q: "solar savings", title: "Solar Savings Calculator", kind: "startup" }), steps: [{ select: ["[data-calc] select", "2"] }, { check: "[data-calc] input[type=checkbox]" }] },
  { name: "quiz", path: web("keeperquiz.club/which-lighthouse-keeper-are-you", { q: "lighthouse keepers", title: "Which Lighthouse Keeper Are You? A Quiz", kind: "blog" }), steps: [{ click: "[data-q] >> nth=0 >> button >> nth=1" }, { click: "[data-q] >> nth=1 >> button >> nth=0" }, { click: "[data-q] >> nth=2 >> button >> nth=1" }, { wait: ".fw-score:visible" }] },
  { name: "cart", path: STORE, steps: addToCart, full: false },
  // The filter box finds cards by their data-tags too: a chip's name typed in shows its cards.
  { name: "store-filter", path: web("lanternworks.shop/catalogue", { q: "storm lanterns", title: "Catalogue — Lanternworks", kind: "store" }), steps: [{ fill: [".fw-filterbar input[type=search]", "premium"] }, { wait: ".fw-count:text-matches('^[1-9]')" }] },
  // The address bar: "cnn" offers the search and cnn.com; "cnn.com" goes there.
  { name: "omnibox", path: STORE, browser: true, full: false, steps: [{ click: ".omni input" }, { fill: [".omni input", "cnn"] }, { wait: ".drop .row >> nth=1" }] },
  { name: "omnibox-go", path: "/", browser: true, full: false, steps: [{ click: ".omni input" }, { fill: [".omni input", "cnn.com"] }, { press: "Enter" }, { url: "/web/cnn\\.com$" }, { wait: 1500 }] },
  // Search suggestions (public/suggest.js): the homepage dropdown with the
  // second row picked by arrow key, recent searches above AI ones on the
  // results page, and AI rows in the address bar.
  { name: "suggest-home", path: "/", full: false, steps: [{ click: "input[name=q]" }, { fill: ["input[name=q]", "cn"] }, { wait: ".fsg-row >> nth=5" }, { press: "ArrowDown" }, { press: "ArrowDown" }] },
  { name: "suggest-recent", path: "/", full: false, steps: [{ click: "input[name=q]" }, { fill: ["input[name=q]", "storm lanterns"] }, { press: "Enter" }, { url: "search\\?q=storm" }, { click: ".searchbox input" }, { fill: [".searchbox input", "st"] }, { wait: ".fsg-row >> nth=4" }] },
  { name: "suggest-omnibox", path: "/", browser: true, full: false, steps: [{ click: ".omni input" }, { fill: [".omni input", "yo"] }, { wait: ".drop [data-kind=suggest] >> nth=2" }] },
  {
    name: "checkout", path: STORE, steps: [...addToCart,
      { fill: [".fw-checkout [name=name]", "Ada Moss"] }, { fill: [".fw-checkout [name=email]", "ada@example.com"] }, { fill: [".fw-checkout [name=address]", "1 Pier Rd, Port Avery"] },
      { click: ".fw-checkout button[type=submit]" }, { url: "order=" }, { wait: ".fw-receipt" }],
  },
  // Instant answers above the results, each put through its interaction.
  { name: "answer-weather", path: "/search?q=weather%20tokyo", steps: [{ click: ".ia-wx-day >> nth=2" }, { wait: ".ia-wx-day[aria-selected=true] >> nth=0" }] },
  { name: "answer-calc", path: "/search?q=17%25%20of%202340", steps: [{ click: "[data-k='7']" }, { click: "[data-k='*']" }, { click: "[data-k='6']" }, { click: "[data-k='=']" }, { wait: ".ia-calc-main:text-is('42')" }] },
  { name: "answer-units", path: "/search?q=5%20miles%20in%20km", steps: [{ fill: [".ia-num >> nth=0", "26.2"] }, { select: [".ia-unit >> nth=1", "meter"] }] },
  { name: "answer-currency", path: "/search?q=500%20lunar%20credits%20in%20usd", steps: [{ click: "[data-tab='1Y']" }] },
  { name: "answer-stock", path: "/search?q=NVDA%20stock", steps: [{ click: "[data-tab='1Y']" }, { wait: ".ia-stock-change:has-text('past year')" }] },
  { name: "answer-dict", path: "/search?q=define%20serendipity", steps: [{ click: ".ia-more" }] },
  { name: "answer-time", path: "/search?q=time%20in%20lagos", steps: [{ wait: ".ia-time-rel:not(:empty)" }] },
  // Tools asked for with nothing in them open at their defaults.
  { name: "answer-calc-blank", path: "/search?q=calculator", steps: [{ wait: ".ia-calc-main:text-is('0')" }, { click: "[data-k='1']" }, { click: "[data-k='2']" }, { click: "[data-k='+']" }, { click: "[data-k='3']" }, { click: "[data-k='=']" }, { wait: ".ia-calc-main:text-is('15')" }] },
  { name: "answer-units-blank", path: "/search?q=unit%20converter", steps: [{ wait: ".ia-num >> nth=1" }, { fill: [".ia-num >> nth=0", "2.5"] }] },
  { name: "answer-currency-blank", path: "/search?q=currency%20converter", steps: [{ wait: ".ia-fx-big" }] },
  { name: "answer-time-local", path: "/search?q=what%20time%20is%20it", steps: [{ wait: ".ia-time-big:not(:empty)" }] },
  { name: "answer-sports", path: "/search?q=lakers%20score" },
  { name: "answer-flight", path: "/search?q=flight%20UA%20902" },
  { name: "didyoumean", path: "/search?q=recieve%20package", steps: [{ wait: ".dym-line" }] },
];
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

const only = opts.only ? new RegExp(opts.only, "i") : null;
const pages = PAGES.filter((p) => !only || only.test(p.name));
if (!pages.length) {
  console.error(`No page matches --only ${opts.only}. Pages: ${PAGES.map((p) => p.name).join(", ")}`);
  process.exit(1);
}
const out = path.resolve(opts.out ?? path.join(root, ".shots"));
await fs.mkdir(out, { recursive: true });
const t0 = Date.now();

// ---------- the server ----------
let server;
let scratch;
const cleanup = async () => {
  if (server && server.exitCode === null) { server.kill(); await once(server, "exit").catch(() => {}); }
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
};
process.on("SIGINT", () => cleanup().finally(() => process.exit(130)));

async function startServer() {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "foogle-shots-"));
  const log = path.join(out, "server.log");
  const env = {
    ...process.env,
    FOOGLE_FAKE_LLM: opts.live ? "" : "1",
    // One visitor takes all these shots; don't rate-limit it.
    RATE_LIMIT_BURST_USD: "off",
  };
  // Fake pictures go to a scratch cache; live ones keep the real disk cache.
  if (!opts.live) env.FOOGLE_IMAGE_CACHE = path.join(scratch, "images");
  server = spawn(process.execPath, ["scripts/start.js", "--port", "0"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  const logFile = createWriteStream(log);
  server.stdout.pipe(logFile);
  server.stderr.pipe(logFile);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start; see ${log}`)), 15_000);
    server.once("exit", (code) => reject(new Error(`server exited (${code}); see ${log}`)));
    server.stdout.on("data", (d) => {
      const port = String(d).match(/http:\/\/localhost:(\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve(`http://localhost:${port}`); }
    });
  });
}

// ---------- the browser ----------
async function launch() {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch();
  } catch (err) {
    if (!/Executable doesn't exist|install/i.test(err.message)) throw err;
    console.log("Installing Playwright's Chromium (one time)…");
    const r = spawnSync("npx", ["playwright", "install", "chromium"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) throw new Error("npx playwright install chromium failed");
    return chromium.launch();
  }
}

// A click is a real one where possible. When something covers the target
// (or it is off screen) the element is clicked by script instead, and the
// shot says so.
async function click(page, selector, timeout, problems) {
  const target = page.locator(selector).first();
  try {
    await target.click({ timeout: Math.min(timeout, 2000) });
  } catch (err) {
    await target.waitFor({ state: "attached", timeout });
    await target.evaluate((el) => el.click());
    problems.push(`${selector} couldn't be clicked for real (${err.message.split("\n").findLast((l) => /intercepts|outside|not visible|not stable/.test(l))?.trim() ?? "timed out"}); clicked it by script`);
  }
}

async function runStep(page, step, timeout, problems) {
  if (step.click) return click(page, step.click, timeout, problems);
  if (step.fill) return page.locator(step.fill[0]).first().fill(step.fill[1], { timeout });
  if (step.select) return page.locator(step.select[0]).first().selectOption(step.select[1], { timeout });
  if (step.check) return page.locator(step.check).first().check({ timeout });
  if (step.press) return (page.page?.() ?? page).keyboard.press(step.press); // a frame's keys are its page's
  if (step.url) return page.waitForURL(new RegExp(step.url), { timeout, waitUntil: "load" });
  if (typeof step.wait === "number") return page.waitForTimeout(step.wait);
  if (step.wait) return page.locator(step.wait).first().waitFor({ timeout });
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

async function shoot(browser, base, spec, vp) {
  const timeout = opts.live ? 120_000 : 5_000;
  const context = await browser.newContext(VIEWPORTS[vp]);
  // Sites scroll smoothly, and Playwright can't click a button that is still
  // gliding into view.
  await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    document.head.append(Object.assign(document.createElement("style"), { textContent: "html{scroll-behavior:auto!important}" }));
  }));
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  const file = path.join(out, `${spec.name}-${vp}.png`);
  const started = Date.now();
  try {
    await page.goto(base + spec.path, { waitUntil: "load", timeout });
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    const tab = await tabFrame(page);
    const width = await tab.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    if (width > VIEWPORTS[vp].viewport.width) problems.push(`page is ${width}px wide on a ${VIEWPORTS[vp].viewport.width}px screen (horizontal overflow)`);
    for (const step of spec.steps ?? []) {
      await runStep(spec.browser ? page : tab, step, timeout, problems).catch((err) => { throw new Error(`step ${JSON.stringify(step)}: ${err.message.split("\n")[0]}`); });
    }
    if (spec.steps?.length) await page.waitForTimeout(250); // let toasts and transitions settle
    if (await tab.getByText("collapsed mid-construction").count()) problems.push("page generation failed (collapse notice on the page)");
    if (spec.full !== false && tab !== page.mainFrame()) await unframe(page, tab);
    await page.screenshot({ path: file, fullPage: spec.full !== false, animations: "disabled" });
    return { ...spec, vp, file, ms: Date.now() - started, problems };
  } catch (err) {
    return { ...spec, vp, file: null, ms: Date.now() - started, problems: [...problems, err.message.split("\n")[0]] };
  } finally {
    await context.close();
  }
}

// A top-level visit gets Foogle's browser (lib/browserbar.js), and the page
// is in its visible tab, an iframe. Without the browser (FOOGLE_BROWSER_BAR=0)
// it is the page itself.
async function tabFrame(page) {
  const iframe = await page.$(".views iframe.on");
  return (await iframe?.contentFrame()) ?? page.mainFrame();
}

// A full-page shot can't see past the tab's first screen, so the tab is
// stretched to its page's full height first: the shot is the browser's bar
// over the whole page.
async function unframe(page, tab) {
  const height = await tab.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  await page.addStyleTag({ content: `html,body{height:auto!important;overflow:visible!important}.views{flex:none!important;height:${height}px!important}` });
  await page.waitForTimeout(100);
}

// Run jobs a few at a time.
async function pool(jobs, size) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) { const i = next++; results[i] = await jobs[i](); }
  }));
  return results;
}

// One PNG with every shot: per page, the top of the desktop shot beside the phone shot.
async function contactSheet(browser, results) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const img = (r, cls) => `<div class="${cls}">${r?.file ? `<img src="${pathToFileURL(r.file)}">` : `<p class="missing">${esc(r?.problems?.at(-1) ?? "no shot")}</p>`}</div>`;
  const cards = pages.map((p) => {
    const d = results.find((r) => r.name === p.name && r.vp === "desktop");
    const m = results.find((r) => r.name === p.name && r.vp === "phone");
    const warn = [...(d?.problems ?? []), ...(m?.problems ?? [])].length;
    return `<div class="card"><h2>${esc(p.name)}${warn ? ` <span>⚠ ${warn}</span>` : ""}</h2><div class="pair">${img(d, "d")}${img(m, "m")}</div><p>${esc(p.path)}</p></div>`;
  }).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:20px;background:#e8eaed;font:13px system-ui,sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{background:#fff;border-radius:10px;padding:10px 12px;box-shadow:0 1px 3px rgba(0,0,0,.15)}h2{margin:0 0 8px;font-size:15px}h2 span{color:#c5221f;font-size:12px}
.pair{display:flex;gap:8px;align-items:flex-start}.d,.m{overflow:hidden;height:440px;border:1px solid #dadce0;background:#f8f9fa}.d img,.m img{display:block;width:100%}
.d{width:420px}.m{width:150px}.missing{color:#c5221f;padding:8px;font-size:12px}
p{margin:6px 0 0;color:#5f6368;font-size:11px;word-break:break-all}</style>${cards}`;
  const file = path.join(out, "contact.html");
  await fs.writeFile(file, html);
  const page = await browser.newPage({ viewport: { width: 1860, height: 900 } });
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  const png = path.join(out, "contact.png");
  await page.screenshot({ path: png, fullPage: true });
  await page.close();
  return png;
}

let failed = false;
let browser;
try {
  const base = opts.url?.replace(/\/+$/, "") ?? await startServer();
  console.log(`Foogle at ${base}${opts.url ? "" : opts.live ? " (live model — this costs money)" : " (fake model)"}; ${pages.length} pages × ${Object.keys(VIEWPORTS).length} widths → ${out}`);
  browser = await launch();
  // Both widths of a page run side by side; the server generates the page
  // once and the second request joins it.
  const jobs = pages.flatMap((p) => Object.keys(VIEWPORTS).map((vp) => () => shoot(browser, base, p, vp)));
  const results = await pool(jobs, opts.live ? 3 : 6);
  for (const r of results) {
    console.log(`${r.file ? "✓" : "✗"} ${`${r.name} ${r.vp}`.padEnd(24)} ${String(r.ms).padStart(6)} ms  ${r.file ?? ""}`);
    for (const p of r.problems) console.log(`    ⚠ ${p}`);
    if (!r.file) failed = true;
  }
  console.log(`\nContact sheet: ${await contactSheet(browser, results)}`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s${opts.url ? "" : `; server log: ${path.join(out, "server.log")}`}`);
} catch (err) {
  console.error(err.message);
  failed = true;
} finally {
  await browser?.close();
  await cleanup();
}
process.exit(failed ? 1 : 0);
