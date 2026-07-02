import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// ---- Basic in-memory brute-force throttle (per email, per process) --------
// Slows password guessing without extra infrastructure. Resets on restart;
// for multi-instance production use a shared store (Redis) instead.
const MAX_FAILS = 5; // attempts before lockout
const WINDOW_MS = 15 * 60 * 1000; // sliding window / lockout duration
const attempts = new Map<string, { fails: number; lockedUntil: number }>();

function isLocked(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.lockedUntil > Date.now();
}
function recordFail(key: string): void {
  const now = Date.now();
  const a = attempts.get(key) ?? { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) a.lockedUntil = now + WINDOW_MS;
  attempts.set(key, a);
}
function clearFails(key: string): void {
  attempts.delete(key);
}

// `trustHost` is supported by NextAuth v4 at runtime but missing from its public
// type, so widen the annotation to allow it.
export const authOptions: NextAuthOptions & { trustHost?: boolean } = {
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  // Derive the site URL from the incoming request host instead of a hardcoded
  // NEXTAUTH_URL, so login works over localhost, the LAN IP, and the (changing)
  // Cloudflare tunnel alike. NEXTAUTH_URL is intentionally left unset in .env.
  trustHost: true,
  pages: {
    signIn: "/ru/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const key = credentials.email.toLowerCase();
        // Too many recent failures — refuse without touching the DB.
        if (isLocked(key)) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user) {
          recordFail(key);
          return null;
        }

        const ok = await bcrypt.compare(credentials.password, user.password);
        if (!ok) {
          recordFail(key);
          return null;
        }

        clearFails(key);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // @ts-expect-error custom field
        session.user.id = token.id;
        // @ts-expect-error custom field
        session.user.role = token.role;
      }
      return session;
    },
  },
};
