import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Middleware uses the edge-safe config only (no Prisma).
// The authorized() callback in authConfig handles all redirect logic.
export default NextAuth(authConfig).auth;

export const config = {
  // Skip static assets, Next.js internals, and favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
