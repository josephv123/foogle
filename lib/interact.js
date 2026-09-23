// Server-side state behind the interactive components (see lib/widgets.js):
// a per-visitor cart and account on each fake site, comments that persist on
// a page, and form submissions that are answered by a confirmation page.
// Everything lives in memory, capped, like the page cache: restarting Foogle
// wipes the fake internet's state along with its pages.

import express from "express";
import { randomBytes } from "node:crypto";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A Map that forgets its oldest entry past a size.
function capped(max) {
  const map = new Map();
  map.put = (k, v) => {
    if (!map.has(k) && map.size >= max) map.delete(map.keys().next().value);
    return map.set(k, v);
  };
  return map;
}

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const siteOf = (s) => clip(s, 120).toLowerCase().replace(/[^a-z0-9.-]/g, "");
// "/domain.tld/some/page?x=1" — the page a comment belongs to.
const pageOf = (s) => clip(s, 300).replace(/^\/web(?=\/)/, "");
const money = (n) => `$${n.toFixed(2).replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

// Fields a confirmation must never echo or keep.
const SECRET = /pass|card|cvv|cvc|ccv|ssn|security|secret|pin\b|iban|account.?num|routing/i;
// A form with only these fields is a query, not a submission: it redirects to
// the equivalent GET page, as every form did before.
const QUERY_FIELD = /^(q|query|search|s|keywords?|term|find)$/i;
const PERSONAL_FIELD = /name|mail|phone|tel|message|comment|address|password|note|guests|party|date|time|slot|pitch|reason|company/i;

const INTENTS = [
  ["checkout", /checkout|order|purchase|pay\b|payment|cart|buy/i],
  ["login", /log-?in|sign-?in/i],
  ["signup", /sign-?up|register|join|create|trial|account|start/i],
  ["subscribe", /subscri|newsletter|notify|waitlist|mailing|updates/i],
  ["booking", /book|reserv|appoint|schedul|rsvp|ticket|slot|visit|table/i],
  ["apply", /appl|permit|renew|claim|enrol|admission/i],
  ["contact", /contact|message|enquir|inquir|support|feedback|question|quote|help/i],
  ["submit", /submit|pitch|upload|entry|enter/i],
];

// What a POSTed form is for: its explicit _intent, else its path, else its
// fields. null means it is a query form (search, filter) and should become a GET.
export function formIntent(path, fields) {
  const names = Object.keys(fields).filter((k) => !k.startsWith("_"));
  const explicit = INTENTS.find(([name]) => name === String(fields._intent ?? "").toLowerCase());
  if (explicit) return explicit[0];
  if (names.some((k) => QUERY_FIELD.test(k)) && !names.some((k) => /mail|password/i.test(k))) return null;
  const byPath = INTENTS.find(([, re]) => re.test(path));
  if (byPath) return byPath[0];
  if (!names.some((k) => PERSONAL_FIELD.test(k))) return null;
  if (names.some((k) => /password/i.test(k))) return "signup";
  return INTENTS.find(([, re]) => names.some((k) => re.test(k)))?.[0] ?? "form";
}

const label = (k) => clip(k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"), 40).replace(/^\w/, (c) => c.toUpperCase());

export function createState({ reply } = {}) {
  const carts = capped(2000); // "visitor|site" -> [{ name, price, qty }]
  const users = capped(2000); // "visitor|site" -> { name, email }
  const comments = capped(500); // page -> [{ id, parent, name, text, rating, at, bot }]
  const submissions = capped(500); // "site|ref" -> submission
  let orderSeq = 4000 + Math.floor(Math.random() * 5000);
  const replying = new Set();

  const cartOf = (v, site) => carts.get(`${v}|${site}`) ?? [];
  const total = (items) => items.reduce((sum, i) => sum + i.price * i.qty, 0);

  function updateCart(v, site, { add, set } = {}) {
    const items = cartOf(v, site).map((i) => ({ ...i }));
    if (add) {
      const name = clip(add.name, 90);
      const price = Math.max(0, Math.min(1e6, Number(String(add.price ?? "").replace(/[^\d.]/g, "")) || 0));
      if (name) {
        const hit = items.find((i) => i.name === name);
        if (hit) hit.qty = Math.min(99, hit.qty + 1);
        else if (items.length < 30) items.push({ name, price, qty: 1 });
      }
    }
    if (set) {
      const hit = items.find((i) => i.name === clip(set.name, 90));
      if (hit) hit.qty = Math.max(0, Math.min(99, Math.round(Number(set.qty) || 0)));
    }
    const kept = items.filter((i) => i.qty > 0);
    carts.put(`${v}|${site}`, kept);
    return kept;
  }

  function addComment(page, { parent, name, text, rating, bot = false }) {
    const list = comments.get(page) ?? [];
    if (list.length >= 200) list.shift();
    const c = {
      id: randomBytes(5).toString("hex"),
      parent: clip(parent, 40) || "top",
      name: clip(name, 40) || "guest",
      text: String(text ?? "").trim().slice(0, 2000),
      rating: Math.max(0, Math.min(5, Math.round(Number(rating) || 0))) || undefined,
      at: Date.now(),
      bot,
    };
    list.push(c);
    comments.put(page, list);
    return c;
  }

  // Someone on the site answers a visitor's comment a few seconds later. One
  // short completion per posted comment, never more than a few at once.
  function answer(page, comment, context) {
    if (!reply || replying.size >= 4) return;
    replying.add(comment.id);
    reply({ page, comment, context })
      .then((r) => { if (r?.text) addComment(page, { parent: comment.parent === "top" ? comment.id : comment.parent, name: r.name, text: r.text, bot: true }); })
      .catch((err) => console.warn(`[comments] no reply: ${err.message}`))
      .finally(() => replying.delete(comment.id));
  }

  function submit(visitor, site, path, fields) {
    const intent = formIntent(path, fields);
    if (!intent) return null;
    const shown = Object.entries(fields)
      .filter(([k, v]) => !k.startsWith("_") && !SECRET.test(k) && String(v).trim())
      .slice(0, 12)
      .map(([k, v]) => [label(k), clip(v, 200)]);
    const name = clip(fields.name ?? fields.full_name ?? fields.fullname ?? fields.first_name ?? fields.username ?? "", 40)
      || clip(String(fields.email ?? "").split("@")[0], 40);
    const email = clip(fields.email ?? "", 90);
    const sub = { intent, site, path, fields: shown, name, email, at: Date.now() };
    if (intent === "checkout") {
      sub.items = cartOf(visitor, site);
      sub.total = total(sub.items);
      sub.ref = String(++orderSeq);
      carts.put(`${visitor}|${site}`, []);
    } else {
      sub.ref = randomBytes(3).toString("hex").toUpperCase();
    }
    if ((intent === "login" || intent === "signup") && name) users.put(`${visitor}|${site}`, { name, email });
    submissions.put(`${site}|${sub.ref}`, sub);
    const key = intent === "checkout" ? "order" : "ref";
    return { sub, location: `/web/${site}${path}?${key}=${sub.ref}` };
  }

  const submission = (site, params) => {
    const ref = params.get("order") ?? params.get("ref");
    return ref ? submissions.get(`${site}|${ref}`) ?? null : null;
  };

  return { cartOf, updateCart, addComment, answer, submit, submission, users, comments, total };
}

// ---------- the visitor ----------
// One random id per browser, in a cookie. The fake sites' carts and logins
// hang off it; it identifies nothing else.
export function visitor(req, res) {
  const found = String(req.headers.cookie ?? "").match(/(?:^|;\s*)fv=([a-f0-9]{16})\b/)?.[1];
  if (found) return found;
  const id = randomBytes(8).toString("hex");
  res.append("Set-Cookie", `fv=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  return id;
}

// ---------- confirmation pages ----------
const TITLES = {
  checkout: (s) => `Order #${s.ref} confirmed`,
  login: (s) => `Welcome back${s.name ? `, ${s.name}` : ""}`,
  signup: (s) => `Welcome aboard${s.name ? `, ${s.name}` : ""}`,
  subscribe: () => "You're subscribed",
  booking: (s) => `Booking confirmed — ${s.ref}`,
  apply: (s) => `Application received — ${s.ref}`,
  contact: () => "Message sent",
  submit: () => "Submission received",
  form: () => "Thanks — we got it",
};

export const submissionTitle = (s) => (TITLES[s.intent] ?? TITLES.form)(s);

// One line for the page's prompts: what the visitor just did, exactly.
export function submissionSummary(s) {
  const items = s.items?.length ? `; ordered ${s.items.map((i) => `${i.qty}× ${i.name} (${money(i.price)})`).join(", ")}; total ${money(s.total)}` : "";
  const fields = s.fields.map(([k, v]) => `${k}: ${v}`).join("; ");
  return clip(`${s.intent} form, reference ${s.ref}${items}${fields ? `; they entered ${fields}` : ""}`, 700);
}

// The rest of a confirmation page: what a site would say after this form.
const RESPONSE_BRIEFS = {
  checkout: [
    "What happens next: a ul.timeline from packing to delivery with realistic dates, the carrier and a tracking number, then a .callout on returns",
    "Goes well with the order: a .grid of 3 .card accessories that suit what was bought, each with .price and an Add to cart button",
  ],
  login: [
    "Picking up where they left off: a .grid of 3 .card items (saved things, recent activity, recommendations) with links into the site",
    "What's new since their last visit: a ul.timeline of 3-4 dated updates and a .callout with a member perk",
  ],
  signup: [
    "Getting started: ol.steps of the first 3-4 things to do, with links into the site",
    "What members get: a .grid of 3 feature .card items with .icon emoji and a .callout with a welcome offer",
  ],
  subscribe: [
    "What's coming: the next 3 issues as a ul.timeline with dates and subjects",
    "From the archive: a .grid of 3 .card links to past favourites",
  ],
  booking: [
    "Before the visit: ol.steps (what to bring, when to arrive, where to go) and a .callout on changing or cancelling",
    "Getting there: a table of address, parking and opening hours, and a .grid of 2-3 .card extras they can add",
  ],
};
const DEFAULT_BRIEFS = [
  "What happens next: ol.steps with realistic timings and who will get in touch, quoting the reference number",
  "Meanwhile: a .grid of 3 helpful .card links into the site and a details.faq with 3 questions",
];
export const responseBriefs = (s) => RESPONSE_BRIEFS[s.intent] ?? DEFAULT_BRIEFS;

// The confirmation itself is built from what was submitted, not written by a
// model: it is on screen at once and the order number, items and total are
// exactly right.
export function receiptSection(s, domain) {
  const lead = {
    checkout: `Thanks${s.name ? `, <b>${esc(s.name)}</b>` : ""}! We've received your order${s.email ? ` and sent a receipt to <b>${esc(s.email)}</b>` : ""}.`,
    login: `You're signed in${s.email ? ` as <b>${esc(s.email)}</b>` : ""}.`,
    signup: `Your account is ready${s.email ? ` — we've sent a welcome note to <b>${esc(s.email)}</b>` : ""}.`,
    subscribe: `The next issue goes to <b>${esc(s.email || "your inbox")}</b>. You can unsubscribe from any email.`,
    booking: `We've saved your booking${s.email ? `; a confirmation is on its way to <b>${esc(s.email)}</b>` : ""}.`,
  }[s.intent] ?? `Thanks${s.name ? `, <b>${esc(s.name)}</b>` : ""}. We've received it${s.email ? ` and will reply to <b>${esc(s.email)}</b>` : ""}.`;
  let detail = "";
  if (s.intent === "checkout" && s.items?.length) {
    const rows = s.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${money(i.price * i.qty)}</td></tr>`).join("");
    const shipping = s.total >= 50 ? 0 : 6.95;
    detail = `<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th></tr></thead><tbody>${rows}
<tr><td>Shipping</td><td></td><td class="num">${shipping ? money(shipping) : "Free"}</td></tr>
<tr><td><b>Total</b></td><td></td><td class="num"><b>${money(s.total + shipping)}</b></td></tr></tbody></table>`;
  } else if (s.intent === "checkout") {
    detail = `<p class="meta">Your cart was empty, so there's nothing to ship — <a href="/web/${esc(domain)}/">keep shopping</a>.</p>`;
  } else if (s.fields.length) {
    detail = `<table><tbody>${s.fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
  }
  return `<section class="fw-receipt"><div class="callout"><h2>✓ ${esc(submissionTitle(s))}</h2><p>${lead}</p><p class="meta">Reference <b>${esc(s.ref)}</b> · ${new Date(s.at).toUTCString().slice(0, 22)}</p></div>${detail}</section>`;
}

// ---------- routes ----------
export function interactRoutes(state) {
  const router = express.Router();
  const json = express.json({ limit: "20kb" });

  router.get("/fw/state", (req, res) => {
    const v = visitor(req, res);
    const site = siteOf(req.query.site);
    const page = pageOf(req.query.page);
    res.setHeader("Cache-Control", "no-store");
    res.json({ cart: state.cartOf(v, site), user: state.users.get(`${v}|${site}`) ?? null, comments: state.comments.get(page) ?? [] });
  });

  router.post("/fw/cart", json, (req, res) => {
    const v = visitor(req, res);
    res.json({ cart: state.updateCart(v, siteOf(req.body?.site), req.body ?? {}) });
  });

  router.post("/fw/account", json, (req, res) => {
    const v = visitor(req, res);
    const site = siteOf(req.body?.site);
    const key = `${v}|${site}`;
    if (req.body?.logout) { state.users.delete(key); return res.json({ user: null }); }
    const email = clip(req.body?.email, 90);
    const name = clip(req.body?.name, 40) || clip(email.split("@")[0], 40);
    if (!name) return res.status(400).json({ error: "name or email required" });
    state.users.put(key, { name, email });
    res.json({ user: { name, email } });
  });

  router.get("/fw/comments", (req, res) => {
    const after = Number(req.query.after) || 0;
    res.setHeader("Cache-Control", "no-store");
    res.json({ comments: (state.comments.get(pageOf(req.query.page)) ?? []).filter((c) => c.at > after) });
  });

  router.post("/fw/comments", json, (req, res) => {
    const b = req.body ?? {};
    const page = pageOf(b.page);
    if (!page.startsWith("/") || !String(b.text ?? "").trim()) return res.status(400).json({ error: "page and text required" });
    const comment = state.addComment(page, { parent: b.parent, name: b.name, text: b.text, rating: b.rating });
    // The rate limiter sets noReply when this visitor can't afford one.
    if (!req.noReply) state.answer(page, comment, { title: clip(b.title, 160), post: clip(b.post, 700) });
    res.json({ comment });
  });

  return router;
}

// A reply from someone on the site. `complete` is llm.js completeText.
export const replyWriter = (complete) => async ({ comment, context }) => {
  const text = await complete({
    system: `You are a regular on a fictional website, replying to a visitor's comment in its comment thread. Write ONE reply in the site's voice: 1-3 sentences, specific and warm or opinionated, engaging with exactly what they said (answer a question, add a tip, gently disagree). Output one line: username: reply. The username is lowercase, invented, fits the site. No quotes, no emoji spam, never mention AI.`,
    user: `Page: ${context.title || comment.page}${context.post ? `\nThey are replying to: ${context.post}` : ""}\nTheir comment (${comment.name}): ${comment.text.slice(0, 800)}`,
    maxTokens: 140,
    temperature: 1,
  });
  const m = String(text).trim().split("\n")[0].match(/^@?([\w.-]{2,30})\s*:\s*(.+)$/);
  return m ? { name: m[1], text: m[2].slice(0, 600) } : null;
};
