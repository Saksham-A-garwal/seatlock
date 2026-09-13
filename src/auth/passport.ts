import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { config } from "../config";
import { prisma } from "../db/prisma";

passport.use(
  new GoogleStrategy(
    {
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
    },
    (_accessToken, _refreshToken, profile: Profile, done) => {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        done(new Error("Google profile did not include an email address"));
        return;
      }

      prisma.user
        .upsert({
          where: { email },
          update: { googleId: profile.id, emailVerified: true },
          create: { email, googleId: profile.id, emailVerified: true },
        })
        .then((user) => done(null, user))
        .catch((error) => done(error as Error));
    }
  )
);

export default passport;
