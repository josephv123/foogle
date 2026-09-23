import { parseArgs } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { presets, applyPreset } from "../lib/presets.js";
import { withMetrics } from "../lib/metrics.js";

try { process.loadEnvFile(".env"); } catch (err) { if (err.code !== "ENOENT") throw err; }
const { values } = parseArgs({ options: {
  presets: { type: "string", default: "mimo-flash,mimo-pro,deepseek,gemini" },
  modes: { type: "string", default: "single,jev" },
  runs: { type: "string", default: "1" }, cases: { type: "string", default: "1" },
  out: { type: "string" }, "jev-env": { type: "string" },
  resume: { type: "boolean", default: false },
} });
if (values["jev-env"]) process.loadEnvFile(values["jev-env"]);
const names = values.presets.split(",");
const modes = values.modes.split(",");
for (const name of names) if (!presets[name]) throw new Error(`Unknown preset: ${name}`);
for (const mode of modes) if (!["single", "planned", "jev"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
if (modes.includes("jev") && !process.env.TYPESAFE_API_KEY) throw new Error("Set TYPESAFE_API_KEY or pass --jev-env /path/to/.env");
const runs = Number(values.runs), caseCount = Number(values.cases);
if (!Number.isInteger(runs) || runs < 1 || runs > 10 || !Number.isInteger(caseCount) || caseCount < 1 || caseCount > 3) throw new Error("Use 1–10 runs and 1–3 cases");
const out = path.resolve(values.out || `.foogle-bench/${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(out, { recursive: true });
if (names.length > 1) {
  // Isolated processes keep model config and capability fallbacks independent.
  // Three concurrent models bound provider load while avoiding a long serial run.
  const queue = [...names];
  let previous;
  if (values.resume) {
    try { previous = JSON.parse(await readFile(path.join(out, "report.json"), "utf8")); }
    catch (err) { if (err.code !== "ENOENT") throw err; }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const name = queue.shift(), childOut = path.join(out, name);
      await mkdir(childOut, { recursive: true });
      if (previous) {
        const rows = previous.rows.filter(r => r.preset === name);
        for (const row of rows) {
          const src = path.join(out, row.file);
          try { await writeFile(path.join(childOut, path.basename(row.file)), await readFile(src)); }
          catch (err) { if (err.code !== "ENOENT") throw err; }
          row.file = path.basename(row.file);
        }
        await writeFile(path.join(childOut, "report.json"), JSON.stringify({ ...previous, rows }));
      }
      const args = ["scripts/benchmark.js", "--presets", name, "--modes", values.modes, "--runs", values.runs, "--cases", values.cases, "--out", childOut];
      if (values["jev-env"]) args.push("--jev-env", values["jev-env"]);
      if (values.resume) args.push("--resume");
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${name} benchmark exited ${code}`)));
      });
    }
  }));
  const reports = await Promise.all(names.map(async name => {
    const r = JSON.parse(await readFile(path.join(out, name, "report.json"), "utf8"));
    r.rows.forEach(row => { row.file = `${name}/${row.file}`; });
    return r;
  }));
  await writeFile(path.join(out, "report.json"), JSON.stringify({ ...reports[0], rows: reports.flatMap(r => r.rows), catalog: reports.flatMap(r => r.catalog), concurrency: 3 }, null, 2));
  console.log(`Combined report: ${out}/report.json`);
  process.exit(0);
}
applyPreset(names[0]);
// Stable experimental controls independent of a previous local-model .env.
process.env.FOOGLE_TEMP_RESULTS = "1";
process.env.FOOGLE_TEMP_PAGES = "0.7";
process.env.FOOGLE_PAGE_MAX_TOKENS = "6000";
process.env.FOOGLE_SECTION_MAX_TOKENS = "1200";
process.env.FOOGLE_PAGE_SECTIONS = "3";
const { config, streamText } = await import("../lib/llm.js");
const { generatePage } = await import("../lib/pages.js");
const { searchResultsPrompt } = await import("../lib/prompts.js");
const cases = [
  { query: "repairing a greenhouse on Mars", title: "Red Planet Gardeners", url: "https://redplanetgardeners.example/greenhouse-repairs", snippet: "A community of Martian gardeners shares practical greenhouse repairs." },
  { query: "underwater bicycle shop", title: "Abyss Cycles", url: "https://abysscycles.example/catalog", snippet: "Browse pressure-rated bicycles, prices and accessories for ocean commuters." },
  { query: "city library lends dreams", title: "Somnia Public Library", url: "https://somnialibrary.example/borrowing-dreams", snippet: "Municipal borrowing rules, eligibility and opening hours for the dream library." },
].slice(0, caseCount);
const report = { startedAt: new Date().toISOString(), controls: { runs, cases: caseCount, modes, pageMaxTokens: 6000, sectionMaxTokens: 1200, imagesFetched: false }, rows: [] };
if (values.resume) {
  try { report.rows = JSON.parse(await readFile(path.join(out, "report.json"), "utf8")).rows; }
  catch (err) { if (err.code !== "ENOENT") throw err; }
}
const catalogResponse = await fetch("https://openrouter.ai/api/v1/models");
if (!catalogResponse.ok) throw new Error(`Model catalog HTTP ${catalogResponse.status}`);
const catalog = (await catalogResponse.json()).data;
report.catalog = catalog.filter(m => names.some(n => [presets[n].page, presets[n].results].includes(m.id))).map(({id, pricing}) => ({id, pricing}));
for (const name of names) for (const id of [presets[name].page, presets[name].results]) if (!catalog.some(m => m.id === id)) throw new Error(`${id} is not in the current OpenRouter catalog`);

function searchItems(text) {
  return text.split("\n").flatMap(line => {
    try { const r = JSON.parse(line.trim().replace(/,$/, "")); return r.title && r.url && r.snippet ? [r] : []; }
    catch { return []; }
  });
}
for (const name of names) {
  config.resultsModel = presets[name].results;
  config.pageModel = presets[name].page;
  for (let run = 1; run <= runs; run++) for (const [caseIndex, args] of cases.entries()) {
    for (const mode of ["search", ...modes]) {
      if (report.rows.some(r => r.preset === name && r.mode === mode && r.run === run && r.case === caseIndex + 1)) continue;
      const events = [], started = performance.now();
      let text = "", firstContentMs = null, error;
      await withMetrics(events, async () => {
        try {
          const chunks = mode === "search"
            ? streamText({ ...searchResultsPrompt(args.query), model: config.resultsModel, maxTokens: 2500, temperature: 1 })
            : generatePage(args, { mode });
          for await (const chunk of chunks) {
            text += chunk;
            if (firstContentMs === null && (mode === "search" ? searchItems(text).length : /<\/style\s*>/i.test(text) && /<(?:h1|header|main)\b[^>]*>[\s\S]*\S/i.test(text))) firstContentMs = performance.now() - started;
          }
        } catch (err) { error = err.message; }
      });
      const file = `${name}-${mode}-${caseIndex + 1}-${run}.${mode === "search" ? "txt" : "html"}`;
      await writeFile(path.join(out, file), text);
      const llmEvents = events.filter(e => e.provider === "openrouter");
      const costs = llmEvents.map(e => e.usage?.cost);
      const row = {
        preset: name, mode, run, case: caseIndex + 1, model: mode === "search" ? config.resultsModel : config.pageModel,
        firstContentMs, totalMs: performance.now() - started,
        // Provider-reported billed cost only; missing usage is unknown, never zero.
        openRouterCost: costs.length && costs.every(c => typeof c === "number") ? costs.reduce((a,b) => a+b, 0) : null,
        jevInputTokens: events.filter(e => e.provider === "typesafe").reduce((s,e) => s + (e.usage?.input_tokens || 0), 0),
        checks: mode === "search" ? { validResults: searchItems(text).length } : { closesDocument: /<\/html>\s*$/i.test(text), hasStyle: /<\/style>/i.test(text), internalLinks: (text.match(/href=["']\/web\//g) || []).length, sections: (text.match(/<section\b/g) || []).length },
        error, file, events,
      };
      report.rows.push(row);
      await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ ...row, events: undefined }));
    }
  }
}
console.log(`Report and reviewable HTML: ${out}`);
