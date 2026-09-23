// How fast search suggestions appear, measured with the real model.
//
//   node scripts/suggest-latency.js                  its own server on a free port (.env keys)
//   node scripts/suggest-latency.js --url http://localhost:3021
//   node scripts/suggest-latency.js --no-prefetch --model meta-llama/llama-3.3-70b-instruct
//
// It types queries into the browser's own suggestion engine (public/suggest.js)
// a key at a time, at a brisk typist's pace (90-220ms a key), stopping to
// read the suggestions after some words and at the end. For every keystroke
// it records how long until suggestions for the text are there to show, and
// it sums the cost of every model call from the server's log. Three rounds:
//   cold   the first visitor on a fresh server (which then warms the empty
//          box and the 26 first letters for everyone)
//   warm   other queries, on the server the first round left behind
//   repeat the first round's queries again, as a new visitor (everything in
//          the shared cache)
// A typed query costs about $0.0001-0.0002 of model calls, so a run is under a cent.
// Browser rendering (one frame) is not included.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { once } from "node:events";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, normalize } from "../public/suggest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values: opts } = parseArgs({
  options: {
    url: { type: "string" },
    prefetch: { type: "boolean", default: true },
    "no-prefetch": { type: "boolean", default: false },
    model: { type: "string" },
    seed: { type: "string", default: "7" },
    log: { type: "string" },
  },
});
const prefetch = opts.prefetch && !opts["no-prefetch"];

const FIRST = ["cnn live", "how to make sourdough starter", "weather in tokyo tomorrow", "mars colony jobs", "best electric bike 2031", "youtube music", "is it safe to eat lab grown meat", "flights to lisbon", "reddit sourdough", "quantum phone review"];
const OTHER = ["amazon prime day", "nasa moon base", "why is the sky orange", "spotify wrapped", "hover scooter repair", "wikipedia octopus", "cheap flights to mars", "github copilot", "robot vacuum stuck", "netflix new shows"];

// A seeded random stream, so runs type the same way.
let seed = Number(opts.seed) || 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the server ----------
let server = null;
const log = [];
async function startServer() {
  const env = { ...process.env, RATE_LIMIT_BURST_USD: "off", ...(opts.model ? { SUGGEST_MODEL: opts.model } : {}) };
  server = spawn(process.execPath, ["scripts/start.js", "--port", "0"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => log.push(...String(d).split("\n")));
  server.stderr.on("data", (d) => log.push(...String(d).split("\n")));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 15_000);
    server.stdout.on("data", (d) => {
      const port = String(d).match(/http:\/\/localhost:(\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve(`http://localhost:${port}`); }
    });
  });
}

// Model calls the server logged since `from`: [{ key, ms, first, usd }].
const calls = (from) => log.slice(from).flatMap((line) => {
  const m = line.match(/^\[suggest\] "(.*)" (\d+) in (\d+)ms \(first \+(\d+|-)ms\) \$([\d.]+)/);
  return m ? [{ key: m[1], n: Number(m[2]), ms: Number(m[3]), first: Number(m[4]) || null, usd: Number(m[5]) }] : [];
});
const warmUsd = (from) => log.slice(from).reduce((sum, line) => sum + Number(line.match(/^\[suggest\] warmed .* \$([\d.]+)/)?.[1] ?? 0), 0);

// ---------- typing ----------
// Types `query`, returning one record per keystroke: how long until the
// dropdown had something for that text (null if the next key came first),
// and whether the typist paused there to read.
async function type(base, query) {
  let changed = () => {};
  const engine = createEngine({ endpoint: `${base}/api/suggest`, prefetch, onChange: () => changed() });
  const records = [];
  for (let i = 1; i <= query.length; i++) {
    const text = query.slice(0, i);
    const key = normalize(text);
    const t0 = performance.now();
    // ms: something to show; full: a full dropdown (5 rows), or all there is
    // (this text's own list is in).
    const record = { text, ms: null, full: null, local: false, pause: false };
    records.push(record);
    const full = () => engine.pool(key).length >= 5 || engine.lists.get(key)?.done;
    if (engine.set(text).length) Object.assign(record, { ms: 0, local: true });
    if (full()) record.full = 0;
    changed = () => {
      if (engine.current() !== key) return;
      if (record.ms == null && engine.pool(key).length) record.ms = performance.now() - t0;
      if (record.full == null && full()) record.full = performance.now() - t0;
    };
    // Stop to read after some words, and always at the end.
    record.pause = i === query.length || (query[i] === " " && rand() < 0.35);
    if (record.pause) {
      const until = performance.now() + 3000;
      while ((record.ms == null || record.full == null) && performance.now() < until) await sleep(5);
      await sleep(300 + rand() * 500);
    } else {
      await sleep(90 + rand() * 130);
    }
  }
  return { records, requests: engine.counts.requests, prefetches: engine.counts.prefetches };
}

const pct = (xs, p) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : NaN;
};

async function round(base, name, queries) {
  const from = log.length;
  const all = [];
  let requests = 0;
  let prefetches = 0;
  for (const q of queries) {
    const r = await type(base, q);
    all.push(...r.records);
    requests += r.requests;
    prefetches += r.prefetches;
  }
  await sleep(1500); // let the last generations finish and log
  const model = calls(from);
  const usd = model.reduce((s, c) => s + c.usd, 0);
  const paused = all.filter((r) => r.pause);
  const seen = all.filter((r) => r.ms != null);
  return {
    name,
    keys: all.length,
    pauseP50: pct(paused.map((r) => r.ms), 0.5),
    pauseP90: pct(paused.map((r) => r.ms), 0.9),
    fullP50: pct(paused.map((r) => r.full), 0.5),
    fullP90: pct(paused.map((r) => r.full), 0.9),
    keyP50: pct(seen.map((r) => r.ms), 0.5),
    keyP90: pct(seen.map((r) => r.ms), 0.9),
    local: all.filter((r) => r.local).length / all.length,
    before: seen.length / all.length,
    requests,
    prefetches,
    misses: model.length,
    firstP50: pct(model.map((c) => c.first), 0.5),
    usd,
    perQuery: usd / queries.length,
    warm: warmUsd(from),
  };
}

try {
  const base = opts.url?.replace(/\/+$/, "") ?? await startServer();
  console.log(`Suggestions at ${base}${opts.model ? ` with ${opts.model}` : ""}${prefetch ? "" : " (no prefetch)"}`);
  const rounds = [];
  rounds.push(await round(base, "cold", FIRST));
  rounds.push(await round(base, "warm", OTHER));
  rounds.push(await round(base, "repeat", FIRST));
  console.log("\nms from a keystroke to suggestions for its text:");
  console.log("round    keys  after a pause p50/p90  (full list)   every key p50/p90   instant  in time  requests  model calls (first line p50)  $ per query");
  for (const r of rounds) {
    console.log(
      r.name.padEnd(7), String(r.keys).padStart(5),
      `${r.pauseP50}/${r.pauseP90}`.padStart(22), `(${r.fullP50}/${r.fullP90})`.padStart(13), `${r.keyP50}/${r.keyP90}`.padStart(19),
      `${Math.round(r.local * 100)}%`.padStart(8), `${Math.round(r.before * 100)}%`.padStart(8),
      `${r.requests}+${r.prefetches}`.padStart(9), `${r.misses} (${r.firstP50}ms)`.padStart(29),
      `$${r.perQuery.toFixed(6)}`.padStart(12),
      r.warm ? `  (+ $${r.warm.toFixed(5)} warming the first letters, once)` : "",
    );
  }
  console.log("\n\"instant\": answered from lists already in the browser; \"in time\": suggestions showed before the next key; requests: typed + prefetched.");
} finally {
  if (server) { server.kill(); await once(server, "exit").catch(() => {}); }
  if (opts.log) fs.writeFileSync(opts.log, log.join("\n"));
}
