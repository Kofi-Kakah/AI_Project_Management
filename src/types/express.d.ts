declare module "cookie-parser" {
  import type { RequestHandler } from "express";
  function cookieParser(secret?: string, options?: { decode?(value: string): string }): RequestHandler;
  export default cookieParser;
}

declare namespace Express {
  interface Request { cookies: Record<string, string | undefined> }
}
