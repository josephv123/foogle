import { parseArgs } from "node:util";

try { process.loadEnvFile(".env"); } catch (err) { if (err.code !== "ENOENT") throw err; }
const { values } = parseArgs({ options: { port: { type: "string" } } });
if (values.port) process.env.PORT = values.port;
await import("../server.js");
