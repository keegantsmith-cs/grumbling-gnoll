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

What I want in this session:
[Write your requests here, all at once if you can. Examples:
- Use the website-designer agent to review and clean up the UI/UX of the whole site, starting with the Table screen and the character sheet.
- Fog that clears automatically where players' tokens can see.
- Condition icons on tokens (prone, poisoned, concentrating) with a hover explanation.
- Level-up helper for players.]
```

## Tips to keep sessions cheap
- Put all your requests in that first message instead of adding new ones mid-way.
- Start a new session for each new batch of features.
- For tiny fixes (wording, a color), switch to a cheaper model with `/model`.
