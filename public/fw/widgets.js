// Foogle's trusted runtime for generated pages. The model writes plain HTML
// with data-* attributes (see lib/widgets.js); this script makes it work.
// It never evaluates model-written code: formulas go through a small
// arithmetic parser, and model text is only ever inserted as textContent.
(() => {
  "use strict";
  const route = location.pathname.match(/^\/web\/([^/]+)(\/.*)?$/);
  if (!route || window.__fw) return;
  window.__fw = true;
  const site = decodeURIComponent(route[1]);
  const params = new URLSearchParams(location.search);
  for (const k of ["fq", "ft", "fs", "fk"]) params.delete(k);
  const page = `/${route[1]}${(route[2] ?? "").replace(/\/+$/, "")}${params.size ? `?${params}` : ""}`;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid);
    return e;
  };
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(`fw:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`fw:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const api = async (path, body) => {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  const num = (s) => { const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const pageDone = () => !!$("footer.site");
  const indexIn = (node, sel) => $$(sel).indexOf(node);

  // ---------- toasts ----------
  let toasts;
  function toast(text, action) {
    toasts ??= document.body.appendChild(el("div", { class: "fw-toasts", "aria-live": "polite" }));
    const t = el("div", { class: "fw-toast" }, el("span", { text }));
    if (action) t.append(el("button", { type: "button", text: action.label, onclick: () => { action.run(); t.remove(); } }));
    toasts.append(t);
    setTimeout(() => t.classList.add("out"), 3600);
    setTimeout(() => t.remove(), 4000);
  }

  // ---------- visitor state: cart, account, comments ----------
  const state = { cart: [], user: null, comments: [], loaded: false };
  const ready = api(`/fw/state?site=${encodeURIComponent(site)}&page=${encodeURIComponent(page)}`)
    .then((s) => { Object.assign(state, s, { loaded: true }); paintCart(); paintUser(); schedule(); })
    .catch(() => { state.loaded = true; });

  // ---------- cart ----------
  const cartCount = () => state.cart.reduce((n, i) => n + i.qty, 0);
  const cartLinks = () => $$("a.cart, header.site a[href$='/cart']");
  let fab;
  // Called on every scan, so it only touches the DOM when something changed
  // (a mutation here would schedule another scan).
  function paintCart(bump) {
    const n = cartCount();
    for (const a of cartLinks()) {
      if (a.textContent !== `🛒 Cart (${n})`) a.textContent = `🛒 Cart (${n})`;
      if (bump) { a.classList.remove("fw-bump"); void a.offsetWidth; a.classList.add("fw-bump"); }
    }
    if (!cartLinks().length && n) {
      fab ??= document.body.appendChild(el("button", { type: "button", class: "fw-cartfab", onclick: openCart }));
      if (fab.textContent !== `🛒 ${n}`) fab.textContent = `🛒 ${n}`;
    }
    if (fab && fab.hidden !== !n) fab.hidden = !n;
  }
  function cartChanged(cart, bump) {
    state.cart = cart;
    paintCart(bump);
    if (drawer?.open) renderDrawer();
  }
  async function addToCart(btn) {
    const card = btn.closest(".card, .post, tr, li, .split, section");
    const name = btn.dataset.name || $("h3, h4, b, strong", card)?.textContent?.trim() || "Item";
    const price = btn.dataset.price ?? $(".price", card)?.textContent ?? "";
    btn.classList.add("fw-added");
    const was = btn.textContent;
    btn.textContent = "Added ✓";
    setTimeout(() => { btn.textContent = was; btn.classList.remove("fw-added"); }, 1400);
    try {
      cartChanged((await api("/fw/cart", { site, add: { name, price } })).cart, true);
      toast(`Added ${name} to your cart`, { label: "View cart", run: openCart });
    } catch { toast("Couldn't reach the cart — try again"); }
  }
  let drawer;
  function openCart() {
    if (!drawer) {
      drawer = el("dialog", { class: "fw-drawer", "aria-label": "Cart" });
      drawer.addEventListener("click", (e) => { if (e.target === drawer) drawer.close(); });
      document.body.append(drawer);
    }
    renderDrawer();
    if (!drawer.open) drawer.showModal();
  }
  function renderDrawer() {
    const items = state.cart;
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const qty = (i, d) => el("button", { type: "button", "aria-label": d > 0 ? "More" : "Less", text: d > 0 ? "+" : "−", onclick: async () => {
      cartChanged((await api("/fw/cart", { site, set: { name: i.name, qty: i.qty + d } })).cart);
    } });
    drawer.replaceChildren(
      el("div", { class: "fw-drawer-head" }, el("h3", { text: "Your cart" }), el("button", { type: "button", class: "fw-x", "aria-label": "Close", text: "×", onclick: () => drawer.close() })),
      items.length
        ? el("ul", { class: "fw-lines" }, items.map((i) => el("li", {},
          el("span", { class: "fw-line-name", text: i.name }),
          el("span", { class: "fw-qty" }, qty(i, -1), el("b", { text: String(i.qty) }), qty(i, 1)),
          el("span", { class: "fw-line-price", text: money(i.price * i.qty) }))))
        : el("p", { class: "meta", text: "Your cart is empty. Add something from the page." }),
      items.length ? el("p", { class: "fw-subtotal" }, el("span", { text: "Subtotal" }), el("b", { text: money(subtotal) })) : null,
      items.length ? el("form", { class: "fw-checkout", method: "post", action: `/web/${site}/checkout` },
        el("input", { type: "hidden", name: "_intent", value: "checkout" }),
        el("label", {}, "Name", el("input", { name: "name", required: true, autocomplete: "name", value: state.user?.name ?? "" })),
        el("label", {}, "Email", el("input", { name: "email", type: "email", required: true, autocomplete: "email", value: state.user?.email ?? "" })),
        el("label", {}, "Delivery address", el("input", { name: "address", required: true, autocomplete: "street-address" })),
        el("button", { class: "btn", type: "submit", text: `Place order · ${money(subtotal)}` }),
        el("p", { class: "meta", text: "No real money moves on the fake web." })) : null,
    );
  }

  // ---------- accounts ----------
  const LOGIN = /^(log ?in|sign ?in)$/i;
  const SIGNUP = /^(sign ?up|start free|join( now| free)?|register|create (an )?account|get started)$/i;
  const SUBSCRIBE = /^subscribe$/i;
  const headerLinks = () => $$("header.site a, header.site button").filter((a) => !a.closest("form"));
  function paintUser() {
    const links = headerLinks().filter((a) => LOGIN.test(a.textContent.trim()) || SIGNUP.test(a.textContent.trim()));
    $$(".fw-user").forEach((u) => u.remove());
    for (const a of links) a.hidden = !!state.user;
    if (state.user && links[0]) {
      const initials = state.user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2);
      links[0].before(el("span", { class: "fw-user" }, el("span", { class: "av", text: initials }), el("b", { text: state.user.name }),
        el("button", { type: "button", class: "fw-link", text: "Log out", onclick: async () => { await api("/fw/account", { site, logout: true }); state.user = null; paintUser(); toast("Logged out"); } })));
    }
  }
  function accountDialog(mode) {
    const d = el("dialog", { class: "fw-dialog" });
    const signup = mode === "signup";
    const form = el("form", { class: "fw-form" },
      el("h3", { text: signup ? `Create your ${site} account` : `Log in to ${site}` }),
      signup ? el("label", {}, "Name", el("input", { name: "name", required: true, autocomplete: "name" })) : null,
      el("label", {}, "Email", el("input", { name: "email", type: "email", required: true, autocomplete: "email" })),
      el("label", {}, "Password", el("input", { name: "password", type: "password", required: true, autocomplete: signup ? "new-password" : "current-password" })),
      el("button", { class: "btn", type: "submit", text: signup ? "Create account" : "Log in" }),
      el("p", { class: "meta" }, signup ? "Already a member? " : "New here? ",
        el("button", { type: "button", class: "fw-link", text: signup ? "Log in" : "Create an account", onclick: () => { d.close(); accountDialog(signup ? "login" : "signup"); } })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        state.user = (await api("/fw/account", { site, name: f.get("name") ?? "", email: f.get("email") })).user;
        d.close();
        paintUser();
        toast(signup ? `Welcome to ${site}, ${state.user.name}!` : `Welcome back, ${state.user.name}`);
      } catch { toast("That didn't work — try again"); }
    });
    d.append(el("button", { type: "button", class: "fw-x", "aria-label": "Close", text: "×", onclick: () => d.close() }), form);
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
    $("input", d)?.focus();
  }
  function subscribeDialog(btn) {
    if (store.get(`sub:${site}`)) return toast(`You're already subscribed to ${site}`);
    const d = el("dialog", { class: "fw-dialog" });
    const form = el("form", { class: "fw-form" }, el("h3", { text: `Subscribe to ${site}` }), el("p", { class: "meta", text: "New issues straight to your inbox. Unsubscribe any time." }),
      el("label", {}, "Email", el("input", { name: "email", type: "email", required: true, autocomplete: "email", value: state.user?.email ?? "" })),
      el("button", { class: "btn", type: "submit", text: "Subscribe" }));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      store.set(`sub:${site}`, true);
      d.close();
      btn.textContent = "Subscribed ✓";
      toast(`Subscribed! The next issue goes to ${new FormData(form).get("email")}`);
    });
    d.append(el("button", { type: "button", class: "fw-x", "aria-label": "Close", text: "×", onclick: () => d.close() }), form);
    d.addEventListener("close", () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  // ---------- comments, votes and replies ----------
  const posts = () => $$("main .post:not(.fw-c), .layout .post:not(.fw-c)").filter((p, i, a) => a.indexOf(p) === i);
  const postKey = (p) => p.dataset.fwKey ?? `p${posts().indexOf(p)}`;
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
  const rendered = new Map(); // comment id -> element
  function voteButton(n, key, label = "▲") {
    const b = el("button", { type: "button", class: "fw-vote", "data-n": String(n), "data-key": key, "data-label": label });
    const on = store.get(`v:${page}:${key}`);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = `${label} ${(n + (on ? 1 : 0)).toLocaleString("en-US")}`;
    return b;
  }
  function enhancePost(post) {
    const key = postKey(post);
    post.dataset.fwKey = key;
    const metas = $$(":scope > .meta, :scope > p.meta, :scope > div:last-child.meta", post);
    metas.forEach((meta, mi) => {
      const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const parts = node.textContent.split(/((?:[▲⬆↑👍♥❤]️?\s*)\d[\d,]*|(?:Helpful|Upvotes?|Likes?)\s*\(?\d[\d,]*\)?|\bReply\b)/i);
        if (parts.length === 1) continue;
        node.replaceWith(...parts.map((part, i) => {
          if (i % 2 === 0) return part;
          if (/^reply$/i.test(part)) return el("button", { type: "button", class: "fw-reply", text: "Reply" });
          const n = num(part);
          const label = part.replace(/\(?\d[\d,]*\)?/, "").trim();
          return voteButton(n, `${key}.${mi}.${i}`, label || "▲");
        }));
      }
    });
  }
  function commentEl(c) {
    const initials = c.name.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "?";
    const text = el("p", { class: "fw-text", text: c.text });
    return el("div", { class: `post fw-c${c.bot ? "" : " fw-mine"}`, "data-fw-key": c.id, id: `c-${c.id}` },
      el("div", { class: "who" }, el("span", { class: "av", text: initials }), el("b", { text: c.name }),
        c.rating ? el("span", { class: "stars", style: `--r:${c.rating}` }) : null, el("span", { class: "meta", text: ago(c.at) })),
      text,
      el("div", { class: "meta" }, voteButton(0, `${c.id}`), " · ", el("button", { type: "button", class: "fw-reply", text: "Reply" })));
  }
  // Replies sit in a thread right after what they answer — or inside it, when
  // the post is one cell of a grid or row.
  function threadAfter(anchor) {
    const inside = !!anchor.parentElement?.matches(".grid, .row, .split, [data-filter]");
    let t = inside ? $(":scope > .fw-thread", anchor) : anchor.nextElementSibling;
    if (!t?.classList.contains("fw-thread")) {
      t = el("div", { class: "fw-thread" });
      if (inside) anchor.append(t); else anchor.after(t);
    }
    return t;
  }
  function placeComments() {
    for (const c of state.comments) {
      if (rendered.has(c.id)) continue;
      let anchor = null;
      if (c.parent === "top") anchor = $("[data-comments] .fw-list");
      else anchor = rendered.get(c.parent) ?? posts().find((p) => postKey(p) === c.parent);
      if (!anchor) continue;
      const node = commentEl(c);
      rendered.set(c.id, node);
      if (c.parent === "top") anchor.append(node);
      else threadAfter(anchor).append(node);
      if (c.fresh) { node.classList.add("fw-new"); delete c.fresh; }
    }
  }
  function composer({ parent, review, onDone, compact }) {
    const name = el("input", { name: "name", placeholder: "Your name", autocomplete: "nickname", value: state.user?.name ?? store.get("name", ""), required: true });
    const text = el("textarea", { name: "text", rows: compact ? 2 : 3, placeholder: review ? "What did you think?" : parent === "top" ? "Add to the discussion…" : "Write a reply…", required: true, maxlength: 2000 });
    let rating = 0;
    const stars = review ? el("span", { class: "fw-rate", role: "radiogroup", "aria-label": "Rating" }, [1, 2, 3, 4, 5].map((n) =>
      el("button", { type: "button", "aria-label": `${n} stars`, text: "★", onclick: (e) => {
        rating = n;
        [...e.target.parentNode.children].forEach((s, i) => s.classList.toggle("on", i < n));
      } }))) : null;
    const submit = el("button", { class: "btn", type: "submit", text: review ? "Post review" : parent === "top" ? "Post comment" : "Reply" });
    const form = el("form", { class: `fw-compose${compact ? " compact" : ""}` }, el("div", { class: "fw-compose-row" }, name, stars), text, el("div", { class: "fw-compose-row" }, submit));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return;
      submit.disabled = true;
      store.set("name", name.value.trim());
      const anchor = parent === "top" ? null : rendered.get(parent) ?? posts().find((p) => postKey(p) === parent);
      const quoted = anchor ? $$(":scope > p", anchor).map((p) => p.textContent).join(" ").slice(0, 600) : "";
      try {
        const { comment } = await api("/fw/comments", { page, parent, name: name.value, text: text.value, rating, title: document.title, post: quoted });
        comment.fresh = true;
        state.comments.push(comment);
        placeComments();
        text.value = "";
        onDone?.();
        awaitReplies(comment);
      } catch { toast("Couldn't post that — try again"); }
      submit.disabled = false;
    });
    return form;
  }
  // Someone on the site usually answers within a few seconds.
  function awaitReplies(comment) {
    const mine = rendered.get(comment.id);
    const typing = el("div", { class: "fw-typing meta", text: "Someone is typing" });
    threadAfter(mine).append(typing);
    let tries = 0;
    const since = comment.at;
    const poll = async () => {
      tries++;
      try {
        const { comments } = await api(`/fw/comments?page=${encodeURIComponent(page)}&after=${since}`);
        const fresh = comments.filter((c) => !rendered.has(c.id) && !state.comments.some((s) => s.id === c.id));
        if (fresh.length) {
          fresh.forEach((c) => { c.fresh = true; state.comments.push(c); });
          typing.remove();
          placeComments();
          return;
        }
      } catch { /* keep trying */ }
      if (tries < 12) setTimeout(poll, 2500);
      else typing.remove();
    };
    setTimeout(poll, 2500);
  }
  function initComments(box) {
    const review = box.dataset.comments === "review" || !!$(".post .stars", box.closest("section") ?? document);
    box.classList.add("fw-comments");
    box.replaceChildren(
      el("h3", { text: review ? "Write a review" : "Join the discussion" }),
      el("div", { class: "fw-list" }),
      composer({ parent: "top", review }),
    );
    placeComments();
  }
  // Pages with a conversation on them get a comment box even when the writer
  // didn't ask for one.
  let autoComments = false;
  function ensureCommentBox() {
    if (autoComments || !pageDone()) return;
    autoComments = true;
    if ($("[data-comments]") || posts().length < 2) return;
    const main = $("main");
    if (!main) return;
    const box = el("div", { "data-comments": "" });
    main.append(el("section", { class: "fw-auto" }, box));
  }

  // ---------- filterable grids ----------
  const priceOf = (card) => num(card.dataset.price ?? $(".price", card)?.textContent);
  const ratingOf = (card) => num(card.dataset.rating ?? $(".stars", card)?.style.getPropertyValue("--r") ?? $(".stars", card)?.textContent);
  const tagsOf = (card) => (card.dataset.tags ? card.dataset.tags.split(/[,\s]+/) : $$(".tag", card).map((t) => t.textContent)).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const railRanges = () => $$(".rail input[type=checkbox]:checked").map((c) => {
    const t = c.closest("label")?.textContent ?? "";
    let m;
    if ((m = t.match(/under\s*\$?(\d+)/i))) return [0, +m[1]];
    if ((m = t.match(/\$?(\d+)\s*[–-]\s*\$?(\d+)/))) return [+m[1], +m[2]];
    if ((m = t.match(/\$?(\d+)\s*\+/))) return [+m[1], Infinity];
    return null;
  }).filter(Boolean);
  function initFilter(grid) {
    const bar = el("div", { class: "fw-filterbar" });
    const chips = el("div", { class: "fw-chips" });
    const search = el("input", { type: "search", placeholder: "Filter…", "aria-label": "Filter" });
    const sort = el("select", { "aria-label": "Sort" });
    const count = el("span", { class: "meta fw-count" });
    const empty = el("p", { class: "meta fw-empty", text: "Nothing matches — try another filter.", hidden: true });
    bar.append(chips, search, sort, count);
    grid.before(bar);
    grid.after(empty);
    const f = { active: "all", n: -1 };
    const items = () => [...grid.children].filter((c) => !c.classList.contains("fw-filterbar"));
    const apply = () => {
      const q = search.value.trim().toLowerCase();
      const ranges = railRanges();
      const list = items();
      list.forEach((c, i) => { c.dataset.fwOrder ??= String(i); });
      const [key, dir] = sort.value.split(":");
      const sorted = [...list].sort((a, b) => key === "price" ? (priceOf(a) - priceOf(b)) * dir : key === "rating" ? (ratingOf(b) - ratingOf(a)) : a.dataset.fwOrder - b.dataset.fwOrder);
      sorted.forEach((c) => grid.append(c));
      let shown = 0;
      for (const c of list) {
        const p = priceOf(c);
        const tags = tagsOf(c);
        // The box searches a card's tags too: typing a chip's name finds what the chip does.
        const ok = (f.active === "all" || tags.includes(f.active))
          && (!q || `${c.textContent} ${tags.join(" ")}`.toLowerCase().includes(q))
          && (!ranges.length || Number.isNaN(p) || ranges.some(([lo, hi]) => p >= lo && p <= hi));
        c.hidden = !ok;
        if (ok) shown++;
      }
      count.textContent = `${shown} of ${list.length}`;
      empty.hidden = shown > 0;
    };
    const refresh = () => {
      const list = items();
      if (list.length === f.n) return;
      f.n = list.length;
      const freq = new Map();
      list.forEach((c) => tagsOf(c).forEach((t) => freq.set(t, (freq.get(t) ?? 0) + 1)));
      const tags = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a)).slice(0, 8);
      chips.replaceChildren(...["all", ...tags].map((t) => el("button", { type: "button", class: "fw-chip", "aria-pressed": String(t === f.active), text: t === "all" ? "All" : t, onclick: () => {
        f.active = t;
        [...chips.children].forEach((b) => b.setAttribute("aria-pressed", String(b === chips.children[["all", ...tags].indexOf(t)])));
        apply();
      } })));
      chips.hidden = !tags.length;
      const hasPrice = list.some((c) => !Number.isNaN(priceOf(c)));
      const hasRating = list.some((c) => !Number.isNaN(ratingOf(c)));
      const current = sort.value;
      sort.replaceChildren(el("option", { value: "featured:1", text: "Featured" }),
        hasPrice ? el("option", { value: "price:1", text: "Price: low to high" }) : null,
        hasPrice ? el("option", { value: "price:-1", text: "Price: high to low" }) : null,
        hasRating ? el("option", { value: "rating:1", text: "Top rated" }) : null);
      sort.value = current || "featured:1";
      if (!sort.value) sort.value = "featured:1";
      sort.hidden = sort.options.length < 2;
      apply();
    };
    search.addEventListener("input", apply);
    sort.addEventListener("change", apply);
    document.addEventListener("change", (e) => { if (e.target.closest?.(".rail")) apply(); });
    grid.__fwRefresh = refresh;
    refresh();
  }

  // ---------- tabs ----------
  function initTabs(root) {
    const panels = $$(":scope > [data-tab]", root);
    if (!panels.length) return;
    const bar = el("div", { class: "fw-tabbar", role: "tablist" });
    const show = (i) => {
      panels.forEach((p, j) => { p.hidden = i !== j; });
      [...bar.children].forEach((b, j) => b.setAttribute("aria-selected", String(i === j)));
    };
    panels.forEach((p, i) => bar.append(el("button", { type: "button", role: "tab", text: p.dataset.tab || `Tab ${i + 1}`, onclick: () => show(i) })));
    root.prepend(bar);
    root.classList.add("fw-ready");
    show(0);
  }

  // ---------- quizzes ----------
  function initQuiz(quiz) {
    const qs = $$("[data-q]", quiz);
    qs.forEach((q) => $$("button", q).forEach((b) => { b.type = "button"; b.classList.add("fw-opt"); }));
    const score = el("div", { class: "fw-score callout", hidden: true });
    quiz.append(score);
    quiz.addEventListener("click", (e) => {
      const opt = e.target.closest(".fw-opt");
      if (!opt) return;
      const q = opt.closest("[data-q]");
      if (q.classList.contains("fw-done")) return;
      const graded = !!$("[data-correct]", q);
      q.classList.add("fw-done");
      opt.classList.add(graded ? (opt.hasAttribute("data-correct") ? "fw-right" : "fw-wrong") : "fw-chosen");
      if (graded) $("[data-correct]", q).classList.add("fw-right");
      q.dataset.right = String(opt.hasAttribute("data-correct"));
      if (qs.every((x) => x.classList.contains("fw-done"))) {
        const gradedQs = qs.filter((x) => $("[data-correct]", x));
        const right = gradedQs.filter((x) => x.dataset.right === "true").length;
        score.replaceChildren(
          el("b", { text: gradedQs.length ? `You got ${right} of ${gradedQs.length} right${right === gradedQs.length ? " — perfect!" : right >= gradedQs.length / 2 ? " — not bad." : "."}` : "Thanks for playing!" }),
          " ", el("button", { type: "button", class: "btn ghost sm", text: "Try again", onclick: () => {
            qs.forEach((x) => { x.classList.remove("fw-done"); $$(".fw-opt", x).forEach((b) => b.classList.remove("fw-right", "fw-wrong", "fw-chosen")); });
            score.hidden = true;
          } }));
        score.hidden = false;
      }
    });
  }

  // ---------- polls ----------
  function vote(poll, row) {
    const rows = $$(":scope > p", poll);
    const key = `poll:${page}:${indexIn(poll, ".bars[data-poll]")}`;
    if (poll.classList.contains("fw-voted")) return;
    const total = num(poll.dataset.votes) || 100;
    const pcts = rows.map((r) => num($("b", r)?.textContent ?? $("i", r)?.style.getPropertyValue("--v")) || 0);
    const sum = pcts.reduce((a, b) => a + b, 0) || 1;
    const counts = pcts.map((p) => Math.round((p / sum) * total));
    const i = rows.indexOf(row);
    counts[i] += 1;
    const all = total + 1;
    rows.forEach((r, j) => {
      const pct = Math.round((counts[j] / all) * 100);
      $("i", r)?.style.setProperty("--v", `${pct}%`);
      const b = $("b", r);
      if (b) b.textContent = `${pct}%`;
    });
    row.classList.add("fw-chosen");
    poll.classList.add("fw-voted");
    let note = poll.nextElementSibling?.classList.contains("fw-pollnote") ? poll.nextElementSibling : null;
    note ??= poll.after(el("p", { class: "meta fw-pollnote" })) ?? poll.nextElementSibling;
    note.textContent = `Thanks for voting · ${all.toLocaleString("en-US")} votes`;
    store.set(key, i);
  }

  // ---------- calculators ----------
  const FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, pow: Math.pow, log: Math.log, log10: Math.log10, exp: Math.exp,
    round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) };
  const parsed = new Map();
  // A tiny arithmetic parser: numbers, names, + - * / % ^, comparisons,
  // ?: and the functions above. Anything else is a parse error.
  function compile(src) {
    if (parsed.has(src)) return parsed.get(src);
    const tokens = src.match(/\d*\.?\d+(?:e[+-]?\d+)?|[A-Za-z_][\w]*|<=|>=|==|!=|&&|\|\||[-+*/%^(),?:<>]/g) ?? [];
    let i = 0;
    const peek = () => tokens[i];
    const take = (t) => { if (t && tokens[i] !== t) throw new Error(`expected ${t}`); return tokens[i++]; };
    const ternary = () => {
      const c = or();
      if (peek() !== "?") return c;
      take("?"); const a = ternary(); take(":"); const b = ternary();
      return (env) => (c(env) ? a(env) : b(env));
    };
    const binary = (next, ops) => () => {
      let left = next();
      while (ops[peek()]) { const op = ops[take()]; const l = left, r = next(); left = (env) => op(l(env), r(env)); }
      return left;
    };
    const unary = () => {
      if (peek() === "-") { take(); const v = unary(); return (env) => -v(env); }
      if (peek() === "+") { take(); return unary(); }
      return power();
    };
    const power = () => {
      const base = primary();
      if (peek() !== "^") return base;
      take(); const exp = unary();
      return (env) => base(env) ** exp(env);
    };
    const primary = () => {
      const t = take();
      if (t === undefined) throw new Error("unexpected end");
      if (t === "(") { const v = ternary(); take(")"); return v; }
      if (/^[\d.]/.test(t)) { const n = Number(t); return () => n; }
      if (/^[A-Za-z_]/.test(t)) {
        if (peek() === "(" && Object.hasOwn(FUNCS, t.toLowerCase())) {
          take("(");
          const args = [];
          if (peek() !== ")") { args.push(ternary()); while (peek() === ",") { take(","); args.push(ternary()); } }
          take(")");
          const f = FUNCS[t.toLowerCase()];
          return (env) => f(...args.map((a) => a(env)));
        }
        if (t === "pi") return () => Math.PI;
        return (env) => (Object.hasOwn(env, t) ? env[t] : 0);
      }
      throw new Error(`unexpected ${t}`);
    };
    const mul = binary(unary, { "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b });
    const add = binary(mul, { "+": (a, b) => a + b, "-": (a, b) => a - b });
    const cmp = binary(add, { "<": (a, b) => +(a < b), ">": (a, b) => +(a > b), "<=": (a, b) => +(a <= b), ">=": (a, b) => +(a >= b), "==": (a, b) => +(a === b), "!=": (a, b) => +(a !== b) });
    const and = binary(cmp, { "&&": (a, b) => +(a && b) });
    const or = binary(and, { "||": (a, b) => +(a || b) });
    let fn;
    try { fn = ternary(); if (i < tokens.length) throw new Error("trailing input"); } catch { fn = null; }
    parsed.set(src, fn);
    return fn;
  }
  const fmt = (v, decimals) => {
    if (!Number.isFinite(v)) return "—";
    const d = decimals != null && decimals !== "" ? Number(decimals) : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
    return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: decimals != null && decimals !== "" ? d : 0 });
  };
  function calc(root) {
    const env = {};
    for (const input of $$("input[name], select[name]", root)) {
      const name = input.name.replace(/[^\w]/g, "_");
      if (input.type === "checkbox") env[name] = (env[name] ?? 0) + (input.checked ? (num(input.value) || 1) : 0);
      else if (input.type === "radio") { if (input.checked) env[name] = num(input.value) || 0; else env[name] ??= 0; }
      else if (input.tagName === "SELECT") { const o = input.selectedOptions[0]; env[name] = num(o?.value) || num(o?.textContent) || 0; }
      else env[name] = num(input.value) || 0;
    }
    for (const pick of $$("[data-pick]", root)) {
      const on = $("[aria-pressed=true]", pick);
      env[pick.dataset.pick.replace(/[^\w]/g, "_")] = on ? num(on.value || on.dataset.value || on.textContent) || 0 : 0;
    }
    for (const out of $$("[data-formula]", root)) {
      const fn = compile(out.dataset.formula);
      let v = NaN;
      try { v = fn ? Number(fn(env)) : NaN; } catch { v = NaN; }
      const name = out.getAttribute("name") || out.id;
      if (name) env[name.replace(/[^\w]/g, "_")] = v;
      if (out.classList.contains("progress")) { out.style.setProperty("--v", `${Math.max(0, Math.min(100, v || 0))}%`); continue; }
      const text = fmt(v, out.dataset.decimals);
      if (out.textContent !== text) {
        out.textContent = text;
        out.classList.remove("fw-flash"); void out.offsetWidth; out.classList.add("fw-flash");
      }
    }
    for (const r of $$("input[type=range]", root)) {
      const bubble = r.nextElementSibling?.classList.contains("fw-rv") ? r.nextElementSibling : r.after(el("span", { class: "fw-rv" })) ?? r.nextElementSibling;
      bubble.textContent = Number(r.value).toLocaleString("en-US");
    }
  }

  // ---------- small things ----------
  function pick(btn) {
    const group = btn.closest("[data-pick]");
    $$("button", group).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    const form = group.closest("form");
    if (form && !form.hasAttribute("data-calc")) {
      const name = group.dataset.pick || "choice";
      let hidden = $(`input[type=hidden][name="${CSS.escape(name)}"]`, form);
      hidden ??= form.appendChild(el("input", { type: "hidden", name }));
      hidden.value = btn.value || btn.textContent.trim();
    }
    const calcRoot = group.closest("[data-calc]");
    if (calcRoot) calc(calcRoot);
  }
  function toggle(btn, silent) {
    btn.dataset.fwOrig ??= btn.textContent;
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? btn.dataset.toggle || `${btn.dataset.fwOrig} ✓` : btn.dataset.fwOrig;
    if (!silent) store.set(`tg:${page}:${indexIn(btn, "[data-toggle]")}`, on);
  }
  function parseDuration(s) {
    let ms = 0;
    for (const [, n, u] of String(s).matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)/gi)) ms += n * { d: 864e5, h: 36e5, m: 6e4, s: 1e3 }[u.toLowerCase()];
    return ms;
  }
  const countdowns = [];
  function initCountdown(node) {
    const spec = node.dataset.countdown;
    const at = Date.parse(spec);
    let end = Number.isNaN(at) ? 0 : at;
    if (!end) {
      const key = `cd:${page}:${indexIn(node, "[data-countdown]")}`;
      end = store.get(key) ?? 0;
      if (!end || end < Date.now()) { end = Date.now() + (parseDuration(spec) || 36e5); store.set(key, end); }
    }
    node.classList.add("fw-countdown");
    countdowns.push([node, end]);
    tick();
  }
  function tick() {
    for (const [node, end] of countdowns) {
      const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      const d = Math.floor(s / 86400);
      const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
      node.textContent = s ? `${d ? `${d}d ` : ""}${hms}` : "Ended";
    }
  }
  setInterval(tick, 1000);
  const counted = new WeakSet();
  const countObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { countObserver.unobserve(e.target); countUp(e.target); }
  }) : null;
  function countUp(node) {
    const text = node.textContent;
    const m = text.match(/\d[\d,]*(?:\.\d+)?/);
    if (!m || /^(19|20)\d\d$/.test(m[0])) return;
    const target = Number(m[0].replace(/,/g, ""));
    const decimals = (m[0].split(".")[1] ?? "").length;
    const commas = m[0].includes(",");
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      const v = target * (1 - (1 - k) ** 3);
      const s = commas ? v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals);
      node.textContent = text.slice(0, m.index) + s + text.slice(m.index + m[0].length);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function live(node) {
    const drift = () => {
      const n = num(node.textContent);
      if (!Number.isNaN(n)) node.textContent = node.textContent.replace(/\d[\d,]*/, Math.max(1, Math.round(n + (Math.random() * 6 - 2.5))).toLocaleString("en-US"));
      setTimeout(drift, 2500 + Math.random() * 4000);
    };
    setTimeout(drift, 2000);
  }
  function sortTable(th) {
    const table = th.closest("table");
    const body = table.tBodies[0];
    if (!body) return;
    const col = [...th.parentNode.children].indexOf(th);
    const dir = th.getAttribute("aria-sort") === "ascending" ? -1 : 1;
    $$("th", table).forEach((h) => h.removeAttribute("aria-sort"));
    th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
    const val = (r) => r.cells[col]?.textContent.trim() ?? "";
    const rows = [...body.rows];
    const numeric = rows.every((r) => !val(r) || !Number.isNaN(num(val(r))));
    rows.sort((a, b) => (numeric ? num(val(a)) - num(val(b)) : val(a).localeCompare(val(b))) * dir).forEach((r) => body.append(r));
  }
  function initForm(form) {
    if (form.closest("header.site") || form.classList.contains("fw-compose") || form.classList.contains("fw-form") || form.classList.contains("fw-checkout")) return;
    if (form.hasAttribute("data-calc")) return;
    const fields = $$("input[name], textarea[name], select[name]", form).filter((i) => i.type !== "hidden" && i.type !== "submit");
    // A lone email box is a newsletter signup: answer it in place.
    if (fields.length === 1 && (fields[0].type === "email" || /mail/i.test(fields[0].name))) { form.dataset.fwSubscribe = ""; return; }
    // Personal details never go into a URL.
    if (fields.some((i) => i.type === "password" || i.type === "email" || i.tagName === "TEXTAREA")) form.method = "post";
    const action = form.getAttribute("action");
    if (!action || !action.startsWith("/web/")) form.setAttribute("action", location.pathname);
    if (form.dataset.intent) form.append(el("input", { type: "hidden", name: "_intent", value: form.dataset.intent }));
  }
  function initDialog(d) {
    if (d.classList.contains("fw-dialog") || d.classList.contains("fw-drawer")) return;
    d.classList.add("fw-modal");
    d.prepend(el("button", { type: "button", class: "fw-x", "aria-label": "Close", text: "×", onclick: () => d.close() }));
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  }

  // ---------- wiring ----------
  // Common page vocabulary becomes interactive even when the writer used no
  // data-* attributes: a product card's "Add to cart", a post's "▲ 42 · Reply".
  const ADD = /^(add( to (cart|bag|basket))?|buy( now)?|add to order|order now|pre-?order)\b/i;
  const INITS = [
    ["[data-tabs]", initTabs],
    ["[data-quiz]", initQuiz],
    ["[data-filter]", initFilter],
    ["[data-comments]", initComments],
    ["[data-countdown]", initCountdown],
    ["[data-calc]", (root) => {
      $$("button", root).forEach((b) => { if (!b.closest("[data-pick]")) b.type = "button"; });
      calc(root);
    }],
    ["[data-pick] button, [data-quiz] button", (b) => { if (b.type === "submit" && !b.closest("[data-quiz]")) b.type = "button"; }],
    ["[data-toggle]", (b) => { if (store.get(`tg:${page}:${indexIn(b, "[data-toggle]")}`)) toggle(b, true); }],
    ["main dialog, .layout dialog", initDialog],
    ["main form, .layout main form", initForm],
    ["main .post, .layout .post", (p) => { if (!p.classList.contains("fw-c")) enhancePost(p); }],
    [".card .btn, .card button, .card a", (b) => {
      if (b.hasAttribute("data-add-to-cart") || !ADD.test(b.textContent.trim())) return;
      if ($(".price", b.closest(".card")) || b.dataset.price) b.setAttribute("data-add-to-cart", "");
    }],
    [".stat b, [data-count]", (n) => { if (!counted.has(n)) { counted.add(n); countObserver?.observe(n); } }],
    ["[data-live], .rail b", (n) => { if (n.hasAttribute("data-live") || /^\s*online/.test(n.nextSibling?.textContent ?? "")) live(n); }],
    // Header cells arrive with their table's head, before the rows stream in.
    ["main thead th", (th) => { if (!th.closest(".fw-receipt, .infobox")) th.classList.add("fw-sortable"); }],
    // A table wider than its column (on a phone, in a narrow tile) scrolls
    // sideways in its own box instead of widening the page. Rows still
    // streaming in land in the moved table.
    ["main table", (t) => {
      if (t.closest(".infobox, .fw-scroll")) return;
      const box = el("div", { class: "fw-scroll" });
      t.replaceWith(box);
      box.append(t);
    }],
  ];
  // A contents box (a reference article, see lib/design.js) lists the
  // page's section headings as they stream in.
  function fillToc(toc) {
    const heads = $$("main section > h2");
    if (toc.__fwCount === heads.length) return;
    toc.__fwCount = heads.length;
    $$(":scope > a", toc).forEach((a) => a.remove());
    heads.forEach((h, i) => {
      h.id ||= `s-${i + 1}-${h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
      toc.append(el("a", { href: `#${h.id}`, text: `${i + 1} ${h.textContent.replace(/\s*\[edit\]\s*$/, "").trim()}` }));
    });
  }
  const seen = new WeakMap();
  let queued = false;
  function scan() {
    queued = false;
    for (const [sel, fn] of INITS) {
      for (const node of $$(sel)) {
        const done = seen.get(node) ?? new Set();
        if (done.has(sel)) continue;
        done.add(sel);
        seen.set(node, done);
        try { fn(node); } catch (err) { console.warn("[fw]", sel, err); }
      }
    }
    $$("[data-filter]").forEach((g) => g.__fwRefresh?.());
    $$("[data-toc]").forEach(fillToc);
    if (state.loaded) placeComments();
    if (pageDone()) {
      ensureCommentBox();
      for (const poll of $$(".bars[data-poll]")) {
        const saved = store.get(`poll:${page}:${indexIn(poll, ".bars[data-poll]")}`);
        const row = $$(":scope > p", poll)[saved];
        if (saved != null && row && !poll.classList.contains("fw-voted")) vote(poll, row);
      }
    }
    if (state.loaded) paintCart();
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
  ready.then(schedule);

  document.addEventListener("click", (e) => {
    const t = e.target.closest?.("button, a, th, .bars[data-poll] > p");
    if (!t) return;
    if (t.matches("[data-add-to-cart]")) { e.preventDefault(); return addToCart(t); }
    if (t.matches("a.cart, header.site a[href$='/cart']")) { e.preventDefault(); return openCart(); }
    if (t.closest("header.site") && !t.closest("form")) {
      const label = t.textContent.trim();
      if (LOGIN.test(label)) { e.preventDefault(); return accountDialog("login"); }
      if (SIGNUP.test(label)) { e.preventDefault(); return accountDialog("signup"); }
      if (SUBSCRIBE.test(label)) { e.preventDefault(); return subscribeDialog(t); }
    }
    if (t.matches(".fw-vote")) {
      const on = t.getAttribute("aria-pressed") !== "true";
      t.setAttribute("aria-pressed", String(on));
      t.textContent = `${t.dataset.label} ${(Number(t.dataset.n) + (on ? 1 : 0)).toLocaleString("en-US")}`;
      store.set(`v:${page}:${t.dataset.key}`, on);
      return;
    }
    if (t.matches(".fw-reply")) {
      const post = t.closest(".post:not(.fw-thread)");
      const open = $(":scope > .fw-compose", threadAfter(post));
      if (open) return open.remove();
      const form = composer({ parent: postKey(post), compact: true, onDone: () => form.remove() });
      threadAfter(post).prepend(form);
      $("textarea", form).focus();
      return;
    }
    if (t.matches(".bars[data-poll] > p")) return vote(t.parentNode, t);
    if (t.matches("[data-pick] button")) { e.preventDefault(); return pick(t); }
    if (t.matches("[data-toggle]")) { e.preventDefault(); toggle(t); }
    if (t.matches("[data-toast]")) { e.preventDefault(); toast(t.dataset.toast); }
    if (t.matches("[data-open]")) {
      e.preventDefault();
      const target = document.getElementById(t.dataset.open.replace(/^#/, ""));
      if (target?.showModal) target.showModal();
      else target?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (t.matches("th.fw-sortable")) return sortTable(t);
  });
  document.addEventListener("input", (e) => {
    const root = e.target.closest?.("[data-calc]");
    if (root) calc(root);
  });
  document.addEventListener("change", (e) => {
    const root = e.target.closest?.("[data-calc]");
    if (root) calc(root);
  });
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.hasAttribute("data-calc")) { e.preventDefault(); return calc(form); }
    if (form.hasAttribute("data-fw-subscribe")) {
      e.preventDefault();
      const email = new FormData(form).get([...new FormData(form).keys()].find((k) => !k.startsWith("_")) ?? "email");
      store.set(`sub:${site}`, true);
      form.replaceWith(el("p", { class: "fw-done-note" }, "✓ You're on the list", el("span", { class: "meta", text: ` — ${email}` })));
      return toast("Subscribed! Watch your inbox.");
    }
    const btn = form.querySelector("button[type=submit], button:not([type]), input[type=submit]");
    if (btn && form.method === "post" && !e.defaultPrevented) setTimeout(() => { btn.disabled = true; btn.textContent = "Sending…"; });
  });
})();
