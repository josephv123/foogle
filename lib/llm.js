import OpenAI from "openai";
import { recordMetric } from "./metrics.js";

// Trim whitespace/quotes that sneak in via .env editing; reject the
// .env.example placeholder ("sk-or-...") — providers send a confusing
// "Missing Authentication header" 401 for malformed keys.
function cleanKey(raw) {
  const key = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!key || key.includes("...")) return undefined;
  return key;
}

// "chat"  = image returned by a chat completion with modalities:["image","text"] (OpenRouter style)
// "images"= the OpenAI /v1/images/generations endpoint
// "svg"   = a text LLM draws the image as an SVG illustration (no image model needed)
// "ascii" = a text LLM draws ASCII art, served wrapped in an SVG
const imageApi = process.env.FOOGLE_IMAGE_API || "chat";
const textImageMode = imageApi === "svg" || imageApi === "ascii";
const pageModel = process.env.FOOGLE_PAGE_MODEL || "anthropic/claude-sonnet-4.5";

// NaN (e.g. FOOGLE_TEMP_*=default) means "don't send the param".
const parseTemp = (raw, fallback) => {
  const t = parseFloat(raw ?? fallback);
  return Number.isFinite(t) ? t : undefined;
};

const baseURL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
// Local servers can use multiple decode slots for sharded search results.
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(baseURL);
export const config = {
  apiKey: cleanKey(process.env.LLM_API_KEY) ?? cleanKey(process.env.OPENROUTER_API_KEY),
  baseURL,
  isLocal,
  // How many concurrent shards a results page is split into. The server has a
  // fixed number of decode slots; going past them queues and gets slower.
  resultShards: Math.max(1, parseInt(process.env.FOOGLE_RESULT_SHARDS ?? (isLocal ? "3" : "1"), 10) || 1),
  pageSections: Math.max(2, parseInt(process.env.FOOGLE_PAGE_SECTIONS ?? "3", 10) || 3),
  resultsModel: process.env.FOOGLE_RESULTS_MODEL || "anthropic/claude-haiku-4.5",
  pageModel,
  // In text-image modes the "image model" is a text LLM — default to the page model.
  imageModel: process.env.FOOGLE_IMAGE_MODEL || (textImageMode ? pageModel : "google/gemini-2.5-flash-image"),
  imageApi,
  // Hot results for variety (the JSONL parser skips an occasional broken line);
  // neutral pages so structure stays reliable.
  tempResults: parseTemp(process.env.FOOGLE_TEMP_RESULTS, "1.2"),
  tempPages: parseTemp(process.env.FOOGLE_TEMP_PAGES, "1.0"),
};

// Reasoning models burn seconds of invisible thinking tokens before the first
// HTML byte. Providers disagree on the wire format, and the disagreement is not
// cosmetic — sending the wrong one looks like it worked while the model thinks
// anyway:
//   OpenRouter   — a unified `reasoning` object.
//   Ollama       — top-level `reasoning_effort`, and only "none" silences it.
//   llama.cpp    — IGNORES reasoning_effort entirely (measured: still emitted
//                  1005 chars of reasoning and ate the whole token budget).
//                  Only chat_template_kwargs.enable_thinking=false works, since
//                  that is the switch the Qwen chat template actually reads.
// So for non-OpenRouter we send both and let the ladder below drop whatever the
// endpoint rejects.
// FOOGLE_REASONING: "off" | "low" | "medium" | "high" | "default" (= never send the param)
const isOpenRouter = (process.env.LLM_BASE_URL || "openrouter.ai").includes("openrouter.ai");
const reasoningParams = (level) => {
  if (isOpenRouter) return { reasoning: level === "off" ? { enabled: false } : { effort: level } };
  if (level !== "off") return { reasoning_effort: level };
  return { reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } };
};

const configuredReasoning = (() => {
  const r = (process.env.FOOGLE_REASONING ?? "").toLowerCase();
  if (r === "default") return undefined;
  if (r === "low" || r === "medium" || r === "high" || r === "off") return r;
  return isOpenRouter ? "off" : undefined;
})();
// Degradation ladder: some endpoints make reasoning mandatory (400 on the
// disable value), others reject one of the two params. On a reasoning-related
// 400 we step down — both params -> reasoning_effort only -> "low" -> no param
// — and remember the level that worked for all later requests.
const reasoningLadder = [];
if (configuredReasoning) {
  reasoningLadder.push(reasoningParams(configuredReasoning));
  if (configuredReasoning === "off") reasoningLadder.push({ reasoning_effort: "none" });
  if (configuredReasoning !== "low") reasoningLadder.push(reasoningParams("low"));
}
reasoningLadder.push({});
const modelCapabilities = new Map();

const isReasoningRejection = (err) =>
  err?.status === 400 && /reasoning|thinking|chat_template|template_kwargs/i.test(err?.message ?? "");

async function chatCreate(params) {
  // A rejection from one model must not change another model's parameters.
  let caps = modelCapabilities.get(params.model);
  if (!caps) modelCapabilities.set(params.model, caps = { reasoningLevel: 0, tempUnsupported: false });
  for (;;) {
    const p = { ...params, ...reasoningLadder[caps.reasoningLevel] };
    if (caps.tempUnsupported) delete p.temperature;
    try {
      return await getClient().chat.completions.create(p);
    } catch (err) {
      if (!caps.tempUnsupported && p.temperature !== undefined && err?.status === 400 && /temperature/i.test(err?.message ?? "")) {
        caps.tempUnsupported = true;
        console.warn(`[llm] provider rejected temperature (${err.message}) — omitting it from now on`);
        continue;
      }
      if (caps.reasoningLevel < reasoningLadder.length - 1 && isReasoningRejection(err)) {
        caps.reasoningLevel++;
        console.warn(
          `[llm] provider rejected reasoning config (${err.message}) — falling back to ${JSON.stringify(reasoningLadder[caps.reasoningLevel])}`,
        );
        continue;
      }
      throw err;
    }
  }
}

let client = null;
function getClient() {
  if (!config.apiKey) {
    throw new Error("Missing API key. Set LLM_API_KEY (or OPENROUTER_API_KEY).");
  }
  client ??= new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 60_000, maxRetries: 1 });
  return client;
}

// Async generator of text deltas.
export async function* streamText({ system, user, model, maxTokens, temperature, stop }) {
  const started = performance.now();
  let firstTokenMs = null, usage, finishReason;
  try {
    const stream = await chatCreate({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      ...(temperature !== undefined && { temperature }),
      ...(stop?.length && { stop }),
      ...(isOpenRouter && { stream_options: { include_usage: true } }),
      stream: true,
    });
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        firstTokenMs ??= performance.now() - started;
        yield delta;
      }
    }
    if (finishReason === "length") throw new Error("Model hit the output token limit");
  } finally {
    recordMetric({ provider: isOpenRouter ? "openrouter" : "compatible", model, firstTokenMs, durationMs: performance.now() - started, usage, finishReason });
  }
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
// Bound concurrent image jobs so a page full of <img> tags doesn't hammer the provider.
const IMG_CONCURRENCY = Math.max(1, parseInt(process.env.FOOGLE_IMAGE_CONCURRENCY ?? "6", 10) || 6);
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

async function fetchToImage(url) {
  const dataUrl = url.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
  if (dataUrl) return { mime: dataUrl[1], buf: Buffer.from(dataUrl[2], "base64") };
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`image fetch ${resp.status}`);
  return {
    mime: resp.headers.get("content-type") || "image/png",
    buf: Buffer.from(await resp.arrayBuffer()),
  };
}

export async function completeText({ system, user, model, maxTokens, temperature, stop }) {
  const started = performance.now();
  let r;
  try {
    r = await chatCreate({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      ...(temperature !== undefined && { temperature }),
      ...(stop?.length && { stop }),
    });
    if (r.choices?.[0]?.finish_reason === "length") throw new Error("Model hit the output token limit");
    return r.choices?.[0]?.message?.content ?? "";
  } finally {
    recordMetric({ provider: isOpenRouter ? "openrouter" : "compatible", model, durationMs: performance.now() - started, usage: r?.usage, finishReason: r?.choices?.[0]?.finish_reason });
  }
}

const escXml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// SVGs are loaded via <img> (scripts can't run there), but sanitize anyway in
// case one is opened directly as a document.
function sanitizeSVG(text) {
  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");
  if (start === -1 || end === -1) throw new Error("model did not return an <svg>");
  return text
    .slice(start, end + 6)
    .replace(/<script[\s\S]*?(?:<\/script>|$)/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, "");
}

async function svgImage(prompt) {
  const text = await completeText({
    model: config.imageModel,
    maxTokens: 3000,
    temperature: config.tempPages,
    system: `You are a vector illustrator. Given an image description, output ONLY a complete standalone SVG — starting with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"> — no markdown fences, no commentary, no <script>, no external references.

Style: bold flat-vector illustration. A considered 4-6 color palette, simple layered composition (background, subject), strong silhouettes. The image must read clearly as the described subject.

Speed matters: 15-40 elements TOTAL, written tersely (short attribute values, no whitespace padding, reuse via 2-3 <defs> gradients at most). Suggest detail with shape and color, don't draw it.`,
    user: prompt,
  });
  return { mime: "image/svg+xml", buf: Buffer.from(sanitizeSVG(text)) };
}

async function asciiImage(prompt) {
  const text = await completeText({
    model: config.imageModel,
    maxTokens: 900,
    temperature: config.tempPages,
    system: `You are an ASCII artist. Given an image description, output ONLY the ASCII art — no markdown fences, no commentary, no caption. Use 10-20 lines, up to 56 characters wide. Use shading characters (.,:;+*#%@) for depth. Go straight into the art with your first character. The art must read clearly as the described subject.`,
    user: prompt,
  });
  const lines = text.replace(/```[a-z]*/gi, "").replace(/\s+$/, "").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) throw new Error("model returned no ascii art");
  const cols = Math.max(...lines.map((l) => l.length), 20);
  const w = cols * 8.5 + 40;
  const h = lines.length * 17 + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#101418"/>${lines
    .map((l, i) => `<text x="20" y="${32 + i * 17}" font-family="Menlo,Consolas,monospace" font-size="14" fill="#7ee787" xml:space="preserve">${escXml(l)}</text>`)
    .join("")}</svg>`;
  return { mime: "image/svg+xml", buf: Buffer.from(svg) };
}

// Returns { mime, buf }.
export function generateImage(prompt) {
  return withImageSlot(async () => {
    if (config.imageApi === "svg") return svgImage(prompt);
    if (config.imageApi === "ascii") return asciiImage(prompt);
    if (config.imageApi === "images") {
      const r = await getClient().images.generate({ model: config.imageModel, prompt });
      const d = r.data?.[0];
      if (d?.b64_json) return { mime: "image/png", buf: Buffer.from(d.b64_json, "base64") };
      if (d?.url) return fetchToImage(d.url);
      throw new Error("no image in response");
    }
    // Default: multimodal chat completion (OpenRouter style).
    const r = await getClient().chat.completions.create({
      model: config.imageModel,
      messages: [{ role: "user", content: `Generate an image: ${prompt}` }],
      modalities: ["image", "text"],
    });
    const url = r.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("no image in response");
    return fetchToImage(url);
  });
}
