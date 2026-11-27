# Starting a new Claude Code session for The Grumbling Gnoll

Copy everything in the box below into a new session (with the `keegantsmith-cs/grumbling-gnoll` repository selected).

```
I'm the DM for my D&D group and the owner of The Grumbling Gnoll, a private D&D 5e virtual tabletop in this repository. I'm not a programmer, so please explain things in plain language. Read CLAUDE.md first; it describes how the project is organized and the privacy rules (DM-only information must never reach players).

Where things stand:
- The site is live on my DigitalOcean droplet. I update it by running: bash /opt/grumbling-gnoll/deploy/update.sh
- Features include: live table (maps, tokens, fog, rings, line of sight, right-click menu, animated dice), character sheets with DM approval, step-by-step and AI character makers, SRD lookup, compendium, PDF edition conversion, adventures with run guides and maps, encounter builder, AI assistant, session recaps, Discord webhooks and Join voice button, backups.
- AI costs: I choose models per job in Account > AI settings and have a monthly limit.
- Our first real session is around December 15.

How I'd like you to work:
- Keep changes small and tested: run npm run typecheck, npm test and npm run build before committing, and check new screens in a browser with Playwright.
- Commit and push to main when a feature is done, then tell me to run the update script.
- Tell me honestly what you tested and what still needs my real API key to try.

What I want in this session (please do them in this order, using the agents in .claude/agents/):
1. privacy-guard: check that no DM-only information can reach players and that logins, uploads and permissions are safe. Fix any leaks and add a test for each rule.
2. playtester: run a full simulated game night in a browser (DM + 3 players) and fix the bugs it finds.
3. website-designer: review and clean up the UI/UX, starting with the Table screen and the character sheet. Show me before/after screenshots.
4. rules-lawyer: check the 5e math (2014 and 2024) and add tests; list anything I need to decide.
After each step, give me a short plain-language summary of what changed. Commit and push after each step.
```

## Tips to keep sessions cheap
- Put all your requests in that first message instead of adding new ones mid-way.
- Start a new session for each new batch of features.
- For tiny fixes (wording, a color), switch to a cheaper model with `/model`.
