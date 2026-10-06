import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env } from "./env";
import { prisma } from "./db";

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({ clientID: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, callbackURL: env.GOOGLE_CALLBACK_URI }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.trim().toLowerCase();
      if (!email || profile.emails?.[0]?.verified !== true) return done(null, false, { message: "Google did not provide a verified email address" });
      let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
      if (!user) {
        user = await prisma.user.findUnique({ where: { email } });
        if (user) user = await prisma.user.update({ where: { id: user.id }, data: { googleId: profile.id, emailVerifiedAt: user.emailVerifiedAt ?? new Date(), avatarUrl: user.avatarUrl ?? profile.photos?.[0]?.value } });
        else user = await prisma.user.create({ data: { email, name: profile.displayName || email, googleId: profile.id, emailVerifiedAt: new Date(), avatarUrl: profile.photos?.[0]?.value } });
      }
      if (user.disabledAt) return done(null, false, { message: "Account disabled" });
      return done(null, user);
    } catch (error) { return done(error as Error); }
  }));
}

export default passport;
