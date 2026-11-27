# 🍺 The Grumbling Gnoll

A private D&D 5e virtual tabletop and community site for a small group (about 10 people).

- **Live table:** upload battle maps or generate them, square or hex grids, tokens, fog of war, measuring, pings, initiative tracker, chat, and server-side dice rolls (`/r 1d20+5`, advantage, secret DM rolls, whispers).
- **Characters:** a full 5e sheet that does the math (modifiers, saves, skills, HP, multiclass spell slots, pact magic). New characters and edits need the **DM's approval**. HP and spell slots used during play don't.
- **Adventures:** upload an adventure module's PDF and the AI builds a chapter-by-chapter run guide, adds its NPCs/monsters/items to the Compendium (converted to 5e if needed), and keeps the AI assistant aware of where the party is.
- **Import paper sheets:** photograph a filled-in character sheet (or upload a PDF, including fillable ones) and the AI copies it onto a sheet on the site.
- **Portraits:** upload a character picture (also used as the map token), or have the AI write a prompt for a free image generator.
- **Discord:** dice rolls, turns, shared handouts and session reminders post to your Discord channel; DM alerts go to a private channel.
- **Rules per campaign:** each campaign uses either the 2014 or the 2024 5e rules.
- **AI DM assistant** (Claude): NPCs, dialogue, read-aloud descriptions, encounters, loot, names, plot hooks, and rules questions. It knows your campaign notes and the party.
- **AI rules check:** characters brought in from another campaign (or uploaded from a file) are checked automatically against that campaign's rules. The DM can run the check on any change.
- **Edition converter:** upload scanned PDFs from OD&D, AD&D 1e/2e, 3.x, 4e or Pathfinder. The AI converts the monsters and magic items to 5e as drafts for the DM to review.
- **AI-designed maps:** describe a place, get a dungeon layout with a DM-only room key.

Voice chat is meant to happen in Discord, alongside the site.

---

## Running it on a server (about 20 minutes, ~$5–7/month)

1. **Rent a small server.** Any provider's smallest Ubuntu 24.04 server works (1 vCPU, 1–2 GB RAM). Hetzner, DigitalOcean, Vultr, and Linode are all fine. Save the server's IP address and root password (or SSH key) they give you.
2. **Connect to it.** On Windows open *PowerShell*, on Mac open *Terminal*, then type:
   ```bash
   ssh root@YOUR.SERVER.IP
   ```
3. **Run the installer:**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/keegantsmith-cs/grumbling-gnoll/main/deploy/setup.sh -o setup.sh
   ```
   ```bash
   bash setup.sh
   ```
   With no domain, the site gets a free address like `https://203-0-113-5.sslip.io`. If you buy a domain later, point it at the server's IP and run `bash setup.sh yourdomain.com`.
4. **Open the address it prints** and create the first account. That account is the admin and DM.
5. **Invite your players:** on the home page, click *Create invite code* and send each player a code. Once they sign up, add them to your campaign from its *Settings* tab.

### Turning on the AI

1. Create an account at <https://platform.claude.com>, add a few dollars of credit, and create an API key.
2. On the server, run:
   ```bash
   nano /opt/grumbling-gnoll/.env
   ```
   Paste the key after `ANTHROPIC_API_KEY=`, then press Ctrl+O, Enter, Ctrl+X to save.
3. Restart the app:
   ```bash
   systemctl restart grumbling-gnoll
   ```

**Costs:** as admin, go to **Account → AI settings & costs** to choose which Claude model does each job, see what each request cost, and set a monthly limit. The "Balanced" choice (Haiku reads PDFs and photos, Sonnet writes and checks) costs a fraction of using Opus for everything. You can also set a spending limit in the Claude Console.

### Updating after new code is pushed

```bash
bash /opt/grumbling-gnoll/deploy/update.sh
```

### Backups

- **Every night** the server saves a backup (database + uploaded files) in `/var/backups/grumbling-gnoll` and keeps 14 days.
- **Any time:** as admin, go to **Account → Backups → Download a full backup now** and keep the file on your computer.
- **Whole-server snapshots (easiest off-server option):** in DigitalOcean, open the droplet → **Backups** → enable. It costs about 20% of the droplet price for weekly (30% for daily) and can restore the entire server in a few clicks.
- **Free off-server copies (optional):** create a free bucket at Cloudflare R2 or Backblaze B2, then fill in the `BACKUP_S3_...` lines in `/opt/grumbling-gnoll/.env`. Each nightly backup is then also copied there and kept for 60 days. Run `bash /opt/grumbling-gnoll/deploy/backup.sh` once to test it.

To restore from a backup file: stop the site (`systemctl stop grumbling-gnoll`), unpack the file into `/opt/grumbling-gnoll/data` (`tar -xzf backup.tar.gz -C /opt/grumbling-gnoll/data`), run `chown -R gnoll:gnoll /opt/grumbling-gnoll/data`, then start it again (`systemctl start grumbling-gnoll`).

---

## Developing locally

Requires Node.js 20+.

```bash
npm install
```
```bash
cp .env.example .env
```
```bash
npm run dev
```

Then open <http://localhost:5173>. `npm run typecheck` checks the code. `npm run build` followed by `npm start` runs the production build on port 3000.

**Layout:**
- `server/`: Express + Socket.IO + SQLite. `server/ai.ts` holds all Claude prompts.
- `client/`: React + Konva (map canvas).
- `shared/`: dice roller, 5e character math, and map generator, used by both.
- Data lives in `data/` (`grumbling-gnoll.db` and `uploads/`).

## Content and copyright

The app includes the free 5e System Reference Document 5.1 (spells, equipment, magic items, monsters) under the Creative Commons Attribution 4.0 license; see `srd/NOTICE.md`. It ships no other D&D text. The class list and math follow the free 5e System Reference Document. Your group adds anything else (subclasses, monsters, books you own) privately. Only upload PDFs you own, for your own table.
