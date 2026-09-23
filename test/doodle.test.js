import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  createDoodles, drawDoodle, composeDoodle, balanced, occasionPrompt, scenePrompt, parseOccasion,
  doodleHome, doodleHomepage, doodleRoutes, utcDate, msUntilMidnight, DOODLE_MEDIA,
} from "../lib/doodle.js";

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

const quiet = { log() {}, warn() {} };
const OCCASION = {
  title: "Happy Quiet Sky Day!",
  blurb: "Since 2041 the drones stay grounded for a day & everyone looks up.",
  query: "Quiet Sky Day",
  scene: "Two kids lie on the grass at either end; a planet shows through the o's.",
  colors: ["#4285f4", "#ea4335", "#fbbc05", "#4285f4", "#34a853", "#ea4335"],
};
const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240"><defs><linearGradient id="sky"><stop offset="0" stop-color="#9cf"/></linearGradient></defs><rect width="600" height="240" fill="url(#sky)"/><circle cx="60" cy="120" r="30" fill="#c63"/><text x="10" y="20">FOOGLE</text><g id="front"><circle cx="400" cy="50" r="6" fill="#333"/></g></svg>`;

// A model that answers both doodle prompts, counting its calls. `hold`
// makes the occasion wait until released, like a slow model.
function stubModel({ occasion = OCCASION, scene = SCENE, fail = null, hold = false } = {}) {
  const calls = { write: [], draw: [] };
  let release;
  const held = hold ? new Promise((r) => { release = r; }) : null;
  return {
    calls,
    release: () => release?.(),
    write: async (spec) => {
      calls.write.push(spec);
      if (held) await held;
      if (fail) throw new Error(fail);
      return JSON.stringify({ ...occasion, medium: occasionPrompt("2026-09-23").media[0] });
    },
    draw: async (spec) => {
      calls.draw.push(spec);
      return { mime: "image/svg+xml", buf: Buffer.from(scene) };
    },
  };
}

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "foogle-doodle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const clock = (iso) => {
  let t = Date.parse(iso);
  const now = () => t;
  now.set = (next) => { t = Date.parse(next); };
  now.add = (ms) => { t += ms; };
  return now;
};

// Background work (a disk read, then the model) settles on its own time.
async function until(ok) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(ok());
}

const HOME = `<main>\n    <div class="logo"><span class="b1">F</span><span class="r">o</span><span class="y">o</span><span class="b1">g</span><span class="g">l</span><span class="r">e</span></div>\n    <form action="/search"></form></main>`;

test("the day's doodle is drawn once, then comes from memory and, after a restart, from disk", async (t) => {
  const dir = await tempDir(t);
  const now = clock("2026-09-23T08:00:00Z");
  const model = stubModel();
  const doodles = createDoodles({ dir, model: "test-model", write: model.write, draw: model.draw, now, log: quiet });
  const doodle = await doodles.ensure();
  assert.equal(doodle.date, "2026-09-23");
  assert.equal(doodle.title, OCCASION.title);
  assert.match(doodle.svg, /^<svg xmlns/);
  assert.equal(doodles.current(), doodle);
  await doodles.ensure();
  doodles.current();
  assert.equal(model.calls.write.length, 1);
  assert.equal(model.calls.draw.length, 1);
  assert.deepEqual(await readdir(dir), [`doodle-2026-09-23-${createHash("sha1").update("test-model").digest("hex").slice(0, 8)}.json`]);

  // A restart finds it on disk and never asks the model.
  const again = stubModel({ fail: "should not be asked" });
  const restarted = createDoodles({ dir, model: "test-model", write: again.write, draw: again.draw, now, log: quiet });
  assert.equal(restarted.current(), null); // still reading the disk
  assert.equal((await restarted.ensure()).svg, doodle.svg);
  assert.equal(restarted.current().title, OCCASION.title);
  assert.equal(again.calls.write.length, 0);

  // Another model's doodles are its own, like pictures.
  const other = stubModel();
  await createDoodles({ dir, model: "fake-model", write: other.write, draw: other.draw, now, log: quiet }).ensure();
  assert.equal(other.calls.write.length, 1);
});

test("the first visitor gets the plain logo at once; the doodle is swapped in on a later load", async (t) => {
  const now = clock("2026-09-23T08:00:00Z");
  const model = stubModel({ hold: true });
  const doodles = createDoodles({ dir: await tempDir(t), write: model.write, draw: model.draw, now, log: quiet });
  assert.equal(doodles.current(), null);
  assert.equal(doodleHome(HOME, doodles.current()), HOME);
  await until(() => model.calls.write.length === 1);
  assert.equal(doodleHome(HOME, doodles.current()), HOME);
  assert.equal(model.calls.write.length, 1, "visits while it's being drawn don't start another");
  model.release();
  await doodles.ensure();

  const html = doodleHome(HOME, doodles.current());
  assert.doesNotMatch(html, /class="logo"/);
  assert.match(html, /<a class="doodle" href="\/search\?q=Quiet%20Sky%20Day" title="Happy Quiet Sky Day!&#10;Since 2041 the drones stay grounded for a day &amp; everyone looks up\.">/);
  assert.match(html, /<img src="\/doodle\/2026-09-23\.svg\?v=\w{10}" width="600" height="240" alt="Happy Quiet Sky Day! — Foogle Doodle">/);
  assert.match(html, /<form action="\/search"><\/form>/, "the rest of the page is untouched");
});

test("a new UTC day gets its own doodle, drawn just after midnight", async (t) => {
  const now = clock("2026-09-23T23:59:59Z");
  const model = stubModel();
  const doodles = createDoodles({ dir: await tempDir(t), write: model.write, draw: model.draw, now, log: quiet });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => doodles.stop());
  doodles.start();
  await doodles.ensure();
  assert.equal(doodles.current().date, "2026-09-23");
  assert.match(model.calls.write[0].user, /September 23, 2066/);

  // Midnight: yesterday's doodle is gone, and the timer starts today's.
  now.set("2026-09-24T00:00:01Z");
  t.mock.timers.tick(msUntilMidnight(Date.parse("2026-09-23T23:59:59Z")) + 1000);
  await until(() => model.calls.write.length === 2);
  assert.match(model.calls.write[1].user, /September 24, 2066/);
  assert.equal(doodles.current(), null);
  await doodles.ensure();
  assert.equal(doodles.current().date, "2026-09-24");
  assert.equal(model.calls.write.length, 2);

  // A server that slept through midnight catches up on the next visit.
  now.set("2026-09-26T09:00:00Z");
  assert.equal(doodles.current(), null);
  await doodles.ensure();
  assert.equal(doodles.current().date, "2026-09-26");

  assert.equal(utcDate(Date.parse("2026-09-23T23:59:59Z")), "2026-09-23");
  assert.equal(msUntilMidnight(Date.parse("2026-09-23T23:59:59Z")), 1000);
  assert.equal(msUntilMidnight(Date.parse("2026-09-24T00:00:00Z")), 86_400_000);
});

test("any failure keeps the plain logo, and it tries again later, a few times a day at most", async (t) => {
  const now = clock("2026-09-23T08:00:00Z");
  const model = stubModel({ fail: "model unavailable" });
  const warnings = [];
  const doodles = createDoodles({ dir: await tempDir(t), write: model.write, draw: model.draw, now, log: { log() {}, warn: (m) => warnings.push(m) } });
  assert.equal(await doodles.ensure(), null);
  assert.equal(doodles.current(), null);
  assert.equal(doodleHome(HOME, doodles.current()), HOME);
  assert.match(warnings[0], /2026-09-23 failed: model unavailable; trying again in 15 min/);
  // Visits don't hammer the model; after a while one tries again.
  for (let i = 0; i < 5; i++) doodles.current();
  assert.equal(model.calls.write.length, 1);
  now.add(15 * 60_000);
  await doodles.ensure();
  assert.equal(model.calls.write.length, 2);
  now.add(60 * 60_000);
  await doodles.ensure();
  now.add(6 * 60 * 60_000);
  await doodles.ensure();
  assert.equal(model.calls.write.length, 3, "three tries a day");
  assert.match(warnings.at(-1), /keeping the plain logo today/);
  // The next day starts afresh.
  now.set("2026-09-24T00:00:01Z");
  await doodles.ensure();
  assert.equal(model.calls.write.length, 4);
});

test("a doodle with a bad occasion or a broken scene fails rather than reaching the homepage", async () => {
  const draw = (scene) => async () => ({ buf: Buffer.from(scene) });
  const write = (o) => async () => JSON.stringify(o);
  await assert.rejects(drawDoodle("2026-09-23", { write: async () => "Sorry, I can't.", draw: draw(SCENE) }), /JSON/);
  await assert.rejects(drawDoodle("2026-09-23", { write: write({ title: "No scene" }), draw: draw(SCENE) }), /no title or scene/);
  await assert.rejects(drawDoodle("2026-09-23", { write: write(OCCASION), draw: draw("<p>not a picture</p>") }), /not an SVG/);
  await assert.rejects(drawDoodle("2026-09-23", { write: write(OCCASION), draw: draw('<svg viewBox="0 0 600 240"><g><rect width="9" height="9"/></svg>') }), /malformed/);
  const ok = await drawDoodle("2026-09-23", { write: write({ ...OCCASION, colors: ["red"], medium: "meme" }), draw: draw(SCENE) });
  assert.deepEqual(ok.colors, ["#4285f4", "#ea4335", "#fbbc05", "#4285f4", "#34a853", "#ea4335"], "unusable colours fall back to Foogle's");
  assert.ok(occasionPrompt("2026-09-23").media.includes(ok.medium), "an unoffered medium falls back to an offered one");
});

test("no doodle is drawn once the day's budget is spent, or when it's turned off", async (t) => {
  const now = clock("2026-09-23T08:00:00Z");
  const model = stubModel();
  const broke = createDoodles({ dir: await tempDir(t), write: model.write, draw: model.draw, now, budgetOk: () => false, log: quiet });
  assert.equal(await broke.ensure(), null);
  assert.equal(broke.current(), null);
  const off = createDoodles({ enabled: false, write: model.write, draw: model.draw, now, log: quiet });
  off.start();
  assert.equal(await off.ensure(), null);
  assert.equal(off.current(), null);
  assert.equal(model.calls.write.length, 0);
});

test("code draws the letters over the scene, so the scene can play with them but never hide them", () => {
  const svg = composeDoodle(SCENE, { colors: OCCASION.colors, medium: "flat" });
  assert.ok(balanced(svg));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 600 240" width="600" height="240">/);
  assert.doesNotMatch(svg, /<text/, "the model's own lettering is dropped");
  const order = ["url(#sky)", 'stroke="#fff" stroke-width="32"', '<g id="front">', 'stroke="#fbbc05"'].map((s) => svg.indexOf(s));
  assert.ok(order.every((i, n) => i > (order[n - 1] ?? -1)), `scene, then outline, then front layer, then letters: ${order}`);
  assert.equal((svg.match(/<path d="M84 160V60H130M84 108H122"/g) ?? []).length, 3, "the F's shadow, outline and colour");

  // Pale letters are darkened to show on their white outline; on a neon
  // sign's dark outline, dim ones are lightened.
  const pale = composeDoodle(SCENE, { colors: Array(6).fill("#fefefe"), medium: "flat" });
  assert.doesNotMatch(pale, /stroke="#fefefe"/);
  const neon = composeDoodle(SCENE, { colors: Array(6).fill("#101010"), medium: "neon" });
  assert.match(neon, /stroke="#140a26"/);
  assert.doesNotMatch(neon, /stroke="#101010"/);
  assert.match(composeDoodle(SCENE, { medium: "woodcut" }), /filter="url\(#foogle-rough\)"/);

  // A scene drawn at another size still fills the canvas.
  assert.match(composeDoodle(SCENE.replace('viewBox="0 0 600 240"', 'viewBox="0 0 1200 480"')), /<svg viewBox="0 0 1200 480" width="600" height="240" preserveAspectRatio="xMidYMid slice">/);
  assert.ok(balanced('<g><path d="M0 0"/><g></g></g>'));
  assert.ok(!balanced("<g><g></g>"));
  assert.ok(!balanced("<g></svg>"));
});

test("prompts are the same all day, differ between days, and tell the model where the letters are", () => {
  assert.deepEqual(occasionPrompt("2026-09-23"), occasionPrompt("2026-09-23"));
  const days = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"].map(occasionPrompt);
  assert.ok(new Set(days.map((d) => d.user)).size >= 4);
  assert.ok(new Set(days.map((d) => d.media.join())).size >= 4);
  for (const d of days) {
    assert.equal(d.media.length, 3);
    assert.ok(d.media.every((m) => DOODLE_MEDIA.includes(m)));
  }
  assert.match(days[0].system, /today is Thursday, September 23, 2066/);
  const scene = scenePrompt(parseOccasion(JSON.stringify(OCCASION)));
  assert.match(scene.system, /viewBox="0 0 600 240"/);
  assert.equal((scene.system.match(/^- [Fogle]: /gm) ?? []).length, 6, "one line per letter");
  assert.match(scene.system, /<g id="front">/);
  assert.match(scene.user, /^Occasion: Happy Quiet Sky Day!/);
});

test("the homepage, the doodle's picture and the archive are served", async (t) => {
  const dir = await tempDir(t);
  const now = clock("2026-09-21T08:00:00Z");
  const model = stubModel();
  const doodles = createDoodles({ dir, write: model.write, draw: model.draw, now, log: quiet });
  for (const day of ["2026-09-21", "2026-09-22", "2026-09-23"]) {
    now.set(`${day}T08:00:00Z`);
    await doodles.ensure();
  }
  // As server.js wires it: the homepage is the static file until there's a doodle.
  const serve = (d) => {
    const app = express();
    app.get("/", doodleHomepage(path.join(PUBLIC, "index.html"), () => d.current()));
    app.use(express.static(PUBLIC));
    app.use(doodleRoutes(d));
    const server = app.listen(0);
    t.after(() => server.close());
    return `http://localhost:${server.address().port}`;
  };
  const base = serve(doodles);

  const home = await fetch(`${base}/`);
  assert.equal(home.headers.get("cache-control"), "no-cache");
  const html = await home.text();
  assert.doesNotMatch(html, /<div class="logo">/);
  assert.match(html, /<a class="doodle" href="\/search\?q=Quiet%20Sky%20Day"[^>]*><img src="\/doodle\/2026-09-23\.svg\?v=/);
  assert.match(html, /I'm Feeling Lucky/, "the rest of the real homepage is there");
  const plain = await (await fetch(`${serve(createDoodles({ enabled: false }))}/`)).text();
  assert.match(plain, /<div class="logo">/);
  assert.doesNotMatch(plain, /class="doodle"/);

  const svg = await fetch(`${base}/doodle/2026-09-22.svg`);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.match(svg.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await svg.text(), /^<svg xmlns/);
  assert.equal((await fetch(`${base}/doodle/2026-01-01.svg`)).status, 404);
  assert.equal((await fetch(`${base}/doodle/..%2F..%2Fetc.svg`)).status, 404);

  // A restarted server lists every day from the disk, newest first.
  const restarted = createDoodles({ dir, write: model.write, draw: model.draw, now, log: quiet });
  const page = await (await fetch(`${serve(restarted)}/doodles`)).text();
  assert.deepEqual([...page.matchAll(/<div class="date">([^<]+)<\/div>/g)].map((m) => m[1]), ["September 23, 2026", "September 22, 2026", "September 21, 2026"]);
  assert.match(page, /<a class="card" href="\/search\?q=Quiet%20Sky%20Day"/);
  assert.equal(model.calls.write.length, 3);
});
