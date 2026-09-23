import test from "node:test";
import assert from "node:assert/strict";
import { applyPreset } from "../lib/presets.js";
import { planFromAnswers, jevPlan } from "../lib/jev.js";
import { generatePage, cleanSection } from "../lib/pages.js";

const args = { url: "https://garden.example/repairs", title: "Gardeners", snippet: "Repairs for greenhouses" };
const plan = planFromAnswers(args, { kind: { choice: "forum" }, mood: { choice: "light" } });

test("hosted presets replace stale local configuration without changing the supplied key", () => {
  const env = { LLM_API_KEY: "ollama", OPENROUTER_API_KEY: "test-key", FOOGLE_PAGE_MODEL: "foogle-qwen", LLM_BASE_URL: "http://localhost:11434/v1" };
  applyPreset("gemini", env);
  assert.equal(env.LLM_API_KEY, "test-key");
  assert.equal(env.FOOGLE_PAGE_MODEL, "google/gemini-3.8-flash");
  assert.equal(env.LLM_BASE_URL, "https://openrouter.ai/api/v1");
  assert.throws(() => applyPreset("gemini", { LLM_API_KEY: "ollama" }), /OPENROUTER_API_KEY/);
});

test("Jev plans preserve context and use a stable domain palette", () => {
  assert.equal(plan.kind, "forum");
  assert.ok(plan.secs.every(s => s.includes(args.snippet)));
  assert.equal(plan.hue, planFromAnswers({ ...args, url: "https://garden.example/other" }, { kind: { choice: "store" }, mood: { choice: "dark" } }).hue);
  assert.throws(() => planFromAnswers(args, { kind: { choice: "invalid" } }), /Invalid Jev/);
});

test("Jev sends the documented request and rejects provider failures", async () => {
  let sent;
  const actual = await jevPlan(args, { apiKey: "test", fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ answers: { kind: { choice: "forum" }, mood: { choice: "light" } } }) };
  } });
  assert.deepEqual(actual, plan);
  assert.equal(sent.model, "jev-latest");
  assert.deepEqual(Object.keys(sent.questions), ["kind", "mood"]);
  await assert.rejects(jevPlan(args, { apiKey: "test", fetchImpl: async () => ({ ok: false, status: 429 }) }), /Jev HTTP 429/);
});

test("styled shell is emitted before section requests; concurrent completions retain document order", async () => {
  const resolvers = [];
  const gen = generatePage(args, { mode: "jev", planWithJev: async () => plan, complete: () => new Promise(resolve => resolvers.push(resolve)) });
  const first = await gen.next();
  assert.match(first.value, /<style>/);
  assert.match(first.value, /Gardeners/);
  assert.equal(resolvers.length, 0);
  const second = gen.next();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolvers.length, 3);
  resolvers[2]("<section>third</section>");
  resolvers[1]("<section>second</section>");
  resolvers[0]("<section>first</section>");
  assert.equal((await second).value, "<section>first</section>");
  assert.equal((await gen.next()).value, "<section>second</section>");
  assert.equal((await gen.next()).value, "<section>third</section>");
  assert.match((await gen.next()).value, /<\/html>$/);
  assert.equal((await gen.next()).done, true);
});

test("Jev failure falls back to text planning", async () => {
  let fallback = 0;
  const chunks = [];
  for await (const c of generatePage(args, { mode: "jev", planWithJev: async () => { throw new Error("timeout"); }, planWithLLM: async () => { fallback++; return plan; }, complete: async () => "<section>content</section>" })) chunks.push(c);
  assert.equal(fallback, 1);
  assert.match(chunks.join(""), /<\/html>$/);
});

test("invalid sections fail the generation rather than being silently cached", async () => {
  assert.throws(() => cleanSection("<section>truncated"), /incomplete/);
  assert.throws(() => cleanSection("<section><script>bad()</script></section>"), /invalid/);
  assert.equal(cleanSection("```html\n<section>ok</section>\n```"), "<section>ok</section>");
  await assert.rejects(async () => {
    for await (const _ of generatePage(args, { mode: "planned", planWithLLM: async () => plan, complete: async () => "<section>truncated" })) { /* exhaust */ }
  }, /incomplete/);
});
