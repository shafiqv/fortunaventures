import { NextRequest, NextResponse } from "next/server";
import { consumeLogin, startSession } from "@/lib/auth";

// Magic link landing. Requires a confirming POST so email-scanner prefetches can't burn the one-time token.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:16px">
  <h2>Sign in to Lineup</h2><form method="post"><input type="hidden" name="token" value="${token.replace(/[^\w-]/g, "")}">
  <button style="font:inherit;padding:12px 18px">Continue</button></form>`;
  return new NextResponse(html, { headers: { "content-type": "text/html" } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const user = consumeLogin(String(form.get("token") ?? ""));
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  if (!user) return NextResponse.redirect(new URL("/?expired=1", base), 303);
  await startSession(user.id);
  return NextResponse.redirect(new URL("/", base), 303);
}
