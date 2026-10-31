import type { User } from "./db";

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function sendEmail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`\n[email → ${to}] ${subject}\n${text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
  });
  if (!res.ok) console.error("Email failed", res.status, await res.text());
}

export async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) {
    console.log(`\n[sms → ${to}] ${body}\n`);
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM ?? "", Body: body }),
  });
  if (!res.ok) console.error("SMS failed", res.status, await res.text());
}

/** Email always; SMS too when the person has a phone number and opted in (CASL consent). */
export async function notifyUser(
  u: Pick<User, "email" | "phone" | "sms_opt_in">,
  subject: string,
  text: string,
  smsText?: string,
) {
  await sendEmail(u.email, subject, text);
  if (u.phone && u.sms_opt_in) await sendSms(u.phone, smsText ?? `${subject}\n${text}`.slice(0, 300));
}
