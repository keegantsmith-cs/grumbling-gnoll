// Rules data for the step-by-step character creator (game mechanics only, no rules text).
import type { Ability, RulesVersion } from "./character.ts";

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

export interface ClassCreation {
  skillCount: number;
  skills: string[] | "any";
  primary: string;
  subclassLevel2014: number;
  gold2014: string; // starting wealth dice (x10 already applied by multiplier)
  goldMultiplier: number;
  blurb: string;
}

export const CLASS_CREATION: Record<string, ClassCreation> = {
  Barbarian: { skillCount: 2, skills: ["animal_handling", "athletics", "intimidation", "nature", "perception", "survival"], primary: "Strength", subclassLevel2014: 3, gold2014: "2d4", goldMultiplier: 10, blurb: "A fierce warrior who fights with primal rage. Tough, hits hard, lots of hit points." },
  Bard: { skillCount: 3, skills: "any", primary: "Charisma", subclassLevel2014: 3, gold2014: "5d4", goldMultiplier: 10, blurb: "A performer whose music is magic. Great at talking, helping allies and knowing a bit of everything." },
  Cleric: { skillCount: 2, skills: ["history", "insight", "medicine", "persuasion", "religion"], primary: "Wisdom", subclassLevel2014: 1, gold2014: "5d4", goldMultiplier: 10, blurb: "A priest who wields divine magic. The party's healer and protector, sturdy in a fight." },
  Druid: { skillCount: 2, skills: ["arcana", "animal_handling", "insight", "medicine", "nature", "perception", "religion", "survival"], primary: "Wisdom", subclassLevel2014: 2, gold2014: "2d4", goldMultiplier: 10, blurb: "A keeper of nature who casts primal spells and can turn into animals." },
  Fighter: { skillCount: 2, skills: ["acrobatics", "animal_handling", "athletics", "history", "insight", "intimidation", "perception", "survival"], primary: "Strength or Dexterity", subclassLevel2014: 3, gold2014: "5d4", goldMultiplier: 10, blurb: "A master of weapons and armor. Simple to play, very effective." },
  Monk: { skillCount: 2, skills: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"], primary: "Dexterity and Wisdom", subclassLevel2014: 3, gold2014: "5d4", goldMultiplier: 1, blurb: "A martial artist who fights unarmed with speed and focus." },
  Paladin: { skillCount: 2, skills: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"], primary: "Strength and Charisma", subclassLevel2014: 3, gold2014: "5d4", goldMultiplier: 10, blurb: "A holy knight bound by an oath. Heavy armor, healing, and smiting foes." },
  Ranger: { skillCount: 3, skills: ["animal_handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"], primary: "Dexterity and Wisdom", subclassLevel2014: 3, gold2014: "5d4", goldMultiplier: 10, blurb: "A hunter and tracker of the wilds, deadly with a bow, with a little nature magic." },
  Rogue: { skillCount: 4, skills: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleight_of_hand", "stealth"], primary: "Dexterity", subclassLevel2014: 3, gold2014: "4d4", goldMultiplier: 10, blurb: "A sneaky expert: locks, traps, stealth, and big sneak-attack damage." },
  Sorcerer: { skillCount: 2, skills: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"], primary: "Charisma", subclassLevel2014: 1, gold2014: "3d4", goldMultiplier: 10, blurb: "Born with magic in the blood. Fewer spells than a wizard, but can bend them." },
  Warlock: { skillCount: 2, skills: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"], primary: "Charisma", subclassLevel2014: 1, gold2014: "4d4", goldMultiplier: 10, blurb: "Made a pact with a powerful being for magic. Eldritch Blast and spooky tricks." },
  Wizard: { skillCount: 2, skills: ["arcana", "history", "insight", "investigation", "medicine", "religion"], primary: "Intelligence", subclassLevel2014: 2, gold2014: "4d4", goldMultiplier: 10, blurb: "A scholar of magic with the biggest spell list. Fragile but powerful." },
};

export function subclassLevel(className: string, rules: RulesVersion) {
  if (rules === "2024") return 3;
  return CLASS_CREATION[className]?.subclassLevel2014 ?? 3;
}

/** Skill proficiencies each background gives. */
export const BACKGROUND_SKILLS: Record<RulesVersion, Record<string, string[]>> = {
  "2014": {
    Acolyte: ["insight", "religion"], Charlatan: ["deception", "sleight_of_hand"], Criminal: ["deception", "stealth"],
    Entertainer: ["acrobatics", "performance"], "Folk Hero": ["animal_handling", "survival"], "Guild Artisan": ["insight", "persuasion"],
    Hermit: ["medicine", "religion"], Noble: ["history", "persuasion"], Outlander: ["athletics", "survival"], Sage: ["arcana", "history"],
    Sailor: ["athletics", "perception"], Soldier: ["athletics", "intimidation"], Urchin: ["sleight_of_hand", "stealth"],
  },
  "2024": {
    Acolyte: ["insight", "religion"], Artisan: ["investigation", "persuasion"], Charlatan: ["deception", "sleight_of_hand"],
    Criminal: ["sleight_of_hand", "stealth"], Entertainer: ["acrobatics", "performance"], Farmer: ["animal_handling", "nature"],
    Guard: ["athletics", "perception"], Guide: ["stealth", "survival"], Hermit: ["medicine", "religion"], Merchant: ["animal_handling", "persuasion"],
    Noble: ["history", "persuasion"], Sage: ["arcana", "history"], Sailor: ["acrobatics", "perception"], Scribe: ["investigation", "perception"],
    Soldier: ["athletics", "intimidation"], Wayfarer: ["insight", "stealth"],
  },
};

/** 2024 backgrounds: the three abilities you may raise (+2/+1 or +1/+1/+1). */
export const BACKGROUND_ABILITIES_2024: Record<string, Ability[]> = {
  Acolyte: ["int", "wis", "cha"], Artisan: ["str", "dex", "int"], Charlatan: ["dex", "con", "cha"], Criminal: ["dex", "con", "int"],
  Entertainer: ["str", "dex", "cha"], Farmer: ["str", "con", "wis"], Guard: ["str", "int", "wis"], Guide: ["dex", "con", "wis"],
  Hermit: ["con", "wis", "cha"], Merchant: ["con", "int", "cha"], Noble: ["str", "int", "cha"], Sage: ["con", "int", "wis"],
  Sailor: ["str", "dex", "wis"], Scribe: ["dex", "int", "wis"], Soldier: ["str", "dex", "con"], Wayfarer: ["dex", "wis", "cha"],
};

export interface SpeciesInfo { bonuses: Partial<Record<Ability, number>>; choose?: { count: number; amount: number; exclude?: Ability[] }; speed: number; note?: string }

/** 2014 race ability increases and speed. Races not listed use the flexible +2/+1 rule. */
export const SPECIES_2014: Record<string, SpeciesInfo> = {
  Dragonborn: { bonuses: { str: 2, cha: 1 }, speed: 30 },
  "Hill Dwarf": { bonuses: { con: 2, wis: 1 }, speed: 25 },
  "Mountain Dwarf": { bonuses: { con: 2, str: 2 }, speed: 25 },
  "High Elf": { bonuses: { dex: 2, int: 1 }, speed: 30 },
  "Wood Elf": { bonuses: { dex: 2, wis: 1 }, speed: 35 },
  "Drow (Dark Elf)": { bonuses: { dex: 2, cha: 1 }, speed: 30 },
  "Forest Gnome": { bonuses: { int: 2, dex: 1 }, speed: 25 },
  "Rock Gnome": { bonuses: { int: 2, con: 1 }, speed: 25 },
  "Half-Elf": { bonuses: { cha: 2 }, choose: { count: 2, amount: 1, exclude: ["cha"] }, speed: 30 },
  "Half-Orc": { bonuses: { str: 2, con: 1 }, speed: 30 },
  "Lightfoot Halfling": { bonuses: { dex: 2, cha: 1 }, speed: 25 },
  "Stout Halfling": { bonuses: { dex: 2, con: 1 }, speed: 25 },
  Human: { bonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30 },
  "Variant Human": { bonuses: {}, choose: { count: 2, amount: 1 }, speed: 30, note: "Also gains one skill and one feat of your choice." },
  Tiefling: { bonuses: { cha: 2, int: 1 }, speed: 30 },
};

export const SPEED_2024: Record<string, number> = { Dwarf: 30, Goliath: 35 };

export function averageHpPerLevel(hitDie: number) {
  return hitDie / 2 + 1;
}
