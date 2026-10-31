# Lineup

Team availability, lineups and spare waitlists for recreational tennis/squash teams.

- Passwordless email sign-in (magic link); invite-only teams via join link or captain adding emails
- Captains import schedules (paste / CSV / .ics file / calendar-feed URL) and edit time & location per game
- Automatic weekly flow: availability request (default 5 business days before) → reminder → spares → lineup summary
- Players answer In / Maybe / Out from a one-tap link (no login); lineup fills by rank, extras sit out
- Spare waitlist: **rolling** (one at a time, expires) or **first come, first served**
- Email (Resend) + SMS (Twilio, opt-in only); without keys, messages print to the server console
- Calendar: subscribe (`webcal://`) or download `.ics` for a team, or add a single match from the reply page

## Run
    cp .env.example .env   # fill in
    npm install
    npm run dev            # http://localhost:3000   (sign-in link shown on screen in dev)
    npm test

## Production
Needs a Node host with a **persistent disk** for SQLite (Fly.io, Railway, Render). Set the env vars from `.env.example`,
and have a scheduler call `GET /api/cron?key=$CRON_SECRET` **hourly** — that drives every automatic email/text.
Canadian note: get explicit consent before texting (the profile page's opt-in checkbox) per CASL.
