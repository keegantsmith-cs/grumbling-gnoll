import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "grumbling-gnoll.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uses_left INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules_version TEXT NOT NULL DEFAULT '2014',
  dm_user_id INTEGER NOT NULL REFERENCES users(id),
  dm_notes TEXT NOT NULL DEFAULT '',
  active_map_id INTEGER,
  initiative TEXT NOT NULL DEFAULT '{"round":1,"turn":0,"entries":[]}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'player',
  PRIMARY KEY (campaign_id, user_id)
);
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS character_changes (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'update', -- create | update | import
  proposed TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  ai_review TEXT,
  dm_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT,
  generated TEXT, -- JSON layout for generated maps
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  grid_type TEXT NOT NULL DEFAULT 'square', -- square | hex | none
  grid_size INTEGER NOT NULL DEFAULT 70,
  grid_offset_x REAL NOT NULL DEFAULT 0,
  grid_offset_y REAL NOT NULL DEFAULT 0,
  feet_per_cell INTEGER NOT NULL DEFAULT 5,
  fog_enabled INTEGER NOT NULL DEFAULT 1,
  fog TEXT NOT NULL DEFAULT '[]',
  dm_key TEXT NOT NULL DEFAULT '', -- DM-only room descriptions etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  size REAL NOT NULL DEFAULT 1,
  color TEXT NOT NULL DEFAULT '#c0392b',
  image_url TEXT,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  controlled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  hp INTEGER,
  max_hp INTEGER,
  conditions TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, -- text | roll | system | share
  body TEXT NOT NULL,
  whisper_to INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS compendium (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE, -- null = shared by all campaigns
  kind TEXT NOT NULL, -- monster | item | npc
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  source_edition TEXT NOT NULL DEFAULT '5e',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved
  player_visible INTEGER NOT NULL DEFAULT 0,
  upload_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  edition TEXT NOT NULL,
  pages INTEGER,
  page_from INTEGER,
  page_to INTEGER,
  next_page INTEGER, -- where to resume if interrupted
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | done | error
  progress TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_history (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_campaign ON chat(campaign_id, id);
CREATE INDEX IF NOT EXISTS idx_tokens_map ON tokens(map_id);
CREATE INDEX IF NOT EXISTS idx_changes_char ON character_changes(character_id, status);
`);

export type Row = Record<string, any>;

export function one<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...params);
}

export function parseJSON<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ---- schema upgrades for databases created by earlier versions ----
function addColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn("uploads", "next_page", "INTEGER");
// Discord
addColumn("campaigns", "discord_webhook", "TEXT NOT NULL DEFAULT ''");
addColumn("campaigns", "discord_dm_webhook", "TEXT NOT NULL DEFAULT ''");
addColumn("campaigns", "discord_options", `TEXT NOT NULL DEFAULT '{"rolls":true,"initiative":true,"shares":true,"maps":true,"chat":false}'`);
// Sessions
addColumn("campaigns", "next_session_at", "TEXT"); // ISO time in UTC
addColumn("campaigns", "session_note", "TEXT NOT NULL DEFAULT ''");
addColumn("campaigns", "session_weekly", "INTEGER NOT NULL DEFAULT 0");
addColumn("campaigns", "reminders_sent", "TEXT NOT NULL DEFAULT '[]'");

// Adventures (published or homebrew modules the DM uploads)
db.exec(`
CREATE TABLE IF NOT EXISTS adventures (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  edition TEXT NOT NULL,
  pages INTEGER NOT NULL,
  page_from INTEGER NOT NULL,
  page_to INTEGER NOT NULL,
  next_page INTEGER,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | done | error
  progress TEXT NOT NULL DEFAULT '',
  error TEXT,
  synopsis TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  current_section_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS adventure_sections (
  id INTEGER PRIMARY KEY,
  adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  dm_notes TEXT NOT NULL DEFAULT '',
  read_aloud TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sections_adv ON adventure_sections(adventure_id, position);
`);
addColumn("compendium", "adventure_id", "INTEGER");

db.exec(`
CREATE TABLE IF NOT EXISTS adventure_maps (
  id INTEGER PRIMARY KEY,
  adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'battle', -- battle | dungeon | region | world | other
  grid_type TEXT NOT NULL DEFAULT 'none',
  cells_across INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  map_id INTEGER REFERENCES maps(id) ON DELETE SET NULL
);
`);

db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
addColumn("ai_history", "model", "TEXT");
addColumn("ai_history", "cost_usd", "REAL");
// Older rows: estimate cost at Opus prices so this month's total isn't zero
db.exec(`UPDATE ai_history SET cost_usd = (COALESCE(input_tokens,0) * 4 + COALESCE(output_tokens,0) * 20) / 1000000.0, model = COALESCE(model, 'claude-opus-5-5') WHERE cost_usd IS NULL`);

// Dice rolled by the character creator, so the DM can see they were rolled fairly
db.exec(`
CREATE TABLE IF NOT EXISTS character_rolls (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- abilities | hp | gold
  result TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn("users", "dice_style", "TEXT NOT NULL DEFAULT 'ruby'");

// DM-only notes about a character (secrets, plot hooks). Never sent to players.
db.exec(`
CREATE TABLE IF NOT EXISTS character_dm_notes (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn("character_changes", "ai_fix", "TEXT");
addColumn("invites", "campaign_id", "INTEGER REFERENCES campaigns(id) ON DELETE SET NULL");
addColumn("invites", "note", "TEXT NOT NULL DEFAULT ''");
addColumn("character_changes", "ai_fix_applied", "INTEGER NOT NULL DEFAULT 0");

// Suggestions for a character, shared only between its player, the campaign DM and the AI
db.exec(`
CREATE TABLE IF NOT EXISTS character_suggestions (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_kind TEXT NOT NULL, -- player | dm | ai
  text TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suggestions_char ON character_suggestions(character_id, id);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS session_recaps (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  player_recap TEXT NOT NULL,
  dm_notes TEXT NOT NULL DEFAULT '',
  last_chat_id INTEGER NOT NULL DEFAULT 0,
  shared INTEGER NOT NULL DEFAULT 0,
  added_to_notes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn("campaigns", "discord_invite", "TEXT NOT NULL DEFAULT ''");
addColumn("campaigns", "discord_server_id", "TEXT NOT NULL DEFAULT ''");
addColumn("tokens", "rings", "TEXT NOT NULL DEFAULT '[]'");
addColumn("tokens", "meta", "TEXT NOT NULL DEFAULT '{}'");
