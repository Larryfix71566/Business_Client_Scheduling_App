import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      businessId: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    businessId: string;
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    businessId: string;
    role: Role;
  }
}
