import test from "node:test";
import assert from "node:assert/strict";
import { formIntent, createState, receiptSection, submissionTitle, submissionSummary, responseBriefs, replyWriter } from "../lib/interact.js";
import { generatePage } from "../lib/pages.js";
import { planFromAnswers } from "../lib/jev.js";

test("forms are read by what they do; query forms stay GETs", () => {
  assert.equal(formIntent("/search", { q: "lamps" }), null);
  assert.equal(formIntent("/tents", { size: "2p", sort: "price" }), null); // a filter, not a submission
  assert.equal(formIntent("/checkout", { name: "Jo", email: "jo@x.example" }), "checkout");
  assert.equal(formIntent("/signup", { email: "jo@x.example", password: "pw" }), "signup");
  assert.equal(formIntent("/account/login", { email: "jo@x.example", password: "pw" }), "login");
  assert.equal(formIntent("/permits/book-appointment", { name: "Jo", time: "10:20" }), "booking");
  assert.equal(formIntent("/contact", { name: "Jo", message: "Hi" }), "contact");
  assert.equal(formIntent("/anything", { _intent: "subscribe", email: "jo@x.example" }), "subscribe");
  assert.equal(formIntent("/", { name: "Jo", message: "Hi" }), "contact");
  assert.equal(formIntent("/", { name: "Jo", email: "jo@x.example" }), "form");
});

test("a visitor's cart is per site; checkout records the order and empties it", () => {
  const s = createState();
  s.updateCart("v1", "tents.example", { add: { name: "Ridge 1", price: "$349.00" } });
  s.updateCart("v1", "tents.example", { add: { name: "Ridge 1", price: "349" } });
  s.updateCart("v1", "tents.example", { add: { name: "Stake kit", price: 18 } });
  s.updateCart("v1", "other.example", { add: { name: "Lamp", price: 20 } });
  assert.deepEqual(s.cartOf("v2", "tents.example"), []);
  assert.deepEqual(s.cartOf("v1", "tents.example").map((i) => [i.name, i.qty, i.price]), [["Ridge 1", 2, 349], ["Stake kit", 1, 18]]);
  s.updateCart("v1", "tents.example", { set: { name: "Stake kit", qty: 0 } });
  assert.equal(s.cartOf("v1", "tents.example").length, 1);

  const { sub, location } = s.submit("v1", "tents.example", "/checkout", { name: "Jo Park", email: "jo@x.example", card_number: "4242424242424242", _intent: "checkout" });
  assert.equal(location, `/web/tents.example/checkout?order=${sub.ref}`);
  assert.equal(sub.total, 698);
  assert.deepEqual(s.cartOf("v1", "tents.example"), []);
  assert.deepEqual(s.cartOf("v1", "other.example").length, 1);
  assert.ok(!JSON.stringify(sub).includes("4242"), "card numbers are never kept");
  assert.equal(s.submission("tents.example", new URLSearchParams(`order=${sub.ref}`)), sub);
  assert.equal(s.submission("other.example", new URLSearchParams(`order=${sub.ref}`)), null);
  assert.equal(submissionTitle(sub), `Order #${sub.ref} confirmed`);
  assert.match(submissionSummary(sub), /2× Ridge 1 \(\$349\); total \$698/);
  assert.match(responseBriefs(sub)[0], /timeline/);
});

test("signing up remembers the visitor on that site; passwords are never echoed", () => {
  const s = createState();
  const { sub, location } = s.submit("v1", "app.example", "/signup", { name: "Jo", email: "jo@x.example", password: "hunter22" });
  assert.match(location, /^\/web\/app\.example\/signup\?ref=[0-9A-F]{6}$/);
  assert.deepEqual(s.users.get("v1|app.example"), { name: "Jo", email: "jo@x.example" });
  assert.ok(!JSON.stringify(sub).includes("hunter22"));
  assert.equal(s.submit("v1", "app.example", "/search", { q: "docs" }), null);
});

test("receipts are exact and escape what the visitor typed", () => {
  const s = createState();
  s.updateCart("v", "shop.example", { add: { name: "<b>Lamp</b>", price: 20 } });
  const { sub } = s.submit("v", "shop.example", "/checkout", { name: "<img src=x onerror=alert(1)>", email: "a@b.example" });
  const html = receiptSection(sub, "shop.example");
  assert.match(html, /^<section class="fw-receipt">/);
  assert.doesNotMatch(html, /<img|<b>Lamp/);
  assert.match(html, /&lt;b&gt;Lamp&lt;\/b&gt;/);
  assert.match(html, /\$6\.95/); // shipping under $50
  assert.match(html, /<b>\$26\.95<\/b>/);
  const booking = s.submit("v", "shop.example", "/book", { name: "Jo", time: "10:20" }).sub;
  assert.match(receiptSection(booking, "shop.example"), /<th>Time<\/th><td>10:20<\/td>/);
});

test("a posted comment gets an answer from someone on the site, threaded under it", async () => {
  let asked;
  const s = createState({ reply: async (args) => { asked = args; return { name: "crumbkate", text: "Stick with rye." }; } });
  const mine = s.addComment("/forum.example/t/1", { parent: "p2", name: "joe", text: "Switch flours?" });
  s.answer("/forum.example/t/1", mine, { title: "Starter", post: "Feed it rye." });
  await new Promise((r) => setImmediate(r));
  const [, reply] = s.comments.get("/forum.example/t/1");
  assert.equal(asked.context.post, "Feed it rye.");
  assert.deepEqual([reply.name, reply.parent, reply.bot], ["crumbkate", "p2", true]);
  const top = s.addComment("/forum.example/t/1", { name: "", text: "hi" });
  assert.equal(top.name, "guest");
  s.answer("/forum.example/t/1", top, {});
  await new Promise((r) => setImmediate(r));
  assert.equal(s.comments.get("/forum.example/t/1").at(-1).parent, top.id); // a reply to a top-level comment nests under it
});

test("reply writer keeps one 'username: text' line", async () => {
  const write = replyWriter(async () => "crumb_kate: Try a warmer spot.\nextra line");
  assert.deepEqual(await write({ comment: { text: "?", name: "joe" }, context: {} }), { name: "crumb_kate", text: "Try a warmer spot." });
  assert.equal(await replyWriter(async () => "no format here")({ comment: { text: "?", name: "j" }, context: {} }), null);
});

test("a confirmation page opens with the receipt and briefs its writers on the submission", async () => {
  const s = createState();
  s.updateCart("v", "shop.example", { add: { name: "Weft 1 lamp", price: 89 } });
  const { sub } = s.submit("v", "shop.example", "/checkout", { name: "Jo", email: "jo@x.example" });
  const submission = { summary: submissionSummary(sub), briefs: responseBriefs(sub), receipt: receiptSection(sub, "shop.example") };
  const plan = planFromAnswers({ url: "https://shop.example/checkout" }, { kind: { choice: "store" }, mood: { choice: "light" } });
  const specs = [];
  const chunks = [];
  const factSpecs = [];
  const args = { url: `https://shop.example/checkout?order=${sub.ref}`, title: submissionTitle(sub), submission };
  for await (const c of generatePage(args, { looks: new Map(), planWithJev: async () => plan, facts: async function* (a) { factSpecs.push(a); }, complete: async (spec) => { specs.push(spec); return "<section><h2>Next</h2></section>"; } })) chunks.push(c);
  assert.equal(chunks[1], submission.receipt); // straight after the shell, before any writer finishes
  assert.equal(specs.length, 2);
  assert.ok(specs.every((spec) => spec.user.includes("Weft 1 lamp") && spec.user.includes("site's answer to a form")));
  assert.match(specs[0].user, /Write section 1 of 2: What happens next/);
  assert.equal(factSpecs[0].submission, submission);
});
