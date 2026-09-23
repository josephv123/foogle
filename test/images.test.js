import test from "node:test";
import assert from "node:assert/strict";
import { STYLES, SHAPES, NEWS_STYLES, imageSpec, imageKey, imageQuery, imageMessages, inferStyle, siteImageStyle } from "../lib/images.js";
import { sanitizeSVG } from "../lib/llm.js";
import { imageShardPrompt, newsShardPrompt } from "../lib/prompts.js";

test("every style has a brief, a label and a real default shape", () => {
  assert.ok(Object.keys(STYLES).length >= 15);
  for (const [key, st] of Object.entries(STYLES)) {
    assert.ok(st.brief.length > 60, key);
    assert.ok(st.label, key);
    assert.ok(Object.hasOwn(SHAPES, st.shape), key);
  }
});

test("a picture's style and shape come from its URL, else from its description", () => {
  assert.deepEqual(imageSpec("a red kettle", { s: "blueprint", a: "tall" }), { description: "a red kettle", style: "blueprint", shape: "tall", palette: null });
  // Old /img URLs carry neither: the medium the description names wins, and
  // the shape is that style's default.
  const old = imageSpec("cutaway diagram of a jet engine");
  assert.equal(old.style, "diagram");
  assert.equal(old.shape, STYLES.diagram.shape);
  assert.equal(imageSpec("a meme about mondays", { s: "not-a-style", a: "hexagon" }).style, "meme");
  assert.equal(imageSpec("a red kettle", { s: "toString" }).style, inferStyle("a red kettle")); // no prototype keys
  // Repeated query params arrive as arrays and are ignored.
  assert.equal(imageSpec("a red kettle", { s: ["photo", "flat"], a: ["wide"] }).shape, STYLES[inferStyle("a red kettle")].shape);
  assert.deepEqual(imageSpec("x", { bg: "#fff", fg: "hsl(20, 50%, 40%)" }).palette, { bg: "#fff", fg: "hsl(20, 50%, 40%)" });
  assert.equal(imageSpec("x", { bg: "#fff", fg: "red;}" }).palette, null);
  assert.equal(imageQuery(imageSpec("x", { s: "map", a: "square" })), "s=map&a=square");
});

test("descriptions that name no medium still get a stable, varied style", () => {
  const plain = ["a quiet harbour", "two foxes in snow", "a bowl of ramen", "an empty tennis court", "grandma's garden", "a lone kayak"];
  for (const d of plain) {
    assert.ok(Object.hasOwn(STYLES, inferStyle(d)));
    assert.equal(inferStyle(d), inferStyle(d));
  }
  assert.ok(new Set(plain.map(inferStyle)).size > 1);
  assert.equal(inferStyle("isometric cutaway of a tiny bakery"), "isometric");
  assert.equal(inferStyle("cutaway of a heat pump"), "diagram");
  assert.equal(inferStyle("pixel art of a castle"), "pixel");
  assert.equal(inferStyle("street map with pins marked A to F"), "map");
});

test("each distinct picture has its own cache key", () => {
  const keys = new Set([
    imageKey(imageSpec("a kettle", { s: "photo" })),
    imageKey(imageSpec("a kettle", { s: "flat" })),
    imageKey(imageSpec("a kettle", { s: "flat", a: "tall" })),
    imageKey(imageSpec("a kettle", { s: "flat", bg: "#fff", fg: "#000" })),
  ]);
  assert.equal(keys.size, 4);
});

test("the drawing brief follows the style, shape and palette", () => {
  const tall = imageMessages(imageSpec("a jazz festival", { s: "poster", a: "tall" }));
  assert.match(tall.system, /viewBox="0 0 280 420"/);
  assert.match(tall.system, /Risograph/);
  assert.match(tall.system, /No words or captions/);
  assert.match(tall.user, /^Picture: a jazz festival\nMedium: risograph poster\.\nColour scheme: /);
  // Media made of words may use a few labels.
  assert.match(imageMessages(imageSpec("rainfall by month", { s: "chart" })).system, /brief labels/);
  // A photo keeps natural colours: no assigned scheme.
  const photo = imageMessages(imageSpec("a harbour", { s: "photo" })).user;
  assert.doesNotMatch(photo, /Colour scheme/);
  // Photographic media get a light, so a page of photos isn't one look.
  assert.match(photo, /\nLight \(unless the picture says otherwise\): \w/);
  assert.doesNotMatch(tall.user, /Light/);
  const lights = new Set(["a harbour", "a bakery", "a bus stop", "a tennis court", "a field", "a kitchen"].map((d) => imageMessages(imageSpec(d, { s: "photo" })).user.split("Light")[1]));
  assert.ok(lights.size > 2);
  // On a site, the palette replaces the scheme.
  const site = imageMessages(imageSpec("a harbour", { s: "flat", bg: "#101418", fg: "#ff3366" }));
  assert.doesNotMatch(site.user, /Colour scheme/);
  assert.match(site.user, /Palette: the image sits on a page with background #101418 and accent #ff3366/);
});

test("a site's pictures share one medium that suits its kind and mood", () => {
  const kinds = ["news", "store", "wiki", "forum", "blog", "startup", "gov", "zine"];
  const moods = ["dark", "light", "paper", "neon", "brutal"];
  const seen = new Set();
  for (const kind of kinds) for (const mood of moods) for (const site of ["a.com", "b.org", "c.net"]) {
    const style = siteImageStyle({ kind, mood, site });
    assert.ok(Object.hasOwn(STYLES, style), `${kind}/${mood}: ${style}`);
    assert.notEqual(style, "meme"); // a whole site of memes would be a joke that wears thin
    assert.equal(siteImageStyle({ kind, mood, site }), style);
    seen.add(style);
  }
  assert.ok(seen.size >= 12, `only ${seen.size} styles across all sites`);
  assert.match(siteImageStyle({ kind: "store", mood: "light", site: "x.com" }), /^(?:product|render3d|photo|sticker|isometric)$/);
  // Kinds or moods the catalog doesn't know still get a picture style.
  assert.ok(Object.hasOwn(STYLES, siteImageStyle({ kind: "museum", mood: "pastel", site: "x.com" })));
});

test("news thumbnails may be charts, maps or scans as well as photos", () => {
  const { system } = newsShardPrompt("port strike", { count: 3, angle: "wire" });
  assert.match(system, /"style": "photo"/);
  for (const key of NEWS_STYLES) assert.ok(Object.hasOwn(STYLES, key), key);
  assert.match(system, /usually photo, sometimes snapshot, chart, map/);
});

test("image search results ask for a style and shape from the catalog", () => {
  const { system } = imageShardPrompt("cats", { count: 4, angle: "memes" });
  for (const key of Object.keys(STYLES)) assert.match(system, new RegExp(`\\b${key} \\(`));
  for (const shape of Object.keys(SHAPES)) assert.match(system, new RegExp(`\\b${shape}\\b`));
});

test("SVG sanitizing keeps filters and gradients but nothing that runs or reaches out", () => {
  const dirty = `Sure! <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<defs><filter id="g"><feTurbulence baseFrequency=".8"/></filter><linearGradient id="s"><stop stop-color="#fff"/></linearGradient></defs>
<script>alert(1)</script><foreignObject><div onclick="x()">hi</div></foreignObject>
<rect onload="alert(1)" fill="url(#s)" filter="url(#g)" width="400" height="300"/><circle onmouseover=alert(1) r="4"/>
<image href="https://evil.example/x.png"/><image xlink:href='http://evil.example/y.png'/><use href="#s"/>
<a href="javascript:alert(1)"><text>R&D</text></a><rect style="fill:url(https://evil.example/z)"/>
<style>@import url(https://evil.example/a.css); rect{fill:url(#s)}</style>
<path fill="#333" d="M0 0h9" fill="none" stroke="#000"/></svg> hope that helps`;
  const clean = sanitizeSVG(dirty);
  assert.match(clean, /^<svg[\s\S]*<\/svg>$/);
  assert.doesNotMatch(clean, /script|foreignObject|onclick|onload|onmouseover|evil\.example|javascript:|@import/i);
  assert.match(clean, /<feTurbulence/);
  assert.match(clean, /fill="url\(#s\)" filter="url\(#g\)"/);
  assert.match(clean, /rect\{fill:url\(#s\)\}/);
  assert.match(clean, /<use href="#s"\/>/);
  // XML repairs: a repeated attribute keeps its last value; a bare & is escaped.
  assert.match(clean, /<path d="M0 0h9" fill="none" stroke="#000"\/>/);
  assert.match(clean, /R&amp;D/);
  assert.throws(() => sanitizeSVG("no picture here"), /did not return an <svg>/);
});
