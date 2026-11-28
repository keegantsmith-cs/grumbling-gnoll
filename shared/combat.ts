// Combat rules shared by the server and the browser: what a creature can do, and the damage / death-save math.
// Pure functions only (no database, no randomness) so they are easy to test.
import { ABILITIES, mod, type Ability, type CharacterData, type Derived } from "./character.ts";

export const CONDITIONS = [
  "Blinded", "Charmed", "Deafened", "Exhaustion", "Frightened", "Grappled", "Incapacitated", "Invisible",
  "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
];

export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

/** The standard "other" things anyone can do on their turn. */
export const STANDARD_OPTIONS: { key: string; label: string; hint: string; effect?: "dodge" }[] = [
  { key: "dash", label: "Dash", hint: "Double your movement this turn." },
  { key: "dodge", label: "Dodge", hint: "Attacks against you have disadvantage until your next turn.", effect: "dodge" },
  { key: "disengage", label: "Disengage", hint: "Your movement doesn't provoke opportunity attacks this turn." },
  { key: "help", label: "Help", hint: "Give an ally advantage on their next check or attack." },
  { key: "hide", label: "Hide", hint: "Make a Dexterity (Stealth) check to hide." },
  { key: "ready", label: "Ready", hint: "Prepare an action to use when a trigger happens." },
  { key: "spell", label: "Cast a spell", hint: "Cast a spell that isn't an attack." },
  { key: "item", label: "Use an item", hint: "Use or interact with an object." },
];

export interface DamagePart { dice: string; type: string }

export interface CombatAction {
  id: string;
  name: string;
  section: "weapon" | "spell" | "action" | "bonus" | "reaction" | "legendary";
  kind: "attack" | "save" | "multiattack" | "other";
  toHit?: number;
  melee?: boolean;
  /** Reach or range in words, e.g. "reach 5 ft." or "range 80/320 ft." */
  range?: string;
  damage?: DamagePart[];
  save?: { ability: Ability; dc: number; half: boolean };
  recharge?: string;
  uses?: string;
  /** Legendary action cost */
  cost?: number;
  multi?: { name: string; count: number }[];
  text?: string;
  /** Spells: slot level and the extra dice per slot above it */
  level?: number;
  upcast?: { dice: string; above: number };
  concentration?: boolean;
  /** Counts as a magical attack for resistance to nonmagical damage */
  magical?: boolean;
  /** True when the numbers were filled in from the character's stats rather than typed on the sheet */
  auto?: boolean;
}

// ---------- dice helpers ----------

/** "2d10+8" -> "4d10+8": a critical hit doubles the dice but not the bonus. */
export function doubleDice(expr: string): string {
  return expr.replace(/(\d*)d(\d+)/gi, (_m, n, s) => `${(n ? parseInt(n, 10) : 1) * 2}d${s}`);
}

/** Dice expression for a spell at a higher slot / cantrip tier, e.g. ("1d10", level 5) -> "2d10". */
export function cantripDice(expr: string, characterLevel: number): string {
  const tier = characterLevel >= 17 ? 4 : characterLevel >= 11 ? 3 : characterLevel >= 5 ? 2 : 1;
  return expr.replace(/(\d*)d(\d+)/gi, (_m, n, s) => `${(n ? parseInt(n, 10) : 1) * tier}d${s}`);
}

export function addDice(a: string, b: string, times = 1): string {
  let out = a;
  for (let i = 0; i < times; i++) out += `+${b}`;
  return out;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** Split "1d8+3 slashing plus 2d6 fire" into parts. A part with no type keeps type "". */
export function parseDamageString(s: string): DamagePart[] {
  const out: DamagePart[] = [];
  for (const piece of String(s ?? "").split(/\s+(?:plus|and|&)\s+|\s*;\s*/i)) {
    const m = piece.trim().match(/^(\d*d\d+(?:\s*[+-]\s*\d+)*|\d+)\s*([a-z]+)?/i);
    if (!m) continue;
    const type = (m[2] ?? "").toLowerCase();
    out.push({ dice: m[1].replace(/\s+/g, ""), type: DAMAGE_TYPES.includes(type) ? type : "" });
  }
  return out;
}

// ---------- monsters ----------

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DMG_RE = /(?:\d+\s*)?\((\d*\s?d\d+(?:\s*[+-]\s*\d+)?)\)\s*([a-z]+)(?:,? or [a-z]+)?\s+damage/gi;

function damageParts(text: string): DamagePart[] {
  const out: DamagePart[] = [];
  for (const m of text.matchAll(DMG_RE)) out.push({ dice: m[1].replace(/\s+/g, ""), type: m[2].toLowerCase() });
  if (!out.length) {
    const flat = text.match(/(\d+)\s+([a-z]+)\s+damage/i);
    if (flat) out.push({ dice: flat[1], type: flat[2].toLowerCase() });
  }
  return out;
}

const ABILITY_BY_NAME: Record<string, Ability> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

/** Turn a stat block's action text into things you can click (attacks, saving-throw abilities, multiattack...). */
export function parseMonsterActions(m: Record<string, any>): CombatAction[] {
  const sections: [CombatAction["section"], any[]][] = [
    ["action", m.actions ?? []], ["bonus", m.bonus_actions ?? []], ["reaction", m.reactions ?? []], ["legendary", m.legendary_actions ?? []],
  ];
  const out: CombatAction[] = [];
  for (const [section, list] of sections) {
    (Array.isArray(list) ? list : []).forEach((a: any, i: number) => {
      const rawName = String(a?.name ?? "").trim();
      const text = String(a?.description ?? "").trim();
      if (!rawName) return;
      const recharge = rawName.match(/\(Recharge\s*(\d)(?:\s*[–-]\s*(\d))?\)/i);
      const uses = rawName.match(/\((\d+\/Day)[^)]*\)/i);
      const cost = rawName.match(/\(Costs?\s*(\d+)\s*Actions?\)/i);
      const name = rawName.replace(/\s*\((?:Recharge[^)]*|\d+\/Day[^)]*|Costs?[^)]*)\)/gi, "").trim();
      const act: CombatAction = { id: `${section}-${i}`, name, section, kind: "other", text };
      if (recharge) act.recharge = recharge[2] ? `${recharge[1]}–${recharge[2]}` : `${recharge[1]}`;
      if (uses) act.uses = uses[1];
      if (cost) act.cost = Number(cost[1]);
      else if (section === "legendary") act.cost = 1;
      const atk = text.match(/(Melee|Ranged)(?: or (Melee|Ranged))?\s+(Weapon|Spell)\s+Attack:\s*([+-])\s*(\d+)\s+to hit/i);
      if (/^multiattack/i.test(name)) {
        act.kind = "multiattack";
      } else if (atk) {
        act.kind = "attack";
        act.toHit = Number(`${atk[4]}${atk[5]}`);
        act.melee = /melee/i.test(atk[1]) || /melee/i.test(atk[2] ?? "");
        act.magical = /spell/i.test(atk[3]);
        const reach = [...text.matchAll(/(reach \d+ ft\.?|range \d+(?:\/\d+)? ft\.?)/gi)].map((r) => r[1].replace(/\.$/, ""));
        if (reach.length) act.range = reach.join(" or ");
        // Only the first "Hit:" sentence group: skip "or 11 (2d8+2) ... if used with two hands" style alternatives
        let hit = text.split(/Hit:/i)[1] ?? "";
        hit = hit.split(/\bor \d+ \(/i)[0].split(/\.\s+[A-Z]/)[0];
        act.damage = damageParts(hit);
      } else {
        const save = text.match(/DC\s*(\d+)\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i);
        if (save) {
          act.kind = "save";
          act.save = { ability: ABILITY_BY_NAME[save[2].toLowerCase()], dc: Number(save[1]), half: /half as much damage|half damage/i.test(text) };
          const dmg = damageParts(text);
          if (dmg.length) act.damage = dmg;
          const area = text.match(/(\d+)-foot(?:-radius)?\s+(cone|line|sphere|cube|radius|cylinder)|within (\d+) ft/i);
          if (area) act.range = area[0];
        }
      }
      // The bundled SRD data lost the "(Recharge 5-6)" notes. Every SRD breath weapon (and Mind Blast) recharges on a 5-6.
      if (!act.recharge && !act.uses && section === "action" && act.kind === "save" && (/\bbreath$/i.test(name) || /^mind blast$/i.test(name))) act.recharge = "5–6";
      out.push(act);
    });
  }
  // Multiattack: work out which attacks it makes and how many of each
  for (const mu of out.filter((a) => a.kind === "multiattack")) {
    const siblings = out.filter((a) => a.kind === "attack" && a.section === mu.section);
    const text = (mu.text ?? "").toLowerCase();
    const multi: { name: string; count: number }[] = [];
    for (const s of siblings) {
      const base = escapeRe(s.name.toLowerCase());
      const re = new RegExp(`\\b(one|two|three|four|five|six|an?|\\d+)\\b(?:(?!\\b(?:one|two|three|four|five|six|\\d+)\\b)[^.;:]){0,40}?\\b${base}s?\\b`);
      let m = text.match(re);
      // "one with its stinger" for an action called "Tail Stinger": try the last word of the name too
      const last = s.name.toLowerCase().split(/\s+/).pop()!;
      if (!m && last !== s.name.toLowerCase()) m = text.match(new RegExp(`\\b(one|two|three|four|five|six|an?|\\d+)\\b(?:(?!\\b(?:one|two|three|four|five|six|\\d+)\\b)[^.;:]){0,40}?\\b${escapeRe(last)}s?\\b`));
      if (m) multi.push({ name: s.name, count: COUNT_WORDS[m[1]] ?? (Number(m[1]) || 1) });
    }
    if (!multi.length && siblings.length) {
      const g = text.match(/\b(one|two|three|four|five|six|\d+)\b[^.]*?\battacks?\b/);
      if (g) multi.push({ name: siblings[0].name, count: COUNT_WORDS[g[1]] ?? (Number(g[1]) || 1) });
    }
    mu.multi = multi;
  }
  return out;
}

/** "DEX +6, CON +13" -> { dex: 6, con: 13 } */
export function parseSavingThrows(s: string): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  for (const m of String(s ?? "").matchAll(/\b(STR|DEX|CON|INT|WIS|CHA)\s*([+-]\d+)/gi)) out[m[1].toLowerCase() as Ability] = Number(m[2]);
  return out;
}

export interface Defense { type: string; /** only against nonmagical (and, for some, non-silvered/adamantine) weapons */ nonmagical?: boolean }

/** "cold; bludgeoning, piercing, and slashing from nonmagical attacks" -> [{cold}, {bludgeoning, nonmagical}...] */
export function parseDefenses(s: string): Defense[] {
  const out: Defense[] = [];
  for (const seg of String(s ?? "").split(";")) {
    const nonmagical = /nonmagical|non-magical/i.test(seg);
    const all = /\ball damage\b/i.test(seg);
    const types = all ? DAMAGE_TYPES : DAMAGE_TYPES.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(seg));
    for (const type of types) out.push({ type, nonmagical: nonmagical || undefined });
  }
  return out;
}

export function parseSkills(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of String(s ?? "").matchAll(/([A-Za-z ]+?)\s*([+-]\d+)/g)) out[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = Number(m[2]);
  return out;
}

// ---------- characters ----------

interface WeaponInfo { dice: string; type: string; ranged?: boolean; finesse?: boolean; versatile?: string; range?: string; reach?: boolean; thrown?: string }
const W = (dice: string, type: string, o: Partial<WeaponInfo> = {}): WeaponInfo => ({ dice, type, ...o });
export const WEAPONS: Record<string, WeaponInfo> = {
  club: W("1d4", "bludgeoning"), dagger: W("1d4", "piercing", { finesse: true, thrown: "20/60" }), greatclub: W("1d8", "bludgeoning"),
  handaxe: W("1d6", "slashing", { thrown: "20/60" }), javelin: W("1d6", "piercing", { thrown: "30/120" }), "light hammer": W("1d4", "bludgeoning", { thrown: "20/60" }),
  mace: W("1d6", "bludgeoning"), quarterstaff: W("1d6", "bludgeoning", { versatile: "1d8" }), sickle: W("1d4", "slashing"),
  spear: W("1d6", "piercing", { thrown: "20/60", versatile: "1d8" }), "light crossbow": W("1d8", "piercing", { ranged: true, range: "80/320" }),
  dart: W("1d4", "piercing", { ranged: true, finesse: true, range: "20/60" }), shortbow: W("1d6", "piercing", { ranged: true, range: "80/320" }),
  sling: W("1d4", "bludgeoning", { ranged: true, range: "30/120" }), battleaxe: W("1d8", "slashing", { versatile: "1d10" }), flail: W("1d8", "bludgeoning"),
  glaive: W("1d10", "slashing", { reach: true }), greataxe: W("1d12", "slashing"), greatsword: W("2d6", "slashing"), halberd: W("1d10", "slashing", { reach: true }),
  lance: W("1d12", "piercing", { reach: true }), longsword: W("1d8", "slashing", { versatile: "1d10" }), maul: W("2d6", "bludgeoning"),
  morningstar: W("1d8", "piercing"), pike: W("1d10", "piercing", { reach: true }), rapier: W("1d8", "piercing", { finesse: true }),
  scimitar: W("1d6", "slashing", { finesse: true }), shortsword: W("1d6", "piercing", { finesse: true }), trident: W("1d6", "piercing", { thrown: "20/60", versatile: "1d8" }),
  "war pick": W("1d8", "piercing"), warhammer: W("1d8", "bludgeoning", { versatile: "1d10" }), whip: W("1d4", "slashing", { finesse: true, reach: true }),
  blowgun: W("1", "piercing", { ranged: true, range: "25/100" }), "hand crossbow": W("1d6", "piercing", { ranged: true, range: "30/120" }),
  "heavy crossbow": W("1d10", "piercing", { ranged: true, range: "100/400" }), longbow: W("1d8", "piercing", { ranged: true, range: "150/600" }),
};
const WEAPON_ALIASES: Record<string, string> = { "crossbow, light": "light crossbow", "crossbow, hand": "hand crossbow", "crossbow, heavy": "heavy crossbow", "hand-axe": "handaxe", "short sword": "shortsword", "long sword": "longsword", "great sword": "greatsword", "great axe": "greataxe", "long bow": "longbow", "short bow": "shortbow" };

/** Find the SRD weapon a sheet entry means ("+1 Longsword", "Flametongue (longsword)"...). */
export function findWeapon(name: string): { key: string; info: WeaponInfo; magic: number } | null {
  let n = name.toLowerCase();
  const magic = Number(n.match(/\+\s*(\d)/)?.[1] ?? 0);
  for (const [alias, key] of Object.entries(WEAPON_ALIASES)) n = n.replace(alias, key);
  let best: string | null = null;
  for (const key of Object.keys(WEAPONS)) if (new RegExp(`\\b${escapeRe(key)}s?\\b`).test(n) && (!best || key.length > best.length)) best = key;
  return best ? { key: best, info: WEAPONS[best], magic } : null;
}

/** What the server knows about a spell (from the SRD) so a spell can become a button. */
export interface SpellFacts {
  name: string; level: number; attack: "" | "melee" | "ranged" | string; save: string; damage: string; damageType: string;
  range?: string; duration?: string; higher?: string; desc?: string;
}

export interface CharacterCombat {
  actions: CombatAction[];
  /** Notes about numbers we filled in ourselves */
  notes: string[];
}

function bonusNumber(s: string): number | null {
  const m = String(s ?? "").trim().match(/^[+-]?\s*\d+$/);
  return m ? Number(m[0].replace(/\s+/g, "")) : null;
}

/** Weapon attacks, spells and unarmed strike for a character, filling blanks from their stats. */
export function characterActions(c: CharacterData, dv: Derived, spellFacts: (name: string) => SpellFacts | undefined = () => undefined): CharacterCombat {
  const actions: CombatAction[] = [];
  const notes: string[] = [];
  const pb = dv.proficiencyBonus;
  const seen = new Set<string>();

  const weaponAction = (name: string, sheet: { bonus?: string; damage?: string; notes?: string } | null, id: string, itemMagic = 0): CombatAction => {
    const w = findWeapon(name);
    const info = w?.info;
    const magic = Math.max(w?.magic ?? 0, itemMagic);
    const ranged = !!info?.ranged;
    const abilityMod = info?.finesse ? Math.max(dv.mods.str, dv.mods.dex) : ranged ? dv.mods.dex : dv.mods.str;
    const typed = bonusNumber(sheet?.bonus ?? "");
    const toHit = typed ?? abilityMod + pb + magic;
    let damage = parseDamageString(sheet?.damage ?? "");
    let auto = typed == null;
    if (!damage.length && info) {
      const flat = abilityMod + magic;
      damage = [{ dice: `${info.dice}${flat ? signed(flat) : ""}`, type: info.type }];
      auto = true;
    } else if (!damage.length) {
      damage = [{ dice: `1${signed(Math.max(0, dv.mods.str))}`, type: "" }];
      auto = true;
    } else if (!damage[0].type && info) {
      damage[0].type = info.type;
    }
    const range = info?.ranged ? `range ${info.range} ft.` : info?.reach ? "reach 10 ft." : info?.thrown ? `reach 5 ft. or thrown ${info.thrown} ft.` : "reach 5 ft.";
    return { id, name, section: "weapon", kind: "attack", toHit, melee: !ranged, range, damage, magical: magic > 0 || /\+\d|magic|flame|frost|holy/i.test(name), auto, text: sheet?.notes || undefined };
  };

  c.attacks.forEach((a, i) => {
    if (!a?.name?.trim()) return;
    seen.add(a.name.trim().toLowerCase());
    actions.push(weaponAction(a.name.trim(), a, `weapon-${i}`));
  });
  // Equipped weapons in the inventory that aren't in the attacks list yet
  c.inventory.forEach((it, i) => {
    if (!it?.equipped || !it.name) return;
    const w = findWeapon(it.name);
    if (!w || seen.has(it.name.trim().toLowerCase())) return;
    if ([...seen].some((s) => findWeapon(s)?.key === w.key)) return;
    seen.add(it.name.trim().toLowerCase());
    actions.push(weaponAction(it.name.trim(), null, `item-${i}`));
  });
  actions.push({ id: "unarmed", name: "Unarmed strike", section: "weapon", kind: "attack", toHit: dv.mods.str + pb, melee: true, range: "reach 5 ft.", damage: [{ dice: `${Math.max(1, 1 + dv.mods.str)}`, type: "bludgeoning" }], auto: true });

  // Spells
  c.spells.forEach((s, i) => {
    if (!s?.name?.trim()) return;
    const f = spellFacts(s.name.trim());
    const base: CombatAction = { id: `spell-${i}`, name: s.name.trim(), section: "spell", kind: "other", level: Number(s.level) || 0, text: s.notes || undefined, magical: true };
    if (!f) { actions.push(base); return; }
    base.level = f.level;
    base.range = f.range;
    base.concentration = /concentration/i.test(f.duration ?? "");
    // Eldritch Blast grows by extra beams (one attack roll each), not by bigger dice
    const beams = /^eldritch blast$/i.test(f.name) ? (dv.level >= 17 ? 4 : dv.level >= 11 ? 3 : dv.level >= 5 ? 2 : 1) : 0;
    const dice = f.damage ? (f.level === 0 && !beams ? cantripDice(f.damage, dv.level) : f.damage) : "";
    if (beams > 1) base.text = [`Fires ${beams} beams: use this once per beam (each beam is its own attack roll).`, s.notes].filter(Boolean).join(" ");
    const type = (f.damageType ?? "").toLowerCase();
    const up = f.higher?.match(/increases? by (\d+d\d+) for each (?:slot )?level above (\d)/i);
    if (up) base.upcast = { dice: up[1], above: Number(up[2]) };
    if (f.attack && dv.spellAttack != null) {
      base.kind = "attack"; base.toHit = dv.spellAttack; base.melee = f.attack === "melee";
      if (dice) base.damage = [{ dice, type }];
    } else if (f.save && dv.spellSaveDC != null) {
      const ab = f.save.toLowerCase().slice(0, 3) as Ability;
      if (ABILITIES.includes(ab)) {
        base.kind = "save";
        base.save = { ability: ab, dc: dv.spellSaveDC, half: /half as much|half damage/i.test(f.desc ?? "") };
        if (dice) base.damage = [{ dice, type }];
      }
    } else if (dice) {
      base.damage = [{ dice, type }];
    }
    actions.push(base);
  });
  if (actions.some((a) => a.auto)) notes.push("Some numbers were worked out from the sheet's stats (shown with ≈).");
  return { actions, notes };
}

// ---------- attacks ----------

export type AttackOutcome = "crit" | "hit" | "miss" | "fumble" | "unknown";

/** natural = the d20 that counts (after advantage/disadvantage). */
export function resolveAttack(natural: number, total: number, ac: number | null): AttackOutcome {
  if (natural === 20) return "crit";
  if (natural === 1) return "fumble";
  if (ac == null) return "unknown";
  return total >= ac ? "hit" : "miss";
}

/** d20 expression for normal / advantage / disadvantage with a bonus. */
export function d20Expression(bonus: number, mode: "normal" | "adv" | "dis" = "normal"): string {
  const dice = mode === "adv" ? "2d20kh1" : mode === "dis" ? "2d20kl1" : "1d20";
  return bonus === 0 ? dice : `${dice}${signed(bonus)}`;
}

// ---------- damage ----------

export interface Defenses { resist: Defense[]; vuln: Defense[]; immune: Defense[] }

export interface DamageAdjust { amount: number; note: string }

/** Damage after a successful save (half), then resistance / vulnerability / immunity. Rounds down. */
export function adjustDamage(amount: number, type: string, def: Defenses, o: { half?: boolean; magical?: boolean } = {}): DamageAdjust {
  let n = Math.max(0, Math.round(amount));
  const notes: string[] = [];
  const t = (type || "").toLowerCase();
  const applies = (d: Defense) => d.type === t && !(d.nonmagical && o.magical);
  if (o.half) { n = Math.floor(n / 2); notes.push("half (successful save)"); }
  if (t && def.immune.some(applies)) return { amount: 0, note: `immune to ${t}` };
  const res = t && def.resist.some(applies);
  const vul = t && def.vuln.some(applies);
  // Resistance is applied first, then vulnerability (several sources of either never stack). Both: halve (round down), then double.
  if (res) { n = Math.floor(n / 2); notes.push(`resistant to ${t}`); }
  if (vul) { n *= 2; notes.push(`vulnerable to ${t}`); }
  return { amount: n, note: notes.join(", ") };
}

export interface HpState { hp: number; max: number; temp: number; deathSaves?: { successes: number; failures: number }; isCharacter: boolean }
export interface HitResult {
  hp: number; temp: number; taken: number; absorbed: number;
  dropped: boolean; dead: boolean; deathSaves?: { successes: number; failures: number };
  /** Constitution save needed to keep concentrating (10 or half the damage) */
  concentrationDC: number | null;
  notes: string[];
}

/** Apply already-adjusted damage: temp HP first, then HP. Handles dropping to 0, instant death and damage at 0 HP. */
export function takeDamage(s: HpState, amount: number, o: { crit?: boolean; concentrating?: boolean } = {}): HitResult {
  const dmg = Math.max(0, Math.round(amount));
  const notes: string[] = [];
  const absorbed = Math.min(s.temp, dmg);
  let temp = s.temp - absorbed;
  let rest = dmg - absorbed;
  const ds = s.deathSaves ? { ...s.deathSaves } : s.isCharacter ? { successes: 0, failures: 0 } : undefined;
  let hp = s.hp;
  let dropped = false, dead = false;
  if (absorbed) notes.push(`${absorbed} soaked up by temporary HP`);
  if (rest > 0) {
    if (hp <= 0) {
      // Already down: a character takes a death-save failure (two on a critical hit); a monster is simply finished off
      if (s.isCharacter && ds) {
        if (rest >= s.max) { dead = true; ds.failures = 3; notes.push("massive damage: dead"); }
        else { ds.successes = 0; /* a stable character who is hurt starts rolling death saves again */ ds.failures = Math.min(3, ds.failures + (o.crit ? 2 : 1)); notes.push(`death save failure${o.crit ? "s (critical hit)" : ""}`); if (ds.failures >= 3) { dead = true; notes.push("three failures: dead"); } }
      }
    } else {
      const left = hp - rest;
      if (left <= 0) {
        hp = 0; dropped = true;
        const over = rest - s.hp;
        if (s.isCharacter && over >= s.max) { dead = true; if (ds) ds.failures = 3; notes.push("massive damage: dead outright"); }
        else notes.push(s.isCharacter ? "drops to 0 HP and falls unconscious" : "drops to 0 HP");
      } else hp = left;
    }
  }
  const concentrationDC = o.concentrating && dmg > 0 && !dead ? Math.max(10, Math.floor(dmg / 2)) : null;
  return { hp, temp, taken: rest, absorbed, dropped, dead, deathSaves: ds, concentrationDC, notes };
}

/** Healing: never above max; getting up from 0 HP clears death saves. Temp HP is not healed. */
export function heal(s: HpState, amount: number): { hp: number; deathSaves?: { successes: number; failures: number }; revived: boolean } {
  const n = Math.max(0, Math.round(amount));
  const hp = Math.min(s.max, s.hp + n);
  const revived = s.hp <= 0 && hp > 0;
  const ds = s.deathSaves ? (revived ? { successes: 0, failures: 0 } : s.deathSaves) : undefined;
  return { hp, deathSaves: ds, revived };
}

/** New temporary HP replaces the old only if higher (they don't stack). */
export const gainTempHp = (current: number, gained: number) => Math.max(current, Math.max(0, Math.round(gained)));

export interface DeathSaveResult { successes: number; failures: number; outcome: "success" | "failure" | "stable" | "dead" | "revived"; hp?: number; text: string }

/** A death saving throw: 10+ succeeds, 1 counts as two failures, 20 brings you back with 1 HP. */
export function deathSave(state: { successes: number; failures: number }, natural: number): DeathSaveResult {
  let { successes, failures } = state;
  if (natural === 20) return { successes: 0, failures: 0, outcome: "revived", hp: 1, text: "Natural 20! Back up with 1 HP." };
  if (natural === 1) failures += 2; else if (natural >= 10) successes += 1; else failures += 1;
  successes = Math.min(3, successes); failures = Math.min(3, failures);
  if (failures >= 3) return { successes, failures, outcome: "dead", text: "Three failures: dead." };
  if (successes >= 3) return { successes, failures, outcome: "stable", text: "Three successes: stable at 0 HP." };
  return { successes, failures, outcome: natural >= 10 ? "success" : "failure", text: natural >= 10 ? "A success." : natural === 1 ? "Natural 1: two failures!" : "A failure." };
}

export type HealthWord = "healthy" | "bloodied" | "near death" | "down";
/** The rough word players see for a monster instead of its numbers. */
export function healthWord(hp: number | null, max: number | null): HealthWord | null {
  if (hp == null || !max) return null;
  if (hp <= 0) return "down";
  if (hp * 4 <= max) return "near death";
  if (hp * 2 <= max) return "bloodied";
  return "healthy";
}

/** Concentration-check DC for a hit. */
export const concentrationDC = (damage: number) => Math.max(10, Math.floor(damage / 2));

export const abilityMod = mod;

// ---------- a monster's whole fighting profile, stored on its token (DM-only) ----------

export interface MonsterCombat {
  ac: number | null;
  abilities: Record<Ability, number>;
  saves: Partial<Record<Ability, number>>;
  skills: Record<string, number>;
  resist: Defense[]; vuln: Defense[]; immune: Defense[];
  condImmune: string[];
  actions: CombatAction[];
  traits: { name: string; description: string }[];
  cr: string;
}

export function monsterCombatData(m: Record<string, any>): MonsterCombat {
  const ac = Number(String(m.armor_class ?? "").match(/\d+/)?.[0]);
  const abilities = Object.fromEntries(ABILITIES.map((a) => [a, Number(m[a]) || 10])) as Record<Ability, number>;
  return {
    ac: Number.isFinite(ac) && ac > 0 ? ac : null,
    abilities,
    saves: parseSavingThrows(m.saving_throws),
    skills: parseSkills(m.skills),
    resist: parseDefenses(m.damage_resistances), vuln: parseDefenses(m.damage_vulnerabilities), immune: parseDefenses(m.damage_immunities),
    condImmune: CONDITIONS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(String(m.condition_immunities ?? ""))),
    actions: parseMonsterActions(m),
    traits: (Array.isArray(m.traits) ? m.traits : []).map((t: any) => ({ name: String(t?.name ?? ""), description: String(t?.description ?? "") })).filter((t: any) => t.name),
    cr: String(m.challenge_rating ?? ""),
  };
}

// ---------- what the combat panel is told about the acting creature (DM or controller only) ----------

export interface Actor {
  tokenId: number;
  name: string;
  kind: "character" | "monster";
  characterId: number | null;
  ownerId: number | null;
  ac: number | null;
  hp: number | null;
  maxHp: number | null;
  tempHp: number;
  deathSaves: { successes: number; failures: number } | null;
  mods: Record<Ability, number>;
  saves: Record<Ability, number>;
  skills: Record<string, number>;
  initiative: number;
  actions: CombatAction[];
  resist: Defense[]; vuln: Defense[]; immune: Defense[]; condImmune: string[];
  traits: { name: string; description: string }[];
  notes: string[];
  proficiencyBonus: number | null;
  spellSaveDC: number | null;
  conditions: string;
  concentrating: string;
  rulesVersion?: string;
  /** Recharge abilities that are spent / daily uses so far, by action id */
  used: Record<string, number>;
  /** Spell slots left per level 1-9 (characters) */
  slotsLeft?: number[];
  pactLeft?: { count: number; level: number };
  /** Timers on this creature: conditions and effects that should end at a certain turn */
  effects: { name: string; at: "start" | "end"; round: number; condition?: boolean }[];
}
