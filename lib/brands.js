// Real, well-known websites. Foogle invents the web, but when a search names
// a site everyone knows (cnn, reddit, wikipedia), it behaves like a real
// search engine: that site's real domain is the top result, and its pages
// are generated as recognisable, futuristic versions of themselves: its
// colours, wordmark, typography, header and page layout, with invented
// content. lib/brandtheme.js renders them; this file knows which sites exist.
//
// The curated table is the quality floor and costs nothing: a lookup, no
// model call. For any other real site (Jev flags it, or a search result was
// marked real) the model writes a brand spec in the same shape, once per
// domain.

import { completeText, extractJSON, config } from "./llm.js";

// The page archetypes lib/brandtheme.js can render.
export const ARCHES = ["newsportal", "newspaper", "community", "linkboard", "encyclopedia", "marketplace", "video", "codehost", "qa", "productbrand", "classifieds", "social", "streaming", "landing"];

// Fonts a brand may name (lib/brandtheme.js maps them to system stacks; no
// web fonts, which would cost a request before the first styled paint).
export const BRAND_FONTS = ["sans", "helvetica", "arial", "arialblack", "segoe", "roboto", "verdana", "georgia", "serif", "times", "franklin", "blackletter", "cond", "rounded", "mono", "avenir", "futura", "script", "didone"];

// Each site: its canonical host and the domains it answers on; how a search
// names it (`aka` matches anywhere in the query; `exact` names are common
// words, so they only count when the query is just the name or pairs it with
// one of its `context` words); its archetype; colours (bg page, fg text, acc
// brand accent, head/headFg header bar, link); fonts [body, headings]; its
// wordmark; nav; the sitelinks a search shows; and how its content reads.
// Everything else has per-archetype defaults in lib/brandtheme.js.
const B = [
  // ---- news portals ----
  { name: "CNN", host: "www.cnn.com", aka: ["cnn", "cnn news", "cable news network"], arch: "newsportal",
    title: "CNN: Breaking News, Latest News and Videos", about: "View the latest news and breaking news today for U.S., world, weather, entertainment, politics and health at CNN.com.",
    colors: { acc: "#cc0000", head: "#ffffff", headFg: "#0c0c0c", fg: "#0c0c0c", foot: "#0c0c0c" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "CNN", style: "block", bg: "#cc0000", fg: "#ffffff", font: "arialblack", track: "-.06em" },
    nav: ["US", "World", "Politics", "Business", "Health", "Entertainment", "Style", "Travel", "Sports", "Science", "Climate", "Weather"],
    links: ["World", "Politics", "Business", "US", "Live TV", "Weather"], legal: "Cable News Network",
    voice: "CNN: urgent, punchy sentence-case headlines; red LIVE and Breaking labels; 'Analysis' and 'Opinion' kickers; datelines like 'Washington (CNN) —'; video everywhere with runtimes." },
  { name: "BBC", host: "www.bbc.com", domains: ["bbc.com", "bbc.co.uk"], aka: ["bbc", "bbc news", "bbc.co.uk"], arch: "newsportal",
    title: "BBC Home - Breaking News, World News, US News, Sports, Business, Innovation", about: "Visit BBC for trusted reporting on the latest world and US news, sports, business, climate, innovation, culture and much more.",
    colors: { acc: "#b80000", head: "#ffffff", headFg: "#141414", fg: "#141414" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "BBC", style: "blocks", bg: "#141414", fg: "#ffffff", font: "helvetica" },
    nav: ["Home", "News", "Sport", "Business", "Innovation", "Culture", "Arts", "Travel", "Earth", "Audio", "Video", "Live"],
    links: ["News", "Sport", "Business", "Culture", "Travel", "Live"], legal: "BBC",
    voice: "BBC: calm, precise British English; short factual headlines; 'LIVE' pages; bylines with a role ('Science correspondent'); measured analysis." },
  { name: "Fox News", host: "www.foxnews.com", aka: ["fox news", "foxnews", "fox news channel"], arch: "newsportal",
    title: "Fox News - Breaking News Updates | Latest News Headlines", about: "Latest breaking news, including politics, crime and celebrity. Find stories, updates and expert opinion.",
    colors: { acc: "#c20017", head: "#003366", headFg: "#ffffff", fg: "#111111", foot: "#003366" }, fonts: ["arial", "arial"],
    logo: { text: "FOX NEWS", style: "block", bg: "#ffffff", fg: "#003366", font: "arialblack", track: "-.03em" },
    nav: ["U.S.", "Politics", "World", "Opinion", "Media", "Entertainment", "Sports", "Lifestyle", "Video"],
    links: ["Politics", "U.S.", "Opinion", "World", "Video", "Watch Live"], legal: "FOX News Network, LLC",
    voice: "Fox News: bold, all-caps-feeling headlines, strong opinion voices, 'FOX NEWS ALERT' banners, video clips from shows." },
  { name: "NBC News", host: "www.nbcnews.com", aka: ["nbc news", "nbcnews", "nbc"], arch: "newsportal",
    title: "NBC News - Breaking News & Top Stories - Latest World, US & Local News", about: "Go to NBCNews.com for breaking news, videos, and the latest top stories in world news, business, politics, health and pop culture.",
    colors: { acc: "#0089d0", head: "#ffffff", headFg: "#0b0b0b", fg: "#0b0b0b" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "NBC NEWS", style: "word", icon: "peacock", font: "arialblack", size: 1.3, track: "-.02em" },
    nav: ["Politics", "U.S. News", "World", "Local", "Business", "Health", "Science", "Culture & Trends", "Sports"],
    links: ["Politics", "U.S. News", "World", "Health", "Business", "Watch Live"], legal: "NBC UNIVERSAL",
    voice: "NBC News: clean broadcast-news tone, 'LIVE' and 'NBC News Exclusive' labels, short explainers." },
  { name: "Reuters", host: "www.reuters.com", aka: ["reuters"], arch: "newsportal",
    title: "Reuters | Breaking International News & Views", about: "Find latest news from every corner of the globe at Reuters.com, your online source for breaking international news coverage.",
    colors: { acc: "#fa6400", head: "#ffffff", headFg: "#404040", fg: "#212121" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "REUTERS", style: "word", icon: "dots", font: "helvetica", weight: 700, track: ".04em", color: "#404040" },
    nav: ["World", "Business", "Markets", "Sustainability", "Legal", "Breakingviews", "Technology", "Investigations"],
    links: ["World", "Business", "Markets", "Technology", "Legal", "Sustainability"], strip: "markets", legal: "Reuters",
    voice: "Reuters: wire-service neutrality, datelines like 'LONDON, March 4 (Reuters) -', numbers and named sources in every paragraph." },
  { name: "AP News", host: "apnews.com", aka: ["ap news", "apnews", "associated press"], arch: "newsportal",
    title: "AP News: Breaking News, Latest Headlines and Videos", about: "Read the latest headlines, breaking news, and videos at APNews.com, the definitive source for independent journalism from every corner of the globe.",
    colors: { acc: "#e2001a", head: "#ffffff", headFg: "#000000", fg: "#000000" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "AP", style: "block", bg: "#ffffff", fg: "#000000", font: "arialblack", border: "#000000" },
    nav: ["World", "U.S.", "Politics", "Sports", "Entertainment", "Business", "Science", "Fact Check", "Oddities"],
    links: ["World", "U.S.", "Politics", "Sports", "Business", "Fact Check"], legal: "The Associated Press",
    voice: "AP: plain, neutral wire copy; datelines in caps ('WASHINGTON (AP) —'); short paragraphs; no adjectives." },
  { name: "Bloomberg", host: "www.bloomberg.com", aka: ["bloomberg", "bloomberg news"], arch: "newsportal",
    title: "Bloomberg - Business News, Stock Markets, Finance, Breaking & World News", about: "Bloomberg delivers business and markets news, data, analysis, and video to the world, featuring stories from Businessweek and Bloomberg News.",
    colors: { acc: "#2800d7", head: "#000000", headFg: "#ffffff", fg: "#000000" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "Bloomberg", style: "word", font: "helvetica", weight: 800, track: "-.03em" },
    nav: ["Markets", "Economics", "Industries", "Tech", "AI", "Politics", "Wealth", "Pursuits", "Opinion", "Businessweek"],
    links: ["Markets", "Technology", "Politics", "Opinion", "Businessweek", "Live TV"], strip: "markets", legal: "Bloomberg L.P.",
    voice: "Bloomberg: markets-first, terse headlines with numbers and tickers, 'Markets Wrap', charts and data points." },
  { name: "Yahoo", host: "www.yahoo.com", aka: ["yahoo", "yahoo news", "yahoo.com"], arch: "newsportal",
    title: "Yahoo | Mail, Weather, Search, News, Finance, Sports, Shopping", about: "Latest news coverage, email, free stock quotes, live scores and video are just the beginning. Discover more every day at Yahoo!",
    colors: { acc: "#6001d2", head: "#ffffff", headFg: "#1d2228", fg: "#1d2228", link: "#1d2228" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "yahoo!", style: "word", font: "arialblack", color: "#6001d2", track: "-.04em", size: 1.6 },
    nav: ["Mail", "News", "Finance", "Sports", "Entertainment", "Life", "Shopping", "Weather"],
    links: ["Mail", "News", "Finance", "Sports", "Weather", "Entertainment"], legal: "Yahoo",
    voice: "Yahoo: a busy portal; trending-now lists, short aggregated headlines with source names, finance tickers, lifestyle." },
  { name: "NPR", host: "www.npr.org", aka: ["npr", "national public radio"], arch: "newsportal",
    title: "NPR - Breaking News, Analysis, Music, Arts & Podcasts", about: "NPR delivers breaking national and world news. Also top stories from business, politics, health, science, technology, music, arts and culture.",
    colors: { acc: "#237bbd", head: "#ffffff", headFg: "#000000", fg: "#000000" }, fonts: ["helvetica", "georgia"],
    logo: { text: "npr", style: "blocks", colors: ["#d62021", "#000000", "#237bbd"], fg: "#ffffff", font: "helvetica" },
    nav: ["News", "Culture", "Music", "Podcasts & Shows", "Search"],
    links: ["News", "Culture", "Music", "Podcasts & Shows", "Politics", "Live Radio"], legal: "npr",
    voice: "NPR: warm public-radio voice, 'Morning Edition' and 'All Things Considered' segments, listen buttons with durations." },
  { name: "ESPN", host: "www.espn.com", aka: ["espn", "espn sports", "espn scores"], arch: "newsportal",
    title: "ESPN - Serving Sports Fans. Anytime. Anywhere.", about: "Visit ESPN for live scores, highlights and sports news. Stream exclusive games on ESPN and play fantasy sports.",
    colors: { acc: "#d00", head: "#151515", headFg: "#ffffff", fg: "#121213", bg: "#eceef0", foot: "#151515" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "ESPN", style: "word", font: "arialblack", italic: true, color: "#ff2733", size: 1.7, track: "-.03em" },
    nav: ["NFL", "NBA", "MLB", "NCAAF", "NHL", "Soccer", "WNBA", "Tennis", "Golf", "More Sports"],
    links: ["NFL", "NBA", "Scores", "Fantasy", "MLB", "Soccer"], strip: "scores", legal: "ESPN Enterprises, Inc.",
    voice: "ESPN: high-energy sports desk; scores, standings, stat lines and hot takes; 'Top Headlines' lists; video highlights with runtimes." },
  // ---- newspapers ----
  { name: "The New York Times", host: "www.nytimes.com", aka: ["nytimes", "nyt", "new york times", "ny times", "the new york times"], arch: "newspaper",
    title: "The New York Times - Breaking News, US News, World News and Videos", about: "Live news, investigations, opinion, photos and video by the journalists of The New York Times from more than 150 countries around the world.",
    colors: { acc: "#326891", fg: "#121212", link: "#121212" }, fonts: ["georgia", "georgia"],
    logo: { text: "The New York Times", style: "masthead", font: "blackletter" },
    nav: ["U.S.", "World", "Business", "Arts", "Lifestyle", "Opinion", "Audio", "Games", "Cooking", "Wirecutter", "The Athletic"],
    links: ["U.S.", "World", "Opinion", "Games", "Cooking", "Wirecutter"], legal: "The New York Times Company",
    voice: "The New York Times: authoritative, elegant serif journalism; understated headlines, summary decks, 'News Analysis', Opinion columnists, Games and Cooking modules." },
  { name: "The Washington Post", host: "www.washingtonpost.com", aka: ["washington post", "washingtonpost", "wapo", "the washington post"], arch: "newspaper",
    title: "The Washington Post - Breaking news and latest headlines, U.S. news, world news, and video", about: "Breaking news and analysis on politics, business, world national news, entertainment more. In-depth DC, Virginia, Maryland news coverage including traffic, weather, crime, education, restaurant reviews and more.",
    colors: { acc: "#1955a5", fg: "#111111", link: "#111111" }, fonts: ["georgia", "georgia"],
    logo: { text: "The Washington Post", style: "masthead", font: "blackletter", tagline: "Democracy Dies in Darkness" },
    nav: ["Politics", "Opinions", "Style", "Investigations", "Climate", "Well+Being", "Business", "Tech", "World", "D.C., Md. & Va.", "Sports"],
    links: ["Politics", "Opinions", "Climate", "Tech", "World", "Sports"], legal: "The Washington Post",
    voice: "The Washington Post: accountability journalism, crisp political reporting, 'Analysis' labels, Opinions section." },
  { name: "The Wall Street Journal", host: "www.wsj.com", aka: ["wsj", "wall street journal", "the wall street journal"], arch: "newspaper",
    title: "The Wall Street Journal - Breaking News, Business, Financial & Economic News, World News and Video", about: "WSJ online coverage of breaking news and current headlines from the US and around the world. Top stories, photos, videos, detailed analysis and in-depth reporting.",
    colors: { acc: "#0274b6", fg: "#111111", link: "#111111" }, fonts: ["georgia", "times"],
    logo: { text: "THE WALL STREET JOURNAL.", style: "masthead", font: "times", weight: 700, track: ".02em" },
    nav: ["World", "Business", "U.S.", "Politics", "Economy", "Tech", "Markets & Finance", "Opinion", "Arts", "Lifestyle", "Real Estate", "Personal Finance"],
    links: ["Markets", "Business", "Opinion", "Tech", "Politics", "Economy"], strip: "markets", legal: "Dow Jones & Company, Inc.",
    voice: "The Wall Street Journal: business-first, dense and exact; market data, hedcut-style portraits, 'Heard on the Street', sharp Opinion pages." },
  { name: "The Guardian", host: "www.theguardian.com", aka: ["guardian", "the guardian", "theguardian"], arch: "newspaper",
    title: "News, sport and opinion from the Guardian's US edition | The Guardian", about: "Latest US news, world news, sports, business, opinion, analysis and reviews from the Guardian, the world's leading liberal voice.",
    colors: { acc: "#c70000", head: "#052962", headFg: "#ffffff", fg: "#121212", link: "#052962" }, fonts: ["georgia", "georgia"],
    logo: { text: "The Guardian", style: "masthead", font: "georgia", weight: 700, color: "#ffffff", align: "right", track: "-.03em" },
    nav: ["News", "Opinion", "Sport", "Culture", "Lifestyle"], pillars: ["#c70000", "#e05e00", "#0077b6", "#a1845c", "#bb3b80"],
    links: ["World", "US politics", "Opinion", "Sport", "Culture", "Environment"], legal: "Guardian News & Media Limited",
    voice: "The Guardian: progressive, witty British voice; colour-coded kickers ('Live', 'Opinion'), columnists, long reads, reader support appeals." },
  { name: "The Economist", host: "www.economist.com", aka: ["economist", "the economist"], arch: "newspaper",
    title: "The Economist | Independent journalism", about: "The Economist offers authoritative insight and opinion on international news, politics, business, finance, science, technology and the connections between them.",
    colors: { acc: "#e3120b", fg: "#0d0d0d", link: "#0d0d0d" }, fonts: ["georgia", "helvetica"],
    logo: { text: "The Economist", style: "block", bg: "#e3120b", fg: "#ffffff", font: "georgia", weight: 400 },
    nav: ["Weekly edition", "The world in brief", "World", "United States", "China", "Business", "Finance & economics", "Science & technology", "Culture"],
    links: ["Weekly edition", "The world in brief", "United States", "Finance & economics", "Science & technology", "Graphic detail"], legal: "The Economist Newspaper Limited",
    voice: "The Economist: anonymous, witty, confident house style; punning headlines, one-line rubrics, charts, 'The world in brief'." },
  { name: "Financial Times", host: "www.ft.com", aka: ["ft", "financial times", "ft.com"], arch: "newspaper",
    title: "Financial Times", about: "News, analysis and opinion from the Financial Times on the latest in markets, economics and politics.",
    colors: { acc: "#0d7680", bg: "#fff1e5", fg: "#33302e", link: "#0d7680" }, fonts: ["georgia", "georgia"],
    logo: { text: "FINANCIAL TIMES", style: "masthead", font: "times", weight: 400, track: ".08em" },
    nav: ["Home", "World", "US", "Companies", "Tech", "Markets", "Climate", "Opinion", "Lex", "Work & Careers", "Life & Arts"],
    links: ["World", "Markets", "Companies", "Opinion", "Lex", "Life & Arts"], strip: "markets", legal: "The Financial Times Ltd",
    voice: "Financial Times: global business authority on salmon-pink paper; Lex column, markets data, crisp analytical headlines." },
  { name: "Los Angeles Times", host: "www.latimes.com", aka: ["la times", "los angeles times", "latimes"], arch: "newspaper",
    title: "Los Angeles Times", about: "The L.A. Times is a leading source of breaking news, entertainment, sports, politics, and more for Southern California and the world.",
    colors: { acc: "#0169c8", fg: "#000000", link: "#000000" }, fonts: ["georgia", "georgia"],
    logo: { text: "Los Angeles Times", style: "masthead", font: "blackletter" },
    nav: ["California", "Entertainment & Arts", "Politics", "Opinion", "Sports", "Business", "Climate", "Food", "Lifestyle"],
    links: ["California", "Entertainment & Arts", "Sports", "Food", "Opinion", "Climate"], legal: "Los Angeles Times",
    voice: "Los Angeles Times: West Coast perspective; California politics, Hollywood, food and climate." },
  // ---- communities ----
  { name: "Reddit", host: "www.reddit.com", aka: ["reddit", "reddit.com", "subreddit"], arch: "community",
    title: "Reddit - Dive into anything", about: "Reddit is a network of communities where people can dive into their interests, hobbies and passions. There's a community for whatever you're interested in on Reddit.",
    colors: { acc: "#ff4500", head: "#ffffff", headFg: "#1a1a1b", fg: "#0f1a1c", link: "#0045ac" }, fonts: ["sans", "sans"],
    logo: { text: "reddit", style: "word", icon: "alien", font: "arialround", color: "#ff4500", weight: 800, track: "-.03em", size: 1.55 },
    nav: ["Home", "Popular", "Explore", "All"],
    links: ["r/popular", "r/AskReddit", "r/worldnews", "r/todayilearned", "r/science", "r/Futurology"], legal: "Reddit, Inc.",
    voice: "Reddit: casual, funny, opinionated users with handles like u/quiet_ferment; subreddit culture, inside jokes, edits ('EDIT: thanks for the gold'), top comments that riff on the post." },
  { name: "Hacker News", host: "news.ycombinator.com", aka: ["hacker news", "hackernews", "hn", "ycombinator news"], arch: "linkboard",
    title: "Hacker News", about: "Hacker News is a social news website focusing on computer science and entrepreneurship, run by the investment fund and startup incubator Y Combinator.",
    colors: { acc: "#ff6600", bg: "#f6f6ef", head: "#ff6600", headFg: "#000000", fg: "#000000", muted: "#828282", link: "#000000" }, fonts: ["verdana", "verdana"],
    logo: { text: "Hacker News", style: "word", icon: "yc", font: "verdana", weight: 700, size: .82 },
    nav: ["new", "past", "comments", "ask", "show", "jobs", "submit"],
    links: ["new", "ask", "show", "jobs", "past", "comments"], legal: "Y Combinator",
    voice: "Hacker News: terse, skeptical engineers; 'Show HN' and 'Ask HN' titles with (domain.tld) after links; long nitpicky comment threads." },
  // ---- encyclopedia ----
  { name: "Wikipedia", host: "en.wikipedia.org", domains: ["wikipedia.org"], aka: ["wikipedia", "wiki", "wikipedia.org", "wikipedia en"], arch: "encyclopedia",
    title: "Wikipedia, the free encyclopedia", about: "Wikipedia is a free online encyclopedia, created and edited by volunteers around the world and hosted by the Wikimedia Foundation.",
    colors: { acc: "#3366cc", bg: "#f6f6f6", fg: "#202122", link: "#0645ad", line: "#a2a9b1" }, fonts: ["sans", "serif"],
    logo: { text: "Wikipedia", style: "stack", icon: "globe", font: "serif", tagline: "The Free Encyclopedia", size: 1.05 },
    nav: ["Main page", "Contents", "Current events", "Random article", "About Wikipedia", "Contact us"],
    links: ["Main page", "Contents", "Current events", "Random article", "About Wikipedia", "Help"], legal: "Wikimedia Foundation, Inc.",
    voice: "Wikipedia: neutral, encyclopedic, citation-dense prose ([1], [2] superscripts), bold subject name in the first sentence, 'See also' and 'References' sections, no second person." },
  // ---- marketplaces ----
  { name: "Amazon", host: "www.amazon.com", domains: ["amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de"], aka: ["amazon.com", "amazon prime", "amazon store", "amazon shopping"], exact: ["amazon", "amzn"],
    context: ["prime", "kindle", "echo", "alexa", "orders", "order", "cart", "deals", "returns", "basket", "shopping", "fire", "account"], arch: "marketplace",
    title: "Amazon.com. Spend less. Smile more.", about: "Free shipping on millions of items. Get the best of Shopping and Entertainment with Prime. Enjoy low prices and great deals on the largest selection of everyday essentials and other products.",
    colors: { acc: "#ff9900", head: "#131921", headFg: "#ffffff", sub: "#232f3e", fg: "#0f1111", link: "#007185", buy: "#ffd814", buyFg: "#0f1111", now: "#ffa41c" }, fonts: ["arial", "arial"],
    logo: { text: "amazon", style: "word", icon: "smile", font: "arialblack", color: "#ffffff", track: "-.05em", size: 1.55 },
    nav: ["All", "Today's Deals", "Customer Service", "Registry", "Gift Cards", "Sell", "Prime Video"],
    links: ["Today's Deals", "Customer Service", "Prime", "Your Orders", "Gift Cards", "Sell"], cta: ["Add to Cart", "Buy Now"], legal: "Amazon.com, Inc. or its affiliates",
    voice: "Amazon: dense retail copy; keyword-stuffed product titles, 'About this item' bullets with ALL-CAPS leads, star ratings with thousands of reviews, Prime delivery dates, 'Customers also bought'." },
  { name: "eBay", host: "www.ebay.com", aka: ["ebay", "ebay.com"], arch: "marketplace",
    title: "Electronics, Cars, Fashion, Collectibles & More | eBay", about: "Buy & sell electronics, cars, clothes, collectibles & more on eBay, the world's online marketplace. Top brands, low prices & free shipping on many items.",
    colors: { acc: "#3665f3", head: "#ffffff", headFg: "#191919", fg: "#191919", link: "#191919", buy: "#3665f3", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "ebay", style: "word", colors: ["#e53238", "#0064d2", "#f5af02", "#86b817"], font: "helvetica", weight: 700, track: "-.07em", size: 1.9 },
    nav: ["Saved", "Motors", "Electronics", "Collectibles", "Home & Garden", "Fashion", "Toys", "Sporting Goods", "Refurbished"],
    links: ["Electronics", "Motors", "Collectibles", "Fashion", "Daily Deals", "Sell"], cta: ["Buy It Now", "Add to cart"], legal: "eBay Inc.",
    voice: "eBay: auction and Buy It Now listings; item condition, seller feedback percentages, shipping from real-sounding towns, 'Watch' counts." },
  { name: "Walmart", host: "www.walmart.com", aka: ["walmart", "walmart.com"], arch: "marketplace",
    title: "Walmart | Save Money. Live better.", about: "Shop Walmart.com today for Every Day Low Prices. Join Walmart+ for unlimited free delivery from your store & free shipping with no order minimum.",
    colors: { acc: "#0071dc", head: "#0071dc", headFg: "#ffffff", fg: "#2e2f32", link: "#2e2f32", buy: "#0071dc", buyFg: "#ffffff", sub: "#e6f1fc", subFg: "#004f9a" }, fonts: ["segoe", "segoe"],
    logo: { text: "Walmart", style: "word", icon: "spark", font: "segoe", weight: 700, color: "#ffffff", size: 1.4 },
    nav: ["Departments", "Services", "Grocery", "Deals", "Home", "Electronics", "Fashion", "Walmart+"],
    links: ["Grocery", "Deals", "Electronics", "Pharmacy", "Walmart+", "Registry"], cta: ["Add to cart", "Buy now"], legal: "Walmart",
    voice: "Walmart: value-first retail; 'Rollback' and 'Now $X' price tags, pickup and delivery slots, Walmart+ perks." },
  { name: "Target", host: "www.target.com", aka: ["target.com", "target store"], exact: ["target"], context: ["circle", "redcard", "deals", "store", "hours", "order", "pickup"], arch: "marketplace",
    title: "Target : Expect More. Pay Less.", about: "Shop Target online and in-store for everything from groceries and essentials to clothing and electronics. Choose contactless pickup or delivery today.",
    colors: { acc: "#cc0000", head: "#ffffff", headFg: "#333333", fg: "#333333", link: "#333333", buy: "#cc0000", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "", style: "word", icon: "bullseye" },
    nav: ["Categories", "Deals", "New & featured", "Pickup & delivery"],
    links: ["Deals", "Weekly Ad", "Target Circle", "Clothing", "Home", "Grocery"], cta: ["Add to cart", "Ship it"], legal: "Target Brands, Inc.",
    voice: "Target: bright, friendly retail; 'Target Circle' deals, owned brands, drive-up pickup, cheerful product copy." },
  { name: "Best Buy", host: "www.bestbuy.com", aka: ["best buy", "bestbuy"], arch: "marketplace",
    title: "Best Buy | Official Online Store | Shop Now & Save", about: "Shop Best Buy for electronics, computers, appliances, cell phones, video games & more new tech. In-store pickup & free shipping.",
    colors: { acc: "#0046be", head: "#0046be", headFg: "#ffffff", fg: "#1d252c", link: "#0046be", buy: "#ffe000", buyFg: "#1d252c" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "BEST BUY", style: "tag", bg: "#ffe000", fg: "#000000", font: "arialblack", size: .95 },
    nav: ["Menu", "Top Deals", "Deal of the Day", "My Best Buy", "Credit Cards", "Gift Cards", "Gift Ideas"],
    links: ["Top Deals", "Deal of the Day", "Computers", "TVs", "Appliances", "Order Status"], cta: ["Add to Cart", "Pick up today"], legal: "Best Buy",
    voice: "Best Buy: tech retail specs, Geek Squad protection plans, open-box deals, in-store pickup today." },
  { name: "Etsy", host: "www.etsy.com", aka: ["etsy", "etsy.com"], arch: "marketplace",
    title: "Etsy - Shop for handmade, vintage, custom, and unique gifts for everyone", about: "Find the perfect handmade gift, vintage & on-trend clothes, unique jewelry, and more… lots more.",
    colors: { acc: "#f1641e", head: "#ffffff", headFg: "#222222", fg: "#222222", link: "#222222", buy: "#222222", buyFg: "#ffffff" }, fonts: ["helvetica", "georgia"],
    logo: { text: "Etsy", style: "word", font: "georgia", color: "#f1641e", weight: 400, size: 1.7, track: "-.02em" },
    nav: ["Gifts", "Home Favorites", "Fashion Finds", "Registry", "Gift Cards"],
    links: ["Gifts", "Jewelry & Accessories", "Home & Living", "Craft Supplies", "Gift Cards", "Sell on Etsy"], cta: ["Add to cart", "Buy it now"], legal: "Etsy, Inc.",
    voice: "Etsy: handmade and vintage makers; shop names like 'FernAndFable', personalization options, 'Star Seller' badges, warm maker stories." },
  { name: "IKEA", host: "www.ikea.com", aka: ["ikea"], arch: "marketplace",
    title: "IKEA US - Furniture and Home Furnishings", about: "Shop IKEA for affordable furniture, home décor, storage solutions and inspiration for every room.",
    colors: { acc: "#0058a3", head: "#ffffff", headFg: "#111111", fg: "#111111", link: "#111111", buy: "#0058a3", buyFg: "#ffffff" }, fonts: ["verdana", "verdana"],
    logo: { text: "IKEA", style: "oval", bg: "#0058a3", fg: "#0058a3", ring: "#ffdb00", font: "verdana", weight: 700 },
    nav: ["Products", "Rooms", "Offers", "Design & plan", "Services", "Inspiration"],
    links: ["Products", "Rooms", "Offers", "Planners", "Delivery", "IKEA Family"], cta: ["Add to bag", "Check in-store stock"], legal: "Inter IKEA Systems B.V.",
    voice: "IKEA: Scandinavian product names in caps (FRÅSNIG, BILLY-style), flat-pack dimensions, assembly notes, room-set inspiration." },
  { name: "The Home Depot", host: "www.homedepot.com", aka: ["home depot", "homedepot", "the home depot"], arch: "marketplace",
    title: "The Home Depot", about: "Shop online for all your home improvement needs: appliances, bathroom decorating ideas, kitchen remodeling, patio furniture, power tools and more.",
    colors: { acc: "#f96302", head: "#ffffff", headFg: "#333333", fg: "#333333", link: "#333333", buy: "#f96302", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "THE HOME DEPOT", style: "block", bg: "#f96302", fg: "#ffffff", font: "arialblack", size: .78, stack: true },
    nav: ["All Departments", "Home Décor", "Tools", "Appliances", "Outdoor", "Specials & Offers", "DIY Projects"],
    links: ["Appliances", "Tools", "Specials & Offers", "Pro", "Tool Rental", "Store Finder"], cta: ["Add to Cart", "Pickup today"], legal: "Home Depot Product Authority, LLC",
    voice: "The Home Depot: DIY and Pro shoppers; specs, how-to guides, aisle numbers, pickup-today stock." },
  { name: "Airbnb", host: "www.airbnb.com", aka: ["airbnb"], arch: "marketplace",
    title: "Airbnb | Vacation rentals, cabins, beach houses, & more", about: "Get an Airbnb for every kind of trip → vacation rentals, cabins, beach houses, unique homes and experiences around the world.",
    colors: { acc: "#ff385c", head: "#ffffff", headFg: "#222222", fg: "#222222", link: "#222222", buy: "#e31c5f", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "airbnb", style: "word", icon: "belo", font: "helvetica", weight: 800, color: "#ff385c", track: "-.03em", size: 1.45 },
    nav: ["Homes", "Experiences", "Services"],
    links: ["Beachfront", "Cabins", "Experiences", "Airbnb your home", "Help Center", "Gift cards"], cta: ["Reserve", "Share"], unit: "night", legal: "Airbnb, Inc.",
    voice: "Airbnb: warm hospitality; listing titles like 'Cliffside cabin with sauna', 'Superhost' hosts, per-night prices, guest reviews with dates." },
  { name: "Booking.com", host: "www.booking.com", aka: ["booking.com", "booking com"], exact: ["booking"], arch: "marketplace",
    title: "Booking.com | Official site | The best hotels, flights, car rentals & accommodations", about: "Find the best deals on hotels, homes, and so much more. Explore the world with Booking.com.",
    colors: { acc: "#0071c2", head: "#003580", headFg: "#ffffff", fg: "#1a1a1a", link: "#006ce4", buy: "#0071c2", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "Booking.com", style: "word", font: "helvetica", weight: 800, color: "#ffffff", size: 1.35, track: "-.02em" },
    nav: ["Stays", "Flights", "Car rental", "Attractions", "Airport taxis"],
    links: ["Stays", "Flights", "Car rental", "Attractions", "Genius", "Deals"], cta: ["Reserve", "I'll reserve"], unit: "night", legal: "Booking.com",
    voice: "Booking.com: review scores like '8.9 Fabulous', 'Only 2 rooms left!', free cancellation and breakfast included badges." },
  { name: "Zillow", host: "www.zillow.com", aka: ["zillow"], arch: "marketplace",
    title: "Zillow: Real Estate, Apartments, Mortgages & Home Values", about: "The leading real estate marketplace. Search millions of for-sale and rental listings, compare Zestimate® home values and connect with local professionals.",
    colors: { acc: "#006aff", head: "#ffffff", headFg: "#2a2a33", fg: "#2a2a33", link: "#006aff", buy: "#006aff", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "Zillow", style: "word", icon: "house", font: "helvetica", weight: 800, color: "#006aff", size: 1.45 },
    nav: ["Buy", "Rent", "Sell", "Home Loans", "Find an Agent"],
    links: ["Homes for sale", "Rentals", "Home values", "Mortgage rates", "Sell", "Agent finder"], cta: ["Request a tour", "Contact agent"], legal: "Zillow, Inc.",
    voice: "Zillow: listings with price, beds, baths, sqft, Zestimate, days on Zillow, open-house times, neighbourhood details." },
  { name: "Yelp", host: "www.yelp.com", aka: ["yelp"], arch: "marketplace",
    title: "Restaurants, Dentists, Bars, Beauty Salons, Doctors - Yelp", about: "User Reviews and Recommendations of Best Restaurants, Shopping, Nightlife, Food, Entertainment, Things to Do, Services and More at Yelp.",
    colors: { acc: "#d32323", head: "#ffffff", headFg: "#2d2e2f", fg: "#2d2e2f", link: "#027a97", buy: "#d32323", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "yelp", style: "word", icon: "burst", font: "arialblack", color: "#d32323", size: 1.5, track: "-.03em" },
    nav: ["Restaurants", "Home Services", "Auto Services", "More"],
    links: ["Restaurants", "Delivery", "Takeout", "Nightlife", "Home Services", "Write a Review"], cta: ["Write a review", "Order online"], legal: "Yelp Inc.",
    voice: "Yelp: first-person local reviews with star ratings and dates, 'Elite' reviewers, hours tables, 'Popular dishes'." },
  { name: "Nike", host: "www.nike.com", aka: ["nike.com", "nike store"], exact: ["nike"], context: ["shoes", "sneakers", "air", "jordan", "running", "store", "shop"], arch: "marketplace",
    title: "Nike. Just Do It. Nike.com", about: "Inspiring the world's athletes, Nike delivers innovative products, experiences and services.",
    colors: { acc: "#111111", head: "#ffffff", headFg: "#111111", fg: "#111111", link: "#111111", buy: "#111111", buyFg: "#ffffff" }, fonts: ["helvetica", "futura"],
    logo: { text: "", style: "word", icon: "swoosh" },
    nav: ["New & Featured", "Men", "Women", "Kids", "Jordan", "Sale"],
    links: ["New & Featured", "Men", "Women", "Kids", "Jordan", "Sale"], cta: ["Add to Bag", "Favorite"], legal: "Nike, Inc.",
    voice: "Nike: bold, all-caps athletic slogans, sizes and colourways, 'Member Exclusive', athlete stories." },
  // ---- video ----
  { name: "YouTube", host: "www.youtube.com", aka: ["youtube", "yt", "youtube.com", "you tube"], arch: "video",
    title: "YouTube", about: "Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.",
    colors: { acc: "#ff0000", head: "#ffffff", headFg: "#0f0f0f", fg: "#0f0f0f", link: "#065fd4" }, fonts: ["roboto", "roboto"],
    logo: { text: "YouTube", style: "word", icon: "play", font: "arial", weight: 700, track: "-.07em", size: 1.3 },
    nav: ["Home", "Shorts", "Subscriptions", "You", "History"],
    links: ["Music", "Trending", "Gaming", "News", "Shorts", "YouTube TV"], legal: "Google LLC",
    voice: "YouTube: clickable video titles (some in Title Case, a few with emoji), channel names, view counts and ages ('1.2M views · 3 days ago'), timestamps in descriptions, chatty comments with likes." },
  { name: "Twitch", host: "www.twitch.tv", aka: ["twitch", "twitch.tv"], arch: "video",
    title: "Twitch", about: "Twitch is the world's leading video platform and community for gamers.",
    colors: { acc: "#9146ff", bg: "#0e0e10", head: "#18181b", headFg: "#efeff1", fg: "#efeff1", link: "#bf94ff", dark: true }, fonts: ["helvetica", "helvetica"],
    logo: { text: "twitch", style: "word", font: "arialblack", color: "#9146ff", italic: true, size: 1.4, track: "-.03em" },
    nav: ["Following", "Browse", "Esports", "Music"],
    links: ["Browse", "Esports", "Just Chatting", "Music", "Twitch Turbo", "Creator Camp"], legal: "Twitch Interactive, Inc.",
    voice: "Twitch: live streams with LIVE badges and viewer counts, streamer handles, game categories, emote-heavy chat." },
  { name: "Vimeo", host: "vimeo.com", aka: ["vimeo"], arch: "video",
    title: "Vimeo: Video hosting, editing, & marketing", about: "Vimeo is the world's most innovative video experience platform. We enable anyone to create high-quality video experiences.",
    colors: { acc: "#17d5ff", head: "#ffffff", headFg: "#1a2e3b", fg: "#1a2e3b", link: "#0a81c4" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "vimeo", style: "word", font: "arialblack", italic: true, color: "#1ab7ea", size: 1.5, track: "-.03em" },
    nav: ["Features", "Solutions", "Resources", "Watch", "Pricing"],
    links: ["Watch", "Staff Picks", "Pricing", "Features", "Enterprise", "Log in"], legal: "Vimeo.com, Inc.",
    voice: "Vimeo: filmmaker-grade short films, 'Staff Pick' laurels, credits and gear notes." },
  // ---- code ----
  { name: "GitHub", host: "github.com", aka: ["github", "github.com", "git hub"], arch: "codehost",
    title: "GitHub · Build and ship software on a single, collaborative platform", about: "Join the world's most widely adopted, AI-powered developer platform where millions of developers, businesses, and the largest open source community build software that advances humanity.",
    colors: { acc: "#0969da", head: "#0d1117", headFg: "#ffffff", fg: "#1f2328", muted: "#59636e", line: "#d1d9e0", link: "#0969da", buy: "#1f883d", buyFg: "#ffffff" }, fonts: ["segoe", "segoe"],
    logo: { text: "GitHub", style: "word", icon: "octo", font: "segoe", weight: 600, color: "#ffffff", size: 1.2 },
    nav: ["Product", "Solutions", "Resources", "Open Source", "Enterprise", "Pricing"],
    links: ["Sign in", "Explore", "Pricing", "Docs", "Copilot", "Enterprise"], legal: "GitHub, Inc.",
    voice: "GitHub: developer-to-developer; READMEs with badges, install commands in code blocks, semantic-version releases, issue threads with reproduction steps, commit messages like 'fix: debounce resize handler (#482)'." },
  { name: "GitLab", host: "gitlab.com", aka: ["gitlab"], arch: "codehost",
    title: "The most-comprehensive AI-powered DevSecOps platform | GitLab", about: "From planning to production, bring teams together in one application. Ship secure code more efficiently to deliver value faster.",
    colors: { acc: "#fc6d26", head: "#171321", headFg: "#ffffff", fg: "#28272d", muted: "#626168", line: "#dcdcde", link: "#1f75cb", buy: "#1f75cb", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "GitLab", style: "word", icon: "tanuki", font: "helvetica", weight: 700, color: "#ffffff", size: 1.2 },
    nav: ["Platform", "Solutions", "Pricing", "Resources", "Company", "Docs"],
    links: ["Sign in", "Pricing", "Explore projects", "Docs", "Get free trial", "Blog"], legal: "GitLab B.V.",
    voice: "GitLab: DevSecOps teams, merge requests, pipelines with job statuses, epics and milestones." },
  // ---- Q&A ----
  { name: "Stack Overflow", host: "stackoverflow.com", aka: ["stack overflow", "stackoverflow", "stack overflow questions"], arch: "qa",
    title: "Stack Overflow - Where Developers Learn, Share, & Build Careers", about: "Stack Overflow is the largest, most trusted online community for developers to learn, share their programming knowledge, and build their careers.",
    colors: { acc: "#f48225", head: "#ffffff", headFg: "#232629", fg: "#232629", muted: "#6a737c", line: "#e3e6e8", link: "#0074cc", buy: "#0a95ff", buyFg: "#ffffff" }, fonts: ["segoe", "segoe"],
    logo: { text: "stack overflow", style: "word", icon: "tray", font: "segoe", weight: 400, color: "#232629", size: 1.25, bold: "overflow" },
    nav: ["Home", "Questions", "Tags", "Users", "Companies", "Labs", "Jobs"],
    links: ["Questions", "Tags", "Users", "Companies", "Ask Question", "Jobs"], legal: "Stack Exchange Inc",
    voice: "Stack Overflow: precise technical questions with code samples and error messages; terse expert answers with code blocks, 'This works because…', comments asking for a minimal reproducible example; tags like [python] [async]." },
  { name: "Quora", host: "www.quora.com", aka: ["quora"], arch: "qa",
    title: "Quora - A place to share knowledge and better understand the world", about: "Quora is a place to gain and share knowledge. It's a platform to ask questions and connect with people who contribute unique insights and quality answers.",
    colors: { acc: "#b92b27", head: "#ffffff", headFg: "#282829", fg: "#282829", muted: "#636466", line: "#dee0e1", link: "#2e69ff", bg: "#f1f2f2", buy: "#2e69ff", buyFg: "#ffffff" }, fonts: ["helvetica", "georgia"],
    logo: { text: "Quora", style: "word", font: "georgia", weight: 700, color: "#b92b27", size: 1.6 },
    nav: ["Home", "Following", "Answer", "Spaces", "Notifications"],
    links: ["Spaces", "Answer", "Following", "Log in", "Careers", "About"], legal: "Quora, Inc.",
    voice: "Quora: first-person expert answers with credentials ('Former NASA engineer'), upvote counts, long personal anecdotes." },
  // ---- product brands ----
  { name: "Apple", host: "www.apple.com", aka: ["apple.com", "apple store", "apple support", "apple inc"], exact: ["apple"],
    context: ["iphone", "ipad", "mac", "macbook", "airpods", "watch", "vision", "store", "support", "music", "tv", "pro", "imac", "homepod"], arch: "productbrand",
    title: "Apple", about: "Discover the innovative world of Apple and shop everything iPhone, iPad, Apple Watch, Mac, and Apple TV, plus explore accessories, entertainment, and expert device support.",
    colors: { acc: "#0071e3", head: "#fafafc", headFg: "#1d1d1f", fg: "#1d1d1f", muted: "#6e6e73", panel: "#f5f5f7", link: "#0066cc" }, fonts: ["sans", "sans"],
    logo: { text: "", style: "word", icon: "apple" },
    nav: ["Store", "Mac", "iPad", "iPhone", "Watch", "Vision", "AirPods", "TV & Home", "Entertainment", "Accessories", "Support"],
    links: ["iPhone", "Mac", "iPad", "Watch", "Support", "Store"], legal: "Apple Inc.",
    voice: "Apple: minimal, confident marketing copy; one-line product taglines ('Thin. Fast. Unbelievably light.'), 'Learn more' and 'Buy' links, footnoted claims, spec comparisons." },
  { name: "Microsoft", host: "www.microsoft.com", aka: ["microsoft", "microsoft.com"], arch: "productbrand",
    title: "Microsoft – AI, Cloud, Productivity, Computing, Gaming & Apps", about: "Explore Microsoft products and services and support for your home or business. Shop Microsoft 365, Copilot, Teams, Xbox, Windows, Azure, Surface and more.",
    colors: { acc: "#0067b8", head: "#ffffff", headFg: "#262626", fg: "#262626", link: "#0067b8" }, fonts: ["segoe", "segoe"],
    logo: { text: "Microsoft", style: "word", icon: "windows", font: "segoe", weight: 600, color: "#737373", size: 1.3 },
    nav: ["Microsoft 365", "Teams", "Copilot", "Windows", "Surface", "Xbox", "Deals", "Small Business", "Support"],
    links: ["Microsoft 365", "Windows", "Surface", "Xbox", "Copilot", "Support"], legal: "Microsoft",
    voice: "Microsoft: clear, friendly enterprise-and-home marketing; product tiles with 'Shop now' and 'Learn more', Copilot everywhere." },
  { name: "Samsung", host: "www.samsung.com", aka: ["samsung", "samsung.com"], arch: "productbrand",
    title: "Samsung US | Mobile | TV | Home Electronics | Home Appliances", about: "Discover the latest in electronics, mobile devices, home appliances and more from Samsung.",
    colors: { acc: "#1428a0", head: "#ffffff", headFg: "#000000", fg: "#000000", link: "#1428a0" }, fonts: ["arial", "arial"],
    logo: { text: "SAMSUNG", style: "word", font: "arialblack", color: "#1428a0", track: ".12em", size: 1.15 },
    nav: ["Shop", "Mobile", "TV & Audio", "Appliances", "Computing & Displays", "Accessories", "SmartThings", "AI"],
    links: ["Mobile", "TV & Audio", "Appliances", "Offers", "Support", "Galaxy AI"], legal: "Samsung Electronics Co., Ltd.",
    voice: "Samsung: bold tech launches, Galaxy product names, trade-in offers, feature callouts with specs." },
  { name: "Tesla", host: "www.tesla.com", aka: ["tesla.com", "tesla motors", "tesla cars"], exact: ["tesla"], context: ["model", "cybertruck", "powerwall", "supercharger", "car", "cars", "order", "roadster", "semi"], arch: "productbrand",
    title: "Electric Cars, Solar & Clean Energy | Tesla", about: "Tesla is accelerating the world's transition to sustainable energy with electric cars, solar and integrated renewable energy solutions for homes and businesses.",
    colors: { acc: "#3e6ae1", head: "#ffffff", headFg: "#171a20", fg: "#171a20", muted: "#5c5e62", link: "#171a20" }, fonts: ["helvetica", "futura"],
    logo: { text: "TESLA", style: "word", font: "futura", weight: 500, track: ".45em", size: 1.05 },
    nav: ["Vehicles", "Energy", "Charging", "Discover", "Shop"],
    links: ["Model Y", "Model 3", "Cybertruck", "Powerwall", "Charging", "Demo Drive"], legal: "Tesla",
    voice: "Tesla: sparse spec-driven copy (range, 0-60, top speed), 'Order Now' and 'Demo Drive' buttons, full-bleed vehicle imagery." },
  // ---- classifieds ----
  { name: "craigslist", host: "sfbay.craigslist.org", domains: ["craigslist.org"], aka: ["craigslist", "craigs list", "craiglist", "cl sf"], arch: "classifieds",
    title: "craigslist: SF bay area jobs, apartments, for sale, services, community, and events", about: "craigslist provides local classifieds and forums for jobs, housing, for sale, services, local community, and events.",
    colors: { acc: "#800080", fg: "#222222", link: "#0000ee", line: "#cccccc" }, fonts: ["arial", "arial"],
    logo: { text: "craigslist", style: "word", font: "times", weight: 400, color: "#800080", size: 1.6 },
    nav: ["post to classifieds", "my account", "help", "safety", "terms", "privacy"],
    links: ["apts / housing", "for sale", "jobs", "services", "community", "gigs"], legal: "craigslist",
    voice: "craigslist: terse, lowercase, typo-prone ads by regular people; prices, neighbourhoods in parentheses, 'cash only', 'no lowballers', 'do NOT contact me with unsolicited services'." },
  // ---- social ----
  { name: "X", host: "x.com", domains: ["x.com", "twitter.com"], aka: ["twitter", "x.com", "twitter.com", "x twitter"], exact: ["x"], arch: "social",
    title: "X. It's what's happening / X", about: "From breaking news and entertainment to sports and politics, get the full story with all the live commentary.",
    colors: { acc: "#1d9bf0", bg: "#000000", fg: "#e7e9ea", muted: "#71767b", line: "#2f3336", head: "#000000", headFg: "#e7e9ea", link: "#1d9bf0", buy: "#eff3f4", buyFg: "#0f1419", dark: true }, fonts: ["sans", "sans"],
    logo: { text: "", style: "word", icon: "x" },
    nav: ["Home", "Explore", "Notifications", "Messages", "Grok", "Communities", "Premium", "Profile", "More"],
    links: ["Explore", "Trending", "Sign up", "Log in", "Premium", "Help Center"], legal: "X Corp.",
    voice: "X: short posts under 280 characters with @handles, hashtags, quote posts, reply/repost/like/view counts; hot takes and breaking-news posts." },
  { name: "Facebook", host: "www.facebook.com", aka: ["facebook", "fb", "facebook.com"], arch: "social",
    title: "Facebook - log in or sign up", about: "Log into Facebook to start sharing and connecting with your friends, family, and people you know.",
    colors: { acc: "#1877f2", bg: "#f0f2f5", panel: "#ffffff", head: "#ffffff", headFg: "#050505", fg: "#050505", muted: "#65676b", line: "#dadde1", link: "#1877f2", buy: "#1877f2", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "", style: "word", icon: "f" },
    nav: ["Home", "Friends", "Groups", "Marketplace", "Watch", "Memories", "Saved", "Events"],
    links: ["Log in", "Marketplace", "Groups", "Watch", "Messenger", "Create a Page"], legal: "Meta",
    voice: "Facebook: friends and family posts, group posts, life updates with reactions (👍❤️😆 1.2K), comment threads, Marketplace listings." },
  { name: "Instagram", host: "www.instagram.com", aka: ["instagram", "ig", "insta", "instagram.com"], arch: "social",
    title: "Instagram", about: "Create an account or log in to Instagram - Share what you're into with the people who get you.",
    colors: { acc: "#0095f6", bg: "#ffffff", fg: "#000000", muted: "#737373", line: "#dbdbdb", head: "#ffffff", headFg: "#000000", link: "#00376b", buy: "#0095f6", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "Instagram", style: "word", font: "script", weight: 400, size: 1.9 },
    nav: ["Home", "Search", "Explore", "Reels", "Messages", "Notifications", "Create", "Profile"],
    links: ["Log in", "Sign up", "Explore", "Reels", "Threads", "Help"], picturePosts: true, legal: "Meta",
    voice: "Instagram: photo-first posts with short captions, emoji and hashtags, likes counts, creators and brands, Reels." },
  { name: "LinkedIn", host: "www.linkedin.com", aka: ["linkedin", "linked in", "linkedin.com"], arch: "social",
    title: "LinkedIn: Log In or Sign Up", about: "1 billion members | Manage your professional identity. Build and engage with your professional network. Access knowledge, insights and opportunities.",
    colors: { acc: "#0a66c2", bg: "#f4f2ee", panel: "#ffffff", head: "#ffffff", headFg: "#000000", fg: "#000000", muted: "#666666", line: "#e0dfdc", link: "#0a66c2", buy: "#0a66c2", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "", style: "word", icon: "in" },
    nav: ["Home", "My Network", "Jobs", "Messaging", "Notifications"],
    links: ["Jobs", "People", "Learning", "Sign in", "Join now", "Top Companies"], legal: "LinkedIn Corporation",
    voice: "LinkedIn: professional updates and humblebrags ('I'm thrilled to announce…'), job changes, thought-leadership posts with line breaks, reactions and reposts." },
  // ---- streaming ----
  { name: "Netflix", host: "www.netflix.com", aka: ["netflix"], arch: "streaming",
    title: "Netflix - Watch TV Shows Online, Watch Movies Online", about: "Watch Netflix movies & TV shows online or stream right to your smart TV, game console, PC, Mac, mobile, tablet and more.",
    colors: { acc: "#e50914", bg: "#141414", panel: "#1f1f1f", fg: "#ffffff", muted: "#b3b3b3", line: "#333333", head: "#141414", headFg: "#e5e5e5", link: "#ffffff", dark: true }, fonts: ["helvetica", "helvetica"],
    logo: { text: "NETFLIX", style: "word", font: "cond", weight: 700, color: "#e50914", size: 1.9, track: ".01em" },
    nav: ["Home", "Shows", "Movies", "Games", "New & Popular", "My List", "Browse by Languages"],
    links: ["Sign In", "Plans", "New & Popular", "Games", "Help Center", "Gift Cards"], legal: "Netflix, Inc.",
    voice: "Netflix: bingeable originals with evocative one-line synopses, maturity ratings, match percentages ('97% Match'), season counts and genre tags ('Suspenseful · Sci-Fi')." },
  { name: "Spotify", host: "open.spotify.com", domains: ["spotify.com"], aka: ["spotify"], arch: "streaming",
    title: "Spotify - Web Player: Music for everyone", about: "Spotify is a digital music service that gives you access to millions of songs.",
    colors: { acc: "#1ed760", bg: "#121212", panel: "#181818", fg: "#ffffff", muted: "#b3b3b3", line: "#2a2a2a", head: "#000000", headFg: "#ffffff", link: "#ffffff", dark: true }, fonts: ["helvetica", "helvetica"],
    logo: { text: "Spotify", style: "word", icon: "note", font: "helvetica", weight: 700, color: "#ffffff", size: 1.35, track: "-.03em" },
    nav: ["Home", "Search", "Your Library"],
    links: ["Web Player", "Premium", "Download", "Support", "Podcasts", "Playlists"], sidebar: true, legal: "Spotify AB",
    voice: "Spotify: playlists and albums with track lists (title, artist, plays, duration), 'Made for you' mixes, podcast episodes, artist bios with monthly listeners." },
  { name: "IMDb", host: "www.imdb.com", aka: ["imdb"], arch: "streaming",
    title: "IMDb: Ratings, Reviews, and Where to Watch the Best Movies & TV Shows", about: "IMDb is the world's most popular and authoritative source for movie, TV and celebrity content. Find ratings and reviews for the newest movie and TV shows.",
    colors: { acc: "#f5c518", bg: "#000000", panel: "#1f1f1f", fg: "#ffffff", muted: "#c5c5c5", line: "#333333", head: "#121212", headFg: "#ffffff", link: "#5799ef", dark: true }, fonts: ["roboto", "roboto"],
    logo: { text: "IMDb", style: "block", bg: "#f5c518", fg: "#000000", font: "arialblack", track: "-.03em" },
    nav: ["Movies", "TV Shows", "Watch", "Awards & Events", "Celebs", "Community"],
    links: ["Top 250 Movies", "Most Popular Movies", "Coming Soon", "Box Office", "Oscars", "IMDbPro"], legal: "IMDb.com, Inc.",
    voice: "IMDb: title pages with year, runtime, rating (★ 8.1/10, 214K), cast lists with character names, trivia and goofs, user reviews." },
  { name: "Disney+", host: "www.disneyplus.com", aka: ["disney plus", "disney+", "disneyplus"], arch: "streaming",
    title: "Disney+ | Stream Disney, Marvel, Pixar, Star Wars, Nat Geo", about: "Stream the latest releases from Disney, Pixar, Marvel, Star Wars, National Geographic and more.",
    colors: { acc: "#0063e5", bg: "#0e1119", panel: "#1a1d29", fg: "#f9f9f9", muted: "#cacaca", line: "#2b2f3d", head: "#0e1119", headFg: "#f9f9f9", link: "#f9f9f9", dark: true }, fonts: ["avenir", "avenir"],
    logo: { text: "Disney+", style: "word", font: "script", weight: 700, color: "#ffffff", size: 1.8 },
    nav: ["Home", "Search", "Watchlist", "Movies", "Series", "Originals"],
    links: ["Sign up", "Log in", "Marvel", "Star Wars", "Pixar", "National Geographic"], legal: "Disney and its related entities",
    voice: "Disney+: family franchises, Marvel and Star Wars series, Pixar shorts; warm, magical synopses." },
  // ---- landing pages ----
  { name: "OpenAI", host: "openai.com", aka: ["openai", "open ai"], arch: "landing",
    title: "OpenAI", about: "We believe our research will eventually lead to artificial general intelligence, a system that can solve human-level problems.",
    colors: { acc: "#000000", head: "#ffffff", headFg: "#000000", fg: "#0d0d0d", link: "#0d0d0d", buy: "#000000", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "OpenAI", style: "word", icon: "knot", font: "helvetica", weight: 600, size: 1.2 },
    nav: ["Research", "Products", "Safety", "Company", "News"],
    links: ["ChatGPT", "API Platform", "Research", "Safety", "Careers", "News"], legal: "OpenAI",
    voice: "OpenAI: calm, minimal research-lab tone; model names, safety notes, product announcements with dates." },
  { name: "Anthropic", host: "www.anthropic.com", aka: ["anthropic"], arch: "landing",
    title: "Home \\ Anthropic", about: "Anthropic is an AI safety and research company that's working to build reliable, interpretable, and steerable AI systems.",
    colors: { acc: "#d97757", bg: "#faf9f5", head: "#faf9f5", headFg: "#141413", fg: "#141413", muted: "#5e5d59", link: "#141413", buy: "#141413", buyFg: "#faf9f5" }, fonts: ["helvetica", "georgia"],
    logo: { text: "ANTHROPIC", style: "word", font: "helvetica", weight: 600, track: ".14em", size: 1 },
    nav: ["Research", "Economic Futures", "Commitments", "Learn", "News", "Try Claude"],
    links: ["Claude", "Research", "Company", "Careers", "News", "API"], legal: "Anthropic PBC",
    voice: "Anthropic: thoughtful, careful safety-research voice; serif headlines, model and research announcements, measured claims." },
  { name: "Notion", host: "www.notion.com", domains: ["notion.com", "notion.so"], aka: ["notion.so", "notion app", "notion.com"], exact: ["notion"], arch: "landing",
    title: "The AI workspace that works for you. | Notion", about: "A collaborative AI workspace, built on your company context. Build and orchestrate agents right alongside your team's projects, meetings, and connected apps.",
    colors: { acc: "#0075de", head: "#ffffff", headFg: "#191919", fg: "#191919", link: "#191919", buy: "#0075de", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "Notion", style: "word", icon: "nbox", font: "helvetica", weight: 700, size: 1.2 },
    nav: ["Product", "AI", "Solutions", "Resources", "Enterprise", "Pricing"],
    links: ["Pricing", "Templates", "Download", "Log in", "Enterprise", "Help"], legal: "Notion Labs, Inc.",
    voice: "Notion: playful-minimal productivity copy, hand-drawn illustration vibes, templates, wikis and docs." },
  { name: "Slack", host: "slack.com", aka: ["slack.com", "slack app"], exact: ["slack"], arch: "landing",
    title: "AI Work Management & Productivity Tools | Slack", about: "Slack is where work happens. Bring your people, projects, tools, and AI together on the world's most popular work operating system.",
    colors: { acc: "#611f69", head: "#4a154b", headFg: "#ffffff", fg: "#1d1c1d", link: "#1264a3", buy: "#611f69", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "slack", style: "word", icon: "hash", font: "helvetica", weight: 800, color: "#ffffff", size: 1.45, track: "-.03em" },
    nav: ["Features", "Solutions", "Enterprise", "Resources", "Pricing"],
    links: ["Pricing", "Features", "Download", "Sign in", "Enterprise", "Help Center"], legal: "Slack Technologies, LLC",
    voice: "Slack: upbeat workplace copy, channels like #launch-crew, huddles, customer logos and stats." },
  { name: "Stripe", host: "stripe.com", aka: ["stripe.com", "stripe payments"], exact: ["stripe"], arch: "landing",
    title: "Stripe | Financial Infrastructure to Grow Your Revenue", about: "Stripe is a financial services platform that helps all types of businesses accept payments, build flexible billing models, and manage money movement.",
    colors: { acc: "#635bff", head: "#ffffff", headFg: "#0a2540", fg: "#0a2540", muted: "#425466", link: "#635bff", buy: "#635bff", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "stripe", style: "word", font: "helvetica", weight: 800, color: "#635bff", size: 1.5, track: "-.04em" },
    nav: ["Products", "Solutions", "Developers", "Resources", "Pricing"],
    links: ["Pricing", "Docs", "Payments", "Billing", "Sign in", "Contact sales"], legal: "Stripe, Inc.",
    voice: "Stripe: crisp developer-and-finance copy, API snippets, volume stats, gradient-mesh confidence." },
  { name: "Discord", host: "discord.com", aka: ["discord.com", "discord app"], exact: ["discord"], arch: "landing",
    title: "Discord - Group Chat That's All Fun & Games", about: "Discord is great for playing games and chilling with friends, or even building a worldwide community.",
    colors: { acc: "#5865f2", bg: "#ffffff", head: "#5865f2", headFg: "#ffffff", fg: "#23272a", link: "#5865f2", buy: "#5865f2", buyFg: "#ffffff" }, fonts: ["helvetica", "arialblack"],
    logo: { text: "Discord", style: "word", font: "arialblack", color: "#ffffff", size: 1.3, track: "-.03em" },
    nav: ["Download", "Nitro", "Discover", "Safety", "Quests", "Support"],
    links: ["Download", "Nitro", "Discover", "Safety", "Log in", "Support"], legal: "Discord Inc.",
    voice: "Discord: playful gamer-friendly copy, servers, voice channels, Nitro perks." },
  { name: "Duolingo", host: "www.duolingo.com", aka: ["duolingo"], arch: "landing",
    title: "Duolingo - The world's best way to learn a language", about: "With Duolingo, you can learn languages for free with bite-size lessons based on science.",
    colors: { acc: "#58cc02", head: "#ffffff", headFg: "#4b4b4b", fg: "#4b4b4b", link: "#1cb0f6", buy: "#58cc02", buyFg: "#ffffff" }, fonts: ["rounded", "rounded"],
    logo: { text: "duolingo", style: "word", font: "rounded", weight: 800, color: "#58cc02", size: 1.7, track: "-.02em" },
    nav: ["Learn", "Schools", "Math", "Music", "Chess", "Super"],
    links: ["Get started", "Log in", "Super Duolingo", "Schools", "Math", "Music"], legal: "Duolingo",
    voice: "Duolingo: cheeky owl mascot energy, streaks, XP, leagues, bite-size lessons." },
  { name: "PayPal", host: "www.paypal.com", aka: ["paypal"], arch: "landing",
    title: "PayPal: Pay, Send and Save Money", about: "PayPal is the faster, safer way to send and receive money or make an online payment. Get started or create a merchant account to accept payments.",
    colors: { acc: "#0070e0", head: "#ffffff", headFg: "#001c64", fg: "#001435", link: "#0070e0", buy: "#003087", buyFg: "#ffffff" }, fonts: ["helvetica", "helvetica"],
    logo: { text: "PayPal", style: "word", colors: ["#003087", "#003087", "#003087", "#0070e0", "#0070e0", "#0070e0"], font: "helvetica", weight: 800, italic: true, size: 1.5 },
    nav: ["Personal", "Business", "Developer", "Help"],
    links: ["Log In", "Sign Up", "Personal", "Business", "Send Money", "Help"], legal: "PayPal",
    voice: "PayPal: reassuring payments copy, buyer protection, send and receive money, business checkout." },
];

// ---------- lookup ----------
const hostKey = (h) => String(h ?? "").toLowerCase().replace(/^(?:www|m|mobile|amp)\./, "").replace(/\.$/, "");
const SITES = B.map((b) => ({ ...b, key: b.key ?? hostKey(b.host), domains: b.domains ?? [hostKey(b.host)] }));
const byDomain = new Map(SITES.flatMap((b) => b.domains.map((d) => [d, b])));

// The curated site a host belongs to: its own domain, or any subdomain of it
// (en.wikipedia.org, old.reddit.com, edition.cnn.com, oakland.craigslist.org).
export function knownSite(host) {
  let h = hostKey(host);
  for (;;) {
    const hit = byDomain.get(h);
    if (hit) return hit;
    const dot = h.indexOf(".");
    if (dot === -1 || h.indexOf(".", dot + 1) === -1) return null;
    h = h.slice(dot + 1);
  }
}

export const SITE_COUNT = SITES.length;

// ---------- queries that name a site ----------
// Words that ask for a site rather than add a topic: "cnn website", "reddit login".
const FILLER = /\b(?:official|website|web ?site|site|homepage|home ?page|login|log ?in|sign ?in|app|online|www|dot com|com|the|page|main|link|url)\b/g;
const NEWSY = /\b(?:news|latest|live|today|breaking|headlines|top stories)\b/g;
const norm = (q) => String(q ?? "").toLowerCase().replace(/[“”"'’]/g, "").replace(/[^\p{L}\p{N}.+&\s-]/gu, " ").replace(/\s+/g, " ").trim();
const words = (s) => s.split(" ").filter(Boolean);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest names first, so "fox news" wins over a bare "fox".
const NAMES = SITES.flatMap((b) => [
  ...(b.aka ?? []).map((a) => ({ name: a, site: b, exact: false })),
  ...(b.exact ?? []).map((a) => ({ name: a, site: b, exact: true })),
]).sort((a, z) => z.name.length - a.name.length).map((n) => ({ ...n, re: new RegExp(`(?:^|\\s)${escRe(n.name)}(?=\\s|$)`) }));

const topicOf = (rest, site) => {
  let t = rest.replace(FILLER, " ");
  if (site.arch === "newsportal" || site.arch === "newspaper") t = t.replace(NEWSY, " ");
  return t.replace(/\s+/g, " ").trim();
};

// The known site a query names, and what else it asks for: "cnn" is CNN's
// home page; "reddit sourdough" and "sourdough wiki" are pages on those
// sites. A domain in the query ("amazon.com kindle") always counts. Common
// words that are also brands (apple, target, x) only count alone ("apple",
// "apple website") or with one of the site's own words ("apple iphone").
export function siteForQuery(query) {
  const q = norm(query);
  if (!q) return null;
  const dom = q.match(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,})(?=\s|$)/);
  if (dom) {
    const site = knownSite(dom[1]);
    if (site) return { site, topic: topicOf(q.replace(dom[0], " "), site) };
  }
  for (const n of NAMES) {
    if (!n.re.test(q)) continue;
    const topic = topicOf(q.replace(n.re, " "), n.site);
    if (n.exact && topic && !words(topic).some((w) => n.site.context?.includes(w))) continue;
    return { site: n.site, topic };
  }
  return null;
}

// Known sites whose name starts with what is being typed ("red" -> Reddit),
// for the address bar's suggestions as the text grows; whole names go through
// siteForQuery. While the text could still be one of a site's everyday-word
// names ("app" for apple), it doesn't count. Shortest match first.
export function sitesStartingWith(text, limit = 3) {
  const q = norm(text);
  if (q.length < 2 || q.includes(" ")) return [];
  const hits = NAMES.filter((n) => !n.exact && n.name.length > q.length && n.name.startsWith(q) && !n.site.exact?.some((e) => e.startsWith(q)))
    .sort((a, z) => a.name.length - z.name.length);
  return [...new Set(hits.map((n) => n.site))].slice(0, limit);
}

// ---------- long-tail sites: a brand spec from the model ----------
// Any real site not in the table gets a spec in the same shape, written once
// per domain and cached. Only asked for when Jev or the results page says the
// domain is a real, well-known site, so invented sites never pay for it.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const clip = (s, n) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

export function brandSpecPrompt(domain) {
  return {
    system: `You describe the visual identity of a real, well-known website so a renderer can imitate it (its look, not its content). Output ONE compact JSON object and nothing else:
{"known": true, "name": "Letterboxd", "arch": "community", "bg": "#14181c", "fg": "#ffffff", "accent": "#00e054", "header": "#14181c", "headerText": "#99aabb", "font": "sans", "logo": "Letterboxd", "logoCase": "none", "logoColor": "#ffffff", "logoWeight": 700, "nav": ["Films", "Lists", "Members", "Journal"], "tagline": "Track films you've watched.", "voice": "one sentence on how the site's content reads"}
- known: false if you do not recognise the domain as a real, widely used site (then output only {"known": false}).
- name: the site's own brand name, cased as the site writes it.
- arch: the page structure it has, one of: newsportal (TV/online news with headline rails), newspaper (print masthead), community (subreddit-style posts and comments), linkboard (dense ranked link list), encyclopedia (wiki articles), marketplace (shop: product pages with a buy box, listings), video (video grid and watch pages), codehost (repositories), qa (questions and voted answers), productbrand (a company's product marketing), classifieds (plain listing directory), social (feed of posts), streaming (dark rows of titles to watch or play), landing (a service's marketing site).
- Colours are the site's real brand colours as #rrggbb: bg page, fg text, accent brand colour, header bar and its text, logoColor the wordmark.
- font: its typeface feel, one of: ${BRAND_FONTS.join(", ")}.
- logoCase: none, lower or upper. nav: 4-8 of its real top navigation labels.`,
    user: `Domain: ${domain}`,
  };
}

// A model's spec becomes a table entry. Everything is checked: colours must
// be hex, names become plain text, unknown choices fall back.
export function parseBrandSpec(raw, domain) {
  let o = raw;
  if (typeof raw === "string") { try { o = extractJSON(raw); } catch { return null; } }
  if (!o || typeof o !== "object" || o.known !== true) return null;
  const hex = (v, d) => (HEX.test(String(v ?? "").trim()) ? String(v).trim().toLowerCase() : d);
  const name = clip(o.name, 32) || hostKey(domain).split(".")[0];
  const bg = hex(o.bg, "#ffffff");
  const fg = hex(o.fg, "#111111");
  const acc = hex(o.accent, "#1a73e8");
  const logoCase = ["lower", "upper"].includes(o.logoCase) ? o.logoCase : "none";
  const text = logoCase === "lower" ? name.toLowerCase() : logoCase === "upper" ? name.toUpperCase() : name;
  const weight = Math.min(900, Math.max(300, Math.round((Number(o.logoWeight) || 700) / 100) * 100));
  const nav = (Array.isArray(o.nav) ? o.nav : []).map((n) => clip(n, 24)).filter(Boolean).slice(0, 8);
  return {
    name, host: String(domain).toLowerCase(), key: hostKey(domain), domains: [hostKey(domain)], generated: true,
    arch: ARCHES.includes(o.arch) ? o.arch : "landing",
    title: name, about: clip(o.tagline, 160),
    colors: { bg, fg, acc, head: hex(o.header, bg), headFg: hex(o.headerText, fg) },
    fonts: [BRAND_FONTS.includes(o.font) ? o.font : "sans", BRAND_FONTS.includes(o.font) ? o.font : "sans"],
    logo: { text, style: "word", color: hex(o.logoColor, acc), weight, size: 1.4 },
    nav: nav.length ? nav : undefined,
    voice: clip(`${name}: ${clip(o.voice, 220)}`, 260),
  };
}

// domain -> Promise<spec | null>. A failed call is forgotten so a later page
// can try again; a "not a site I know" answer is kept.
const learned = new Map();
const LEARNED_MAX = 500;
export const learnedSite = (domain) => learned.get(hostKey(domain))?.value ?? null;
// A spec already being written (a results page marked the site real).
export const learningSite = (domain) => learned.get(hostKey(domain))?.promise ?? null;

export function learnSite(domain, { complete = completeText } = {}) {
  const key = hostKey(domain);
  const hit = learned.get(key);
  if (hit) return hit.promise;
  const entry = { value: null };
  entry.promise = complete({ ...brandSpecPrompt(key), maxTokens: 320, temperature: 0.2 })
    .then((text) => { entry.value = parseBrandSpec(text, domain); console.log(`[brand] ${key}: ${entry.value ? `${entry.value.name} (${entry.value.arch})` : "not a known site"}`); return entry.value; })
    .catch((err) => { console.warn(`[brand] ${key}: ${err.message}`); learned.delete(key); return null; });
  if (learned.size >= LEARNED_MAX) learned.delete(learned.keys().next().value);
  learned.set(key, entry);
  return entry.promise;
}

export const hasModel = () => Boolean(config.apiKey);
