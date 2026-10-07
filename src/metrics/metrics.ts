import type { RequestHandler } from "express";
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const httpRequests = new Counter({
  name: "http_requests_total",
  help: "Total number of completed HTTP requests.",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegistry],
});

const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const collectHttpMetrics: RequestHandler = (req, res, next) => {
  if (req.path === "/metrics") {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const routePath = req.route?.path;
    const route =
      typeof routePath === "string"
        ? `${req.baseUrl}${routePath}` || "/"
        : "unmatched";
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequests.inc(labels);
    httpRequestDuration.observe(
      labels,
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000,
    );
  });
  next();
};

export async function renderMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

export function metricsContentType(): string {
  return metricsRegistry.contentType;
}
