import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { AppError } from "../utils/AppError";

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError("AI service is not configured", 503, "AI_UNAVAILABLE");
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}
