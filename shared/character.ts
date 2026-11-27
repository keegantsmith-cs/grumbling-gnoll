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

export function classInfo(name: string): ClassInfo | undefined {
  return CLASSES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
}

function casterTypeOf(cl: ClassLevel): CasterType {
  if (cl.casterOverride) return cl.casterOverride;
  const base = classInfo(cl.name)?.caster ?? "none";
  if (base === "none" && SUBCLASS_CASTER[cl.subclass?.trim()]) return SUBCLASS_CASTER[cl.subclass.trim()];
  return base;
}

export interface Derived {
  level: number;
  proficiencyBonus: number;
  mods: Record<Ability, number>;
  saves: Record<Ability, number>;
  skills: Record<string, number>;
  initiative: number;
  ac: number;
  maxHp: number;
  passivePerception: number;
  spellAbility?: Ability;
  spellSaveDC?: number;
  spellAttack?: number;
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
  const maxHp = c.hp.max ?? Math.max(1, autoHp);

  // Spell slots (multiclass rules). Single-class half casters round up; multiclass rounds down.
  let casterLevel = 0;
  const casting = c.classes.filter((cl) => ["full", "half", "third"].includes(casterTypeOf(cl)));
  for (const cl of casting) {
    const t = casterTypeOf(cl);
    const lv = Number(cl.level) || 0;
    if (t === "full") casterLevel += lv;
    else if (t === "half") casterLevel += casting.length === 1 ? Math.ceil(lv / 2) : Math.floor(lv / 2);
    else if (t === "third") casterLevel += casting.length === 1 ? Math.ceil(lv / 3) : Math.floor(lv / 3);
  }
  // A lone half-caster gets no slots at level 1; a lone third-caster gets none before level 3.
  if (casting.length === 1) {
    const t = casterTypeOf(casting[0]);
    const lv = Number(casting[0].level) || 0;
    if ((t === "half" && lv < 2) || (t === "third" && lv < 3)) casterLevel = 0;
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

  const dc = spellAbility ? 8 + pb + mods[spellAbility] : undefined;
  const atk = spellAbility ? pb + mods[spellAbility] : undefined;

  return {
    level,
    proficiencyBonus: pb,
    mods,
    saves,
    skills,
    initiative: mods.dex + (Number(c.initiativeBonus) || 0),
    ac: c.ac ?? 10 + mods.dex,
    maxHp,
    passivePerception: c.overrides.passivePerception ?? 10 + skills.perception,
    spellAbility,
    spellSaveDC: c.overrides.spellSaveDC ?? dc,
    spellAttack: c.overrides.spellAttack ?? atk,
    spellSlots,
    pact,
    hitDice: hitDiceParts.join(" + "),
  };
}

export function classSummary(c: CharacterData) {
  return c.classes.map((cl) => `${cl.name}${cl.subclass ? ` (${cl.subclass})` : ""} ${cl.level}`).join(" / ");
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
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return s === undefined ? "(none)" : s.length > 120 ? s.slice(0, 117) + "..." : s;
    };
    out.push(`${path}: ${show(a)} → ${show(b)}`);
  };
  walk(before, after, "");
  return out;
}
