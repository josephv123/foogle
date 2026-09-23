import { createHash } from "node:crypto";
import { normalizePlan } from "./theme.js";
import { recordMetric } from "./metrics.js";

export const questions = {
  kind: {
    type: "choice", instructions: "Which website type best fits this fictional URL and its search result?",
    criteria: { forum: "Community discussions", store: "Products for sale", wiki: "Reference or encyclopedia", blog: "Personal writing or essays", news: "Reporting or journalism", startup: "Company or service landing page", gov: "Public agency or civic service", zine: "Experimental art or independent culture" },
  },
  mood: {
    type: "choice", instructions: "Which visual style best fits the fictional website described in the state?",
    criteria: { dark: "Restrained dark interface", light: "Clean bright interface", paper: "Warm print or archival aesthetic", neon: "Luminous futuristic aesthetic", brutal: "Bold stark graphic aesthetic" },
  },
};

const briefs = {
  forum: ["Opening post with a specific question", "Community replies with distinct viewpoints", "Related discussions and community resources"],
  store: ["Featured products with prices", "Product details and comparisons", "Delivery, support and related products"],
  wiki: ["Overview and key facts", "History and detailed explanation", "References and related entries"],
  blog: ["Opening argument and personal perspective", "Concrete examples and observations", "Conclusion and related essays"],
  news: ["Lead story and key facts", "Reporting, quotes and context", "Developments and related coverage"],
  startup: ["Product promise and concrete capabilities", "How it works and use cases", "Plans and getting started"],
  gov: ["Service overview and eligibility", "Application steps and requirements", "Contact details and related services"],
  zine: ["Editorial introduction", "Featured work and commentary", "Contributors and further reading"],
};

// Only the design choices need semantic inference. Names/context already exist,
// and code supplies the palette and section responsibilities without more calls.
export function planFromAnswers(args, answers) {
  for (const [id, question] of Object.entries(questions)) {
    if (!Object.hasOwn(question.criteria, answers?.[id]?.choice)) throw new Error(`Invalid Jev ${id} answer`);
  }
  const domain = new URL(args.url).hostname;
  const kind = answers.kind.choice;
  const topic = [args.title, args.snippet, args.query, args.siteContext?.query].filter(Boolean).join(". ");
  const plan = normalizePlan({
    kind, mood: answers.mood.choice,
    hue: createHash("sha256").update(domain).digest().readUInt16BE(0) % 360,
    site: args.siteContext?.title || args.title || domain,
    tag: args.snippet || args.query || "",
    nav: ["Home", "About", "Archive", "Contact"],
    secs: briefs[kind].map(brief => `${brief}. Topic: ${topic || args.url}`),
  });
  return plan;
}

export async function jevPlan(args, { apiKey = process.env.TYPESAFE_API_KEY, fetchImpl = fetch, timeoutMs = 1800 } = {}) {
  if (!apiKey) throw new Error("Set TYPESAFE_API_KEY to use Jev page planning.");
  const started = performance.now();
  let response;
  try {
    const r = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.FOOGLE_JEV_MODEL || "jev-latest", state: args, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`Jev HTTP ${r.status}`);
    response = await r.json();
    return planFromAnswers(args, response.answers);
  } finally {
    recordMetric({ provider: "typesafe", model: response?.model || "jev-latest", durationMs: performance.now() - started, usage: response?.usage, answers: response?.answers });
  }
}
