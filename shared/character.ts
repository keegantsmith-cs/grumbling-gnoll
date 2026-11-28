// Character sheet data model and 5th Edition math.
import { SUBCLASS_CASTER } from "./options.ts";
// Everything calculated here can be overridden by hand on the sheet.

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export type RulesVersion = "2014" | "2024";

export const SKILLS: { key: string; name: string; ability: Ability }[] = [
  { key: "acrobatics", name: "Acrobatics", ability: "dex" },
  { key: "animal_handling", name: "Animal Handling", ability: "wis" },
  { key: "arcana", name: "Arcana", ability: "int" },
  { key: "athletics", name: "Athletics", ability: "str" },
  { key: "deception", name: "Deception", ability: "cha" },
  { key: "history", name: "History", ability: "int" },
  { key: "insight", name: "Insight", ability: "wis" },
  { key: "intimidation", name: "Intimidation", ability: "cha" },
  { key: "investigation", name: "Investigation", ability: "int" },
  { key: "medicine", name: "Medicine", ability: "wis" },
  { key: "nature", name: "Nature", ability: "int" },
  { key: "perception", name: "Perception", ability: "wis" },
  { key: "performance", name: "Performance", ability: "cha" },
  { key: "persuasion", name: "Persuasion", ability: "cha" },
  { key: "religion", name: "Religion", ability: "int" },
  { key: "sleight_of_hand", name: "Sleight of Hand", ability: "dex" },
  { key: "stealth", name: "Stealth", ability: "dex" },
  { key: "survival", name: "Survival", ability: "wis" },
];

export type CasterType = "full" | "half" | "third" | "pact" | "none";

export interface ClassInfo {
  name: string;
  hitDie: number;
  saves: Ability[];
  caster: CasterType;
  spellAbility?: Ability;
  /** Artificer: a half caster that rounds UP and casts from level 1, alone or multiclassed */
  roundsUp?: boolean;
}

// Core classes (names and mechanics from the free 5e SRD). Players can also type a custom class.
export const CLASSES: ClassInfo[] = [
  { name: "Barbarian", hitDie: 12, saves: ["str", "con"], caster: "none" },
  { name: "Bard", hitDie: 8, saves: ["dex", "cha"], caster: "full", spellAbility: "cha" },
  { name: "Cleric", hitDie: 8, saves: ["wis", "cha"], caster: "full", spellAbility: "wis" },
  { name: "Druid", hitDie: 8, saves: ["int", "wis"], caster: "full", spellAbility: "wis" },
  { name: "Fighter", hitDie: 10, saves: ["str", "con"], caster: "none" },
  { name: "Monk", hitDie: 8, saves: ["str", "dex"], caster: "none" },
  { name: "Paladin", hitDie: 10, saves: ["wis", "cha"], caster: "half", spellAbility: "cha" },
  { name: "Ranger", hitDie: 10, saves: ["str", "dex"], caster: "half", spellAbility: "wis" },
  { name: "Rogue", hitDie: 8, saves: ["dex", "int"], caster: "none" },
  { name: "Sorcerer", hitDie: 6, saves: ["con", "cha"], caster: "full", spellAbility: "cha" },
  { name: "Warlock", hitDie: 8, saves: ["wis", "cha"], caster: "pact", spellAbility: "cha" },
  { name: "Wizard", hitDie: 6, saves: ["int", "wis"], caster: "full", spellAbility: "int" },
];

export interface ClassLevel {
  name: string;
  subclass: string;
  level: number;
  /** Set for custom/homebrew classes or subclasses that cast (e.g. Eldritch Knight = "third"). */
  casterOverride?: CasterType | "";
}

export interface Attack {
  name: string;
  bonus: string; // e.g. "+5" or blank to calculate
  damage: string; // e.g. "1d8+3 slashing"
  notes: string;
}

export interface Spell {
  name: string;
  level: number;
  prepared: boolean;
  notes: string;
}

export interface InventoryItem {
  name: string;
  qty: number;
  weight: number;
  equipped: boolean;
  attuned: boolean;
  notes: string;
}

export interface CharacterData {
  name: string;
  rulesVersion: RulesVersion;
  species: string; // "race" in 2014 rules
  background: string;
  alignment: string;
  classes: ClassLevel[];
  experience: number;
  abilities: Record<Ability, number>;
  saveProficiencies: Ability[];
  skillProficiencies: string[];
  skillExpertise: string[];
  hp: { max: number | null; current: number; temp: number };
  ac: number | null; // null = 10 + Dex
  speed: number;
  initiativeBonus: number; // extra on top of Dex
  inspiration: boolean;
  deathSaves: { successes: number; failures: number };
  spellSlotsUsed: number[]; // index 0 = 1st level
  pactSlotsUsed: number;
  attacks: Attack[];
  spells: Spell[];
  inventory: InventoryItem[];
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
  features: string;
  proficienciesText: string; // armor, weapons, tools, languages
  personality: string;
  backstory: string;
  notes: string;
  portraitUrl: string;
  fullBodyUrl: string;
  overrides: {
    proficiencyBonus?: number | null;
    spellSaveDC?: number | null;
    spellAttack?: number | null;
    passivePerception?: number | null;
  };
}

export function blankCharacter(rulesVersion: RulesVersion = "2014"): CharacterData {
  return {
    name: "New Adventurer",
    rulesVersion,
    species: "",
    background: "",
    alignment: "",
    classes: [{ name: "Fighter", subclass: "", level: 1 }],
    experience: 0,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProficiencies: ["str", "con"],
    skillProficiencies: [],
    skillExpertise: [],
    hp: { max: null, current: 10, temp: 0 },
    ac: null,
    speed: 30,
    initiativeBonus: 0,
    inspiration: false,
    deathSaves: { successes: 0, failures: 0 },
    spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pactSlotsUsed: 0,
    attacks: [],
    spells: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    features: "",
    proficienciesText: "",
    personality: "",
    backstory: "",
    notes: "",
    portraitUrl: "",
    fullBodyUrl: "",
    overrides: {},
  };
}

/** Fill in any fields missing from older/imported data so the sheet never crashes. */
export function normalizeCharacter(raw: unknown, fallbackRules: RulesVersion = "2014"): CharacterData {
  const base = blankCharacter(fallbackRules);
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<CharacterData>;
  return {
    ...base,
    ...d,
    abilities: { ...base.abilities, ...(d.abilities ?? {}) },
    hp: { ...base.hp, ...(d.hp ?? {}) },
    deathSaves: { ...base.deathSaves, ...(d.deathSaves ?? {}) },
    currency: { ...base.currency, ...(d.currency ?? {}) },
    overrides: { ...(d.overrides ?? {}) },
    classes: Array.isArray(d.classes) && d.classes.length ? d.classes : base.classes,
    spellSlotsUsed: Array.isArray(d.spellSlotsUsed) ? d.spellSlotsUsed : base.spellSlotsUsed,
    attacks: Array.isArray(d.attacks) ? d.attacks : [],
    spells: Array.isArray(d.spells) ? d.spells : [],
    inventory: Array.isArray(d.inventory) ? d.inventory : [],
    saveProficiencies: Array.isArray(d.saveProficiencies) ? d.saveProficiencies : base.saveProficiencies,
    skillProficiencies: Array.isArray(d.skillProficiencies) ? d.skillProficiencies : [],
    skillExpertise: Array.isArray(d.skillExpertise) ? d.skillExpertise : [],
  };
}

export const mod = (score: number) => Math.floor((score - 10) / 2);
export const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function totalLevel(c: CharacterData) {
  return c.classes.reduce((s, cl) => s + (Number(cl.level) || 0), 0);
}

export function profBonusForLevel(level: number) {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

// Standard multiclass spellcaster table (PHB / SRD). Row = caster level 1..20, columns = slot levels 1..9.
const SLOT_TABLE: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// Warlock pact magic: [slots, slot level] by warlock level
function pactSlots(level: number): { count: number; level: number } {
  if (level <= 0) return { count: 0, level: 0 };
  const count = level === 1 ? 1 : level <= 10 ? 2 : level <= 16 ? 3 : 4;
  const slotLevel = Math.min(5, Math.ceil(level / 2));
  return { count, level: slotLevel };
}

// Classes outside the SRD that players may type in: only the game math, so their sheets work (not offered in the creator).
const EXTRA_CLASS_INFO: ClassInfo[] = [
  { name: "Artificer", hitDie: 8, saves: ["con", "int"], caster: "half", spellAbility: "int", roundsUp: true },
];

export function classInfo(name: string): ClassInfo | undefined {
  const n = name.trim().toLowerCase();
  return CLASSES.find((c) => c.name.toLowerCase() === n) ?? EXTRA_CLASS_INFO.find((c) => c.name.toLowerCase() === n);
}

function casterTypeOf(cl: ClassLevel): CasterType {
  if (cl.casterOverride) return cl.casterOverride;
  const base = classInfo(cl.name)?.caster ?? "none";
  if (base === "none" && SUBCLASS_CASTER[cl.subclass?.trim()]) return SUBCLASS_CASTER[cl.subclass.trim()];
  return base;
}

// SRD armor: base AC and type. Matched against equipped items by name ("Chain Mail", "+1 studded leather armor"...).
const ARMOR: Record<string, { base: number; type: "light" | "medium" | "heavy" }> = {
  padded: { base: 11, type: "light" }, leather: { base: 11, type: "light" }, "studded leather": { base: 12, type: "light" },
  hide: { base: 12, type: "medium" }, "chain shirt": { base: 13, type: "medium" }, "scale mail": { base: 14, type: "medium" },
  breastplate: { base: 14, type: "medium" }, "half plate": { base: 15, type: "medium" },
  "ring mail": { base: 14, type: "heavy" }, "chain mail": { base: 16, type: "heavy" }, splint: { base: 17, type: "heavy" }, plate: { base: 18, type: "heavy" },
};

/** "+1 Chain Mail Armor" -> { key: "chain mail", bonus: 1 }. */
function armorName(raw: string) {
  const bonus = Number(raw.match(/\+(\d)/)?.[1] ?? 0);
  const key = raw.toLowerCase().replace(/\+\d/g, "").replace(/\b(armou?r|suit of|a)\b/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return { key, bonus };
}

/** True for SRD armor and shields, so new characters start out wearing them. */
export function isArmorOrShield(name: string) {
  const { key } = armorName(name);
  return key === "shield" || key in ARMOR;
}

/** Armor Class worked out from worn armor, a shield, and Unarmored Defense. Returns the AC and a short explanation. */
export function autoArmorClass(c: CharacterData, mods: Record<Ability, number>): { ac: number; source: string } {
  let armor: { name: string; base: number; type: "light" | "medium" | "heavy"; bonus: number } | null = null;
  let shield: { name: string; bonus: number } | null = null;
  for (const it of c.inventory) {
    if (!it.equipped || !it.name) continue;
    const { key, bonus } = armorName(it.name);
    if (key === "shield") shield ??= { name: it.name, bonus };
    else if (ARMOR[key] && (!armor || ARMOR[key].base + bonus > armor.base + armor.bonus)) armor = { name: it.name, ...ARMOR[key], bonus };
  }
  const levelIn = (name: string) => c.classes.filter((cl) => cl.name.trim().toLowerCase() === name).reduce((n, cl) => n + (Number(cl.level) || 0), 0);
  const shieldAc = shield ? 2 + shield.bonus : 0;
  const withShield = (ac: number, src: string) => ({ ac: ac + shieldAc, source: shield ? `${src} + ${shield.name}` : src });
  if (armor) {
    const dex = armor.type === "light" ? mods.dex : armor.type === "medium" ? Math.min(2, mods.dex) : 0;
    return withShield(armor.base + armor.bonus + dex, armor.name);
  }
  // No armor: the best of 10 + Dex, Unarmored Defense (Barbarian: + Con; Monk: + Wis, no shield) and Draconic Resilience
  const options: { ac: number; source: string }[] = [withShield(10 + mods.dex, "10 + Dex")];
  if (levelIn("barbarian") > 0) options.push(withShield(10 + mods.dex + mods.con, "Unarmored Defense (Dex + Con)"));
  if (levelIn("monk") > 0 && !shield) options.push({ ac: 10 + mods.dex + mods.wis, source: "Unarmored Defense (Dex + Wis)" });
  if (levelIn("sorcerer") > 0 && c.classes.some((cl) => /draconic/i.test(cl.subclass ?? ""))) options.push(withShield(13 + mods.dex, "Draconic Resilience (13 + Dex)"));
  return options.reduce((best, o) => (o.ac > best.ac ? o : best));
}

/** Extra hit points per level from the Tough feat (+2) and Dwarven Toughness (+1: Hill Dwarf in 2014, every Dwarf in 2024). */
export function bonusHpPerLevel(c: CharacterData): { perLevel: number; sources: string[] } {
  const sources: string[] = [];
  let perLevel = 0;
  // "Tough" written as its own entry in Features (a line like "Tough", "- Tough", "Feat: Tough"), not "Toughness"
  if (/(^|\n)\s*(?:[-*•]\s*)?(?:\*\*)?(?:feat:\s*)?tough(?:\*\*)?(?![a-z])/i.test(c.features ?? "")) { perLevel += 2; sources.push("Tough"); }
  const sp = (c.species ?? "").toLowerCase();
  if (c.rulesVersion === "2024" ? /\bdwarf\b/.test(sp) : /hill dwarf/.test(sp)) { perLevel += 1; sources.push("Dwarven Toughness"); }
  return { perLevel, sources };
}

export interface Derived {
  level: number;
  proficiencyBonus: number;
  mods: Record<Ability, number>;
  saves: Record<Ability, number>;
  skills: Record<string, number>;
  initiative: number;
  ac: number;
  /** How the automatic AC was worked out, e.g. "Chain Mail + Shield" (empty when typed in by hand) */
  acSource: string;
  maxHp: number;
  passivePerception: number;
  spellAbility?: Ability;
  spellSaveDC?: number;
  spellAttack?: number;
  /** One entry per spellcasting class (highest level first) */
  casters: { className: string; ability: Ability; dc: number; attack: number }[];
  spellSlots: number[]; // 9 entries
  pact: { count: number; level: number };
  hitDice: string;
}

export function derive(c: CharacterData): Derived {
  const level = Math.max(1, totalLevel(c));
  const pb = c.overrides.proficiencyBonus ?? profBonusForLevel(level);
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, mod(Number(c.abilities[a]) || 10)])) as Record<Ability, number>;
  const saves = Object.fromEntries(
    ABILITIES.map((a) => [a, mods[a] + (c.saveProficiencies.includes(a) ? pb : 0)]),
  ) as Record<Ability, number>;
  const skills: Record<string, number> = {};
  for (const s of SKILLS) {
    const prof = c.skillExpertise.includes(s.key) ? pb * 2 : c.skillProficiencies.includes(s.key) ? pb : 0;
    skills[s.key] = mods[s.ability] + prof;
  }

  // Hit points: max at 1st level of the first class, then average (rounded up) per level after.
  let autoHp = 0;
  let first = true;
  const hitDiceParts: string[] = [];
  for (const cl of c.classes) {
    const hd = classInfo(cl.name)?.hitDie ?? 8;
    const lv = Number(cl.level) || 0;
    if (lv <= 0) continue;
    hitDiceParts.push(`${lv}d${hd}`);
    for (let i = 0; i < lv; i++) {
      autoHp += (first ? hd : hd / 2 + 1) + mods.con;
      first = false;
    }
  }
  autoHp += bonusHpPerLevel(c).perLevel * level;
  const maxHp = c.hp.max ?? Math.max(1, autoHp);
  const autoAc = autoArmorClass(c, mods);

  // Spell slots (multiclass rules). A single casting class uses its own table (half/third round up).
  // Multiclassed: 2014 rounds half and third casters down; 2024 rounds half casters up, third casters down.
  const is2024 = c.rulesVersion === "2024";
  let casterLevel = 0;
  const casting = c.classes.filter((cl) => ["full", "half", "third"].includes(casterTypeOf(cl)));
  for (const cl of casting) {
    const t = casterTypeOf(cl);
    const lv = Number(cl.level) || 0;
    if (t === "full") casterLevel += lv;
    else if (t === "half") casterLevel += casting.length === 1 || is2024 || classInfo(cl.name)?.roundsUp ? Math.ceil(lv / 2) : Math.floor(lv / 2);
    else if (t === "third") casterLevel += casting.length === 1 ? Math.ceil(lv / 3) : Math.floor(lv / 3);
  }
  // A lone third-caster gets no slots before level 3. A lone half-caster gets none at level 1
  // in 2014 (in 2024, Paladins and Rangers cast from level 1).
  if (casting.length === 1) {
    const t = casterTypeOf(casting[0]);
    const lv = Number(casting[0].level) || 0;
    if ((t === "half" && lv < 2 && !is2024 && !classInfo(casting[0].name)?.roundsUp) || (t === "third" && lv < 3)) casterLevel = 0;
  }
  const row = casterLevel > 0 ? SLOT_TABLE[Math.min(20, casterLevel) - 1] : [];
  const spellSlots = Array.from({ length: 9 }, (_, i) => row[i] ?? 0);

  const warlockLevels = c.classes.filter((cl) => casterTypeOf(cl) === "pact").reduce((s, cl) => s + (Number(cl.level) || 0), 0);
  const pact = pactSlots(warlockLevels);

  // Spellcasting ability: from the highest-level casting class.
  const castingClasses = c.classes
    .filter((cl) => casterTypeOf(cl) !== "none")
    .sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0));
  const spellAbility = castingClasses.length ? classInfo(castingClasses[0].name)?.spellAbility ?? (casterTypeOf(castingClasses[0]) === "third" ? "int" : undefined) : undefined;

  // Each casting class has its own save DC and attack (they differ when the classes use different abilities)
  const casters: { className: string; ability: Ability; dc: number; attack: number }[] = [];
  for (const cl of castingClasses) {
    const ab = classInfo(cl.name)?.spellAbility ?? (casterTypeOf(cl) === "third" ? "int" : undefined);
    if (ab && !casters.some((x) => x.className === cl.name)) casters.push({ className: cl.name, ability: ab, dc: 8 + pb + mods[ab], attack: pb + mods[ab] });
  }

  const dc = spellAbility ? 8 + pb + mods[spellAbility] : undefined;
  const atk = spellAbility ? pb + mods[spellAbility] : undefined;

  return {
    level,
    proficiencyBonus: pb,
    mods,
    saves,
    skills,
    initiative: mods.dex + (Number(c.initiativeBonus) || 0),
    ac: c.ac ?? autoAc.ac,
    acSource: c.ac == null ? autoAc.source : "",
    maxHp,
    passivePerception: c.overrides.passivePerception ?? 10 + skills.perception,
    spellAbility,
    spellSaveDC: c.overrides.spellSaveDC ?? dc,
    spellAttack: c.overrides.spellAttack ?? atk,
    casters,
    spellSlots,
    pact,
    hitDice: hitDiceParts.join(" + "),
  };
}

/** Class names for a summary line. The total level is shown separately ("Level 3 ..."), so a single-class
 *  character shows no number here; multiclass characters show each class's own level. */
export function classSummary(c: CharacterData) {
  const multi = c.classes.length > 1;
  return c.classes.map((cl) => `${cl.name}${cl.subclass ? ` (${cl.subclass})` : ""}${multi ? ` ${cl.level}` : ""}`).join(" / ");
}

/** A readable list of what changed between two versions, for the DM approval screen. */
export function diffCharacter(before: CharacterData | null, after: CharacterData): string[] {
  if (!before) return ["New character"];
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
      for (const k of keys) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      return;
    }
    const show = (v: unknown) => {
      // Lists of spells, attacks, gear or classes read better as names
      if (Array.isArray(v) && v.every((x) => x && typeof x === "object" && "name" in x)) {
        return v.length ? v.map((x: any) => (x.level != null && "subclass" in x ? `${x.name} ${x.level}` : x.name) || "?").join(", ") : "(none)";
      }
      if (Array.isArray(v)) return v.length ? v.join(", ") : "(none)";
      if (v === null) return "(auto)";
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return s === undefined ? "(none)" : s.length > 120 ? s.slice(0, 117) + "..." : s;
    };
    out.push(`${path}: ${show(a)} → ${show(b)}`);
  };
  walk(before, after, "");
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  "abilities.str": "Strength", "abilities.dex": "Dexterity", "abilities.con": "Constitution", "abilities.int": "Intelligence", "abilities.wis": "Wisdom", "abilities.cha": "Charisma",
  "hp.max": "Max hit points", ac: "Armor class", saveProficiencies: "Saving throws", skillProficiencies: "Skills", skillExpertise: "Expertise",
  proficienciesText: "Proficiencies & languages", initiativeBonus: "Initiative bonus", classes: "Classes", spells: "Spells", attacks: "Attacks",
  inventory: "Equipment", features: "Features & traits", species: "Species / race", background: "Background", alignment: "Alignment", experience: "Experience",
  speed: "Speed", name: "Name",
};
/** Friendly name for a sheet field path like "abilities.dex". */
export function fieldLabel(f: string) {
  const key = f.replace(/\.\d+.*$/, "").replace(/^(classes|spells|attacks|inventory)\..*$/, "$1");
  return FIELD_LABELS[f] ?? FIELD_LABELS[key] ?? f.charAt(0).toUpperCase() + f.slice(1);
}
