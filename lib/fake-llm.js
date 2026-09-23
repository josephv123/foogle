// Development switches for the model, so layout and interactivity work can be
// checked in seconds and for free:
//
//   FOOGLE_FAKE_LLM=1            every model call and every Jev call is answered
//                                with canned output (lib/fake-fixtures.js): no
//                                network, no key, no cost.
//   FOOGLE_FAKE_LLM_DELAY_MS=3   pause between streamed chunks (0 for none), so
//                                the streaming code paths still run.
//   FOOGLE_LLM_CACHE=record      call the real model and save every response.
//   FOOGLE_LLM_CACHE=replay      answer from the saved responses (a prompt that
//                                wasn't recorded gets canned output). No network.
//   FOOGLE_LLM_CACHE_DIR=dir     where recordings live (default .foogle-cache/llm).
//
// The hooks sit below everything else: lib/llm.js gets its OpenAI client from
// devClient() and lib/jev.js its fetch from devJevFetch, so the real request
// building, streaming, usage accounting and parsing all still run.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeReply, fakeJevAnswers } from "./fake-fixtures.js";
import { recordingClient, replayingClient, recordingFetch, replayingFetch } from "./llm-cache.js";

const env = process.env;
export const FAKE = /^(1|true|yes|on)$/i.test(env.FOOGLE_FAKE_LLM ?? "");
const cacheMode = String(env.FOOGLE_LLM_CACHE ?? "").toLowerCase();
export const CACHE = FAKE ? null : ["record", "replay"].includes(cacheMode) ? cacheMode : null;
// Nothing leaves the machine, so no API key is needed.
export const OFFLINE = FAKE || CACHE === "replay";
// The model name config uses. The disk image cache is keyed by it, so canned
// pictures (fake mode, or a replay miss) never mix with real ones.
export const devModel = (real) => (FAKE ? "foogle/fake-llm" : CACHE === "replay" ? `${real}+replay` : real);

const DELAY_MS = Math.max(0, Number(env.FOOGLE_FAKE_LLM_DELAY_MS ?? 3) || 0);
const CACHE_DIR = path.resolve(env.FOOGLE_LLM_CACHE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".foogle-cache", "llm"));

if (FAKE) console.log("[fake-llm] FOOGLE_FAKE_LLM is on: canned model and Jev output, no network, no cost");
else if (CACHE) console.log(`[fake-llm] FOOGLE_LLM_CACHE=${CACHE}: ${CACHE === "record" ? "saving" : "replaying"} responses in ${CACHE_DIR}`);
if (cacheMode && !CACHE && !FAKE) console.warn(`[fake-llm] ignoring FOOGLE_LLM_CACHE=${cacheMode} (use record or replay)`);

// Roughly 4 characters per token, as for English text.
const tokens = (s) => Math.ceil(String(s).length / 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An OpenAI chat-completions response for `text`, streamed in small chunks
// when the request asks for a stream. Like the real API, a reply longer than
// max_tokens is cut off with finish_reason "length". Usage reports a cost of 0.
export function respond(req, text, { delayMs = DELAY_MS, chunk = 32, finish = "stop" } = {}) {
  let content = String(text);
  if (req.max_tokens && tokens(content) > req.max_tokens) {
    content = content.slice(0, req.max_tokens * 4);
    finish = "length";
  }
  const usage = { prompt_tokens: tokens(req.messages.map((m) => m.content).join("")), completion_tokens: tokens(content), cost: 0 };
  if (!req.stream) return { choices: [{ message: { role: "assistant", content }, finish_reason: finish }], usage };
  return (async function* () {
    for (let i = 0; i < content.length; i += chunk) {
      if (delayMs) await sleep(delayMs);
      yield { choices: [{ delta: { content: content.slice(i, i + chunk) }, finish_reason: null }] };
    }
    yield { choices: [{ delta: {}, finish_reason: finish }], usage };
  })();
}

const messageText = (req, role) => req.messages.find((m) => m.role === role)?.content ?? "";

// The same shape as the OpenAI SDK client, as far as lib/llm.js uses it.
export function fakeClient(opts) {
  return {
    chat: {
      completions: {
        create: async (req) => respond(req, fakeReply(messageText(req, "system"), messageText(req, "user")), opts),
      },
    },
  };
}

// A fetch for the Jev endpoint that answers every question it is asked.
export const fakeJevFetch = async (url, init = {}) => {
  const body = JSON.parse(init.body ?? "{}");
  if (DELAY_MS) await sleep(DELAY_MS * 10);
  return Response.json({ answers: fakeJevAnswers(body) });
};

// lib/llm.js's client: canned, recorded or real.
export function devClient(makeReal) {
  if (FAKE) return fakeClient();
  if (CACHE === "record") return recordingClient(makeReal(), CACHE_DIR);
  if (CACHE === "replay") return replayingClient(fakeClient(), CACHE_DIR, (req, text, finish) => respond(req, text, { finish }));
  return makeReal();
}

// lib/jev.js's fetch, or undefined to use the global one.
export const devJevFetch = FAKE ? fakeJevFetch
  : CACHE === "record" ? recordingFetch((...args) => fetch(...args), CACHE_DIR)
  : CACHE === "replay" ? replayingFetch(fakeJevFetch, CACHE_DIR)
  : undefined;
