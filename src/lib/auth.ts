import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./db";
import type { Role } from "@prisma/client";
import type { TenantContext } from "./tenant";

// Credentials auth. Email is unique per-business, so a given email could exist
// in more than one business; we check the password against each match and log
// the session in as the first user whose password verifies.
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const candidates = await prisma.user.findMany({ where: { email } });
        for (const u of candidates) {
          if (await bcrypt.compare(password, u.passwordHash)) {
            return {
              id: u.id,
              email: u.email,
              name: u.name,
              businessId: u.businessId,
              role: u.role,
            };
          }
        }
        return null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.businessId = user.businessId;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.businessId = token.businessId as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
});

/** Resolve the current session into a TenantContext, or null if signed out. */
export async function getSessionContext(): Promise<TenantContext | null> {
  const session = await auth();
  if (!session?.user?.businessId || !session.user.id) return null;
  return {
    businessId: session.user.businessId,
    userId: session.user.id,
    role: session.user.role,
  };
}
