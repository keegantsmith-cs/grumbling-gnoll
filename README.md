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

**Costs:** the default model (`claude-opus-5-5`) gives the best results. A typical DM request costs a cent or two, a character check 2–5¢, and a converted PDF page about 3–6¢. The AI Assistant tab shows a running monthly estimate. For lower costs, set `AI_MODEL=claude-haiku-5-5` in `.env` (much cheaper, somewhat less capable) and restart. You can also set a monthly spending limit in the Claude Console.

### Updating after new code is pushed

```bash
bash /opt/grumbling-gnoll/deploy/update.sh
```

### Backups

The installer makes a nightly backup of the database and uploaded files in `/var/backups/grumbling-gnoll` and keeps 14 days. Download one to your computer now and then:

```bash
scp root@YOUR.SERVER.IP:/var/backups/grumbling-gnoll/backup-*.tar.gz .
```

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

The app ships with no copyrighted D&D text. The class list and math follow the free 5e System Reference Document. Your group adds anything else (subclasses, monsters, books you own) privately. Only upload PDFs you own, for your own table.
