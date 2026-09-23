import OpenAI from "openai";

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
});

// Async generator of text deltas.
export async function* streamText(spec) {
  let finishReason;
  const stream = await getClient().chat.completions.create({ ...request(spec), stream: true });
  for await (const chunk of stream) {
    finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
  if (finishReason === "length") throw new Error("Model hit the output token limit");
}

export async function completeText(spec) {
  const r = await getClient().chat.completions.create(request(spec));
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

// A site's palette is part of the prompt, so its pictures are drawn for the
// page (see /img in server.js).
export const withPalette = (prompt, { bg, fg }) =>
  `${prompt}\nPalette: the image sits on a page with background ${bg} and accent ${fg}. Use ${bg} or a close tint of it as the backdrop, so the picture blends into the page wherever it is letterboxed, and build the rest around the accent with tints and shades in the same family (the subject can keep its natural colors where they matter).`;

// Measured on GPT-6 Luna: this lean brief draws recognizable subjects in ~6s
// (~660 output tokens); an 800x600, 15-40 element brief took ~11s.
// Returns { mime, buf }.
export function generateImage(prompt) {
  return withImageSlot(async () => {
    const text = await completeText({
      maxTokens: 2000,
      temperature: config.tempPages,
      system: `You are a vector illustrator. Given an image description, output ONLY a standalone SVG starting with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"> — no markdown fences, no commentary, no <script>, no external references.

Bold flat-vector illustration: a full-bleed background, a clear subject with a strong silhouette, 4-6 harmonious colors. 10-25 elements, integer coordinates, compact paths (short d strings, no decimals), at most one gradient. Aim for under 1500 characters total. No words or captions; only use <text> for single letters or numbers the description explicitly asks for (like lettered map pins). The subject must be instantly recognizable.`,
      user: prompt,
    });
    return { mime: "image/svg+xml", buf: Buffer.from(sanitizeSVG(text)) };
  });
}
