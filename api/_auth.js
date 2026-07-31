/* Auth.js configuration.

   JWT sessions, no database adapter. That is a deliberate choice: with a
   single OAuth provider there is nothing to link, so an adapter would add a
   users/accounts/sessions schema and a round trip to Postgres on every request
   in exchange for nothing the app uses. The session cookie carries the
   identity; Postgres only ever holds the synced document.

   Identity key is "google:<sub>". Google's `sub` is stable for the life of the
   account, unlike the email address, so changing your Gmail address does not
   orphan your data. */

import Google from "@auth/express/providers/google";

export const AUTH_BASE_PATH = "/api/auth";

export function authConfigured() {
  return !!(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

export const authConfig = {
  basePath: AUTH_BASE_PATH,
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 }, // 90 days: this is a phone app people open weekly
  providers: authConfigured()
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          // no refresh token needed — we never call Google APIs on the user's behalf
          authorization: { params: { prompt: "select_account" } },
        }),
      ]
    : [],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && account.provider) {
        token.mizanId = `${account.provider}:${account.providerAccountId || token.sub}`;
      }
      if (profile && profile.email) token.email = profile.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.mizanId || (token.sub ? `google:${token.sub}` : null);
      }
      return session;
    },
  },
  cookies: {
    sessionToken: {
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
};

/* The identity the sync endpoints key on. Returns null when unauthenticated. */
export function userIdFrom(session) {
  if (!session || !session.user) return null;
  return session.user.id || null;
}
