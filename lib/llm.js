import OpenAI from "openai";
import { imageMessages } from "./images.js";
import { OFFLINE, devModel, devClient } from "./fake-llm.js";

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
  // In fake or replay mode (lib/fake-llm.js) nothing is sent, so no key is needed.
  apiKey: cleanKey(process.env.OPENROUTER_API_KEY) ?? (OFFLINE ? "offline" : undefined),
  model: devModel("openai/gpt-6-luna"),
  // Hot results for variety (the JSONL parser skips an occasional broken line);
  // neutral pages so structure stays reliable.
  tempResults: 1.2,
  tempPages: 1.0,
};

let client = null;
function getClient() {
  if (!config.apiKey) throw new Error("Missing API key. Set OPENROUTER_API_KEY.");
  // OpenRouter, unless FOOGLE_FAKE_LLM or FOOGLE_LLM_CACHE says otherwise.
  client ??= devClient(() => new OpenAI({ apiKey: config.apiKey, baseURL: "https://openrouter.ai/api/v1", timeout: 60_000, maxRetries: 1 }));
  return client;
}

// `model` and `provider` (OpenRouter routing) default to Luna; search
// suggestions use a smaller, faster model (see lib/suggest.js).
const request = ({ system, user, maxTokens, temperature, model = config.model, provider }) => ({
  model,
  messages: [{ role: "system", content: system }, { role: "user", content: user }],
  max_tokens: maxTokens,
  temperature,
  // Thinking costs seconds of invisible tokens before the first byte.
  reasoning: { enabled: false },
  // Each response then reports its cost in USD (see onUsage).
  usage: { include: true },
  ...(provider ? { provider } : {}),
});

// Per-call client options: an AbortSignal, and retries (a retry is useless to
// a caller that needs an answer in a fraction of a second).
const callOptions = ({ signal, maxRetries }) => ({ ...(signal ? { signal } : {}), ...(maxRetries != null ? { maxRetries } : {}) });

// OpenRouter routing for calls that are mostly output: pictures, and the
// Images results that name them. Luna is served by OpenAI and Azure at the
// same price, and on 2026-09-23 Azure wrote a 12-picture batch at ~265
// tokens/s against OpenAI's ~123 (median picture 4.6s against 8.0s). Sorting
// by throughput follows whichever is faster lately, and falls back to the
// other. OpenAI's flex tier is cheaper but can queue for many seconds, and
// its fast tier costs double and was no faster, so both are left out.
export const FAST_ROUTE = { sort: "throughput", ignore: ["openai/flex", "openai/fast"] };

// Every call's reported usage goes to these listeners; the daily budget in
// lib/limits.js is tracked from it.
const usageListeners = new Set();
export const onUsage = (fn) => usageListeners.add(fn);
function reportUsage(usage) {
  if (usage) for (const fn of usageListeners) fn(usage);
}

// A reply cut off at maxTokens. A caller that can use the part that did arrive
// (a page section keeps its whole blocks, see lib/pages.js) checks for it.
export class TruncatedError extends Error {
  constructor() { super("Model hit the output token limit"); }
}

// A reply whose stream broke off partway: OpenRouter's "Stream ended before a
// terminal response event", or a dropped connection. Like TruncatedError, the
// part that did arrive may still be usable.
export class DroppedError extends Error {
  constructor(cause) { super(`Stream dropped mid-reply: ${cause?.message ?? cause}`, { cause }); }
}

// Async generator of text deltas. `spec.onUsage` also gets this call's usage.
export async function* streamText(spec) {
  let finishReason;
  const stream = await getClient().chat.completions.create({ ...request(spec), stream: true }, callOptions(spec));
  try {
    for await (const chunk of stream) {
      reportUsage(chunk.usage);
      if (chunk.usage) spec.onUsage?.(chunk.usage);
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  } catch (err) {
    throw new DroppedError(err);
  }
  if (finishReason === "length") throw new TruncatedError();
}

export async function completeText(spec) {
  const r = await getClient().chat.completions.create(request(spec), callOptions(spec));
  reportUsage(r.usage);
  if (r.choices?.[0]?.finish_reason === "length") throw new TruncatedError();
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
// Pictures are SVG illustrations drawn by the text model, a bounded number at
// once. A picture someone is waiting for (an /img request, an Images or News
// result) goes ahead of one drawn in case it's needed (a prefetched page's),
// and a queued one moves up once a browser asks for it: see `ticket` below.
const IMG_CONCURRENCY = 24;
let imgActive = 0;
const imgQueue = []; // tickets waiting for a slot
async function withImageSlot(fn, ticket) {
  if (imgActive < IMG_CONCURRENCY) imgActive++;
  else await new Promise((go) => imgQueue.push(Object.assign(ticket, { go })));
  try {
    return await fn();
  } finally {
    const i = imgQueue.findIndex((t) => t.urgent);
    const next = imgQueue.splice(i === -1 ? 0 : i, 1)[0];
    // The slot passes straight to the next picture.
    if (next) next.go();
    else imgActive--;
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

// Everything a picture draws is outside these: they define paint, filters and
// shapes for later, or hold no picture at all.
const UNDRAWN = new Set(["defs", "linearGradient", "radialGradient", "pattern", "filter", "clipPath", "mask", "symbol", "marker", "style", "title", "desc", "metadata"]);
const DRAWN = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "use"]);
// A tag, quoted attribute values and all, or a whole comment or CDATA section.
// An unterminated comment or CDATA matches on its own, and ends the draft.
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!--|<!\[CDATA\[|<(\/?)([a-zA-Z][\w:.-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;

// A picture as far as the model has written it: the SVG up to its last
// complete tag, with the elements still open closed, sanitized like a finished
// one. Null until something outside <defs> has been drawn. Tags are balanced
// on the way, so a finished picture comes through too, repaired: a model now
// and then closes an element under the wrong name (<path …>label</text>), and
// one mismatched tag would leave the whole picture blank.
export function draftSVG(text) {
  const start = text.indexOf("<svg");
  if (start === -1) return null;
  const open = [];
  let hidden = 0; // how many of the open elements are UNDRAWN
  let drawn = false;
  let out = "";
  let last = start;
  const close = (n) => {
    if (UNDRAWN.has(n)) hidden--;
    else if (!hidden && DRAWN.has(n)) drawn = true;
    return `</${n}>`;
  };
  const tag = new RegExp(TAG);
  tag.lastIndex = start;
  for (let m; (m = tag.exec(text)); ) {
    if (m[0] === "<!--" || m[0] === "<![CDATA[") break;
    out += text.slice(last, m.index);
    last = tag.lastIndex;
    const [whole, closing, name, selfClosing] = m;
    if (!name) {
      out += whole;
    } else if (closing) {
      // A closer for an element that isn't open closes the innermost one
      // instead, never the <svg> itself; one for an outer element closes
      // everything inside it too.
      let i = open.lastIndexOf(name);
      if (i === -1 && open.length > 1) i = open.length - 1;
      if (i !== -1) out += open.splice(i).reverse().map(close).join("");
    } else {
      out += whole;
      if (selfClosing) {
        if (!hidden && DRAWN.has(name)) drawn = true;
      } else {
        open.push(name);
        if (UNDRAWN.has(name)) hidden++;
      }
    }
  }
  if (!drawn) return null;
  return sanitizeSVG(out + open.reverse().map((n) => `</${n}>`).join(""));
}

// The brief — medium, canvas, palette — comes from lib/images.js. On GPT-6
// Luna a picture takes ~3-6s depending on the medium (see EXPERIMENTS.md).
// Returns { mime, buf }.
export const generateImage = (spec, opts) => drawSVG(imageMessages(spec), opts);

// Any SVG from a { system, user } prompt, in an image slot, repaired and
// sanitized (see draftSVG). The Foogle Doodle (lib/doodle.js) brings its own
// prompt. It streams: `onText` gets the text so far after every delta, for
// drafts. `ticket` is the picture's place in the queue; set `ticket.urgent`
// while it waits to move it up.
export function drawSVG(messages, { maxTokens = 2400, onText, ticket = { urgent: true } } = {}) {
  return withImageSlot(async () => {
    let text = "";
    try {
      for await (const delta of streamText({ ...messages, maxTokens, temperature: config.tempPages, provider: FAST_ROUTE })) {
        text += delta;
        onText?.(text);
      }
    } catch (err) {
      // Cut off at the token limit, a picture is mostly drawn: keep it.
      if (!(err instanceof TruncatedError) || !draftSVG(text)) throw err;
    }
    return { mime: "image/svg+xml", buf: Buffer.from(draftSVG(text) ?? sanitizeSVG(text)) };
  }, ticket);
}
