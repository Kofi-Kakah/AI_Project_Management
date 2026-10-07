import pinoHttp from "pino-http";
import pino from "pino";
import { logger } from "../utils/logger";

export function redactRequestUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export const requestLogger = pinoHttp({
  logger,
  serializers: {
    req: (req) => ({
      ...pino.stdSerializers.req(req),
      url: redactRequestUrl(req.url),
    }),
  },
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers.set-cookie",
  ],
});
