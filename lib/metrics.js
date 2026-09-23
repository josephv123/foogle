import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage();
export function withMetrics(events, fn) { return context.run(events, fn); }
export function recordMetric(event) { context.getStore()?.push(event); }
