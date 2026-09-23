import test from "node:test";
import assert from "node:assert/strict";
import { displayURL, omniboxTarget, tabTitle, isHome, primaryRows, siteSuggestions, browserShell } from "../lib/browserbar.js";
import { recentRows, rememberSearch } from "../public/fw/browsing.js";

test("the bar shows a fake site's own URL, not Foogle's /web/ path", () => {
  const cases = [
    ["/web/crumbforum.net/threads/starter-smells", "https://crumbforum.net/threads/starter-smells"],
    // Foogle's result context rides along in the query string; it isn't the site's.
    ["/web/crumbforum.net/threads/starter-smells?fq=sourdough&ft=Starter%20smells&fs=Why&fk=forum", "https://crumbforum.net/threads/starter-smells"],
    ["/web/crumbforum.net", "https://crumbforum.net/"],
    ["/web/crumbforum.net/", "https://crumbforum.net/"],
    ["/web/Shop.Example/search?q=red+lamps&fq=lamps", "https://shop.example/search?q=red+lamps"],
    // A confirmation page after a form, and a GET form's own query.
    ["/web/garden.example/checkout?order=4821", "https://garden.example/checkout?order=4821"],
    ["/web/garden.example/search?fq=x&q=glass+panes&sort=new", "https://garden.example/search?q=glass+panes&sort=new"],
    // UTF-8 reads as text; escaped ASCII keeps its meaning.
    ["/web/caf%C3%A9.example/men%C3%BC?x=a%26b%20c", "https://café.example/menü?x=a%26b%20c"],
    ["/web/x.example/a%2Fb", "https://x.example/a%2Fb"],
    ["/web/localhost:8080/admin", "https://localhost:8080/admin"],
    // Foogle's own pages are on www.foogle.com.
    ["/", "https://www.foogle.com/"],
    ["/search?q=starter+smells", "https://www.foogle.com/search?q=starter+smells"],
    ["/search?q=starter+smells&page=2", "https://www.foogle.com/search?q=starter+smells&page=2"],
    ["/images?q=caf%C3%A9", "https://www.foogle.com/images?q=café"],
    ["/timelines?q=moon", "https://www.foogle.com/timelines?q=moon"],
    // An in-page anchor stays on the end, even after Foogle's context.
    ["/web/shop.example/faq?fq=x#returns", "https://shop.example/faq#returns"],
  ];
  for (const [path, url] of cases) assert.equal(displayURL(path), url, path);
});

test("typing a URL goes to that site; anything else is a Foogle search", () => {
  const go = (text, here) => omniboxTarget(text, { here });
  // URLs, with or without a scheme.
  assert.equal(go("example.com/foo"), "/web/example.com/foo");
  assert.equal(go("https://example.com/foo"), "/web/example.com/foo");
  assert.equal(go("http://Example.COM/Foo?x=1#top"), "/web/example.com/Foo?x=1#top");
  assert.equal(go("  crumbforum.net/threads/starter-smells  "), "/web/crumbforum.net/threads/starter-smells");
  assert.equal(go("crumbforum.net/"), "/web/crumbforum.net");
  assert.equal(go("www.moon-base.jobs"), "/web/www.moon-base.jobs");
  assert.equal(go("shop.example?q=lamps"), "/web/shop.example?q=lamps");
  assert.equal(go("localhost:8080/admin"), "/web/localhost:8080/admin");
  assert.equal(go("192.168.1.20"), "/web/192.168.1.20");
  assert.equal(go("https://intranet"), "/web/intranet");
  assert.equal(go("readme.md/install"), "/web/readme.md/install");
  // What the bar itself shows goes back to the same page.
  assert.equal(go(displayURL("/web/crumbforum.net/threads/starter-smells?fq=a")), "/web/crumbforum.net/threads/starter-smells");
  // Foogle's own addresses, and links copied from this Foogle, stay on Foogle.
  assert.equal(go("https://www.foogle.com/search?q=bread"), "/search?q=bread");
  assert.equal(go("foogle.com"), "/");
  assert.equal(go("http://192.168.1.5:3020/web/crumbforum.net/x?fq=a", "192.168.1.5:3020"), "/web/crumbforum.net/x?fq=a");
  assert.equal(go("localhost:3000/images?q=cats", "localhost:3000"), "/images?q=cats");
  assert.equal(go("/web/crumbforum.net/threads"), "/web/crumbforum.net/threads");
  // Searches.
  assert.equal(go("starter smells"), "/search?q=starter+smells");
  assert.equal(go("sourdough"), "/search?q=sourdough");
  assert.equal(go("what is 2+2?"), "/search?q=what+is+2%2B2%3F");
  assert.equal(go("3.14"), "/search?q=3.14");
  assert.equal(go("node.js"), "/search?q=node.js");
  assert.equal(go("notes.TXT"), "/search?q=notes.TXT");
  assert.equal(go("e.g."), "/search?q=e.g.");
  assert.equal(go("ada@garden.example"), "/search?q=ada%40garden.example");
  assert.equal(go("example.com/a b"), "/search?q=example.com%2Fa+b");
  assert.equal(go("? example.com"), "/search?q=example.com");
  assert.equal(go("javascript:alert(1)"), "/search?q=javascript%3Aalert%281%29");
  assert.equal(go("ftp://files.example"), "/search?q=ftp%3A%2F%2Ffiles.example");
  assert.equal(go("   "), "/");
  assert.equal(go(undefined), "/");
});

test("the address bar only ever sends the visitor somewhere on Foogle", () => {
  for (const text of ["//evil.example/x", "/\\evil.example", "https://localhost:3000//evil.example", "https://evil.example", "\\\\evil.example", "/x\r\nSet-Cookie: a=b"]) {
    const target = omniboxTarget(text, { here: "localhost:3000" });
    assert.match(target, /^\/(?![/\\])/, text);
    assert.doesNotMatch(target, /[\s\\]/, text);
  }
});

test("the tab reads like a browser's until the page's title arrives", () => {
  assert.equal(tabTitle("/web/crumbforum.net/threads/x?fq=bread&ft=Starter%20smells"), "Starter smells");
  assert.equal(tabTitle("/web/crumbforum.net/threads/x"), "crumbforum.net/threads/x");
  assert.equal(tabTitle("/web/crumbforum.net"), "crumbforum.net");
  assert.equal(tabTitle("/search?q=starter+smells"), "starter smells - Foogle Search");
  assert.equal(tabTitle("/images?q=cats"), "cats - Foogle Images");
  assert.equal(tabTitle("/"), "Foogle");
});

test("suggestions: the first row is what Enter does; a URL goes there, anything else searches", () => {
  const rows = (text) => primaryRows(text).map((r) => [r.kind, r.label, r.target]);
  assert.deepEqual(rows("cnn"), [["search", 'Search Foogle for "cnn"', "/search?q=cnn"]]);
  assert.deepEqual(rows("foo.bar baz"), [["search", 'Search Foogle for "foo.bar baz"', "/search?q=foo.bar+baz"]]);
  assert.deepEqual(rows("cnn.com  "), [["url", "cnn.com", "/web/cnn.com"], ["search", 'Search Foogle for "cnn.com"', "/search?q=cnn.com"]]);
  assert.deepEqual(rows("https://x.com/y")[0], ["url", "x.com/y", "/web/x.com/y"]);
  assert.deepEqual(rows("en.wikipedia.org/wiki/Foo")[0], ["url", "en.wikipedia.org/wiki/Foo", "/web/en.wikipedia.org/wiki/Foo"]);
  assert.deepEqual(rows("localhost:3000")[0], ["url", "localhost:3000", "/web/localhost:3000"]);
  assert.deepEqual(rows("10.0.0.7/admin")[0], ["url", "10.0.0.7/admin", "/web/10.0.0.7/admin"]);
  assert.deepEqual(rows("   "), []);
});

test("known sites (lib/brands.js) the text names are offered, by brands' own rules", () => {
  const sites = (text) => siteSuggestions(text).map((r) => [r.label, r.detail, r.target]);
  assert.deepEqual(sites("cnn"), [["cnn.com", "CNN", "/web/www.cnn.com"]]);
  assert.deepEqual(sites("Apple"), [["apple.com", "Apple", "/web/www.apple.com"]]);
  assert.deepEqual(sites("reddit sourdough"), [["reddit.com/r/sourdough", "Reddit", "/web/www.reddit.com/r/sourdough/"]]);
  // As the name is typed…
  assert.deepEqual(sites("red"), [["reddit.com", "Reddit", "/web/www.reddit.com"]]);
  // …but not while it could still be an everyday word, or when it is one in a search.
  assert.deepEqual(sites("app"), []);
  assert.deepEqual(sites("apple pie"), []);
  // A URL goes where it says.
  assert.deepEqual(sites("cnn.com"), []);
  assert.equal(siteSuggestions("netf")[0].fill, "netflix.com");
});

test("recent searches (foogle.recent, newest first) match what is typed; omnibox searches join them", () => {
  const recent = ["sourdough starter smells", "Sourdough discard crackers", "moon base jobs", 42, ""];
  assert.deepEqual(recentRows("sour", recent).map((r) => [r.kind, r.label, r.target]), [
    ["recent", "sourdough starter smells", "/search?q=sourdough+starter+smells"],
    ["recent", "Sourdough discard crackers", "/search?q=Sourdough+discard+crackers"],
  ]);
  assert.deepEqual(recentRows("  ", recent), []);
  assert.deepEqual(recentRows("x", null), []);
  assert.deepEqual(rememberSearch(["a", "Moon base jobs", "b"], " moon base jobs "), ["moon base jobs", "a", "b"]);
  assert.equal(rememberSearch(Array.from({ length: 30 }, (_, i) => `q${i}`), "new").length, 20);
});

test("the homepage is the new-tab page: an empty address bar with a placeholder", () => {
  assert.ok(isHome("/"));
  assert.ok(!isHome("/search?q=x") && !isHome("/?q=x") && !isHome("/web/x.example"));
  const home = browserShell({ originalUrl: "/" });
  assert.match(home, /<input name="q" value="" placeholder="Search Foogle or type a URL"/);
  assert.match(home, /<div class="browser loading home">/);
  assert.match(browserShell({ originalUrl: "/search?q=bread" }), /<input name="q" value="https:\/\/www\.foogle\.com\/search\?q=bread" placeholder/);
});

test("a top-level visit gets the browser: one tab framing the page, and nothing inline that runs", () => {
  const req = { originalUrl: '/web/crumbforum.net/threads/x?fq=a&ft=%3Cb%3E"hi"&fk=forum' };
  const html = browserShell(req);
  assert.match(html, /^<!DOCTYPE html><html lang="en">/);
  // The tab's page is the very URL visited, escaped.
  assert.match(html, /<main class="views"><iframe class="on" src="\/web\/crumbforum\.net\/threads\/x\?fq=a&amp;ft=%3Cb%3E&quot;hi&quot;&amp;fk=forum"/);
  assert.match(html, /<input name="q" value="https:\/\/crumbforum\.net\/threads\/x"/);
  assert.match(html, /<span class="h">crumbforum\.net<\/span><span class="p">\/threads\/x<\/span>/);
  assert.match(html, /<title>&lt;b&gt;&quot;hi&quot;<\/title>/); // the result title, escaped
  assert.match(html, /<span class="title">&lt;b&gt;&quot;hi&quot;<\/span>/);
  assert.match(html, /<form class="omni" action="\/go" method="get">/);
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.match(html, /<script type="module" src="\/fw\/browserbar\.js\?v=\w{8}"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});
