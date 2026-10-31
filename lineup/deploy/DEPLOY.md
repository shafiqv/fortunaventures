# Test deployment (Fly.io) — about 15 minutes

You need: a Fly.io account (fly.io, credit card required, a 1-GB volume + one small machine is a few dollars/month), and `flyctl` installed
(`brew install flyctl` or `curl -L https://fly.io/install.sh | sh`). Run everything below from the `lineup/` folder.

## 1. Create the app and its disk
```
fly auth login
fly launch --no-deploy --copy-config --config deploy/fly.toml.example   # pick your app name; keep region yyz (Toronto)
fly volumes create lineup_data --size 1 --region yyz
```

## 2. Set secrets
```
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)" CRON_SECRET="$(openssl rand -hex 24)"
# DEMO ONLY (fake data): shows the sign-in link on screen so you don't need email yet.
# Anyone who types an email gets signed in as that person — never leave this on once real players use it.
fly secrets set SHOW_LOGIN_LINK=1
```
Set `APP_URL` in the `[env]` block of the config to your app's URL (`https://<app>.fly.dev`) before deploying.

## 3. Deploy and load the fake league
```
fly deploy
fly ssh console -C "npm run seed"        # builds the demo league on the volume (refuses to wipe a database that has real users)
```
Open `https://<app>.fly.dev`, enter `demo-organizer@example.com`, click the sign-in link that appears.
Health check: `https://<app>.fly.dev/api/health`.

## 4. Make the weekly emails/texts fire
The app only sends on schedule when something calls `/api/cron` hourly. Easiest: copy `deploy/cron-workflow.yml.example` to
`.github/workflows/lineup-cron.yml` in the repo, then add two repo secrets: `LINEUP_URL` (https://<app>.fly.dev) and `CRON_SECRET` (the value from step 2).
(Don't enable this against the demo data if you add real email keys — it would email the fake `example.com` players. It's harmless without keys.)

## 5. Going from demo to real
1. `fly secrets unset SHOW_LOGIN_LINK`
2. Create a Resend account, verify your sending domain, then: `fly secrets set RESEND_API_KEY=... EMAIL_FROM="Lineup <no-reply@yourdomain.ca>"`
3. Optional texts: Twilio account + a Canadian number, then `fly secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1...`
4. Start from an empty database: `fly ssh console -C "rm /data/lineup.db*"` then `fly apps restart`. Sign in with your own email, go to Admin → New league, paste the real roster.
5. Point your domain at it: `fly certs add yourdomain.ca`, then set `APP_URL` to it and redeploy.

## Other hosts
Anything that runs the Dockerfile with a persistent disk mounted at `/data` works (Render "Disk", Railway "Volume"). Vercel/Netlify do not (no persistent disk for SQLite).
