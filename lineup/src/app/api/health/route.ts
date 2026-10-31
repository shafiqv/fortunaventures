import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const n = (db().prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  return Response.json({ ok: true, users: n });
}
