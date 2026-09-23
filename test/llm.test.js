import test from "node:test";
import assert from "node:assert/strict";

test("requests go to Luna on OpenRouter without reasoning; truncation and a dropped stream fail", async t => {
  const seen = [];
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (url, init) => {
    const p = JSON.parse(init.body);
    seen.push({ url: String(url), ...p });
    const finish = p.messages[1].content === "truncate" ? "length" : "stop";
    if (!p.stream) return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: finish }] });
    const events = [{ choices: [{ delta: { content: "hello" }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: finish }] }];
    const sse = (e) => `data: ${JSON.stringify(e)}\n\n`;
    // OpenRouter reports a stream that broke off upstream as an error event.
    if (p.messages[1].content === "drop") return new Response(sse(events[0]) + sse({ error: { message: "Stream ended before a terminal response event", code: 502 } }), { headers: { "Content-Type": "text/event-stream" } });
    // Or the connection itself dies partway.
    if (p.messages[1].content === "reset") {
      const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse(events[0]))); setTimeout(() => c.error(new Error("socket hang up")), 5); } });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  };
  process.env.OPENROUTER_API_KEY = "test";
  const { completeText, streamText, TruncatedError, DroppedError } = await import("../lib/llm.js");
  const spec = { system: "test", user: "test", maxTokens: 20, temperature: 0.7 };
  assert.equal(await completeText(spec), "ok");
  assert.equal(seen[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen[0].model, "openai/gpt-6-luna");
  assert.equal(seen[0].temperature, 0.7);
  assert.deepEqual(seen[0].reasoning, { enabled: false });
  let text = "";
  for await (const c of streamText(spec)) text += c;
  assert.equal(text, "hello");
  const truncated = (err) => err instanceof TruncatedError && /token limit/.test(err.message);
  await assert.rejects(completeText({ ...spec, user: "truncate" }), truncated);
  await assert.rejects(async () => { for await (const _ of streamText({ ...spec, user: "truncate" })) {} }, truncated);
  // What arrived before a stream dropped is still yielded (a page section keeps its whole blocks).
  for (const [user, why] of [["drop", /Stream ended before a terminal response event/], ["reset", /socket hang up/]]) {
    let got = "";
    await assert.rejects(async () => { for await (const c of streamText({ ...spec, user })) got += c; }, (err) => err instanceof DroppedError && why.test(err.message));
    assert.equal(got, "hello");
  }
});
