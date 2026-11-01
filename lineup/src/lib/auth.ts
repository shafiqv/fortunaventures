import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db, type User } from "./db";
import { appUrl, sendEmail } from "./notify";
import { APP_NAME } from "./brand";

const COOKIE = "lineup_session";
const secret = () => process.env.SESSION_SECRET ?? "dev-secret-change-me";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("hex");

export const newToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");

/** Email a one-time sign-in link (valid 20 min). Returns the link in non-production for convenience. */
export async function requestLogin(emailRaw: string): Promise<{ ok: boolean; devLink: string | null }> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, devLink: null };
  const token = newToken(32);
  db().prepare("DELETE FROM login_tokens WHERE expires_at < ?").run(Date.now());
  db().prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?,?,?)")
    .run(sha(token), email, Date.now() + 20 * 60_000);
  const link = `${appUrl()}/auth/verify?token=${token}`;
  await sendEmail(email, `Your ${APP_NAME} sign-in link`, `Click to sign in (expires in 20 minutes):\n\n${link}\n\nIf you didn't ask for this, ignore this email.`);
  // SHOW_LOGIN_LINK=1 is for a throwaway demo site only: it shows the sign-in link on screen instead of requiring email.
  return { ok: true, devLink: process.env.NODE_ENV !== "production" || process.env.SHOW_LOGIN_LINK === "1" ? link : null };
}

/** Consume a login token; returns the user (created if new) or null. */
export function consumeLogin(token: string): User | null {
  const row = db().prepare("SELECT email, expires_at FROM login_tokens WHERE token_hash = ?").get(sha(token)) as
    | { email: string; expires_at: number } | undefined;
  if (!row) return null;
  db().prepare("DELETE FROM login_tokens WHERE token_hash = ?").run(sha(token));
  if (row.expires_at < Date.now() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return null;
  db().prepare("INSERT OR IGNORE INTO users (email) VALUES (?)").run(row.email);
  return db().prepare("SELECT * FROM users WHERE email = ?").get(row.email) as User;
}

export async function startSession(userId: number) {
  const exp = Date.now() + 90 * 24 * 3600_000;
  const v = `${userId}.${exp}`;
  (await cookies()).set(COOKIE, `${v}.${sign(v)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(exp),
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  const [id, exp, sig] = c.split(".");
  const v = `${id}.${exp}`;
  const good = sig && sig.length === sign(v).length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(v)));
  if (!good || Number(exp) < Date.now()) return null;
  return (db().prepare("SELECT * FROM users WHERE id = ?").get(Number(id)) as User) ?? null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) { const { redirect } = await import("next/navigation"); redirect("/"); }
  return u!;
}
