import OpenAI from "openai";
import { imageMessages } from "./images.js";

// Trim whitespace/quotes that sneak in via .env editing; reject the
// .env.example placeholder ("sk-or-...") — OpenRouter sends a confusing
// "Missing Authentication header" 401 for malformed keys.
function cleanKey(raw) {
  const key = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!key || key.includes("...")) return undefined;
  return key;
}

// GPT-6 Luna on OpenRouter writes everything: results, pages and pictures.
// See EXPERIMENTS.md for the comparison that picked it.
export const config = {
  apiKey: cleanKey(process.env.OPENROUTER_API_KEY),
  model: "openai/gpt-6-luna",
  // Hot results for variety (the JSONL parser skips an occasional broken line);
  // neutral pages so structure stays reliable.
  tempResults: 1.2,
  tempPages: 1.0,
};

let client = null;
function getClient() {
  if (!config.apiKey) throw new Error("Missing API key. Set OPENROUTER_API_KEY.");
  client ??= new OpenAI({ apiKey: config.apiKey, baseURL: "https://openrouter.ai/api/v1", timeout: 60_000, maxRetries: 1 });
  return client;
}

const request = ({ system, user, maxTokens, temperature }) => ({
  model: config.model,
  messages: [{ role: "system", content: system }, { role: "user", content: user }],
  max_tokens: maxTokens,
  temperature,
  // Thinking costs seconds of invisible tokens before the first byte.
  reasoning: { enabled: false },
  // Each response then reports its cost in USD (see onUsage).
  usage: { include: true },
});

// Every call's reported usage goes to these listeners; the daily budget in
// lib/limits.js is tracked from it.
const usageListeners = new Set();
export const onUsage = (fn) => usageListeners.add(fn);
function reportUsage(usage) {
  if (usage) for (const fn of usageListeners) fn(usage);
}

// Async generator of text deltas.
export async function* streamText(spec) {
  let finishReason;
  const stream = await getClient().chat.completions.create({ ...request(spec), stream: true });
  for await (const chunk of stream) {
    reportUsage(chunk.usage);
    finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
  if (finishReason === "length") throw new Error("Model hit the output token limit");
}

export async function completeText(spec) {
  const r = await getClient().chat.completions.create(request(spec));
  reportUsage(r.usage);
  if (r.choices?.[0]?.finish_reason === "length") throw new Error("Model hit the output token limit");
  return r.choices?.[0]?.message?.content ?? "";
}

// Fallback parser: pull a JSON value out of text that may be wrapped in prose or code fences.
export function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");
  return JSON.parse(candidate.slice(start, candidate.lastIndexOf(candidate[start] === "[" ? "]" : "}") + 1));
}

// ---------- image generation ----------
// Pictures are SVG illustrations drawn by the text model. Bound concurrent
// jobs; 12 takes a full Images grid at once.
const IMG_CONCURRENCY = 12;
let imgActive = 0;
const imgQueue = [];
async function withImageSlot(fn) {
  if (imgActive >= IMG_CONCURRENCY) await new Promise((r) => imgQueue.push(r));
  imgActive++;
  try {
    return await fn();
  } finally {
    imgActive--;
    imgQueue.shift()?.();
  }
}

// SVGs are loaded via <img> (scripts can't run there) and served with a
// locked-down CSP, but sanitize anyway in case one is opened directly as a
// document. Filters, gradients and patterns stay; anything that can run code
// or reach outside the file goes.
export function sanitizeSVG(text) {
  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");
  if (start === -1 || end === -1) throw new Error("model did not return an <svg>");
  return text
    .slice(start, end + 6)
    .replace(/<(script|foreignObject|iframe|object|embed)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*'|(?!["'#])[^\s>]+)/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(?!["']?#)[^)]*\)/gi, "none")
    .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, "")
    // An SVG is XML: one malformed tag and the browser shows nothing at all.
    // Models repeat an attribute (fill="#333" … fill="none") — the last one is
    // what they meant — and write bare "&" in labels.
    .replace(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))+)(\s*\/?)>/g, (_, tag, attrs, close) => {
      const seen = new Map();
      for (const [, name, value] of attrs.matchAll(/\s+([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
        seen.delete(name);
        seen.set(name, value);
      }
      return `<${tag}${[...seen].map(([n, v]) => ` ${n}=${v}`).join("")}${close}>`;
    })
    .replace(/&(?!#?\w+;)/g, "&amp;");
}

// The brief — medium, canvas, palette — comes from lib/images.js. On GPT-6
// Luna a picture takes ~5-9s depending on the medium (see EXPERIMENTS.md).
// Returns { mime, buf }.
export function generateImage(spec) {
  return withImageSlot(async () => {
    const text = await completeText({ ...imageMessages(spec), maxTokens: 2400, temperature: config.tempPages });
    return { mime: "image/svg+xml", buf: Buffer.from(sanitizeSVG(text)) };
  });
}
