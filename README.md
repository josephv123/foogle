# Foogle

The fake/future Google. You use it exactly like Google: type a query, get a results page. The difference is that none of it exists — the search results are invented by an LLM, and when you click one, that webpage gets **vibe-coded on the spot**, streamed into your browser so you watch it build itself. Links inside generated pages route back through Foogle, so the fake internet is browsable forever.

## Setup

Requires Node.js 20.12+ for the launcher.

```sh
cp .env.example .env   # then put your API key in it
npm install
npm start  # Luna + Jev at http://localhost:3000
```

The default launcher uses GPT-6 Luna through OpenRouter for search results, page sections and ASCII images, with Jev choosing the page layout. Add `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` to `.env`. Without a TypeSafe key, Luna handles planning too.

Use `npm start -- --preset current` to honor a custom provider/model configuration. The table below describes that custom configuration.

Foogle is provider-agnostic: it speaks the OpenAI-compatible chat-completions API, so any provider works — OpenRouter (default), OpenAI, Ollama, LM Studio, etc.

| Env var | Default | Purpose |
|---|---|---|
| `LLM_API_KEY` (or `OPENROUTER_API_KEY`) | — | API key (required) |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | Any OpenAI-compatible endpoint |
| `FOOGLE_RESULTS_MODEL` | `anthropic/claude-haiku-4.5` | Fast model that invents search results |
| `FOOGLE_PAGE_MODEL` | `anthropic/claude-sonnet-4.5` | Model that vibe-codes the pages |
| `FOOGLE_IMAGE_MODEL` | `google/gemini-2.5-flash-image` | Image model (`chat`/`images` modes) or text model (`svg`/`ascii` modes, defaults to the page model) |
| `FOOGLE_IMAGE_API` | `chat` | `chat` = multimodal chat completion (OpenRouter style); `images` = OpenAI `/v1/images/generations`; `svg` = text LLM draws vector illustrations; `ascii` = text LLM draws ASCII art |
| `FOOGLE_REASONING` | `off` on OpenRouter, unset elsewhere | Reasoning control for thinking models: `off`, `low`, `medium`, `high`, or `default` (never send the param — for strict providers that reject unknown fields) |
| `FOOGLE_TEMP_RESULTS` | `1.2` | Temperature for search/news/image results — hot for diversity |
| `FOOGLE_TEMP_PAGES` | `1.0` | Temperature for page (and svg/ascii image) generation — neutral for reliable structure |
| `FOOGLE_IMAGE_CONCURRENCY` | `6` | Max parallel image generations |
| `PORT` | `3000` | |

`npm start` loads `.env` automatically. Override the default with `--preset`, `--mode`, or `FOOGLE_PRESET` / `FOOGLE_PAGE_MODE` in `.env`.

## How it works

- `GET /` — Google-clone homepage.
- `GET /search?q=…` — streams a results-page shell instantly, then asks the results model to invent ~9 fictional sites for the query, rendered one by one as they stream. "I'm Feeling Lucky" 302s straight to the first one.
- `GET /images?q=…` — image search: a grid of AI-generated pictures, each clicking through to the (generated) site it "came from".
- `GET /news?q=…` — Google News-style coverage of the query from invented outlets, with generated thumbnails.
- `GET /img/<description>` — on-demand image generation, used by the Images/News tabs and by `<img>` tags the page model writes. Cached; falls back to a gradient placeholder on failure.
- `GET /web/<domain>/<path>` — the fake web. On first visit, the page model generates a complete self-contained HTML page for that URL and streams it to your browser as it's written. Generated pages only link to other `/web/…` paths, so every click works.
- Pages and result pages are cached in memory (capped, FIFO), so the back button is instant and a fake site stays consistent within a session. Restarting the server wipes the fake internet — except images, which also persist to a disk cache (`.foogle-cache/`) since they're the most expensive asset. Delete that directory to regenerate them.


## Model experiments and Jev

Keep `OPENROUTER_API_KEY` in `.env`. Hosted presets use that key and override the
old local endpoint/model values for that process; they do not rewrite `.env`.

```sh
npm start -- --preset luna --mode jev --port 3010
npm start -- --preset mimo-pro --mode jev --jev-env /path/to/jev/.env --port 3010
npm start -- --preset free-laguna --mode jev --jev-env /path/to/jev/.env --port 3010
```

Presets: `current` (existing config), `mimo-flash`, `mimo-pro`, `deepseek`,
`gemini`, `luna`, `free-qwen`, `free-laguna`, `free-nemotron`, `free-gemma`. Pinned model IDs live in
`lib/presets.js`; availability is verified against OpenRouter's catalog by the
benchmark. Free endpoints can be rate-limited or unavailable. No paid fallback
is silently substituted for a free model. Hosted presets use ASCII images;
image-generation cost is separate from the text benchmarks.

Page modes (`FOOGLE_PAGE_MODE` or `--mode`):

| Mode | Pipeline | Tradeoff |
|---|---|---|
| `single` | One model generates complete HTML/CSS | Most freedom; CSS delays the first styled content |
| `planned` | Small text-model plan, existing CSS, three concurrent section calls | Less CSS generation, an extra planning call |
| `jev` (launcher default) | Jev chooses layout/style, code renders shell, three concurrent section calls | Fast styled shell, constrained layout vocabulary |

For Jev, set `TYPESAFE_API_KEY` in `.env`, or explicitly load a separate env file
with `--jev-env`. Keys stay server-side. Jev asks layout and visual-style questions
in one request. The hue derives from the domain. Low-confidence harmless styling
choices are accepted; these are preferences, not factual judgments. A 1.8-second
Jev deadline falls back to a text planner in `jev` mode. The planner falls back to
full-page generation if it fails. Partial/invalid sections are not cached.

## Repeatable comparison

```sh
npm run bench -- --jev-env /path/to/jev/.env
npm run bench -- --presets free-qwen,free-laguna,free-nemotron --modes single,jev --jev-env /path/to/jev/.env
npm run bench -- --presets mimo-flash,gemini --modes single,planned,jev --runs 3 --cases 3 --jev-env /path/to/jev/.env
npm test
```

Each run saves raw HTML/text and `report.json` under ignored `.foogle-bench/`.
Use `--out PATH --resume` to retain completed trials. Multiple models run in
isolated processes, at most three concurrently. Trials bypass app caches and use
fixed temperatures, 6,000 full-page tokens, 1,200 tokens per section, and three
sections. Every preset also gets a search-result trial. This is an experiment,
not an automatic production model switch.

The report records first valid search result / first emitted styled HTML with
visible content, completion time, provider-reported OpenRouter cost, Jev input
tokens, finish reasons, basic HTML checks and errors. Emission time is a server
proxy, **not browser paint time**. A template header counts as first content, so
compare completion time and review the saved HTML too. Generated images are not
fetched. Jev charges are not included in the OpenRouter cost; missing billing
usage stays unknown. Structural checks are not a visual-quality score. Small
samples are a screening test, not a reliable ranking of production latency.

See [EXPERIMENTS.md](EXPERIMENTS.md) for measured results and limitations.
