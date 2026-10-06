import { Router } from "express";
import { env } from "../../config/env";
import passport from "../../config/passport";
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

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, getCurrentUser);

authRouter.get("/verify-email", verifyEmail);
authRouter.post("/resend-verification", resendVerification);
authRouter.post("/forgot-password", requestPasswordReset);
authRouter.post("/reset-password", resetPassword);

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
