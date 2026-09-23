import test from "node:test";
import assert from "node:assert/strict";
import { STYLES, SHAPES, imageSpec, sketchSVG, sketchCSS } from "../lib/images.js";

// One stub for the whole file: the OpenAI client is made once per process.
// A request for a held description waits for release().
const calls = [];
const held = new Set();
const waiting = new Map();
const hold = (desc) => held.add(desc);
const release = (desc) => { held.delete(desc); waiting.get(desc)?.(); };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#8cf"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="400" height="300" fill="url(#s)"/><circle cx="300" cy="70" r="40" fill="#fd0"/></svg>';
globalThis.fetch = async (url, init) => {
  const p = JSON.parse(init.body);
  const desc = p.messages[1].content.match(/^Picture: (.*)$/m)?.[1];
  calls.push({ desc, provider: p.provider, stream: p.stream });
  if (held.has(desc)) await new Promise((r) => waiting.set(desc, r));
  const text = desc === "truncated" ? SVG.slice(0, SVG.indexOf("<circle")) + '<circle cx="3' : SVG;
  const chunks = text.match(/[\s\S]{1,24}/g).map((content) => ({ choices: [{ delta: { content }, finish_reason: null }] }));
  chunks.push({ choices: [{ delta: {}, finish_reason: desc === "truncated" ? "length" : "stop" }] });
  return new Response(chunks.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
};
process.env.OPENROUTER_API_KEY = "test";
const { draftSVG, sanitizeSVG, generateImage, FAST_ROUTE } = await import("../lib/llm.js");

test("a draft is the picture so far: complete tags only, open elements closed, sanitized", () => {
  // Nothing drawn while the model is still defining gradients and filters.
  assert.equal(draftSVG(""), null);
  assert.equal(draftSVG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><defs><linearGradient id="s"><stop stop-color="#8cf"/>'), null);
  assert.equal(draftSVG('<svg viewBox="0 0 4 3"><defs><rect id="r" width="4" height="3"/></defs>'), null);
  // A half-written tag is left out; everything still open gets closed.
  assert.equal(
    draftSVG('<svg viewBox="0 0 4 3"><defs><linearGradient id="s"><stop/></linearGradient></defs><g fill="red"><rect width="4" height="3"/><circle cx="1'),
    '<svg viewBox="0 0 4 3"><defs><linearGradient id="s"><stop/></linearGradient></defs><g fill="red"><rect width="4" height="3"/></g></svg>',
  );
  // A ">" inside a quoted value doesn't end the tag.
  assert.equal(draftSVG('<svg viewBox="0 0 4 3"><rect width="4" height="3"/><text x="1" aria-label="a>b">hi</text><path d="M0'), '<svg viewBox="0 0 4 3"><rect width="4" height="3"/><text x="1" aria-label="a>b">hi</text></svg>');
  // Drafts go through the same sanitizer as finished pictures.
  const risky = draftSVG('```svg\n<svg viewBox="0 0 4 3"><rect width="4" height="3" onclick="alert(1)"/><script>alert(2)');
  assert.equal(risky, '<svg viewBox="0 0 4 3"><rect width="4" height="3"/></svg>');
  // An unterminated comment ends the draft rather than breaking it.
  assert.equal(draftSVG('<svg viewBox="0 0 4 3"><rect width="4" height="3"/><!-- <rect'), '<svg viewBox="0 0 4 3"><rect width="4" height="3"/></svg>');
  // Once the model is done, the draft is the finished picture.
  assert.equal(draftSVG(SVG), sanitizeSVG(SVG));
  // Tags are balanced, so a picture with one mismatched tag still draws: a
  // closer under the wrong name closes the innermost element, a stray one
  // never closes the <svg>, and an outer closer closes what's inside it.
  assert.equal(
    draftSVG('<svg viewBox="0 0 4 3"><rect width="4" height="3"/><path d="">OOPS</text><text x="1">HI</text></svg>'),
    '<svg viewBox="0 0 4 3"><rect width="4" height="3"/><path d="">OOPS</path><text x="1">HI</text></svg>',
  );
  assert.equal(draftSVG('<svg viewBox="0 0 4 3"></g><g><rect width="4" height="3"></g></svg>'), '<svg viewBox="0 0 4 3"><g><rect width="4" height="3"></rect></g></svg>');
});

test("a picture's sketch is an SVG of its shape in the colours it will be drawn in", () => {
  for (const style of Object.keys(STYLES)) {
    for (const shape of Object.keys(SHAPES)) {
      const svg = sketchSVG(imageSpec("a harbour at dawn", { s: style, a: shape }));
      assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHAPES[shape].join(" ")}">`));
      assert.doesNotMatch(svg, /undefined|null|NaN/, `${style}/${shape}`);
    }
  }
  // A site's pictures start in its palette; a blueprint stays blue anywhere.
  assert.match(sketchSVG(imageSpec("a harbour", { s: "flat", bg: "#101418", fg: "#ff3366" })), /stop-color="#101418"[\s\S]*stop-color="#ff3366"/);
  assert.doesNotMatch(sketchSVG(imageSpec("a harbour", { s: "blueprint", bg: "#101418", fg: "#ff3366" })), /#ff3366/);
  // Different pictures, different sketches.
  assert.notEqual(sketchSVG(imageSpec("a harbour", { s: "photo" })), sketchSVG(imageSpec("a bakery", { s: "photo" })));
  // A search result shows the same sketch in CSS before its picture is asked for.
  const css = sketchCSS(imageSpec("a harbour", { s: "blueprint" }));
  assert.match(css, /^radial-gradient\(45% 40% at \d+% \d+%, color-mix\(in srgb, #3b73b6 60%, transparent\), transparent\), radial-gradient\([^;"]*\), linear-gradient\(#1f4f8f, #163a6a\)$/);
  assert.match(sketchCSS(imageSpec("a harbour", { s: "flat", bg: "hsl(20, 50%, 40%)", fg: "#ff3366" })), /linear-gradient\(hsl\(20, 50%, 40%\), hsl\(20, 50%, 40%\)\)$/);
});

test("pictures stream from the fastest provider, and one cut off at the token limit is kept", async () => {
  const texts = [];
  const img = await generateImage(imageSpec("a lighthouse", { s: "photo" }), { onText: (t) => texts.push(t) });
  assert.equal(img.mime, "image/svg+xml");
  assert.equal(String(img.buf), sanitizeSVG(SVG));
  assert.ok(texts.length > 3 && texts.at(-1) === SVG, "onText sees the text grow");
  const call = calls.find((c) => c.desc === "a lighthouse");
  assert.equal(call.stream, true);
  assert.deepEqual(call.provider, FAST_ROUTE);
  assert.equal(FAST_ROUTE.sort, "throughput");
  // Everything up to the cut is drawn.
  const cut = await generateImage(imageSpec("truncated", { s: "photo" }));
  assert.match(String(cut.buf), /<rect width="400" height="300" fill="url\(#s\)"\/><\/svg>$/);
});

test("a picture someone is waiting for jumps the queue", async () => {
  const started = () => calls.map((c) => c.desc);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  // Fill every slot with pictures that won't finish until released.
  const busy = Array.from({ length: 24 }, (_, i) => `busy ${i}`);
  const waiters = ["prefetched 1", "prefetched 2", "wanted"];
  [...busy, ...waiters].forEach(hold);
  const running = busy.map((d) => generateImage(imageSpec(d, { s: "photo" })));
  await settle();
  assert.equal(busy.filter((d) => started().includes(d)).length, 24);
  // Three more wait: two drawn ahead of need, then one someone's waiting for.
  const second = { urgent: false };
  const queued = [
    generateImage(imageSpec("prefetched 1", { s: "photo" }), { ticket: { urgent: false } }),
    generateImage(imageSpec("prefetched 2", { s: "photo" }), { ticket: second }),
    generateImage(imageSpec("wanted", { s: "photo" })),
  ];
  await settle();
  assert.ok(!waiters.some((d) => started().includes(d)));
  release("busy 0");
  await settle();
  assert.deepEqual(waiters.filter((d) => started().includes(d)), ["wanted"], "the wanted picture goes first");
  // A browser asks for the second prefetched picture: it moves up.
  second.urgent = true;
  release("busy 1");
  await settle();
  assert.deepEqual(waiters.filter((d) => started().includes(d)), ["prefetched 2", "wanted"]);
  [...busy, ...waiters].forEach(release);
  await Promise.all([...running, ...queued]);
  assert.ok(started().includes("prefetched 1"));
});
