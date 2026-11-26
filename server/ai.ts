// All Claude (AI) features live here.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { run } from "./db.ts";

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
function getClient(): Anthropic {
  if (!aiEnabled()) throw new AIError("AI is not set up yet. Add ANTHROPIC_API_KEY to the server's .env file.");
  client ??= new Anthropic();
  return client;
}

export class AIError extends Error {}

type Effort = "low" | "medium" | "high";

// Opus 5.5 and Sonnet 5.5 support automatic fallback to another model if a request is
// declined by a safety classifier (D&D violence occasionally trips these).
function fallbackParams() {
  if (/^claude-(opus-5|sonnet-5-5|fable)/.test(AI_MODEL)) {
    return { betas: ["server-side-fallback-2026-07-01"] as string[], fallbacks: "default" as const };
  }
  return { betas: [] as string[] };
}

function friendlyError(err: unknown): never {
  if (err instanceof AIError) throw err;
  if (err instanceof Anthropic.AuthenticationError) throw new AIError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.RateLimitError) throw new AIError("The AI is busy (rate limited). Try again in a minute.");
  if (err instanceof Anthropic.BadRequestError) throw new AIError(`The AI request was rejected: ${err.message}`);
  if (err instanceof Anthropic.APIError) throw new AIError(`AI service error (${err.status}). Try again shortly.`);
  if (err instanceof Anthropic.APIConnectionError) throw new AIError("Couldn't reach the AI service. Check the server's internet connection.");
  throw err;
}

function logUsage(campaignId: number | null, userId: number | null, kind: string, prompt: string, output: unknown, usage?: { input_tokens: number; output_tokens: number }) {
  run(
    "INSERT INTO ai_history (campaign_id, user_id, kind, prompt, output, input_tokens, output_tokens) VALUES (?,?,?,?,?,?,?)",
    campaignId,
    userId,
    kind,
    prompt,
    typeof output === "string" ? output : JSON.stringify(output),
    usage?.input_tokens ?? null,
    usage?.output_tokens ?? null,
  );
}

const BASE_SYSTEM = `You are an expert Dungeons & Dragons 5th Edition assistant helping a Dungeon Master run a home game for a small group of friends.
Write vivid, table-ready material a DM can read aloud or use immediately. Keep game mechanics accurate to the 5th Edition rules version you are given.
Never claim that something is official published content unless it is from the 5e System Reference Document; homebrew is fine and should be labelled as such when mechanics are invented.`;

export interface CampaignContext {
  id: number;
  name: string;
  rulesVersion: string;
  dmNotes: string;
  party: string; // short summary of the player characters
}

function campaignSystem(ctx: CampaignContext): Anthropic.Beta.BetaTextBlockParam[] {
  // Stable text first so it can be cached between requests.
  return [
    { type: "text", text: BASE_SYSTEM },
    {
      type: "text",
      text: `Campaign: ${ctx.name}\nRules: D&D 5th Edition (${ctx.rulesVersion} rules)\n\nThe party:\n${ctx.party || "(no approved characters yet)"}\n\nDM's private campaign notes (world, lore, NPCs met so far, recent events):\n${ctx.dmNotes || "(none yet)"}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

function checkStop(msg: { stop_reason: string | null }) {
  if (msg.stop_reason === "refusal") throw new AIError("The AI declined this request. Try rewording it.");
  if (msg.stop_reason === "max_tokens") throw new AIError("The AI's answer was too long and got cut off. Try asking for less.");
}

// ---------- DM assistant ----------

export const ASSIST_KINDS = {
  npc: "a non-player character",
  dialogue: "in-character dialogue",
  description: "a read-aloud description of a place, scene, or object",
  encounter: "a combat or social encounter balanced for the party",
  loot: "treasure and loot",
  names: "a list of names",
  hooks: "plot hooks and adventure ideas",
  rules: "a rules question answer",
  freeform: "anything else",
} as const;
export type AssistKind = keyof typeof ASSIST_KINDS;

const KIND_INSTRUCTIONS: Record<AssistKind, string> = {
  npc: "Create an NPC. Include: name, species, role/occupation, appearance (2-3 sentences), personality traits, how they talk (voice, mannerisms, a catchphrase), what they want, a secret, how they react to the party, and 3 sample lines of dialogue. If combat is plausible, add a compact 5e stat block (or name a suitable SRD stat block).",
  dialogue: "Write in-character dialogue the DM can perform. Give the lines, with short stage directions in italics, and 2-3 alternative responses depending on how the players react.",
  description: "Write a read-aloud description (boxed text, 80-150 words, appealing to several senses), then a short 'DM notes' section with hidden details, things players can discover, and relevant checks with DCs.",
  encounter: "Design an encounter balanced for the party described above. Give the setup, creatures (with counts and CR, using SRD monsters where possible), the difficulty and XP budget, tactics, terrain features, and how it could end without a fight.",
  loot: "Generate treasure appropriate to the party's level: coins, mundane valuables, and any magic items with rarity. Briefly describe each item's look so it feels unique.",
  names: "Generate a list of 15 fitting names with a one-line note each.",
  hooks: "Give 5 plot hooks that fit the campaign notes, each with a twist and a suggested first scene.",
  rules: "Answer the rules question clearly and briefly, citing the relevant rule. Note where 2014 and 2024 rules differ if relevant. If it's a judgement call, say so and suggest a ruling.",
  freeform: "Help the DM with their request.",
};

export async function dmAssist(ctx: CampaignContext, userId: number, kind: AssistKind, request: string): Promise<string> {
  const anthropic = getClient();
  const prompt = `${KIND_INSTRUCTIONS[kind]}\n\nDM's request: ${request || "(surprise me)"}\n\nFormat the answer in Markdown with short headings. Be concise and usable at the table.`;
  try {
    const msg = await anthropic.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 8000,
      ...fallbackParams(),
      output_config: { effort: kind === "encounter" || kind === "rules" ? "medium" : "low" },
      system: campaignSystem(ctx),
      messages: [{ role: "user", content: prompt }],
    });
    checkStop(msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    logUsage(ctx.id, userId, `assist:${kind}`, request, text, msg.usage);
    return text;
  } catch (e) {
    friendlyError(e);
  }
}

// ---------- Character review (imports from other campaigns, or any pending change) ----------

const ReviewSchema = z.object({
  verdict: z.enum(["looks_good", "minor_issues", "needs_changes"]),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(["info", "warning", "error"]),
      area: z.string(),
      problem: z.string(),
      suggestion: z.string(),
    }),
  ),
});
export type CharacterReview = z.infer<typeof ReviewSchema>;

export async function reviewCharacter(opts: {
  campaign: CampaignContext;
  userId: number;
  character: unknown;
  derived: unknown;
  previous: unknown | null;
  reason: string;
}): Promise<CharacterReview> {
  const anthropic = getClient();
  const prompt = `Review this player character for rules correctness under D&D 5th Edition (${opts.campaign.rulesVersion} rules).
Context: ${opts.reason}

Check: ability scores are plausible for standard generation methods (point buy, standard array, or rolled - flag anything above 20 or very high totals); ability score increases match level; hit points; AC given the listed armor; proficiency choices allowed by class/background; class features and subclass match level; spell counts, spell levels, and slots match the class and level; multiclass prerequisites; magic items and attunement (max 3 attuned); anything that comes from a different rules version (2014 vs 2024) and would work differently in this campaign.
Homebrew or content the DM added privately may appear: flag it as "info", not an error.
${opts.previous ? "Focus on what changed compared to the previous approved version, but mention anything else that's wrong." : ""}

The calculated numbers shown on the sheet (from the app) are included as "derived".

Character JSON:
${JSON.stringify(opts.character, null, 1)}

Derived values:
${JSON.stringify(opts.derived, null, 1)}
${opts.previous ? `\nPrevious approved version:\n${JSON.stringify(opts.previous, null, 1)}` : ""}

Keep each issue to one or two sentences. If everything is fine, return an empty issues list.`;
  try {
    const msg = await anthropic.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 8000,
      ...fallbackParams(),
      output_config: { effort: "medium", format: betaZodOutputFormat(ReviewSchema) },
      system: campaignSystem(opts.campaign),
      messages: [{ role: "user", content: prompt }],
    });
    checkStop(msg);
    if (!msg.parsed_output) throw new AIError("The AI review came back in an unexpected format. Try again.");
    logUsage(opts.campaign.id, opts.userId, "character-review", opts.reason, msg.parsed_output, msg.usage);
    return msg.parsed_output;
  } catch (e) {
    friendlyError(e);
  }
}

// ---------- Edition conversion ----------

const Named = z.object({ name: z.string(), description: z.string() });
export const MonsterSchema = z.object({
  name: z.string(),
  size: z.string(),
  type: z.string(),
  alignment: z.string(),
  armor_class: z.number(),
  armor_note: z.string(),
  hit_points: z.number(),
  hit_dice: z.string(),
  speed: z.string(),
  str: z.number(),
  dex: z.number(),
  con: z.number(),
  int: z.number(),
  wis: z.number(),
  cha: z.number(),
  saving_throws: z.string(),
  skills: z.string(),
  damage_vulnerabilities: z.string(),
  damage_resistances: z.string(),
  damage_immunities: z.string(),
  condition_immunities: z.string(),
  senses: z.string(),
  languages: z.string(),
  challenge_rating: z.string(),
  proficiency_bonus: z.number(),
  traits: z.array(Named),
  actions: z.array(Named),
  bonus_actions: z.array(Named),
  reactions: z.array(Named),
  legendary_actions: z.array(Named),
  lore: z.string(),
  conversion_notes: z.string(),
  source_page: z.string(),
});
export const ItemSchema = z.object({
  name: z.string(),
  item_type: z.string(),
  rarity: z.enum(["common", "uncommon", "rare", "very rare", "legendary", "artifact", "varies", "mundane"]),
  requires_attunement: z.boolean(),
  attunement_note: z.string(),
  description: z.string(),
  conversion_notes: z.string(),
  source_page: z.string(),
});
const ConversionSchema = z.object({
  monsters: z.array(MonsterSchema),
  items: z.array(ItemSchema),
  skipped: z.string(),
});
export type ConversionResult = z.infer<typeof ConversionSchema>;

export const EDITIONS = [
  "OD&D (1974) / Basic",
  "AD&D 1st Edition",
  "AD&D 2nd Edition",
  "D&D 3.0 / 3.5",
  "D&D 4th Edition",
  "Pathfinder 1e",
  "Pathfinder 2e",
  "5e 2014 (update to 2024)",
  "5e 2024 (update to 2014)",
  "Other / unknown",
];

const CONVERT_GUIDE = `Conversion guidance:
- Recalculate everything for 5e: AC, hit points (use the 5e hit dice formula: dice = size die × count, plus Con mod × count), ability scores, proficiency bonus by CR, saving throws, attack bonuses (proficiency + ability mod), save DCs (8 + proficiency + ability mod), damage per round, and Challenge Rating using the 5e DMG CR guidelines (defensive and offensive CR averaged).
- Older editions: descending AC (lower is better) converts roughly as 5e AC = 19 - old AC for AD&D/OD&D; THAC0 and hit dice need full recalculation, not copying. Old "save vs. X" becomes the matching 5e ability save. Percentage magic resistance becomes Magic Resistance (advantage on saves vs. spells) or nothing for low values.
- 3.x/Pathfinder: drop feats, base attack bonus, grapple, and skill ranks; translate damage reduction to resistance where it fits; spell-like abilities become Innate Spellcasting using 5e spell names; recalculate CR rather than copying it.
- 4e: convert powers to actions/bonus actions/reactions; recharge powers become "Recharge 5-6"; bloodied effects can stay as traits; role (brute, soldier, etc.) should guide the stat block.
- Magic items: map to 5e rarity, use 5e attunement rules, change charges/plus bonuses to 5e limits (+1 uncommon, +2 rare, +3 very rare), and replace references to old spells with 5e equivalents.
- Keep each creature's flavour, signature abilities, and lore. Where you had to make a judgement call, explain it in conversion_notes so the DM can check it.
- Use empty strings for fields that don't apply and empty arrays for missing sections.`;

export async function convertPdfChunk(opts: {
  campaignId: number | null;
  userId: number;
  pdfBase64: string;
  edition: string;
  targetRules: string;
  pageLabel: string;
}): Promise<{ result: ConversionResult; usage: { input_tokens: number; output_tokens: number } }> {
  const anthropic = getClient();
  try {
    // Streaming keeps long conversions from hitting HTTP timeouts.
    const stream = anthropic.beta.messages.stream({
      model: AI_MODEL,
      max_tokens: 64000,
      ...fallbackParams(),
      output_config: { effort: "medium", format: betaZodOutputFormat(ConversionSchema) },
      system: `${BASE_SYSTEM}\n\nYou convert monsters and magic items from older or different tabletop RPG editions into D&D 5th Edition (${opts.targetRules} rules) for a DM's private use.\n\n${CONVERT_GUIDE}`,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdfBase64 } },
            {
              type: "text",
              text: `These are scanned pages (${opts.pageLabel}) from a ${opts.edition} book. The text may contain OCR errors: use context to correct them.
Find every monster/creature stat block and every magic item on these pages and convert each to 5e (${opts.targetRules} rules).
Ignore spells, NPC-only story text, maps, and tables that aren't monsters or items, but list notable things you skipped in "skipped".
If a creature or item is cut off at the start or end of these pages, convert what's there and say so in conversion_notes.
Put the original page number in source_page.`,
            },
          ],
        },
      ],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = ConversionSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new AIError("The AI's conversion came back in an unexpected format.");
    logUsage(opts.campaignId, opts.userId, "convert", `${opts.edition} ${opts.pageLabel}`, { monsters: parsed.data.monsters.length, items: parsed.data.items.length }, msg.usage);
    return { result: parsed.data, usage: msg.usage };
  } catch (e) {
    if (e instanceof SyntaxError) throw new AIError("The AI's conversion came back incomplete. Try a smaller page range.");
    friendlyError(e);
  }
}

// ---------- AI-designed maps ----------

const MapDesignSchema = z.object({
  name: z.string(),
  overview: z.string(),
  rooms: z.array(
    z.object({
      label: z.string(),
      name: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      shape: z.enum(["rect", "cave"]),
      read_aloud: z.string(),
      dm_notes: z.string(),
    }),
  ),
  connections: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(["corridor", "door", "secret_door", "locked_door"]) })),
});
export type MapDesign = z.infer<typeof MapDesignSchema>;

export async function designMap(ctx: CampaignContext, userId: number, description: string, cols: number, rows: number): Promise<MapDesign> {
  const anthropic = getClient();
  const prompt = `Design a battle map / dungeon layout on a ${cols} × ${rows} grid of 5-foot squares (x from 0 to ${cols - 1}, y from 0 to ${rows - 1}).
Description from the DM: ${description}

Rules for the layout:
- 4 to 10 areas. Each area is a rectangle at (x, y) with width w and height h in squares, at least 3×3, fully inside the grid, with at least 2 empty squares between areas.
- Use shape "cave" for natural caverns and "rect" for built rooms.
- Label areas 1, 2, 3, ... and connect them so every area can be reached. Prefer a few loops over a straight line.
- For each area write a short read-aloud description and DM notes (creatures, traps with DCs, treasure, clues) suitable for the party.`;
  try {
    const msg = await anthropic.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      ...fallbackParams(),
      output_config: { effort: "medium", format: betaZodOutputFormat(MapDesignSchema) },
      system: campaignSystem(ctx),
      messages: [{ role: "user", content: prompt }],
    });
    checkStop(msg);
    if (!msg.parsed_output) throw new AIError("The AI map design came back in an unexpected format. Try again.");
    logUsage(ctx.id, userId, "map-design", description, { rooms: msg.parsed_output.rooms.length }, msg.usage);
    return msg.parsed_output;
  } catch (e) {
    friendlyError(e);
  }
}
