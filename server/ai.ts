// All Claude (AI) features live here.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { one, run } from "./db.ts";

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

// ---------- models, prices and the monthly budget ----------

/** Price per million tokens: [input, output]. Update if Anthropic's prices change. */
export const MODELS: Record<string, { label: string; price: [number, number]; note: string }> = {
  "claude-opus-5-5": { label: "Claude Opus 5.5", price: [4, 20], note: "Best quality, most expensive" },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", price: [2, 10], note: "Very good, about half the price of Opus" },
  "claude-haiku-5-5": { label: "Claude Haiku 5.5", price: [0.1, 0.5], note: "Good for reading and copying, about 40x cheaper than Opus" },
};

export const FEATURES = {
  assistant: "AI Assistant (NPCs, descriptions, encounters...), adventure overviews, portrait prompts",
  review: "Character rules checks and NPC stat blocks",
  reading: "Reading PDFs and photos: edition conversion, adventures, paper character sheets",
  maps: "AI-designed maps",
} as const;
export type Feature = keyof typeof FEATURES;

export function getSetting(key: string): string | undefined {
  return one("SELECT value FROM app_settings WHERE key = ?", key)?.value;
}
export function setSetting(key: string, value: string) {
  run("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}

export function modelFor(feature: Feature): string {
  const m = getSetting(`model.${feature}`);
  return m && MODELS[m] ? m : AI_MODEL;
}

export function monthSpend(): number {
  return one("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_history WHERE created_at >= date('now', 'start of month')")!.c;
}

function checkBudget() {
  const cap = Number(getSetting("monthlyCapUSD") || 0);
  if (cap > 0 && monthSpend() >= cap) {
    throw new AIError(`This month's AI budget ($${cap.toFixed(2)}) has been reached. An admin can raise it in Account > AI settings.`);
  }
}

function callParams(feature: Feature) {
  const model = modelFor(feature);
  return { model, ...fallbackParams(model) };
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

export function costOf(model: string, u: Usage): number {
  const [pin, pout] = MODELS[model]?.price ?? MODELS["claude-opus-5-5"].price;
  const cacheRead = u.cache_read_input_tokens ?? 0, cacheWrite = u.cache_creation_input_tokens ?? 0;
  const prompt = u.input_tokens + cacheRead + cacheWrite;
  // Haiku 5.5 charges 5x more when a single request's prompt is over 100K tokens
  const mult = model === "claude-haiku-5-5" && prompt > 100_000 ? 5 : 1;
  return ((u.input_tokens + cacheRead * 0.1 + cacheWrite * 1.25) * pin + u.output_tokens * pout) * mult / 1e6;
}

let client: Anthropic | null = null;
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
function getClient(): Anthropic {
  if (!aiEnabled()) throw new AIError("AI is not set up yet. Add ANTHROPIC_API_KEY to the server's .env file.");
  checkBudget();
  client ??= new Anthropic();
  return client;
}

export class AIError extends Error {}

type Effort = "low" | "medium" | "high";

// Opus 5.5 and Sonnet 5.5 support automatic fallback to another model if a request is
// declined by a safety classifier (D&D violence occasionally trips these).
function fallbackParams(model: string) {
  if (/^claude-(opus-5|sonnet-5-5|fable)/.test(model)) {
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

function logUsage(campaignId: number | null, userId: number | null, kind: string, prompt: string, output: unknown, msg: { model: string; usage: Usage }) {
  const u = msg.usage;
  run(
    "INSERT INTO ai_history (campaign_id, user_id, kind, prompt, output, input_tokens, output_tokens, model, cost_usd) VALUES (?,?,?,?,?,?,?,?,?)",
    campaignId,
    userId,
    kind,
    prompt,
    typeof output === "string" ? output : JSON.stringify(output),
    u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    u.output_tokens,
    msg.model,
    costOf(msg.model, u),
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
  adventure?: string; // the adventure the party is playing, if any
}

function campaignSystem(ctx: CampaignContext): Anthropic.Beta.BetaTextBlockParam[] {
  // Stable text first so it can be cached between requests.
  return [
    { type: "text", text: BASE_SYSTEM },
    {
      type: "text",
      text: `Campaign: ${ctx.name}\nRules: D&D 5th Edition (${ctx.rulesVersion} rules)\n\nThe party:\n${ctx.party || "(no approved characters yet)"}\n\nDM's private campaign notes (world, lore, NPCs met so far, recent events):\n${ctx.dmNotes || "(none yet)"}${ctx.adventure ? `\n\n${ctx.adventure}` : ""}`,
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
      ...callParams("assistant"),
      max_tokens: 8000,
      output_config: { effort: kind === "encounter" || kind === "rules" ? "medium" : "low" },
      system: campaignSystem(ctx),
      messages: [{ role: "user", content: prompt }],
    });
    checkStop(msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    logUsage(ctx.id, userId, `assist:${kind}`, request, text, msg);
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
      ...callParams("review"),
      max_tokens: 8000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ReviewSchema) },
      system: campaignSystem(opts.campaign),
      messages: [{ role: "user", content: prompt }],
    });
    checkStop(msg);
    if (!msg.parsed_output) throw new AIError("The AI review came back in an unexpected format. Try again.");
    logUsage(opts.campaign.id, opts.userId, "character-review", opts.reason, msg.parsed_output, msg);
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
      ...callParams("reading"),
      max_tokens: 64000,
      output_config: { effort: "low", format: betaZodOutputFormat(ConversionSchema) },
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
    logUsage(opts.campaignId, opts.userId, "convert", `${opts.edition} ${opts.pageLabel}`, { monsters: parsed.data.monsters.length, items: parsed.data.items.length }, msg);
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
      ...callParams("maps"),
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(MapDesignSchema) },
      system: campaignSystem(ctx),
      messages: [{ role: "user", content: prompt }],
    });
    checkStop(msg);
    if (!msg.parsed_output) throw new AIError("The AI map design came back in an unexpected format. Try again.");
    logUsage(ctx.id, userId, "map-design", description, { rooms: msg.parsed_output.rooms.length }, msg);
    return msg.parsed_output;
  } catch (e) {
    friendlyError(e);
  }
}

// ---------- Reading a paper / PDF character sheet ----------

const ABILITY = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const SKILL = z.enum([
  "acrobatics", "animal_handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation",
  "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight_of_hand", "stealth", "survival",
]);
const SheetSchema = z.object({
  name: z.string(),
  species: z.string(),
  background: z.string(),
  alignment: z.string(),
  classes: z.array(z.object({ name: z.string(), subclass: z.string(), level: z.number() })),
  experience: z.number(),
  abilities: z.object({ str: z.number(), dex: z.number(), con: z.number(), int: z.number(), wis: z.number(), cha: z.number() }),
  saveProficiencies: z.array(ABILITY),
  skillProficiencies: z.array(SKILL),
  skillExpertise: z.array(SKILL),
  hpMax: z.number().nullable(),
  hpCurrent: z.number().nullable(),
  hpTemp: z.number(),
  armorClass: z.number().nullable(),
  speed: z.number(),
  attacks: z.array(z.object({ name: z.string(), bonus: z.string(), damage: z.string(), notes: z.string() })),
  spells: z.array(z.object({ name: z.string(), level: z.number(), prepared: z.boolean() })),
  inventory: z.array(z.object({ name: z.string(), qty: z.number(), equipped: z.boolean(), attuned: z.boolean() })),
  currency: z.object({ cp: z.number(), sp: z.number(), ep: z.number(), gp: z.number(), pp: z.number() }),
  features: z.string(),
  proficienciesText: z.string(),
  personality: z.string(),
  backstory: z.string(),
  notes: z.string(),
  readingProblems: z.string(),
});
export type ScannedSheet = z.infer<typeof SheetSchema>;

export interface SheetFile { kind: "image" | "pdf"; mediaType: string; base64: string; formFields?: string }

export async function scanCharacterSheet(opts: { campaignId: number | null; userId: number; files: SheetFile[]; rulesVersion: string }): Promise<ScannedSheet> {
  const anthropic = getClient();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of opts.files) {
    if (f.kind === "pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } });
      if (f.formFields) content.push({ type: "text", text: `Filled-in form fields from that PDF (field name: value). These are the most reliable source when present:\n${f.formFields}` });
    } else {
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType as "image/jpeg" | "image/png" | "image/webp", data: f.base64 } });
    }
  }
  content.push({
    type: "text",
    text: `These are photos/scans/PDF pages of a filled-in D&D character sheet (could be the official sheet, a third-party sheet, or handwritten notes). Copy what's written into the structured format.

- Copy what the player wrote. Don't invent or "fix" values, except obvious OCR or handwriting slips you can resolve from the rest of the sheet.
- Ability scores are the big score numbers (usually 3-20), not the modifiers.
- saveProficiencies / skillProficiencies: marked with a filled bubble, tick, or "P". skillExpertise: double-marked or labelled expertise.
- classes: split multiclass entries like "Fighter 3 / Rogue 2". Put the subclass (archetype, oath, domain, etc.) in subclass.
- hpMax is the hit point maximum; hpCurrent is current HP if written separately (null if blank).
- attacks: weapon/spell attack rows. bonus like "+5", damage like "1d8+3 slashing".
- spells: every spell listed, with level 0 for cantrips. prepared = true unless the sheet shows it unprepared.
- Put class/racial features and feats in features; armor/weapon/tool proficiencies and languages in proficienciesText; traits/ideals/bonds/flaws in personality.
- Use empty strings, 0, or empty lists for anything blank or missing.
- In readingProblems, briefly list anything you couldn't read or weren't sure about (or "" if none) so the player can double-check.
The campaign uses the ${opts.rulesVersion} 5e rules (for context only; copy the sheet as written).`,
  });
  try {
    const stream = anthropic.beta.messages.stream({
      ...callParams("reading"),
      max_tokens: 32000,
      output_config: { effort: "low", format: betaZodOutputFormat(SheetSchema) },
      system: BASE_SYSTEM,
      messages: [{ role: "user", content }],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = SheetSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new AIError("The AI couldn't make sense of that sheet. Try clearer photos.");
    logUsage(opts.campaignId, opts.userId, "sheet-scan", `${opts.files.length} file(s)`, { name: parsed.data.name }, msg);
    return parsed.data;
  } catch (e) {
    if (e instanceof SyntaxError) throw new AIError("The AI's reading of the sheet came back incomplete. Try again, or upload fewer pages.");
    friendlyError(e);
  }
}

// ---------- Portrait prompt ----------

export async function characterArtPrompt(campaignId: number | null, userId: number, c: { name: string; species: string; classes: { name: string; subclass: string; level: number }[]; background: string; personality: string; backstory: string; features: string; inventory: { name: string; equipped: boolean }[] }, style: string, framing: "portrait" | "fullbody" = "portrait"): Promise<string> {
  const anthropic = getClient();
  const gear = c.inventory.filter((i) => i.equipped).map((i) => i.name).join(", ");
  const info = `Name: ${c.name}\nSpecies: ${c.species}\nClass: ${c.classes.map((x) => `${x.name}${x.subclass ? ` (${x.subclass})` : ""} ${x.level}`).join(" / ")}\nBackground: ${c.background}\nEquipped gear: ${gear}\nPersonality: ${c.personality.slice(0, 1500)}\nBackstory: ${c.backstory.slice(0, 2500)}`;
  try {
    const msg = await anthropic.beta.messages.create({
      ...callParams("assistant"),
      max_tokens: 2000,
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: `Write a prompt for an AI image generator to create ${framing === "fullbody" ? "a full-body fantasy character illustration" : "a fantasy character portrait"} of this D&D character. One paragraph, 60-110 words: ${framing === "fullbody" ? "full figure head to toe in a characterful standing or action pose, tall vertical composition, full outfit, armor, weapons and gear clearly shown" : "head-and-shoulders or bust framing, face clearly visible"}, species features, age, build, hair, clothing/armor, signature gear, expression that fits their personality, simple atmospheric background, lighting. Art style: ${style || "painterly fantasy illustration"}. No text or lettering in the image. Don't use the character's name or any franchise names. Reply with only the prompt.\n\n${info}`,
      }],
    });
    checkStop(msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    logUsage(campaignId, userId, "art-prompt", c.name, text, msg);
    return text;
  } catch (e) {
    friendlyError(e);
  }
}

// ---------- Reading adventure modules ----------

const AdventureChunkSchema = z.object({
  sections: z.array(z.object({
    title: z.string(),
    continues_previous: z.boolean(),
    page_start: z.number(),
    page_end: z.number(),
    summary: z.string(),
    dm_notes: z.string(),
    read_aloud: z.string(),
  })),
  npcs: z.array(z.object({
    name: z.string(), role: z.string(), description: z.string(), where: z.string(),
    stat_reference: z.string(),
    stats: MonsterSchema.nullable(),
  })),
  monsters: z.array(MonsterSchema),
  items: z.array(ItemSchema),
  maps: z.array(z.object({
    page: z.number(),
    title: z.string(),
    kind: z.enum(["battle", "dungeon", "region", "world", "other"]),
    has_grid: z.enum(["square", "hex", "none"]),
    cells_across: z.number(),
    description: z.string(),
  })),
});
export type AdventureChunk = z.infer<typeof AdventureChunkSchema>;

export async function readAdventureChunk(opts: {
  campaignId: number; userId: number; pdfBase64: string; pageLabel: string; edition: string; targetRules: string; title: string; previousTitles: string[];
}): Promise<AdventureChunk> {
  const anthropic = getClient();
  const is5e = /^5e/i.test(opts.edition);
  try {
    const stream = anthropic.beta.messages.stream({
      ...callParams("reading"),
      max_tokens: 64000,
      output_config: { effort: "low", format: betaZodOutputFormat(AdventureChunkSchema) },
      system: `${BASE_SYSTEM}\n\nYou are preparing a DM's private run-guide for an adventure module they own, to be played with D&D 5th Edition (${opts.targetRules} rules).${is5e ? "" : `\n\nThe adventure was written for ${opts.edition}, so convert its monsters and items to 5e.\n\n${CONVERT_GUIDE}`}`,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdfBase64 } },
          {
            type: "text",
            text: `These are ${opts.pageLabel} of the adventure "${opts.title}" (${opts.edition}). They may be scans with OCR errors.
${opts.previousTitles.length ? `Sections found so far (in order): ${opts.previousTitles.slice(-15).join(" | ")}` : "This is the start of the adventure."}

Build the run-guide for these pages:
- sections: the chapters/locations/scenes in reading order (keyed areas like "Area 12. The Crypt" can be grouped into one section per chapter or level if there are many). If the first section here continues the last one listed above, set continues_previous = true and reuse its title.
  - summary: what happens here and why it matters, 2-5 sentences.
  - dm_notes: Markdown bullets with what the DM needs at the table: key NPCs and their motives, creatures and numbers, traps/hazards with DCs (converted to 5e), treasure, clues, and where things lead next. Keep it tight.
  - read_aloud: the most important boxed/read-aloud text, condensed, or "" if none.
- npcs: named characters introduced on these pages (not ones only mentioned in passing).
  - If the NPC's own stat block is printed here, put it in stats${is5e ? "" : " (converted to 5e)"} and don't repeat it under monsters.
  - If the text says to use a standard stat block (e.g. "use the Bandit Captain statistics", or old-edition stats like "F5, AC 4, hp 30"), put that in stat_reference${is5e ? "" : " along with the closest 5e equivalent"}, and set stats to null.
  - Otherwise stat_reference is "" and stats is null.
- monsters: ${is5e ? "only NEW or unique creatures with full stat blocks printed on these pages (skip standard Monster Manual creatures that are only referenced)" : "every creature with stats on these pages, converted to 5e"}.
- items: magic items described on these pages${is5e ? "" : ", converted to 5e"}.
- maps: every page that shows a map (dungeon/building floor plan, battle map, region or world map). page is the PDF page number counting from 1 for the FIRST page you were given as ${opts.pageLabel.replace("pages ", "").split("-")[0]} (i.e. use the real page numbers in that range). has_grid: the grid printed on the map. cells_across: roughly how many grid squares/hexes span the map's width (0 if no grid or unsure). description: one line (what it shows, scale if printed).
Skip front matter, credits, ads, and the table of contents. Use empty lists when there's nothing.`,
          },
        ],
      }],
    });
    const msg = await stream.finalMessage();
    checkStop(msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = AdventureChunkSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new AIError("The AI's reading of those pages came back in an unexpected format.");
    logUsage(opts.campaignId, opts.userId, "adventure", `${opts.title} ${opts.pageLabel}`, { sections: parsed.data.sections.length }, msg);
    return parsed.data;
  } catch (e) {
    if (e instanceof SyntaxError) throw new AIError("The AI's reading came back incomplete. Retry and it will continue from where it stopped.");
    friendlyError(e);
  }
}

export async function adventureSynopsis(ctx: CampaignContext, userId: number, title: string, outline: string): Promise<string> {
  const anthropic = getClient();
  try {
    const msg = await anthropic.beta.messages.create({
      ...callParams("assistant"),
      max_tokens: 8000,
      output_config: { effort: "low" },
      system: campaignSystem(ctx),
      messages: [{
        role: "user",
        content: `Here is a section-by-section outline of the adventure "${title}" that the DM uploaded:\n\n${outline}\n\nWrite, in Markdown:\n## Overview\nThe adventure's premise, main villain(s) and their goal, and how it ends, in under 200 words.\n## Getting the party involved\n2-3 ways to hook THIS party into it, using the campaign notes where possible.\n## Things to prepare\nA short bullet list (recurring NPCs, big set-pieces, likely level range).`,
      }],
    });
    checkStop(msg);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    logUsage(ctx.id, userId, "adventure-synopsis", title, text, msg);
    return text;
  } catch (e) {
    friendlyError(e);
  }
}

// ---------- NPC stat blocks ----------

export async function npcStatBlock(ctx: CampaignContext, userId: number, npcText: string, reference: string, extra: string) {
  const anthropic = getClient();
  try {
    const msg = await anthropic.beta.messages.parse({
      ...callParams("review"),
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(MonsterSchema) },
      system: campaignSystem(ctx),
      messages: [{
        role: "user",
        content: `Create a D&D 5e (${ctx.rulesVersion} rules) stat block for this NPC.\n\n${npcText}\n${reference ? `\nThe adventure says: ${reference}. Base the stat block on that (use the 5e equivalent), adjusted to fit the character.` : ""}${extra ? `\nDM's request: ${extra}` : ""}

Make it fit who they are (a scholar shouldn't fight like a knight). Pick a challenge rating that suits their role in the story and the party described above; follow the 5e DMG guidelines for CR so the numbers are balanced. Give them 1-3 signature traits or actions that show their personality. Use proper 5e formatting for attacks ("Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) slashing damage."). In conversion_notes, briefly say how you chose the CR. Put the original page as "" in source_page.`,
      }],
    });
    checkStop(msg);
    if (!msg.parsed_output) throw new AIError("The stat block came back in an unexpected format. Try again.");
    logUsage(ctx.id, userId, "npc-stats", npcText.slice(0, 100), { name: msg.parsed_output.name }, msg);
    return msg.parsed_output;
  } catch (e) {
    friendlyError(e);
  }
}
