import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { withMetrics } from "../lib/metrics.js";

test("model capability fallbacks are isolated, streaming usage is captured, and truncation fails", async t => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const p = JSON.parse(body);
    seen.push(p);
    res.setHeader("Content-Type", "application/json");
    if (p.model === "no-temperature" && p.temperature !== undefined) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: "temperature is unsupported" } }));
    }
    if (p.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {content:"hello"}, finish_reason:null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{delta:{},finish_reason:p.model === "truncated" ? "length" : "stop"}] })}\n\n`);
      res.write(`data: ${JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:2,cost:0.0001}})}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    res.end(JSON.stringify({ choices: [{ message: {content:"ok"}, finish_reason:"stop" }], usage: {prompt_tokens:10,completion_tokens:2} }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  process.env.LLM_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.LLM_API_KEY = "test";
  process.env.FOOGLE_REASONING = "default";
  const { completeText, streamText } = await import("../lib/llm.js");
  const p = { system:"test", user:"test", maxTokens:20, temperature:0.7 };
  await completeText({ ...p, model:"no-temperature" });
  await completeText({ ...p, model:"with-temperature" });
  assert.equal(seen.at(-1).temperature, 0.7);
  assert.equal(seen.filter(r => r.model === "no-temperature").length, 2);
  const events = [];
  const text = await withMetrics(events, async () => {
    let s = ""; for await (const c of streamText({...p,model:"stream"})) s += c; return s;
  });
  assert.equal(text, "hello");
  assert.equal(events[0].usage.cost, 0.0001);
  assert.equal(events[0].finishReason, "stop");
  assert.ok(events[0].firstTokenMs >= 0);
  await assert.rejects(async () => { for await (const _ of streamText({...p,model:"truncated"})) {} }, /token limit/);
});
