# Foogle

The fake/future Google. You use it exactly like Google: type a query, get a results page. The difference is that none of it exists — the search results are invented by an LLM, and when you click one, that webpage gets **vibe-coded on the spot**, streamed into your browser so you watch it build itself. Links inside generated pages route back through Foogle, so the fake internet is browsable forever.

## Setup

Requires Node.js 20.12+.

```sh
cp .env.example .env   # then put your keys in it
npm install
npm start              # http://localhost:3000 (--port N to change)
```

Foogle runs on one stack, the one that won the comparison in [EXPERIMENTS.md](EXPERIMENTS.md):

- **GPT-6 Luna via OpenRouter** writes the search results, the pages and the pictures. Set `OPENROUTER_API_KEY`.
- **Jev** picks each generated site's layout (kind and visual style). Set `TYPESAFE_API_KEY`. Without it, or if Jev takes over 1.8s, a site gets a default layout based on the kind of result you clicked.
- **Pictures are SVG illustrations** Luna draws (~6s and ~$0.0004 each). On a generated site they are drawn in that site's palette.

## How it works

- `GET /` — Google-clone homepage.
- `GET /search?q=…&page=N` — streams a results-page shell instantly, then asks the model (three concurrent shards) to invent ~9 fictional sites for the query, rendered one by one as they stream: site name and favicon, date, a type badge with a rich detail line (rating, price, answers, runtime) and sitelinks. A **Foogle Overview** panel (direct answer, key facts, People also ask) generates alongside and streams into the right-hand column without moving the results; related searches close the page. Pages 2–10 ("Foooooooooogle") dig into more niche sites. "I'm Feeling Lucky" 302s straight to the first one; with an empty box it picks a random query.
- `GET /images?q=…` — image search: a grid of AI-generated pictures, each clicking through to the (generated) site it "came from".
- `GET /news?q=…&page=N` — Google News-style coverage of the query from invented outlets, with generated thumbnails.
- `GET /maps?q=…` — a local pack of invented places (ratings, hours, addresses) beside a generated map with matching A–F pins.
- `GET /timelines?q=…` — a chronology of the query from its origins into the 2080s; future events are marked with filled dots.
- `GET /img/<description>` — on-demand SVG illustration, used by the Images/News/Maps tabs and by `<img>` tags in generated pages. Cached; falls back to a gradient placeholder on failure.
- `GET /web/<domain>/<path>` — the fake web. On first visit, Jev picks the layout, code renders the styled header at once, and four concurrent calls write the page's sections, streamed to your browser as they're written. Generated pages only link to other `/web/…` paths, so every click works. Query strings are part of the page (`/search?q=a` and `?q=b` are different pages), and form POSTs redirect to the equivalent GET, so search boxes on fake sites work. A site keeps the look of its first page, and its pictures are drawn in its palette (`/img/…?bg=&fg=`). The top two search results start generating as soon as they appear, so the likeliest clicks open instantly.
- Pages and result pages are cached in memory (capped, FIFO), so the back button is instant and a fake site stays consistent within a session. Restarting the server wipes the fake internet — except images, which also persist to a disk cache (`.foogle-cache/`) since they're the most expensive asset. Delete that directory to regenerate them.
## Deploy

Foogle deploys to Render's free web service tier from [`render.yaml`](render.yaml), a Render Blueprint. It builds with `npm ci`, starts with `npm start` on Node 22, health-checks `/` and redeploys on every push to `main`.

1. Create a dedicated OpenRouter key for the deployment at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). Give it a **credit limit** (a few dollars), so a runaway bill is impossible, and **no expiration date or a distant one**, so the site doesn't stop working without warning.
2. In the [Render dashboard](https://dashboard.render.com), click **New > Blueprint** and pick this repo (connect GitHub first if asked).
3. When prompted, paste `OPENROUTER_API_KEY` (the new key) and `TYPESAFE_API_KEY`, then click **Deploy Blueprint**.

The Blueprint also sets `TRUST_PROXY=1` (Render sits behind a proxy, so visitors are rate-limited by their real IP) and `DAILY_BUDGET_USD=1`. Change these under the service's **Environment** tab. Render asks for secrets only when the Blueprint is first created, so add any new ones there too.

On the free tier the service sleeps after 15 minutes without traffic, and the next visit takes up to about a minute to wake it. Its filesystem is ephemeral, so the image disk cache (`.foogle-cache/`) starts empty after each deploy or restart and only saves repeat work while the instance is up.

## Tests

```sh
npm test
```
