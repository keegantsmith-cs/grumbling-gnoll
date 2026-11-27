# The Grumbling Gnoll: guide for Claude

A private D&D 5e virtual tabletop for one DM (the owner, non-technical) and ~10 players. Deployed on a DigitalOcean droplet via `deploy/setup.sh`; updates via `deploy/update.sh` (git pull + build + restart). Explain things to the owner in plain language.

## Stack
- **Server:** Node 22 + TypeScript run with `tsx` (no build step), Express 5, Socket.IO, SQLite (better-sqlite3). Entry `server/index.ts`.
- **Client:** React 19 + Vite, Konva (react-konva) for the map canvas. Hash routing (`#/c/<id>/<tab>/<sub>`) in `client/src/hooks.ts`.
- **Shared:** `shared/` is imported by both (dice, character math, map generator, encounter math, dropdown options, creation data).
- **AI:** Claude via `@anthropic-ai/sdk` (beta `messages.parse`/`stream` with zod structured outputs). All prompts live in `server/ai.ts`. Model per feature (`assistant | review | reading | maps`) set by the admin in Account → AI settings (`app_settings` table); every call is logged with cost in `ai_history`; monthly cap enforced in `checkBudget()`.

## Layout
- `server/db.ts`: schema. New columns go through `addColumn()` at the bottom (the live database already exists, so never rely on `CREATE TABLE` changes alone).
- `server/routes/*.ts`: REST routes, mounted under `/api` in `server/index.ts`. `campaignAccess(req, needDM)` in `server/helpers.ts` checks membership/DM.
- `server/realtime.ts`: Socket.IO: table state (map, tokens, fog, rings), chat & dice, initiative, `addMonsterTokens()`. `postChat()` + whispers (`whisper_to`) decide who sees what; DM rolls are whispered to the DM unless public.
- `server/discord.ts`: outgoing webhooks only (rolls, turns, shares, reminders, DM alerts) + session reminder scheduler.
- `server/routes/srd.ts` + `srd/srd-5.1.json`: bundled SRD 5.1 (CC-BY-4.0, see `srd/NOTICE.md`; rebuild with `scripts/build-srd.mjs`).
- `client/src/pages/`: one file per tab (Table, CharacterSheet, Approvals, Maps, Adventures, Compendium, Assistant, Converter, Settings...).
- `client/src/components/`: shared UI (Chat, DiceTray, Rings, EncounterBuilder, MonsterDrop, SrdLookup, Markdown...).

## Rules that matter
- **Privacy is a feature.** DM-only data must never reach players: character `dmNotes` (table `character_dm_notes`), suggestions (owner + DM only), NPC `statblock` in the compendium, hidden tokens, secret doors on generated maps, map `dmKey`, DM rolls, whispers, webhook URLs. Filter on the server, not in the UI. AI text that players read (e.g. character suggestions) must be generated WITHOUT DM-only context.
- Players' character edits go to DM approval (`character_changes`); in-play values (HP, slots, portraits) save directly via `PATCH /characters/:id/play`.
- Copyright: ship only SRD content. Users add other books privately (compendium, PDF conversion).

## Commands
- `npm run dev`: server :3000 + Vite :5173. `npm run typecheck`. `npm test` (node:test via tsx; `tests/api.test.ts` boots a real server on a temp DB). `npm run build`.
- GitHub Actions runs typecheck + tests + build on push.
- Browser checks: Playwright is preinstalled (`require('playwright')`); start the server with `DATA_DIR=<scratch dir> PORT=<port> npx tsx server/index.ts`.

## Conventions
- Keep UI text friendly and non-technical. Dark tavern theme tokens in `client/src/styles.css`.
- Commit messages describe the user-visible change.
