import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("default launcher uses Luna and Jev for search, pages and cached revisits", async t => {
  const script = `
    let sections = 0;
    globalThis.fetch = async (url, init) => {
      const p = JSON.parse(init.body);
      if (url === "https://api.typesafe.ai/v1/systemone") {
        return Response.json({ answers: { kind: {choice:"forum"}, mood:{choice:"light"} } });
      }
      if (String(url) !== "https://openrouter.ai/api/v1/chat/completions" || p.model !== "openai/gpt-6-luna") {
        throw new Error("Unexpected provider or model");
      }
      if (p.stream) {
        const result = JSON.stringify({title:"Gardeners",url:"https://garden.example/repairs",snippet:"Greenhouse repairs"}) + "\\n";
        return new Response('data: ' + JSON.stringify({choices:[{delta:{content:result},finish_reason:"stop"}]}) + '\\n\\ndata: [DONE]\\n\\n', {headers:{"Content-Type":"text/event-stream"}});
      }
      sections++;
      console.log("SECTION_CALL=" + sections);
      return Response.json({choices:[{message:{content:'<section><h2>Garden repairs</h2><p>Section '+sections+'</p><a href="/web/garden.example/archive">Archive</a></section>'},finish_reason:"stop"}]});
    };
    await import("./scripts/start.js");
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, "--", "--port", "0"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, OPENROUTER_API_KEY: "test", TYPESAFE_API_KEY: "test", FOOGLE_PRESET: "", FOOGLE_PAGE_MODE: "", FOOGLE_PAGE_SECTIONS: "3" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => { child.kill(); await once(child, "exit"); });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start")), 5000);
    child.once("error", reject);
    child.stdout.on("data", data => {
      const match = String(data).match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const base = `http://localhost:${port}`;
  const search = await fetch(`${base}/search?q=greenhouse`);
  assert.equal(search.status, 200);
  assert.match(await search.text(), /Gardeners/);
  const lucky = await fetch(`${base}/search?q=greenhouse&lucky=1`, { redirect: "manual" });
  assert.equal(lucky.status, 302);
  assert.match(lucky.headers.get("location"), /^\/web\/garden.example/);
  const url = `${base}/web/garden.example/repairs?fq=greenhouse&ft=Gardeners`;
  const page = await (await fetch(url)).text();
  assert.equal((page.match(/<section>/g) || []).length, 3);
  assert.match(page, /<\/html>/);
  assert.match(output, /pages:.*openai\/gpt-6-luna \(jev\)/);
  assert.match(output, /SECTION_CALL=3/);
  assert.ok(!output.includes("SECTION_CALL=4"));
  const cached = await (await fetch(url)).text();
  assert.match(cached, /Section 3/);
  assert.ok(!output.includes("SECTION_CALL=4"));
});
