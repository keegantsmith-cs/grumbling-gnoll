# Starting a new Claude Code session for The Grumbling Gnoll

Copy everything in the box below into a new session (with the `keegantsmith-cs/grumbling-gnoll` repository selected).

```
I'm the DM for my D&D group and the owner of The Grumbling Gnoll, a private D&D 5e virtual tabletop in this repository. I'm not a programmer, so please explain things in plain language. Read CLAUDE.md first; it describes how the project is organized and the privacy rules (DM-only information must never reach players).

Where things stand:
- The site is live on my DigitalOcean droplet. I update it by running: bash /opt/grumbling-gnoll/deploy/update.sh
- Features include: live table (maps, tokens, fog, rings, line of sight, right-click menu, animated dice), character sheets with DM approval, step-by-step and AI character makers, SRD lookup, compendium, PDF edition conversion, adventures with run guides and maps, AI map enrichment, encounter builder, AI assistant, AI NPCs for the map, session recaps, Discord webhooks and Join voice button, backups.
- Already done in earlier sessions: privacy/security review, a simulated game-night playtest, rules-math fixes with tests, and two design passes on the Table screen and character sheet (screenshots in docs/screenshots/ux-review). Please don't redo those; build on them.
- AI costs: I choose models per job in Account > AI settings and have a monthly limit.
- Our first real session is around December 15, so please favor polish and reliability over big new features.

How I'd like you to work:
- Keep changes small and tested: run npm run typecheck, npm test and npm run build before committing, and check new screens in a browser with Playwright.
- Commit and push to main when a step is done (pull the latest main first), then tell me to run the update script.
- Tell me honestly what you tested and what still needs my real API key to try.

What I want in this session (in this order, using the agents in .claude/agents/):
1. website-designer: review and clean up the rest of the site, one area at a time: login/sign-up and joining a campaign, Home and campaign list, Characters list and both character makers, Approvals, Maps, Adventures, Compendium, AI Assistant, Convert editions, Settings and Account. Check laptop and tablet sizes. Save before/after screenshots in docs/screenshots/ux-review.
2. Small leftovers from earlier reviews, if not already done: a touch-friendly way to open the map's right-click menu on tablets (e.g. long-press), and letting players roll attacks from a sheet they can't edit.
3. playtester: a fresh full game night in a browser (DM + 3 players, including one on a tablet) to catch anything the many recent changes broke, then fix what it finds.
4. privacy-guard: a quick re-check that none of this session's changes leak DM-only information.
5. Finish with a short "before game night" checklist for me: what to try myself with my real API key, and anything I should set up (Discord webhooks, backups, player invites).
After each step, give me a short plain-language summary of what changed.
```

## Tips to keep sessions cheap
- Put all your requests in that first message instead of adding new ones mid-way.
- Start a new session for each new batch of features.
- Run one session at a time. Several sessions changing the same files at once can produce conflicting changes.
- For tiny fixes (wording, a color), switch to a cheaper model with `/model`.
