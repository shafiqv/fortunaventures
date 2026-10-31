import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const g = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (g.__db) return g.__db;
  const file = process.env.DATABASE_PATH ?? "./data/lineup.db";
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  for (const sql of [
    "ALTER TABLE users ADD COLUMN cal_token TEXT",
    "ALTER TABLE teams ADD COLUMN league_id INTEGER",
    "ALTER TABLE teams ADD COLUMN lineup_policy TEXT NOT NULL DEFAULT 'rank'",
    "ALTER TABLE games ADD COLUMN lines INTEGER",
    "ALTER TABLE games ADD COLUMN matchup_id INTEGER",
    "ALTER TABLE games ADD COLUMN played_recorded INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE responses ADD COLUMN played INTEGER NOT NULL DEFAULT 0",
  ]) { try { d.exec(sql); } catch { /* column already exists */ } }
  g.__db = d;
  return d;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  sms_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  organizer_id INTEGER NOT NULL REFERENCES users(id),
  courts_per_matchup INTEGER NOT NULL DEFAULT 3,
  default_time TEXT NOT NULL DEFAULT '19:00'
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sport TEXT NOT NULL,                 -- tennis | squash | other
  format TEXT NOT NULL,                -- singles | doubles
  lines INTEGER NOT NULL DEFAULT 4,
  invite_code TEXT NOT NULL UNIQUE,
  request_business_days INTEGER NOT NULL DEFAULT 5,  -- availability email goes out this many business days before
  reminder_days INTEGER NOT NULL DEFAULT 3,          -- nudge non-responders
  spares_days INTEGER NOT NULL DEFAULT 2,            -- start contacting spares if short
  summary_days INTEGER NOT NULL DEFAULT 1,           -- final roster summary
  spare_mode TEXT NOT NULL DEFAULT 'rolling',        -- rolling | first_come
  spare_expiry_hours INTEGER NOT NULL DEFAULT 12,
  auto_spares INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'player',  -- captain | player | spare
  rank INTEGER NOT NULL DEFAULT 99,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,              -- YYYY-MM-DDTHH:MM club-local
  opponent TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  request_sent INTEGER NOT NULL DEFAULT 0,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  summary_sent INTEGER NOT NULL DEFAULT 0,
  spares_started INTEGER NOT NULL DEFAULT 0,
  UNIQUE (team_id, starts_at, opponent)
);
CREATE TABLE IF NOT EXISTS responses (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'none',  -- none | in | out | maybe
  token TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, user_id)
);
CREATE TABLE IF NOT EXISTS spare_offers (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | expired | cancelled
  offered_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (game_id, user_id)
);
`;

export type Team = {
  id: number; name: string; sport: string; format: "singles" | "doubles"; lines: number;
  invite_code: string; request_business_days: number; reminder_days: number; spares_days: number;
  summary_days: number; league_id: number | null; lineup_policy: "rank" | "rotation"; spare_mode: "rolling" | "first_come"; spare_expiry_hours: number; auto_spares: number;
};
export type User = { id: number; email: string; name: string; phone: string; sms_opt_in: number };
export type Game = {
  id: number; team_id: number; starts_at: string; opponent: string; location: string; notes: string;
  request_sent: number; reminder_sent: number; summary_sent: number; spares_started: number;
  lines: number | null; matchup_id: number | null; played_recorded: number;
};
export type League = { id: number; name: string; organizer_id: number; courts_per_matchup: number; default_time: string };
export type Member = User & { role: "captain" | "player" | "spare"; rank: number };
