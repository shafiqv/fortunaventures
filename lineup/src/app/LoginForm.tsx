"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, { sent: false } as Awaited<ReturnType<typeof login>>);
  if (state.sent)
    return (
      <div className="card">
        <b>Check your email</b> for a sign-in link. It expires in 20 minutes.
        {state.devLink && <p className="mute">Dev mode link: <a href={state.devLink}>{state.devLink}</a></p>}
      </div>
    );
  return (
    <form action={action} className="card row">
      <input className="grow" type="email" name="email" placeholder="you@email.com" required autoComplete="email" />
      <button disabled={pending}>{pending ? "Sending…" : "Email me a sign-in link"}</button>
      {state.error && <div className="out">{state.error}</div>}
    </form>
  );
}
