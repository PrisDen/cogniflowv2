// Edge-safe Auth.js config — no Prisma imports, used by middleware.
// Full config (with credentials provider + Prisma) lives in auth.ts.

import type { NextAuthConfig } from "next-auth";

const PROTECTED_PATHS = ["/dashboard", "/problems", "/session", "/gaps", "/settings"];
const AUTH_PATHS = ["/login", "/signup"];

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Already logged in → redirect away from auth pages to dashboard
      if (isLoggedIn && AUTH_PATHS.includes(pathname)) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      // Not logged in → redirect to login for protected routes
      if (!isLoggedIn && PROTECTED_PATHS.some((p) => pathname.startsWith(p))) {
        return false; // Auth.js sends to pages.signIn
      }

      return true;
    },
  },
  // Providers are registered in auth.ts — not needed here
  providers: [],
};
