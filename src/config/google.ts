import { GoogleGenAI } from "@google/genai";
import { env } from "./env";
import { AppError } from "../utils/AppError";

let client: GoogleGenAI | undefined;

export function getGoogleGenAIClient(): GoogleGenAI {
  if (!env.GLM_API_KEY) {
    throw new AppError("AI service is not configured", 503, "AI_UNAVAILABLE");
  }
  client ??= new GoogleGenAI({ apiKey: env.GLM_API_KEY });
  return client;
}
