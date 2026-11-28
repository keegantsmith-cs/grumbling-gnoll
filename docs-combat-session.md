# Starting a Claude Code session: better combat

Copy everything in the box below into a new session (with the `keegantsmith-cs/grumbling-gnoll` repository selected).

```
I'm the DM for my D&D group and the owner of The Grumbling Gnoll, a private D&D 5e virtual tabletop in this repository. I'm not a programmer, so please explain things in plain language. Read CLAUDE.md first; it describes how the project is organized and the privacy rules (DM-only information must never reach players).

The site is live on my DigitalOcean droplet. I update it by running: bash /opt/grumbling-gnoll/deploy/update.sh
Our first real session is around December 15, so the combat tools must be reliable and simple to use during a game.

What already exists (build on it, don't rebuild it): the live Table with tokens, initiative/turn order, range rings and line of sight, right-click map menu, animated dice and dice styles, monsters dropped on the map from the encounter builder or compendium with HP tracking and damage/heal, character sheets with an attacks list, and DM rolls whispered to the DM unless made public.

This session's goal: make combat on the Table smoother and more exciting.

1. Attacks and options for every combatant
   - When it's someone's turn (or when I click a token), show a combat panel with what they can do: weapon and spell attacks with to-hit and damage, plus other options (Dash, Dodge, Disengage, Help, Hide, Ready, cast a spell, use an item).
   - Characters: pull attacks from their sheet (weapons, spells, attack bonus, damage dice and type, range). Fill in sensible numbers from their stats where the sheet leaves them blank.
   - Monsters: pull attacks from their stat block (SRD or my compendium), including multiattack, recharge abilities and saving-throw abilities with their DC.

2. Roll buttons (optional: I may use real dice)
   - One-click buttons for attack rolls, damage (doubled dice on a critical), saving throws, ability checks, skill checks and initiative. Include advantage and disadvantage.
   - Each player rolls from their own panel; their rolls show in chat as they do now.
   - Rolling on the site must always be optional. Give me (and players) a way to type in a result from physical dice instead, e.g. "I rolled 17", and still let the site work out hit or miss and apply damage.
   - The DM's monster rolls stay hidden from players unless I choose to show them.

3. Health and important information at a glance
   - In the turn order and on tokens: HP (bars or numbers), AC, conditions (poisoned, prone, stunned, etc.), concentration, temporary HP, and death saves for characters at 0 HP.
   - Easy ways to apply damage or healing to one or several targets, including half damage on a successful save, and resistance, vulnerability and immunity from the stat block.
   - Reminders for things like concentration checks when a concentrating creature takes damage, and when a condition or effect should end.
   - Keep my rules decisions: monster HP and AC are DM-only (players see only a rough "healthy / bloodied / near death" if anything); monster stat blocks stay hidden.

4. AI narration (a button, never automatic)
   - A "Narrate" button after a hit, miss, critical, kill, or a character dropping to 0 HP that writes 1–3 vivid sentences describing what happened, using the attacker, target, weapon or spell and the result.
   - Let me read it first, then choose to post it to chat for everyone, keep it private, or reroll it.
   - Keep it cheap: short answers, use the model I set for the assistant in Account > AI settings, and log the cost like other AI calls.
   - The narration players read must never include DM-only information (hidden monsters, exact monster HP, secret notes).

How I'd like you to work:
- Before building, show me a short plan and a rough sketch of the combat panel, and ask me any questions you have (for example, whether players can see enemy AC, or whether hits apply damage automatically).
- Build it in small steps. After each step run npm run typecheck, npm test and npm run build, check it in a browser with Playwright (a DM and two players), commit and push to main (pull the latest main first), and give me a short plain-language summary.
- Use the agents in .claude/agents/: rules-lawyer to check the attack, damage, crit, save and condition math and add tests; privacy-guard to make sure nothing DM-only reaches players; website-designer to keep the panel clean and usable on a laptop and a tablet; playtester to finish with a simulated fight (DM + 3 players) and fix what it finds.
- Tell me honestly what you tested and what still needs my real API key to try (the narration). Then remind me to run the update script.
```
