// The Foogle Doodle. Once a day (by UTC date) the model invents an occasion
// in Foogle's world (an invented inventor's birthday, a holiday of the 2060s,
// the anniversary of something that never happened) and draws a scene for
// it, which takes the logo's place on the homepage. Hovering it names the
// occasion; clicking it searches for it, as Google's do.
//
// The model never draws the letters. Code draws "Foogle" in chunky rounded
// strokes with an outline, over the model's scene, and the prompt tells the
// model where each letter will be, so the scene can play with them (something
// seen through the o's, a character on top of the l) while the word stays
// legible whatever gets drawn.
//
// Nobody waits for it. It is drawn in the background at startup and at each
// UTC midnight, and until it is ready, or if drawing it fails, the homepage
// keeps the plain logo. Each day's doodle is kept in memory and in the image
// disk cache, so a restart doesn't draw it again, and /doodles lists them.

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Router } from "express";
import { completeText, drawSVG, extractJSON, config } from "./llm.js";
import { STYLES as MEDIA, hash } from "./images.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const msUntilMidnight = (ms) => 86_400_000 - (ms % 86_400_000);

// ---------- the occasion ----------
// Foogle's world runs this many years ahead of ours, so the 2060s are recent
// history and every anniversary adds up from the same "now".
const YEARS_AHEAD = 40;
// Seeded by the date, so each day asks for a different kind of occasion and
// the same date always sends the same prompt (record and replay rely on it).
const KINDS = [
  "the birthday of an invented inventor, scientist, explorer or artist (say which birthday)",
  "the anniversary of an invented moment from the 2030s to the 2050s (say which anniversary)",
  "a holiday the world has come to celebrate by now, and how people mark it",
  "an invented festival, race, contest or tradition, held this year somewhere specific",
  "a milestone of the early 2060s that happened on this very day",
];
const FIELDS = [
  "space travel", "the deep sea", "music", "food and cooking", "trains, ships and flight", "cities and architecture",
  "gardens and forests", "medicine", "weather", "games and sport", "books and libraries", "animals", "energy",
  "crafts and making", "mathematics", "film and animation", "fashion and textiles", "the post and messages",
  "archaeology", "astronomy", "mountains", "rivers and bridges", "toys", "photography",
];
// Media from lib/images.js that suit an illustration with words laid over it
// (no photos, charts or media that bring their own lettering).
export const DOODLE_MEDIA = ["flat", "watercolor", "pixel", "woodcut", "collage", "render3d", "isometric", "line", "painting", "neon"];

const pick = (list, seed) => list[hash(seed) % list.length];

// Three media per day to choose from: variety across days, but the model can
// still pick the one that suits the occasion.
function mediaFor(date) {
  return [...DOODLE_MEDIA].sort((a, b) => hash(`${date}|${a}`) - hash(`${date}|${b}`)).slice(0, 3);
}

export function occasionPrompt(date) {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  const now = new Date(Date.UTC(year + YEARS_AHEAD, month - 1, dayOfMonth, 12));
  const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const media = mediaFor(date);
  return {
    system: `You run the Foogle Doodle. Foogle is the search engine of an invented future web, and every day its homepage logo becomes a doodle, like a Google Doodle, celebrating an occasion from its world. Invent today's occasion. In Foogle's world today is ${day}: every year you mention, and every anniversary or birthday you count, must add up from ${now.getUTCFullYear()}.

Output ONLY a JSON object, no fences:
{"title": "...", "blurb": "...", "query": "...", "scene": "...", "medium": "...", "colors": ["#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb"]}

- title: how the doodle is titled, under 55 characters, in the style of "Celebrating Odile Varga's 150th Birthday", "Happy Quiet Sky Day!" or "25 Years of the Lunar Post".
- blurb: one line under 130 characters: what it is and why it matters, with specific names, places and years, told as real history (never mention that it is invented).
- query: what a curious visitor would type into a search box to learn more, 2 to 6 words.
- scene: two sentences for the illustrator. The word "Foogle" is added across the middle of the picture afterwards, in plain rounded letters of the colours below, so don't describe the letters themselves (what they're made of, how they look). Describe what surrounds them and how the scene plays with them: who stands at either end and what they're doing, what is seen through the holes of the two o's, what sits on top of the F or the l. Concrete, drawable things; no writing, signs or numbers.
- medium: the one of ${media.join(", ")} that suits the occasion best.
- colors: the six letters' colours, F o o g l e, from the scene's palette. Saturated mid-to-dark tones that show up on white (no pale or pastel colours), not all the same.`,
    user: `Today is ${day}. Today's occasion is ${pick(KINDS, date)}, to do with ${pick(FIELDS, `${date}|field`)}.`,
    media,
  };
}

const GOOGLE_COLORS = ["#4285f4", "#ea4335", "#fbbc05", "#4285f4", "#34a853", "#ea4335"];
const HEX = /^#(?:[0-9a-f]{3}){1,2}$/i;

// The model's JSON, checked and filled in. Throws if there's no occasion.
export function parseOccasion(text, media = DOODLE_MEDIA) {
  const o = extractJSON(String(text));
  const title = clip(o?.title, 80);
  const scene = clip(o?.scene, 700);
  if (!title || !scene) throw new Error("the occasion has no title or scene");
  const colors = Array.isArray(o.colors) ? o.colors.slice(0, 6).map((c) => String(c).trim().toLowerCase()) : [];
  return {
    title,
    blurb: clip(o.blurb, 200),
    query: clip(o.query, 80) || title,
    scene,
    medium: media.includes(o.medium) ? o.medium : media[0],
    colors: colors.length === 6 && colors.every((c) => HEX.test(c)) ? colors : GOOGLE_COLORS,
  };
}

// ---------- the letters ----------
export const W = 600;
export const H = 240;
const STROKE = 20;
const OUTLINE = 6;
const ring = (cx) => `M${cx - 30} 130a30 30 0 1 0 60 0a30 30 0 1 0 -60 0`;
// Centre lines of a rounded, single-weight "Foogle", drawn with a 20-unit
// stroke: its outside edge runs from x 74 to 526 and y 50 to 210.
const GLYPHS = [
  { ch: "F", d: "M84 160V60H130M84 108H122", post: [74, 140], note: "an upright stroke with two arms pointing right" },
  { ch: "o", d: ring(190), ring: [190, 130] },
  { ch: "o", d: ring(278), ring: [278, 130] },
  { ch: "g", d: `${ring(366)}M396 100V178a28 28 0 0 1 -52 14`, ring: [366, 130], note: "a tail hangs from its right side and curls left, down to y {tail}" },
  { ch: "l", d: "M426 60V160", post: [416, 436], note: "a single upright post" },
  { ch: "e", d: "M456 130H516A30 30 0 1 0 507 151", ring: [486, 130], note: "a bar crosses its middle and it is open at the lower right" },
];
// Smaller than the canvas, leaving room at both ends for the scene's
// characters and above for its sky.
const SCALE = 0.76;
const DX = Math.round(W / 2 - 300 * SCALE);
const DY = 17;
const at = (v, d) => Math.round(v * SCALE + d);
const LETTERS_AT = `translate(${DX} ${DY}) scale(${SCALE})`;
const BOX = { left: at(74, DX), right: at(526, DX), top: at(50, DY), base: at(170, DY), bottom: at(210, DY) };

// Where each letter is, in the canvas's own coordinates, for the prompt.
function layout() {
  const r = (n) => Math.round(n * SCALE);
  return GLYPHS.map((g) => {
    if (g.post) {
      const [x1, x2] = g.post;
      return `- ${g.ch}: ${g.note}, x ${at(x1, DX)} to ${at(x2, DX)}, from y ${BOX.top} down to the baseline at y ${BOX.base}. Its top is a ledge things can stand on.`;
    }
    const [cx, cy] = g.ring;
    const note = g.note ? `; ${g.note.replace("{tail}", BOX.bottom)}` : "";
    return `- ${g.ch}: a ring around (${at(cx, DX)},${at(cy, DY)}), outer radius ${r(40)}, with a see-through hole of radius ${r(20)}${note}. Its top is at y ${at(cy - 40, DY)}.`;
  }).join("\n");
}

// The letters take on a little of the picture's medium (paper edges, a neon
// glow, a glossy highlight), never enough to lose their shape.
const FINISHES = {
  woodcut: "rough", collage: "rough", watercolor: "rough", line: "rough", painting: "rough",
  render3d: "gloss", isometric: "gloss",
  neon: "neon",
  pixel: "square",
};

// A letter's colour must stand out from its outline: on white, anything
// paler than Foogle's own yellow is darkened; on a neon sign's dark outline,
// anything dim is lightened.
function inkColor(hex, dark = false) {
  let rgb = (hex.length === 4 ? [...hex.slice(1)].map((c) => c + c) : hex.slice(1).match(/../g)).map((h) => parseInt(h, 16));
  const lum = () => rgb.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  if (dark) while (lum() < 0.3) rgb = rgb.map((v) => Math.round(v + (255 - v) * 0.15));
  else if (lum() > 0.58) while (lum() > 0.45) rgb = rgb.map((v) => Math.round(v * 0.9));
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ---------- the scene ----------
export function scenePrompt(occasion) {
  const st = MEDIA[occasion.medium] ?? MEDIA.flat;
  return {
    system: `You illustrate the Foogle Doodle: the playful picture that replaces Foogle's logo on its homepage for a day, like a Google Doodle. Output ONLY a standalone SVG starting with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"> — no markdown fences, no commentary, no <script>, no <foreignObject>, no <image>, no external references.

The word "Foogle" is laid over your picture afterwards, in big rounded letters with an outline. Draw everything except the letters: never draw them, their outlines or their shadows, even if the scene describes them, and no other letters, words, numbers or signs either. Where the letters will be:
${layout()}
The word spans x ${BOX.left} to ${BOX.right} and y ${BOX.top} to ${BOX.bottom}; the rest of the canvas is yours.

Make the letters part of the scene, the way Google Doodles do:
- The word stands on the ground: unless the scene is in the sky or in space, put its ground, floor, shore, stage or seabed at y ${BOX.base}, across the full width, so the letters stand on it.
- The occasion's main characters (people, animals, machines) are big, nearly as tall as the letters, at the two ends of the word (x 0-${BOX.left - 5} and ${BOX.right + 5}-${W}), doing something to do with the occasion and with the letters: leaning on the F, climbing the l, reaching into an o.
- In the holes of the o's, g and e: something small and bright (a planet, an eye, a clock face, a porthole's view), never plain black.
- Things perched on the letters' tops or hanging from them; above the word (y 0-${BOX.top}), room for flying things, bunting, stars or a sun.
- Behind the letters keep it calm (sky, a wall, water, a soft pattern) so the word stays easy to read; rich detail everywhere else, a full-bleed background and a hint of motion or celebration.

Front layer: end the SVG with <g id="front">…</g> holding 2 to 5 small things that overlap the letters' edges, like a cap on the F, a bird on the l or a streamer across the o's. It is drawn over the letters' outline but under their colour, so it can touch the letters without hiding them.

Medium — ${st.label}: ${st.brief} Adapt it to a doodle: the word takes the middle of the canvas.

Fill the whole ${W}x${H} canvas. Integer coordinates, compact paths (short d strings, no decimals), reuse <defs> for gradients, patterns and filters. Keep it under 3500 characters.`,
    user: `Occasion: ${occasion.title}. ${occasion.blurb}\nScene: ${occasion.scene}\nMedium: ${st.label}.\nThe letters' colours, F to e: ${occasion.colors.join(", ")}; make the background contrast with them.`,
  };
}

// An SVG image with an unclosed tag shows nothing at all, so the scene's
// markup is checked before it goes near the homepage.
export function balanced(xml) {
  const open = [];
  for (const [, close, name, rest] of String(xml).replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    if (close) {
      if (open.pop() !== name) return false;
    } else if (!rest.trimEnd().endsWith("/")) open.push(name);
  }
  return open.length === 0;
}

// The finished doodle: the model's scene, the letters' shadow and outline,
// the scene's front layer, then the letters' colour on top of everything.
export function composeDoodle(sceneSVG, { colors = GOOGLE_COLORS, medium = "flat" } = {}) {
  const svg = String(sceneSVG).replace(/<text\b[\s\S]*?<\/text>|<text\b[^>]*\/>/gi, "");
  const open = svg.match(/^<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/)?.[0];
  const end = svg.lastIndexOf("</svg>");
  if (!open || end === -1) throw new Error("the scene is not an SVG");
  const viewBox = open.match(/viewBox\s*=\s*["']([-\d.\s,]+)["']/)?.[1] ?? `0 0 ${W} ${H}`;
  const body = svg.slice(open.length, end);
  if (!balanced(body)) throw new Error("the scene's SVG is malformed");
  const cut = body.lastIndexOf('<g id="front"');
  const split = cut > 0 && balanced(body.slice(0, cut)) && balanced(body.slice(cut));
  const [back, front] = split ? [body.slice(0, cut), body.slice(cut)] : [body, ""];
  // Nested in its own viewport, so a scene drawn at another size still fills
  // the canvas and its front layer lines up with it.
  const layer = (content) => `<svg viewBox="${viewBox}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">${content}</svg>`;

  const finish = FINISHES[medium];
  const neon = finish === "neon";
  const caps = finish === "square" ? `stroke-linecap="square" stroke-linejoin="miter"` : `stroke-linecap="round" stroke-linejoin="round"`;
  const strokes = (attrs, each = () => "") => `<g fill="none" ${caps} transform="${LETTERS_AT}" ${attrs}>${GLYPHS.map((g, i) => `<path d="${g.d}"${each(i)}/>`).join("")}</g>`;
  const rough = finish === "rough" ? ` filter="url(#foogle-rough)"` : "";
  const halo = STROKE + 2 * OUTLINE;
  const ink = GLYPHS.map((_, i) => inkColor(HEX.test(colors[i] ?? "") ? colors[i] : GOOGLE_COLORS[i], neon));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<defs><filter id="foogle-shadow" x="-5%" y="-5%" width="110%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>`
    + `<filter id="foogle-rough"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="6"/></filter>`
    + `<filter id="foogle-glow" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
    + layer(back)
    + (neon ? "" : `<g filter="url(#foogle-shadow)" opacity=".3"><g transform="translate(2 4)">${strokes(`stroke="#000" stroke-width="${halo}"`)}</g></g>`)
    + strokes(`stroke="${neon ? "#140a26" : "#fff"}" stroke-width="${halo}"${rough}`)
    + (front ? layer(front) : "")
    + strokes(`stroke-width="${STROKE}"${neon ? ` filter="url(#foogle-glow)"` : ""}`, (i) => ` stroke="${ink[i]}"`)
    + (finish === "gloss" ? `<g transform="translate(-2 -3)">${strokes(`stroke="#fff" stroke-opacity=".35" stroke-width="4"`)}</g>` : "")
    + (neon ? strokes(`stroke="#fff" stroke-opacity=".6" stroke-width="5"`) : "")
    + `</svg>`;
}

// One day's doodle, start to finish: two model calls, ~10-20s.
export async function drawDoodle(date, { write = completeText, draw = drawSVG } = {}) {
  const ask = occasionPrompt(date);
  const occasion = parseOccasion(await write({ system: ask.system, user: ask.user, maxTokens: 700, temperature: config.tempResults }), ask.media);
  const scene = await draw(scenePrompt(occasion), { maxTokens: 4000 });
  const svg = composeDoodle(Buffer.isBuffer(scene?.buf) ? scene.buf.toString("utf8") : String(scene), occasion);
  return { date, ...occasion, svg, v: createHash("sha1").update(svg).digest("hex").slice(0, 10) };
}

// ---------- the day's doodle ----------
const MAX_TRIES = 3; // per day
const RETRY_MS = 15 * 60_000; // times the number of tries so far
const KEEP = 7; // days kept in memory; the disk keeps the rest

export function createDoodles({
  enabled = true,
  dir, // the image disk cache (optional)
  model = config.model, // doodles are kept per model, like pictures
  write = completeText,
  draw = drawSVG,
  budgetOk = () => true, // lib/limits.js withinBudget
  now = Date.now,
  log = console,
} = {}) {
  const ready = new Map(); // date -> doodle
  const running = new Map(); // date -> Promise<doodle | null>
  const tries = new Map(); // date -> { count, after }
  const tag = createHash("sha1").update(String(model)).digest("hex").slice(0, 8);
  const file = (date) => path.join(dir, `doodle-${date}-${tag}.json`);
  const FILE = new RegExp(`^doodle-(\\d{4}-\\d{2}-\\d{2})-${tag}\\.json$`);
  let timer = null;

  function remember(doodle) {
    ready.set(doodle.date, doodle);
    for (const d of [...ready.keys()].sort().slice(0, -KEEP)) ready.delete(d);
    return doodle;
  }

  async function load(date) {
    if (!dir) return null;
    try {
      const d = JSON.parse(await fs.readFile(file(date), "utf8"));
      return d?.date === date && d.svg && d.title ? d : null;
    } catch {
      return null;
    }
  }

  // Write-then-rename, so a half-written file is never read back.
  async function save(doodle) {
    if (!dir) return;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(`${file(doodle.date)}.tmp`, JSON.stringify(doodle));
      await fs.rename(`${file(doodle.date)}.tmp`, file(doodle.date));
    } catch (err) {
      log.warn(`[doodle] disk cache write failed: ${err.message}`);
    }
  }

  // The day's doodle: from memory, from disk, or drawn now. Resolves to null
  // (never rejects) when it can't be had yet.
  function ensure(date = utcDate(now())) {
    if (!enabled) return Promise.resolve(null);
    if (ready.has(date)) return Promise.resolve(ready.get(date));
    if (running.has(date)) return running.get(date);
    const t = tries.get(date) ?? { count: 0, after: 0 };
    if (t.count >= MAX_TRIES || now() < t.after) return Promise.resolve(null);
    const task = (async () => {
      const saved = await load(date);
      if (saved) return remember(saved);
      if (!budgetOk()) {
        tries.set(date, { count: MAX_TRIES, after: Infinity });
        log.warn(`[doodle] ${date}: the day's budget is spent; keeping the plain logo`);
        return null;
      }
      t.count++;
      tries.set(date, t);
      const t0 = now();
      try {
        const doodle = await drawDoodle(date, { write, draw });
        log.log(`[doodle] ${date}: "${doodle.title}" (${doodle.medium}) in ${((now() - t0) / 1000).toFixed(1)}s`);
        await save(doodle);
        return remember(doodle);
      } catch (err) {
        t.after = now() + RETRY_MS * t.count;
        log.warn(`[doodle] ${date} failed: ${err.message}; ${t.count < MAX_TRIES ? `trying again in ${RETRY_MS * t.count / 60_000} min` : "keeping the plain logo today"}`);
        return null;
      }
    })().catch((err) => {
      log.warn(`[doodle] ${date}: ${err.message}`);
      return null;
    }).finally(() => running.delete(date));
    running.set(date, task);
    return task;
  }

  // What the homepage shows now: today's doodle, or null for the plain logo.
  // A new day, or a retry that's due, starts drawing in the background, so
  // no visitor ever waits for it.
  function current() {
    const date = utcDate(now());
    const doodle = ready.get(date);
    if (!doodle) ensure(date);
    return doodle ?? null;
  }

  const get = async (date) => ready.get(date) ?? (await load(date));

  // Every day's doodle this model has drawn, newest first.
  async function archive({ limit = 60 } = {}) {
    const names = dir ? await fs.readdir(dir).catch(() => []) : [];
    const dates = new Set([...names.map((n) => n.match(FILE)?.[1]).filter(Boolean), ...ready.keys()]);
    const days = [...dates].sort().reverse().slice(0, limit);
    return (await Promise.all(days.map(get))).filter(Boolean);
  }

  // Draw today's now, and each day's just after midnight UTC.
  function start() {
    if (!enabled || timer) return;
    const tick = () => {
      ensure();
      timer = setTimeout(tick, msUntilMidnight(now()) + 1000);
      timer.unref?.();
    };
    tick();
  }
  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };

  return { current, ensure, get, archive, start, stop };
}

// ---------- the homepage and the archive ----------
const LOGO = /<div class="logo">[\s\S]*?<\/div>/;
const DOODLE_CSS = `.doodle{display:block;margin-bottom:22px;line-height:0;border-radius:12px;outline-offset:4px}.doodle img{width:min(520px,calc(100vw - 32px));height:auto;border-radius:14px}`;

const hover = (d) => (d.blurb ? `${d.title}\n${d.blurb}` : d.title);
const searchHref = (d) => `/search?q=${encodeURIComponent(d.query || d.title)}`;
const doodleSrc = (d) => `/doodle/${d.date}.svg?v=${d.v ?? ""}`;

// The homepage with the doodle in the logo's place; unchanged without one.
export function doodleHome(html, doodle) {
  if (!doodle) return html;
  const link = `<style>${DOODLE_CSS}</style><a class="doodle" href="${esc(searchHref(doodle))}" title="${esc(hover(doodle)).replace(/\n/g, "&#10;")}"><img src="${esc(doodleSrc(doodle))}" width="${W}" height="${H}" alt="${esc(doodle.title)} — Foogle Doodle"></a>`;
  return html.replace(LOGO, () => link);
}

// GET / while there is a doodle: the homepage file with the doodle in it.
// Without one it passes, and the homepage is served as the static file.
export function doodleHomepage(file, current) {
  return async (req, res, next) => {
    const doodle = current();
    if (!doodle) return next();
    try {
      // Revalidated on every load, so the next day's doodle shows up.
      res.set("Cache-Control", "no-cache").type("html").send(doodleHome(await fs.readFile(file, "utf8"), doodle));
    } catch (err) {
      next(err);
    }
  };
}

const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function archivePage(doodles) {
  const cards = doodles.map((d) => `<a class="card" href="${esc(searchHref(d))}" title="${esc(hover(d)).replace(/\n/g, "&#10;")}">
  <img src="${esc(doodleSrc(d))}" width="${W}" height="${H}" loading="lazy" alt="${esc(d.title)}">
  <div class="date">${esc(longDate(d.date))}</div><h2>${esc(d.title)}</h2>${d.blurb ? `<p>${esc(d.blurb)}</p>` : ""}
</a>`).join("\n");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Foogle Doodles</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:arial,sans-serif;color:#202124}
header{display:flex;align-items:baseline;gap:14px;padding:22px 28px;border-bottom:1px solid #ebebeb}
.logo{font-size:30px;font-weight:500;letter-spacing:-1.5px;text-decoration:none}
.b1{color:#4285f4}.r{color:#ea4335}.y{color:#fbbc05}.g{color:#34a853}
header span{font-size:22px;color:#5f6368}
main{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
.intro{color:#5f6368;font-size:14px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:28px 22px}
.card{display:block;text-decoration:none;color:inherit}
.card img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid #ebebeb}
.card:hover h2{text-decoration:underline}
.date{font-size:12px;color:#70757a;margin:10px 0 4px}
.card h2{font-size:17px;font-weight:400;color:#1a0dab;line-height:1.3}
.card p{font-size:14px;color:#4d5156;line-height:1.5;margin-top:4px}
.empty{color:#5f6368;font-size:15px;padding:40px 0}
</style></head><body>
<header><a class="logo" href="/"><span class="b1">F</span><span class="r">o</span><span class="y">o</span><span class="b1">g</span><span class="g">l</span><span class="r">e</span></a><span>Doodles</span></header>
<main><p class="intro">Every day Foogle's logo celebrates something from the future web. Click one to search for it.</p>
${cards ? `<div class="grid">${cards}</div>` : `<p class="empty">No doodles yet. Today's is being drawn; check back in a minute.</p>`}
</main></body></html>`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function doodleRoutes(doodles) {
  const router = Router();
  router.get("/doodle/:date.svg", async (req, res) => {
    const doodle = DATE.test(req.params.date) && (await doodles.get(req.params.date));
    if (!doodle) return res.status(404).end();
    // Opened directly, an SVG is a document: nothing in it may run or load.
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.type("image/svg+xml").send(doodle.svg);
  });
  router.get("/doodles", async (req, res) => {
    res.type("html").send(archivePage(await doodles.archive()));
  });
  return router;
}
