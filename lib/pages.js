import { config, completeText, streamText, extractJSON } from "./llm.js";
import { pagePrompt, pagePlanPrompt, pageSectionPrompt } from "./prompts.js";
import { normalizePlan, themeCSS, themeHeader, themeFooter } from "./theme.js";
import { jevPlan } from "./jev.js";

export const pageMode = process.env.FOOGLE_PAGE_MODE || (process.env.FOOGLE_FAST_PAGES === "on" || process.env.FOOGLE_FAST_PAGES === "true" || process.env.FOOGLE_FAST_PAGES === "1" ? "planned" : "single");
if (!["single", "planned", "jev"].includes(pageMode)) throw new Error(`Invalid FOOGLE_PAGE_MODE: ${pageMode}`);

const positiveInt = (v, fallback) => Math.max(1, parseInt(v, 10) || fallback);
const pageTokens = positiveInt(process.env.FOOGLE_PAGE_MAX_TOKENS, 16000);
const sectionTokens = positiveInt(process.env.FOOGLE_SECTION_MAX_TOKENS, 1200);

async function llmPlan(args) {
  const text = await completeText({ ...pagePlanPrompt(args), model: config.resultsModel, maxTokens: 600, temperature: config.tempPages });
  const plan = normalizePlan(extractJSON(text));
  if (!plan.site || !plan.secs.length) throw new Error("Incomplete page plan");
  return plan;
}

export function cleanSection(text) {
  const fragment = text.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "");
  if (!/^<section(?:\s|>)/i.test(fragment) || !/<\/section>\s*$/i.test(fragment) || /<(?:html|head|body|style|script)\b/i.test(fragment)) {
    throw new Error("Section generation returned incomplete or invalid HTML");
  }
  return fragment;
}

export async function* generatePage(args, { mode = pageMode, planWithJev = jevPlan, planWithLLM = llmPlan, complete = completeText } = {}) {
  if (!["single", "planned", "jev"].includes(mode)) throw new Error(`Invalid page mode: ${mode}`);
  if (mode === "single") {
    yield* streamText({ ...pagePrompt(args), model: config.pageModel, maxTokens: pageTokens, temperature: config.tempPages });
    return;
  }
  let plan;
  try {
    if (mode === "jev") {
      try { plan = await planWithJev(args); }
      catch (err) {
        console.warn(`[jev] ${err.message}; using text-model planner`);
        plan = await planWithLLM(args);
      }
    } else plan = await planWithLLM(args);
  } catch (err) {
    console.warn(`[page-plan] ${err.message}; using full-page generation`);
    yield* generatePage(args, { mode: "single" });
    return;
  }
  const domain = new URL(args.url).hostname;
  // Complete CSS/header arrives before any section generation. Keep sections in
  // document order even when later requests finish first. Capture every rejection
  // immediately so a failed later section cannot cause an unhandled rejection.
  yield `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${themeCSS(plan)}</head><body>${themeHeader(plan, domain)}`;
  const selected = plan.secs.slice(0, Math.min(6, config.pageSections));
  const jobs = selected.map((brief, index) => complete({
    ...pageSectionPrompt({ plan, domain, url: args.url, brief, index, total: selected.length }),
    model: config.pageModel, maxTokens: sectionTokens, temperature: config.tempPages,
  }).then(text => ({ html: cleanSection(text) })).catch(error => ({ error })));
  let firstError;
  for (const job of jobs) {
    const result = await job;
    if (result.error) firstError ??= result.error;
    else yield result.html;
  }
  yield `${themeFooter(plan, domain)}</body></html>`;
  if (firstError) throw firstError; // partial failures must not enter the page cache
}
