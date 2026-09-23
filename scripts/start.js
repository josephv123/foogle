import { parseArgs } from "node:util";
import { applyPreset } from "../lib/presets.js";

try { process.loadEnvFile(".env"); } catch (err) { if (err.code !== "ENOENT") throw err; }
const { values } = parseArgs({ options: {
  preset: { type: "string", default: process.env.FOOGLE_PRESET || "luna" },
  mode: { type: "string" }, port: { type: "string" }, "jev-env": { type: "string" },
} });
if (values["jev-env"]) process.loadEnvFile(values["jev-env"]);
applyPreset(values.preset);
process.env.FOOGLE_PAGE_MODE = values.mode || process.env.FOOGLE_PAGE_MODE || (values.preset === "current" ? "single" : "jev");
if (values.port) process.env.PORT = values.port;
await import("../server.js");
