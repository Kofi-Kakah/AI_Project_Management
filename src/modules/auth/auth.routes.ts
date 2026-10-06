import { Router } from "express";
import { env } from "../../config/env";
import passport from "../../config/passport";
import {
  credentialsSchema,
  emailSchema,
  registerSchema,
  resetPasswordSchema,
  verificationTokenQuerySchema,
} from "./auth.schema";
import {
  getCurrentUser,
  googleAuthUnavailable,
  googleCallback,
  login,
  logout,
  refresh,
  register,
  requestPasswordReset,
  resetPassword,
  resendVerification,
  verifyEmail,
} from "./auth.controller";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";

export const authRouter = Router();

authRouter.post("/register", validate(registerSchema), register);
authRouter.post("/login", validate(credentialsSchema), login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, getCurrentUser);

authRouter.get("/verify-email", validate(verificationTokenQuerySchema, "query"), verifyEmail);
authRouter.post("/resend-verification", validate(emailSchema), resendVerification);
authRouter.post("/forgot-password", validate(emailSchema), requestPasswordReset);
authRouter.post("/reset-password", validate(resetPasswordSchema), resetPassword);

authRouter.get(
  "/google",
  googleAuthUnavailable,
  passport.authenticate("google", { session: false, scope: ["email", "profile"] }),
);
authRouter.get(
  "/google/callback",
  googleAuthUnavailable,
  passport.authenticate("google", {
    session: false,
    failureRedirect: new URL("/login?error=google_sign_in_failed", env.FRONTEND_URL).toString(),
  }),
  googleCallback,
);
