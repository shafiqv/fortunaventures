import "./globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { currentUser } from "@/lib/auth";
import { logout } from "./actions";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `${APP_NAME} – team availability & spares`, description: "Weekly availability, lineups and spare waitlists for recreational tennis and squash teams." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link className="logo" href="/">🎾 {APP_NAME}</Link>
          {user && (
            <div className="row">
              <Link href="/profile" className="mute">{user.name || user.email}</Link>
              <form action={logout}><button className="ghost">Sign out</button></form>
            </div>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
