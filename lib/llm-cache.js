// Record and replay model responses (FOOGLE_LLM_CACHE, see lib/fake-llm.js):
// capture one real run, then iterate against it for free. One JSON file per
// response, named by a hash of its prompt.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const hash = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);

// A page's later sections carry whichever fact-sheet lines had arrived when
// they were sent (lib/pages.js waits at most FACTS_WAIT_MS), so the same
// section's prompt differs between runs. The loose key leaves the fact sheet
// out; replay tries the exact key first.
export const stripFacts = (user) => user.replace(/^Fact sheet:\n[\s\S]*?\n(?=Write section|This page is the site's answer)/m, "");

export function promptKeys(req) {
  const system = req.messages.find((m) => m.role === "system")?.content ?? "";
  const user = req.messages.find((m) => m.role === "user")?.content ?? "";
  const exact = hash(system, user);
  const loose = hash(system, stripFacts(user));
  return loose === exact ? [exact] : [exact, loose];
}

// Write-then-rename, so a half-written recording is never read back.
function save(dir, keys, record) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const key of keys) {
      const file = path.join(dir, `${key}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 1));
      fs.renameSync(`${file}.tmp`, file);
    }
  } catch (err) {
    console.warn(`[llm-cache] could not save a recording: ${err.message}`);
  }
}

function load(dir, keys) {
  for (const key of keys) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), "utf8")); } catch { /* next key */ }
  }
  return null;
}

const describe = (req) => ({
  model: req.model,
  system: String(req.messages.find((m) => m.role === "system")?.content ?? "").slice(0, 160),
  user: req.messages.find((m) => m.role === "user")?.content ?? "",
});

// Passes every call through to `inner` and saves what came back, once the
// whole response has arrived (a stream that fails midway isn't saved).
export function recordingClient(inner, dir) {
  return {
    chat: {
      completions: {
        create: async (req) => {
          const res = await inner.chat.completions.create(req);
          const keys = promptKeys(req);
          if (!req.stream) {
            const c = res.choices?.[0];
            save(dir, keys, { ...describe(req), text: c?.message?.content ?? "", finish: c?.finish_reason ?? "stop" });
            return res;
          }
          return (async function* () {
            let text = "";
            let finish = "stop";
            for await (const chunk of res) {
              text += chunk.choices?.[0]?.delta?.content ?? "";
              finish = chunk.choices?.[0]?.finish_reason ?? finish;
              yield chunk;
            }
            save(dir, keys, { ...describe(req), text, finish });
          })();
        },
      },
    },
  };
}

// Answers from the recordings; anything not recorded goes to `fallback`.
// `respond(req, text, finish)` shapes a recorded text into an API response.
export function replayingClient(fallback, dir, respond) {
  const missed = new Set();
  return {
    chat: {
      completions: {
        create: async (req) => {
          const keys = promptKeys(req);
          const hit = load(dir, keys);
          if (hit) return respond(req, hit.text, hit.finish);
          if (!missed.has(keys[0])) {
            missed.add(keys[0]);
            console.warn(`[llm-cache] not recorded, using canned output: ${describe(req).system.slice(0, 60)}…`);
          }
          return fallback.chat.completions.create(req);
        },
      },
    },
  };
}

// Jev is recorded by its whole request body.
export const recordingFetch = (inner, dir) => async (url, init = {}) => {
  const res = await inner(url, init);
  if (res.ok) save(dir, [hash("jev", init.body)], { jev: JSON.parse(init.body ?? "{}").state?.url, body: await res.clone().json() });
  return res;
};

export const replayingFetch = (fallback, dir) => async (url, init = {}) => {
  const hit = load(dir, [hash("jev", init.body)]);
  return hit ? Response.json(hit.body) : fallback(url, init);
};
