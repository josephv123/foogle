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
// dialogs and drawers, which sit over the page).
const PAGES = [
  { name: "home", path: "/" },
  { name: "search", path: "/search?q=storm%20lanterns" },
  { name: "images", path: "/images?q=storm%20lanterns" },
  { name: "news", path: "/news?q=harbor%20festival" },
  { name: "maps", path: "/maps?q=late%20night%20ramen" },
  { name: "timelines", path: "/timelines?q=lighthouses" },
  { name: "store", path: STORE },
  { name: "forum", path: web("crumbforum.net/t/starter-smells-like-nail-polish", { q: "sourdough starter", title: "Starter smells like nail polish — help?", kind: "forum" }) },
  { name: "news-site", path: web("harborledger.news/2026/09/harbor-festival-returns", { q: "harbor festival", title: "Harbor Festival Returns After Six Years", kind: "news" }) },
  { name: "wiki", path: web("fogpedia.org/wiki/fog-signal", { q: "fog signals", title: "Fog signal", kind: "wiki" }) },
  // A search naming a real site, and that site's own look (lib/brands.js).
  { name: "known-search", path: "/search?q=cnn" },
  { name: "known-site", path: web("en.wikipedia.org/wiki/Octopus", { q: "wikipedia octopus", title: "Octopus - Wikipedia" }) },
  // With the fake model, a style named in the URL is the one the site gets.
  { name: "zine-retro", path: web("staticbloom.net/web1996/issue-12", { q: "cassette culture", title: "Static Bloom #12: Tape Hiss Forever", kind: "zine" }) },
  { name: "startup-calc", path: web("sunpatch.energy/solar-savings-calculator", { q: "solar savings", title: "Solar Savings Calculator", kind: "startup" }), steps: [{ select: ["[data-calc] select", "2"] }, { check: "[data-calc] input[type=checkbox]" }] },
  { name: "quiz", path: web("keeperquiz.club/which-lighthouse-keeper-are-you", { q: "lighthouse keepers", title: "Which Lighthouse Keeper Are You? A Quiz", kind: "blog" }), steps: [{ click: "[data-q] >> nth=0 >> button >> nth=1" }, { click: "[data-q] >> nth=1 >> button >> nth=0" }, { click: "[data-q] >> nth=2 >> button >> nth=1" }, { wait: ".fw-score:visible" }] },
  { name: "cart", path: STORE, steps: addToCart, full: false },
  {
    name: "checkout", path: STORE, steps: [...addToCart,
      { fill: [".fw-checkout [name=name]", "Ada Moss"] }, { fill: [".fw-checkout [name=email]", "ada@example.com"] }, { fill: [".fw-checkout [name=address]", "1 Pier Rd, Port Avery"] },
      { click: ".fw-checkout button[type=submit]" }, { url: "order=" }, { wait: ".fw-receipt" }],
  },
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
  if (step.press) return page.keyboard.press(step.press);
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
    const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    if (width > VIEWPORTS[vp].viewport.width) problems.push(`page is ${width}px wide on a ${VIEWPORTS[vp].viewport.width}px screen (horizontal overflow)`);
    for (const step of spec.steps ?? []) {
      await runStep(page, step, timeout, problems).catch((err) => { throw new Error(`step ${JSON.stringify(step)}: ${err.message.split("\n")[0]}`); });
    }
    if (spec.steps?.length) await page.waitForTimeout(250); // let toasts and transitions settle
    if (await page.getByText("collapsed mid-construction").count()) problems.push("page generation failed (collapse notice on the page)");
    if (spec.full !== false) await page.addStyleTag({ content: UNFRAME });
    await page.screenshot({ path: file, fullPage: spec.full !== false, animations: "disabled" });
    return { ...spec, vp, file, ms: Date.now() - started, problems };
  } catch (err) {
    return { ...spec, vp, file: null, ms: Date.now() - started, problems: [...problems, err.message.split("\n")[0]] };
  } finally {
    await context.close();
  }
}

// The browser bar (lib/browserbar.js) makes <body> a scroll box under it, and
// a full-page screenshot can't see past the box's first screen. For those,
// the document scrolls as usual, with room at the top for the bar.
const UNFRAME = "html{overflow:visible!important;padding-top:var(--fbar-h,0)!important}body{position:static!important;overflow:visible!important}";

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
