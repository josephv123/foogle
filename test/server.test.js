import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
      const system = p.messages[0].content;
      const sse = (content) => new Response('data: ' + JSON.stringify({choices:[{delta:{content},finish_reason:"stop"}]}) + '\\n\\ndata: [DONE]\\n\\n', {headers:{"Content-Type":"text/event-stream"}});
      if (system.includes("ONE section")) {
        sections++;
        console.log("SECTION_CALL=" + sections);
        return sse('<section><h2>Garden repairs</h2><p>Section '+sections+'</p><a href="/web/garden.example/archive">Archive</a></section>');
      }
      if (system.includes("fact sheet")) {
        console.log("FACTS_CALL");
        return sse("- The greenhouse glazier is Ada Moss.\\nGlass costs $38 a pane.");
      }
      if (system.includes("image index")) {
        return sse(JSON.stringify({caption:"Greenhouse frame plans",site:"panes.example",path:"/plans",style:"blueprint",shape:"tall",image:"greenhouse frame side elevation"}) + "\\n");
      }
      if (system.includes("visitor's comment")) {
        return Response.json({choices:[{message:{content:"crumbkate: Rye first, then bread flour."},finish_reason:"stop"}]});
      }
      if (p.stream) {
        return sse(JSON.stringify({site:"Gardeners Guild",title:"Gardeners",url:"https://garden.example/repairs",snippet:"Greenhouse repairs",kind:"forum",meta:"4.8★ · 212 reviews"}) + "\\n");
      }
      if (system.includes("draws in SVG")) {
        console.log("ART_PROMPT=" + JSON.stringify(p.messages[1].content));
        return Response.json({choices:[{message:{content:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#7ab"/></svg>'},finish_reason:"stop"}]});
      }
      if (system.includes("overview writer")) {
        return Response.json({choices:[{message:{content:JSON.stringify({title:"Greenhouses",summary:"Reglaze cracked panes in spring.",ask:[{q:"How long does glazing last?",a:"About 20 years."}],related:["cold frames"]})},finish_reason:"stop"}]});
      }
      throw new Error("Unexpected request");
    };
    await import("./scripts/start.js");
  `;
  // A fresh image cache, so art is generated (not read from a real run's disk cache).
  const imageCache = await mkdtemp(path.join(tmpdir(), "foogle-img-"));
  t.after(() => rm(imageCache, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, "--", "--port", "0"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, OPENROUTER_API_KEY: "test", TYPESAFE_API_KEY: "test", FOOGLE_IMAGE_CACHE: imageCache },
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
  const serp = await search.text();
  assert.match(serp, /Gardeners Guild/);
  assert.match(serp, /<span class="rkind">Forum<\/span>/);
  assert.match(serp, /&amp;fk=forum/); // the page learns what kind of result was clicked
  // The overview panel is streamed into its slot; related searches close the page.
  assert.match(serp, /<template id="kpt">[\s\S]*Reglaze cracked panes/);
  assert.match(serp, /People also search for[\s\S]*cold%20frames/);
  const page2 = await (await fetch(`${base}/search?q=greenhouse&page=2`)).text();
  assert.match(page2, /Page 2 of about/);
  assert.match(page2, /href="\/search\?q=greenhouse&page=3">Next/);
  const form = await fetch(`${base}/web/garden.example/search`, { method: "POST", body: new URLSearchParams({ q: "glass panes" }), redirect: "manual" });
  assert.equal(form.status, 303);
  assert.equal(form.headers.get("location"), "/web/garden.example/search?q=glass+panes");
  const lucky = await fetch(`${base}/search?q=greenhouse&lucky=1`, { redirect: "manual" });
  assert.equal(lucky.status, 302);
  assert.match(lucky.headers.get("location"), /^\/web\/garden.example/);
  const url = `${base}/web/garden.example/repairs?fq=greenhouse&ft=Gardeners`;
  const page = await (await fetch(url)).text();
  assert.equal((page.match(/<section>/g) || []).length, 4);
  assert.match(page, /<\/html>/);
  assert.match(output, /model:.*openai\/gpt-6-luna/);
  assert.match(output, /SECTION_CALL=4/);
  // Hero art is an SVG illustration drawn in the site's palette.
  const art = page.match(/<img class="art" src="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const svg = await (await fetch(base + art)).text();
  assert.match(svg, /^<svg/);
  assert.match(output, /ART_PROMPT=.*Palette: the image sits on a page with background \S+ and accent hsl\(/);
  assert.equal(output.match(/ART_PROMPT=/g).length, 1); // warmed and fetched as the same image
  // Image results are drawn in the medium and shape they name; the grid tile
  // keeps that shape.
  const images = await (await fetch(`${base}/images?q=greenhouse`)).text();
  assert.match(images, /src="\/img\/greenhouse%20frame%20side%20elevation\?s=blueprint&amp;a=tall"/);
  assert.match(images, /style="aspect-ratio:280\/420"/);
  const drawn = await fetch(`${base}/img/greenhouse%20frame%20side%20elevation?s=blueprint&a=tall`);
  assert.match(drawn.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await drawn.text(), /^<svg/);
  assert.match(output, /ART_PROMPT=.*Medium: blueprint/);
  // An old-style bare /img URL still draws, in a style its description names.
  const bare = await fetch(`${base}/img/pixel%20art%20of%20a%20greenhouse`);
  assert.equal(bare.status, 200);
  assert.match(await bare.text(), /^<svg/);
  assert.match(output, /ART_PROMPT="Picture: pixel art of a greenhouse\\nMedium: pixel art\./);
  const cached = await (await fetch(url)).text();
  assert.match(cached, /Section 4/);
  assert.ok(!output.includes("SECTION_CALL=5"));

  // Generated pages may run only Foogle's scripts, and load its runtime.
  const res = await fetch(url);
  assert.match(res.headers.get("content-security-policy"), /script-src 'self' 'unsafe-hashes' 'sha256-/);
  assert.match(await res.text(), /<script src="\/fw\/widgets\.js\?v=\w+" async>/);
  assert.equal((await fetch(`${base}/fw/widgets.js`)).status, 200);

  // A visitor's cart follows their cookie; checkout answers with a receipt page.
  const first = await fetch(`${base}/fw/state?site=garden.example&page=/garden.example/repairs`);
  const cookie = first.headers.get("set-cookie").split(";")[0];
  assert.match(cookie, /^fv=[a-f0-9]{16}$/);
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  assert.equal((await post("/fw/cart", { site: "garden.example", add: { name: "Glass pane", price: "$38" } })).cart[0].qty, 1);
  await post("/fw/cart", { site: "garden.example", add: { name: "Glass pane", price: "$38" } });
  const order = await fetch(`${base}/web/garden.example/checkout`, { method: "POST", headers: { cookie }, body: new URLSearchParams({ name: "Ada", email: "ada@garden.example", _intent: "checkout" }), redirect: "manual" });
  assert.equal(order.status, 303);
  const receiptURL = order.headers.get("location");
  assert.match(receiptURL, /^\/web\/garden\.example\/checkout\?order=\d+$/);
  const receipt = await (await fetch(base + receiptURL)).text();
  assert.match(receipt, /<title>Order #\d+ confirmed/);
  assert.match(receipt, /<td>Glass pane<\/td><td class="num">2<\/td><td class="num">\$76<\/td>/);
  assert.equal((await (await fetch(`${base}/fw/state?site=garden.example`, { headers: { cookie } })).json()).cart.length, 0);

  // Comments persist on the page, and someone answers.
  const { comment } = await post("/fw/comments", { page: "/garden.example/repairs", parent: "p1", name: "ada", text: "Rye or bread flour?" });
  assert.equal(comment.parent, "p1");
  let comments = [];
  for (let i = 0; i < 50 && comments.length < 2; i++) {
    comments = (await (await fetch(`${base}/fw/comments?page=/garden.example/repairs`)).json()).comments;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.deepEqual(comments.map(c => [c.name, c.bot]), [["ada", false], ["crumbkate", true]]);
});
