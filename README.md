# Foogle

The fake/future Google. You use it exactly like Google: type a query, get a results page. The difference is that none of it exists — the search results are invented by an LLM, and when you click one, that webpage gets **vibe-coded on the spot**, streamed into your browser so you watch it build itself. Links inside generated pages route back through Foogle, so the fake internet is browsable forever.

## Setup

Requires Node.js 20.6+ for the `.env` command below.

```sh
cp .env.example .env   # then put your API key in it
npm install
node --env-file=.env server.js  # http://localhost:3000
```

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

`npm start` reads the environment directly — load `.env` with `node --env-file=.env server.js`, or export the vars yourself.

## How it works

- `GET /` — Google-clone homepage.
- `GET /search?q=…` — streams a results-page shell instantly, then asks the results model to invent ~9 fictional sites for the query, rendered one by one as they stream. "I'm Feeling Lucky" 302s straight to the first one.
- `GET /images?q=…` — image search: a grid of AI-generated pictures, each clicking through to the (generated) site it "came from".
- `GET /news?q=…` — Google News-style coverage of the query from invented outlets, with generated thumbnails.
- `GET /img/<description>` — on-demand image generation, used by the Images/News tabs and by `<img>` tags the page model writes. Cached; falls back to a gradient placeholder on failure.
- `GET /web/<domain>/<path>` — the fake web. On first visit, the page model generates a complete self-contained HTML page for that URL and streams it to your browser as it's written. Generated pages only link to other `/web/…` paths, so every click works.
- Pages and result pages are cached in memory (capped, FIFO), so the back button is instant and a fake site stays consistent within a session. Restarting the server wipes the fake internet — except images, which also persist to a disk cache (`.foogle-cache/`) since they're the most expensive asset. Delete that directory to regenerate them.
