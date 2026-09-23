// Preloaded by `npm test`. The suite tests the real model path and stubs the
// network itself, so the development switches (lib/fake-llm.js) must not leak
// in from a shell that exported them. Blank rather than deleted, so a child
// server's .env can't switch them back on either.
for (const name of ["FOOGLE_FAKE_LLM", "FOOGLE_LLM_CACHE"]) process.env[name] = "";
