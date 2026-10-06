import pinoHttp from "pino-http";
import { logger } from "../utils/logger";

export const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
});
