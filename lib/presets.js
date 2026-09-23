// Verified against OpenRouter's /api/v1/models catalog on 2026-09-22.
export const presets = {
  "mimo-flash": { results: "xiaomi/mimo-v2.6-flash", page: "xiaomi/mimo-v2.6-flash" },
  "mimo-pro": { results: "xiaomi/mimo-v2.6-flash", page: "xiaomi/mimo-v2.6-pro" },
  deepseek: { results: "deepseek/deepseek-v4.1-flash", page: "deepseek/deepseek-v4.1-flash" },
  gemini: { results: "google/gemini-3.8-flash", page: "google/gemini-3.8-flash" },
  luna: { results: "openai/gpt-6-luna", page: "openai/gpt-6-luna" },
  "free-qwen": { results: "qwen/qwen3.8-27b:free", page: "qwen/qwen3.8-27b:free" },
  "free-laguna": { results: "poolside/laguna-xs-2.1:free", page: "poolside/laguna-xs-2.1:free" },
  "free-nemotron": { results: "nvidia/nemotron-3.5-lightning:free", page: "nvidia/nemotron-3.5-lightning:free" },
  "free-gemma": { results: "google/gemma-4-26b-a4b-it:free", page: "google/gemma-4-26b-a4b-it:free" },
};

export function applyPreset(name, env = process.env) {
  if (name === "current") return;
  const preset = presets[name];
  if (!preset) throw new Error(`Unknown preset ${name}. Choose current, ${Object.keys(presets).join(", ")}`);
  const key = env.OPENROUTER_API_KEY || (env.LLM_API_KEY?.startsWith("sk-or-") ? env.LLM_API_KEY : "");
  if (!key || key.includes("...")) throw new Error("Set a funded OPENROUTER_API_KEY in .env before using a hosted preset.");
  Object.assign(env, {
    LLM_API_KEY: key, LLM_BASE_URL: "https://openrouter.ai/api/v1",
    FOOGLE_RESULTS_MODEL: preset.results, FOOGLE_PAGE_MODEL: preset.page,
    FOOGLE_IMAGE_MODEL: preset.page, FOOGLE_IMAGE_API: "ascii",
    FOOGLE_RESULT_SHARDS: "1", FOOGLE_FAST_PAGES: "off", FOOGLE_REASONING: "off",
  });
}
