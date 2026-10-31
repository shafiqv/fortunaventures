# Lineup

Team availability, lineups and spare waitlists for recreational tennis/squash teams.

- Passwordless email sign-in (magic link); invite-only teams via join link or captain adding emails
- Captains import schedules (paste / CSV / .ics file / calendar-feed URL) and edit time & location per game
- Automatic weekly flow: availability request (default 5 business days before) → reminder → spares → lineup summary
- Players answer In / Maybe / Out from a one-tap link (no login); lineup fills by rank, extras sit out
- Spare waitlist: **rolling** (one at a time, expires) or **first come, first served**
- Email (Resend) + SMS (Twilio, opt-in only); without keys, messages print to the server console
- Calendar: subscribe (`webcal://`) or download `.ics` for a team, or add a single match from the reply page

## Organizer admin (`/admin`) — multi-team leagues tied to Excel
- Create a league by pasting (or uploading .xlsx) the roster sheet: team-name rows followed by player names. Merged header cells are handled.
- **Generate the whole season** from a start date, number of weeks and holiday dates (repeating round-robin; holidays don't advance the cycle).
- **Lineup editor**: pick the pair for each court, add one-off subs by name, or let it fill automatically and then tweak. A placed player who drops out opens their slot and triggers sub offers.
- **Ratings**: enter court scores after each night; an Elo-style rating (score share, partner's and opponents' ratings) updates every player. Start ratings can be seeded per player. Court 1 = the two best available players, court 2 the next two, etc. Setting chooses who plays (fair rotation vs best-rated) when more than six are in.
- **Scoring** is best of 3 sets per court; the 3rd set is a 10-point match tie-break (counts as one game) unless all four play a full set. **Reliability**: a player cancelling within 48h after saying "in" is logged as a late cancel; the organizer ticks no-shows. The first of each is a warning, repeats lower the rating used for court order (−15 / −40); the organizer can forgive an entry.
- Schedule each week: pick the matchups, and set start time and number of courts **per matchup** (reduced-court weeks are normal). Editing a matchup updates both teams.
- Lineups rotate fairly: players who sat out most recently play first; everyone benched is the automatic sub list.
- Add emails/phones in one table (players are created by name; nothing is sent until an email exists). Signing in with that email links to the same player.
- **Download Excel**: `Rosters` (same layout as the source sheet) and `Lineups` (every match: lines, bench, out, no-reply).
- One click sends each player their own team's availability request.

## Run
    cp .env.example .env   # fill in
    npm install
    npm run dev            # http://localhost:3000   (sign-in link shown on screen in dev)
    npm test

## Production
Needs a Node host with a **persistent disk** for SQLite (Fly.io, Railway, Render). Set the env vars from `.env.example`,
and have a scheduler call `GET /api/cron?key=$CRON_SECRET` **hourly** — that drives every automatic email/text.
Canadian note: get explicit consent before texting (the profile page's opt-in checkbox) per CASL.
