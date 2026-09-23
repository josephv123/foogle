import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLimits, clientIP, usageUSD, ACTION_USD } from "../lib/limits.js";

// A stand-in for an Express request/response pair.
const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });
function res() {
  const r = { statusCode: 200, headers: {}, body: null, contentType: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.type = (t) => { r.contentType = t; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}
const clock = (start = Date.UTC(2026, 8, 23, 12)) => { const c = () => c.t; c.t = start; return c; };

test("each visitor spends a refilling dollar budget, weighted by what the action costs", () => {
  const now = clock();
  const limits = createLimits({ env: { RATE_LIMIT_BURST_USD: "0.011", RATE_LIMIT_USD_PER_HOUR: "0.036" }, now });
  const a = req("203.0.113.5");
  assert.ok(limits.allow(a, res(), "search")); // 0.007 of 0.011
  assert.ok(limits.allow(a, res(), "web")); // 0.0033
  const refused = res();
  assert.equal(limits.allow(a, refused, "search"), false);
  assert.equal(refused.statusCode, 429);
  // 0.0063 short at $0.036/hour (a cent every 1000s) is 630 seconds.
  assert.equal(refused.headers["retry-after"], "630");
  assert.equal(refused.contentType, "html");
  assert.match(refused.body, /Foogle/);
  assert.match(refused.body, /faster than the future/);
  assert.equal(refused.headers["cache-control"], "no-store");
  // Cheap actions still fit where a search doesn't.
  assert.ok(limits.allow(a, res(), "img"));
  // Someone else is unaffected.
  assert.ok(limits.allow(req("198.51.100.7"), res(), "search"));
  // And the bucket refills with time: the picture made the wait 680s.
  now.t += 670_000;
  assert.equal(limits.allow(a, res(), "search"), false);
  now.t += 10_000;
  assert.ok(limits.allow(a, res(), "search"));
});

test("pictures are refused with a placeholder image, not a page", () => {
  const limits = createLimits({ env: { RATE_LIMIT_BURST_USD: "0.0001" }, now: clock() });
  const r = res();
  assert.equal(limits.allow(req("203.0.113.5"), r, "img"), false);
  assert.equal(r.statusCode, 429);
  assert.equal(r.contentType, "image/svg+xml");
  assert.match(r.body, /^<svg/);
});

test("forwarded headers are only believed when TRUST_PROXY is set", () => {
  const spoofed = req("10.0.0.2", { "x-forwarded-for": "1.1.1.1, 203.0.113.5", "fly-client-ip": "203.0.113.9" });
  assert.equal(clientIP(spoofed, undefined), "10.0.0.2");
  assert.equal(clientIP(spoofed, "false"), "10.0.0.2");
  assert.equal(clientIP(spoofed, "1"), "203.0.113.5"); // the address our one proxy saw
  assert.equal(clientIP(spoofed, "2"), "1.1.1.1");
  assert.equal(clientIP(spoofed, "5"), "1.1.1.1");
  assert.equal(clientIP(spoofed, "true"), "1.1.1.1");
  assert.equal(clientIP(spoofed, "Fly-Client-IP"), "203.0.113.9");
  assert.equal(clientIP(req("10.0.0.2"), "cf-connecting-ip"), "10.0.0.2");

  // Without TRUST_PROXY, a made-up X-Forwarded-For doesn't buy a fresh bucket.
  const env = { RATE_LIMIT_BURST_USD: "0.007" };
  const limits = createLimits({ env, now: clock() });
  assert.ok(limits.allow(req("10.0.0.2", { "x-forwarded-for": "1.1.1.1" }), res(), "search"));
  assert.equal(limits.allow(req("10.0.0.2", { "x-forwarded-for": "2.2.2.2" }), res(), "search"), false);
  const proxied = createLimits({ env: { ...env, TRUST_PROXY: "1" }, now: clock() });
  assert.ok(proxied.allow(req("10.0.0.2", { "x-forwarded-for": "1.1.1.1" }), res(), "search"));
  assert.ok(proxied.allow(req("10.0.0.2", { "x-forwarded-for": "2.2.2.2" }), res(), "search"));
});

// A request as a Render web service gets it: through Cloudflare, then Render's own proxy.
const viaRender = (headers = {}) => req("10.226.90.66", {
  "x-forwarded-for": "81.97.145.24, 172.71.195.123, 10.226.90.65", "cf-connecting-ip": "81.97.145.24", "true-client-ip": "81.97.145.24",
  cookie: "fv=secret-visitor-id", ...headers,
});

test("behind Render, the visitor is Cloudflare's connecting IP, not the rightmost forwarded hop", () => {
  assert.equal(clientIP(viaRender(), "1"), "10.226.90.65"); // Render's proxy, shared by everyone
  assert.equal(clientIP(viaRender(), "cf-connecting-ip"), "81.97.145.24");
  // Render only appends to X-Forwarded-For, so its first entry is whatever the visitor sent.
  assert.equal(clientIP(viaRender({ "x-forwarded-for": "6.6.6.6, 81.97.145.24, 172.71.195.123, 10.226.90.65" }), "true"), "6.6.6.6");
});

test("whoami shows how the limiter sees a request: its address, bucket and forwarded headers", () => {
  const limits = createLimits({ env: { TRUST_PROXY: "cf-connecting-ip" }, now: clock() });
  const me = limits.whoami(viaRender());
  assert.equal(me.ip, "81.97.145.24");
  assert.equal(me.visitor, "81.97.145.24");
  assert.equal(me.trustProxy, "cf-connecting-ip");
  assert.equal(me.socket, "10.226.90.66");
  assert.deepEqual(me.headers, ["cf-connecting-ip", "cookie", "true-client-ip", "x-forwarded-for"]);
  assert.deepEqual(me.forwarded, { "x-forwarded-for": "81.97.145.24, 172.71.195.123, 10.226.90.65", "true-client-ip": "81.97.145.24", "cf-connecting-ip": "81.97.145.24" });
  assert.deepEqual(me.wouldBe, { 1: "10.226.90.65", 2: "172.71.195.123", true: "81.97.145.24", "cf-connecting-ip": "81.97.145.24", "true-client-ip": "81.97.145.24" });
  assert.doesNotMatch(JSON.stringify(me), /secret/); // header names only, besides the three above
  assert.equal(createLimits({ env: {}, now: clock() }).whoami(req("203.0.113.5")).trustProxy, null);
});

test("an IPv6 /64 is one visitor, and IPv4-mapped addresses are plain IPv4", () => {
  const limits = createLimits({ env: { RATE_LIMIT_BURST_USD: "0.007" }, now: clock() });
  assert.ok(limits.allow(req("2001:db8:1:2::1"), res(), "search"));
  assert.equal(limits.allow(req("2001:0db8:0001:0002:ffff:ffff:ffff:ffff"), res(), "search"), false);
  assert.ok(limits.allow(req("2001:db8:1:3::1"), res(), "search"));
  assert.ok(limits.allow(req("::ffff:203.0.113.5"), res(), "search"));
  assert.equal(limits.allow(req("203.0.113.5"), res(), "search"), false);
});

test("the daily budget stops new generations until midnight UTC", () => {
  const now = clock(Date.UTC(2026, 8, 23, 22, 30));
  const limits = createLimits({ env: { DAILY_BUDGET_USD: "0.01", RATE_LIMIT_USD_PER_HOUR: "off" }, now });
  limits.record({ prompt_tokens: 1000, completion_tokens: 1000, cost: 0.004 });
  assert.ok(limits.allow(req("203.0.113.5"), res(), "search"));
  limits.record({ cost: 0.007 });
  const r = res();
  assert.equal(limits.allow(req("198.51.100.7"), r, "timelines"), false);
  assert.equal(r.statusCode, 503);
  assert.equal(r.headers["retry-after"], String(90 * 60));
  assert.match(r.body, /Foogle is out of juice for today/);
  assert.match(r.body, /1 hour 30 min/);
  assert.equal(limits.status().spentUsd.toFixed(3), "0.011");
  now.t = Date.UTC(2026, 8, 24, 0, 0, 1);
  assert.ok(limits.allow(req("198.51.100.7"), res(), "timelines"));
  assert.equal(limits.status().spentUsd, 0);
});

test("background work (the daily doodle) asks the day's budget and is counted in it", () => {
  const now = clock(Date.UTC(2026, 8, 23, 22, 30));
  const limits = createLimits({ env: { DAILY_BUDGET_USD: "0.01" }, now });
  assert.ok(limits.withinBudget());
  limits.record({ cost: 0.004 }); // the doodle's two calls report their cost like any other
  assert.ok(limits.withinBudget());
  limits.record({ cost: 0.007 });
  assert.equal(limits.withinBudget(), false);
  now.t = Date.UTC(2026, 8, 24, 0, 0, 1);
  assert.ok(limits.withinBudget());
  assert.equal(createLimits({ env: { DAILY_BUDGET_USD: "0" }, now }).withinBudget(), false);
  assert.ok(createLimits({ env: { DAILY_BUDGET_USD: "off" }, now }).withinBudget());
});

test("limits are configurable and can be switched off", () => {
  const off = createLimits({ env: { RATE_LIMIT_USD_PER_HOUR: "off", DAILY_BUDGET_USD: "off" }, now: clock() });
  for (let i = 0; i < 1000; i++) assert.ok(off.allow(req("203.0.113.5"), res(), "search"));
  off.record({ cost: 1e6 });
  assert.ok(off.allow(req("203.0.113.5"), res(), "search"));
  // A budget of 0 is a kill switch.
  assert.equal(createLimits({ env: { DAILY_BUDGET_USD: "0" }, now: clock() }).allow(req("203.0.113.5"), res(), "web"), false);
  // Garbage falls back to the defaults.
  assert.deepEqual(createLimits({ env: { RATE_LIMIT_BURST_USD: "lots" } }).config, { burstUsd: 0.1, usdPerHour: 0.4, dailyBudgetUsd: 5 });
  // Unknown actions cost a page; a dollar amount can be passed directly.
  const tight = createLimits({ env: { RATE_LIMIT_BURST_USD: "0.0038", RATE_LIMIT_USD_PER_HOUR: "0" }, now: clock() });
  assert.ok(tight.allow(req("203.0.113.5"), res(), "something-new"));
  assert.ok(tight.allow(req("203.0.113.5"), res(), 0.0005));
  assert.equal(tight.allow(req("203.0.113.5"), res(), 0.0001), false);
  assert.ok(ACTION_USD.search > ACTION_USD.web && ACTION_USD.web > ACTION_USD.img);
});

test("usage is priced from OpenRouter's reported cost, or from tokens when it is missing", () => {
  assert.equal(usageUSD({ cost: 0.0012, prompt_tokens: 1, completion_tokens: 1 }), 0.0012);
  assert.equal(usageUSD({ prompt_tokens: 1000, completion_tokens: 1000 }), 0.0006);
});

test("model calls ask OpenRouter for usage and report it to listeners", async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const bodies = [];
  const usage = { prompt_tokens: 5, completion_tokens: 7, cost: 0.00002 };
  globalThis.fetch = async (url, init) => {
    const p = JSON.parse(init.body);
    bodies.push(p);
    if (!p.stream) return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage });
    const events = [{ choices: [{ delta: { content: "hi" }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage }];
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  };
  process.env.OPENROUTER_API_KEY = "test";
  const { completeText, streamText, onUsage } = await import("../lib/llm.js");
  const seen = [];
  onUsage((u) => seen.push(u.cost));
  const spec = { system: "s", user: "u", maxTokens: 20, temperature: 1 };
  await completeText(spec);
  for await (const _ of streamText(spec)) { /* drain */ }
  assert.deepEqual(bodies.map(b => b.usage), [{ include: true }, { include: true }]);
  assert.deepEqual(seen, [0.00002, 0.00002]);
});

// ---------- the running server ----------
// Every model call costs COST dollars and reports it like OpenRouter does.
const mockProviders = (cost) => `
  globalThis.fetch = async (url, init) => {
    const p = JSON.parse(init.body);
    if (String(url).startsWith("https://api.typesafe.ai")) return Response.json({ answers: { kind: {choice:"forum"}, mood: {choice:"light"} } });
    const system = p.messages[0].content;
    const usage = { prompt_tokens: 100, completion_tokens: 100, cost: ${cost} };
    const content = system.includes("ONE section") ? "<section><h2>Repairs</h2><p>Glass.</p></section>"
      : system.includes("fact sheet") ? "- Glass costs $38 a pane."
      : system.includes("vector illustrator") ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300"/></svg>'
      : system.includes("comment thread") ? "fernwise: Reglaze in spring, trust me."
      : system.includes("overview writer") ? JSON.stringify({ title: "Greenhouses", summary: "Reglaze in spring." })
      : JSON.stringify({ site: "Gardeners Guild", title: "Gardeners", url: "https://garden.example/repairs", snippet: "Repairs", kind: "forum" }) + "\\n";
    if (p.stream) return new Response("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }], usage }) + "\\n\\ndata: [DONE]\\n\\n", { headers: { "Content-Type": "text/event-stream" } });
    return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }], usage });
  };
  await import("./scripts/start.js");
`;

async function startServer(t, { cost, env }) {
  const imageCache = await mkdtemp(path.join(tmpdir(), "foogle-img-"));
  t.after(() => rm(imageCache, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--input-type=module", "-e", mockProviders(cost), "--", "--port", "0"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, OPENROUTER_API_KEY: "test", TYPESAFE_API_KEY: "test", FOOGLE_IMAGE_CACHE: imageCache, TRUST_PROXY: "", RATE_LIMIT_BURST_USD: "", RATE_LIMIT_USD_PER_HOUR: "", DAILY_BUDGET_USD: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => { child.kill(); await once(child, "exit"); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start")), 5000);
    child.once("error", reject);
    child.stdout.on("data", data => {
      const match = String(data).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  return `http://localhost:${port}`;
}

test("the server charges visitors only for fresh generations", async t => {
  const base = await startServer(t, { cost: 0.0001, env: { TRUST_PROXY: "1", RATE_LIMIT_BURST_USD: "0.00763", RATE_LIMIT_USD_PER_HOUR: "0", DAILY_BUDGET_USD: "off" } });
  const as = (ip) => ({ headers: { "X-Forwarded-For": ip } });
  const first = await fetch(`${base}/search?q=greenhouse`, as("203.0.113.5"));
  assert.equal(first.status, 200);
  assert.match(await first.text(), /Gardeners Guild/);
  // Cached: free, however often.
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/search?q=greenhouse`, as("203.0.113.5"))).status, 200);
  // The top result was prefetched by the search, so opening it is free too.
  const page = await fetch(`${base}/web/garden.example/repairs?fq=greenhouse`, as("203.0.113.5"));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Repairs/);
  // A new search is not.
  const limited = await fetch(`${base}/search?q=cold%20frames`, as("203.0.113.5"));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.match(await limited.text(), /faster than the future/);
  const img = await fetch(`${base}/img/a%20cold%20frame`, as("203.0.113.5"));
  assert.equal(img.status, 200); // a picture is cheap enough to still fit
  assert.equal((await fetch(`${base}/news?q=cold%20frames`, as("203.0.113.5"))).status, 429);
  // $0.00013 left: two comments get a reply; the third still posts, unanswered.
  const post = (text) => fetch(`${base}/fw/comments`, { method: "POST", headers: { ...as("203.0.113.5").headers, "Content-Type": "application/json" }, body: JSON.stringify({ page: "/garden.example/repairs", name: "ada", text }) });
  assert.equal((await post("Does putty work?")).status, 200);
  assert.equal((await post("And in winter?")).status, 200);
  assert.equal((await post("What about hail?")).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const { comments } = await (await fetch(`${base}/fw/comments?page=${encodeURIComponent("/garden.example/repairs")}`)).json();
  assert.equal(comments.filter((c) => !c.bot).length, 3);
  assert.equal(comments.filter((c) => c.bot).length, 2);
  // Another visitor has their own budget.
  assert.equal((await fetch(`${base}/search?q=cold%20frames`, as("198.51.100.7"))).status, 200);
});

test("the server answers /api/whoami for free, as the limiter sees the request", async t => {
  const base = await startServer(t, { cost: 0.01, env: { TRUST_PROXY: "cf-connecting-ip", RATE_LIMIT_BURST_USD: "0", DAILY_BUDGET_USD: "0" } });
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${base}/api/whoami`, { headers: { "CF-Connecting-IP": "81.97.145.24", "X-Forwarded-For": "81.97.145.24, 172.71.195.123" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const me = await r.json();
    assert.equal(me.ip, "81.97.145.24");
    assert.equal(me.forwarded["x-forwarded-for"], "81.97.145.24, 172.71.195.123");
    assert.equal(me.forwarded["true-client-ip"], null);
    assert.ok(me.headers.includes("cf-connecting-ip") && me.headers.includes("host"));
  }
});

test("the server shows the out-of-juice page once the day's budget is spent", async t => {
  const base = await startServer(t, { cost: 0.01, env: { DAILY_BUDGET_USD: "0.03", RATE_LIMIT_USD_PER_HOUR: "off" } });
  // Three shards and the overview report $0.04 before the page ends.
  assert.equal((await fetch(`${base}/search?q=greenhouse`)).status, 200);
  const out = await fetch(`${base}/search?q=cold%20frames`);
  assert.equal(out.status, 503);
  assert.ok(Number(out.headers.get("retry-after")) > 0);
  assert.match(await out.text(), /Foogle is out of juice for today/);
  const img = await fetch(`${base}/img/a%20cold%20frame`);
  assert.equal(img.status, 503);
  assert.match(img.headers.get("content-type"), /image\/svg\+xml/);
  // What was already made still loads.
  assert.equal((await fetch(`${base}/search?q=greenhouse`)).status, 200);
});
