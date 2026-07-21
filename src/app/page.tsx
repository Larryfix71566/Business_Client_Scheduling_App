import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";

export default async function Home() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  redirect(ctx.role === "ADMIN" ? "/admin" : "/dashboard");
}
