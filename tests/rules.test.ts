import { test } from "node:test";
import assert from "node:assert/strict";
import { rollDice, diceList } from "../shared/dice.ts";
import { blankCharacter, derive, diffCharacter, profBonusForLevel } from "../shared/character.ts";
import { generateCave, generateDungeon, mapFromDesign } from "../shared/mapgen.ts";

// A fake random source so dice results are predictable
const seq = (...vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

test("dice: simple expression with modifier", () => {
  const r = rollDice("2d6+3", seq(0, 0.99)); // 1 and 6
  assert.equal(r.total, 1 + 6 + 3);
});

test("dice: advantage keeps the higher d20 and spots natural 20s", () => {
  const r = rollDice("adv+5", seq(0.2, 0.99)); // 5 and 20
  assert.equal(r.total, 25);
  assert.equal(r.crit, "success");
  assert.deepEqual(diceList(r).map((d) => d.kept), [false, true]);
});

test("dice: 4d6 drop lowest", () => {
  const r = rollDice("4d6dl1", seq(0, 0.5, 0.99, 0.99)); // 1,4,6,6 -> 16
  assert.equal(r.total, 16);
});

test("dice: rejects nonsense and huge rolls", () => {
  assert.throws(() => rollDice("banana"));
  assert.throws(() => rollDice("500d6"));
});

test("character: proficiency bonus by level", () => {
  assert.deepEqual([1, 4, 5, 9, 13, 17, 20].map(profBonusForLevel), [2, 2, 3, 4, 5, 6, 6]);
});

test("character: wizard 5 numbers", () => {
  const c = { ...blankCharacter(), classes: [{ name: "Wizard", subclass: "", level: 5 }], abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 }, saveProficiencies: ["int", "wis"] as any };
  const d = derive(c);
  assert.equal(d.proficiencyBonus, 3);
  assert.equal(d.spellSaveDC, 15);
  assert.deepEqual(d.spellSlots.slice(0, 4), [4, 3, 2, 0]);
  assert.equal(d.maxHp, 6 + 2 + 4 * (4 + 2)); // max at 1st, then average 4 + Con 2
});

test("character: multiclass paladin 2 / sorcerer 3 slots and warlock pact magic", () => {
  const ps = derive({ ...blankCharacter(), classes: [{ name: "Paladin", subclass: "", level: 2 }, { name: "Sorcerer", subclass: "", level: 3 }] });
  assert.deepEqual(ps.spellSlots.slice(0, 3), [4, 3, 0]); // caster level 1 + 3 = 4
  const wl = derive({ ...blankCharacter(), classes: [{ name: "Warlock", subclass: "", level: 5 }] });
  assert.deepEqual(wl.pact, { count: 2, level: 3 });
});

test("character: Eldritch Knight gets third-caster slots from level 3", () => {
  const ek = (lvl: number) => derive({ ...blankCharacter(), classes: [{ name: "Fighter", subclass: "Eldritch Knight", level: lvl }] });
  assert.equal(ek(2).spellSlots[0], 0);
  assert.equal(ek(3).spellSlots[0], 2);
  assert.equal(ek(3).spellAbility, "int");
});

test("character: diff lists readable changes", () => {
  const a = blankCharacter();
  const lines = diffCharacter(a, { ...a, abilities: { ...a.abilities, dex: 15 }, spells: [{ name: "Shield", level: 1, prepared: true, notes: "" }] });
  assert.ok(lines.includes("abilities.dex: 10 → 15"));
  assert.ok(lines.some((l) => l.startsWith("spells: (none) → Shield")));
});

test("maps: dungeon is repeatable from a seed and has rooms with floor", () => {
  const a = generateDungeon(40, 30, 1234), b = generateDungeon(40, 30, 1234);
  assert.deepEqual(a.tiles, b.tiles);
  assert.ok(a.rooms.length >= 4);
  for (const r of a.rooms) assert.equal(a.tiles[r.y + 1][r.x + 1], ".");
});

test("maps: cave has open ground; AI layouts are clamped inside the grid", () => {
  assert.ok(generateCave(40, 30, 7).tiles.join("").includes("."));
  const m = mapFromDesign(20, 20, 1, [{ label: "1", name: "Huge", x: -5, y: 50, w: 99, h: 99, shape: "rect" }], []);
  assert.equal(m.rooms[0].x >= 1 && m.rooms[0].x + m.rooms[0].w <= 19, true);
});

import { evaluateEncounter } from "../shared/encounter.ts";

test("encounters: 2014 multiplier and thresholds", () => {
  const r = evaluateEncounter("2014", [1, 1, 1, 1], [{ cr: "1/4", count: 4 }]);
  assert.equal(r.totalXp, 200);
  assert.equal(r.multiplier, 2);
  assert.equal(r.adjustedXp, 400);
  assert.equal(r.difficulty, "Deadly");
  // small parties get a bigger multiplier, big parties a smaller one
  assert.equal(evaluateEncounter("2014", [3, 3], [{ cr: "1", count: 1 }]).multiplier, 1.5);
  assert.equal(evaluateEncounter("2014", [3, 3, 3, 3, 3, 3], [{ cr: "1", count: 2 }]).multiplier, 1);
});

test("encounters: 2024 budget", () => {
  const r = evaluateEncounter("2024", [1, 1, 1, 1], [{ cr: "1/4", count: 4 }]);
  assert.equal(r.adjustedXp, 200);
  assert.equal(r.difficulty, "Low");
  assert.equal(evaluateEncounter("2024", [5, 5, 5, 5], [{ cr: "5", count: 2 }]).difficulty, "High"); // 3600: over Moderate (3000), under High (4400)
  assert.equal(evaluateEncounter("2024", [5, 5, 5, 5], [{ cr: "3", count: 4 }]).difficulty, "Moderate"); // 2800
});

// ---------------------------------------------------------------------------
// Core 5e math, checked against the 2014 PHB/DMG (SRD 5.1) and 2024 PHB/DMG (SRD 5.2)
// ---------------------------------------------------------------------------
import { mod, type CharacterData, type ClassLevel, type RulesVersion } from "../shared/character.ts";
import {
  POINT_BUY_COST, POINT_BUY_BUDGET, STANDARD_ARRAY, SPECIES_2014, BACKGROUND_SKILLS, BACKGROUND_ABILITIES_2024, CLASS_CREATION,
  asiLevels, classSkillChoices, speciesDarkvision, speciesSpeed, subclassLevel, averageHpPerLevel,
} from "../shared/creation.ts";
import { XP_BY_CR, xpForCr } from "../shared/encounter.ts";

const char = (rules: RulesVersion, classes: ClassLevel[], extra: Partial<CharacterData> = {}): CharacterData =>
  ({ ...blankCharacter(rules), classes, ...extra });
const slots = (rules: RulesVersion, classes: ClassLevel[]) => derive(char(rules, classes)).spellSlots;
const cl = (name: string, level: number, subclass = ""): ClassLevel => ({ name, subclass, level });

test("rules: ability modifiers", () => {
  assert.deepEqual([1, 3, 8, 9, 10, 11, 12, 15, 18, 20, 30].map(mod), [-5, -4, -1, -1, 0, 0, 1, 2, 4, 5, 10]);
});

test("rules: proficiency bonus at every tier boundary", () => {
  for (const [lvl, pb] of [[1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4], [13, 5], [16, 5], [17, 6], [20, 6]]) assert.equal(profBonusForLevel(lvl), pb, `level ${lvl}`);
});

test("rules: saves, skills, expertise, passive Perception and initiative", () => {
  const d = derive(char("2014", [cl("Rogue", 5)], {
    abilities: { str: 10, dex: 16, con: 12, int: 14, wis: 13, cha: 8 },
    saveProficiencies: ["dex", "int"], skillProficiencies: ["perception", "stealth"], skillExpertise: ["stealth"], initiativeBonus: 0,
  }));
  assert.equal(d.saves.dex, 3 + 3);
  assert.equal(d.saves.wis, 1);
  assert.equal(d.skills.perception, 1 + 3);
  assert.equal(d.skills.stealth, 3 + 6); // expertise doubles proficiency
  assert.equal(d.skills.athletics, 0);
  assert.equal(d.passivePerception, 14);
  assert.equal(d.initiative, 3);
  assert.equal(d.ac, 13); // no armor entered: 10 + Dex
  assert.equal(derive(char("2024", [cl("Fighter", 1)], { initiativeBonus: 2 })).initiative, 2); // e.g. 2024 Alert adds proficiency
});

test("rules: hit points use max at 1st level, then the rounded-up average, with Con on every level", () => {
  assert.deepEqual([6, 8, 10, 12].map(averageHpPerLevel), [4, 5, 6, 7]);
  const abilities = { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10 };
  assert.equal(derive(char("2014", [cl("Barbarian", 1)], { abilities })).maxHp, 14);
  assert.equal(derive(char("2024", [cl("Fighter", 3)], { abilities })).maxHp, 12 + 2 * 8);
  // multiclass: only the very first class level is maxed
  const mc = derive(char("2014", [cl("Fighter", 1), cl("Wizard", 2)], { abilities }));
  assert.equal(mc.maxHp, 12 + 2 * 6);
  assert.equal(mc.hitDice, "1d10 + 2d6");
  // raising Con raises HP retroactively
  assert.equal(derive(char("2014", [cl("Wizard", 4)], { abilities: { ...abilities, con: 16 } })).maxHp, 9 + 3 * 7);
  // a hand-entered maximum (rolled HP, Tough, Dwarven Toughness) wins
  assert.equal(derive(char("2014", [cl("Wizard", 4)], { hp: { max: 30, current: 30, temp: 0 } })).maxHp, 30);
});

test("rules: spell save DC and attack bonus", () => {
  const d = derive(char("2024", [cl("Cleric", 9)], { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 } }));
  assert.equal(d.spellAbility, "wis");
  assert.equal(d.spellSaveDC, 8 + 4 + 4);
  assert.equal(d.spellAttack, 8);
  assert.equal(derive(char("2014", [cl("Fighter", 5)])).spellSaveDC, undefined);
  assert.equal(derive(char("2014", [cl("Rogue", 3, "Arcane Trickster")], { abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 } })).spellSaveDC, 13);
});

test("rules: full caster slot table (both editions)", () => {
  for (const rules of ["2014", "2024"] as const) {
    assert.deepEqual(slots(rules, [cl("Wizard", 1)]), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(slots(rules, [cl("Bard", 3)]).slice(0, 3), [4, 2, 0]);
    assert.deepEqual(slots(rules, [cl("Cleric", 11)]), [4, 3, 3, 3, 2, 1, 0, 0, 0]);
    assert.deepEqual(slots(rules, [cl("Druid", 18)]), [4, 3, 3, 3, 3, 1, 1, 1, 1]);
    assert.deepEqual(slots(rules, [cl("Sorcerer", 20)]), [4, 3, 3, 3, 3, 2, 2, 1, 1]);
  }
});

test("rules: Paladin/Ranger get slots at level 2 in 2014 but at level 1 in 2024", () => {
  assert.equal(slots("2014", [cl("Paladin", 1)])[0], 0);
  assert.equal(slots("2014", [cl("Paladin", 2)])[0], 2);
  assert.equal(slots("2024", [cl("Paladin", 1)])[0], 2);
  assert.equal(slots("2024", [cl("Ranger", 1)])[0], 2);
  for (const rules of ["2014", "2024"] as const) {
    assert.deepEqual(slots(rules, [cl("Ranger", 3)]).slice(0, 2), [3, 0]);
    assert.deepEqual(slots(rules, [cl("Paladin", 5)]).slice(0, 3), [4, 2, 0]);
    assert.deepEqual(slots(rules, [cl("Paladin", 9)]).slice(0, 4), [4, 3, 2, 0]);
    assert.deepEqual(slots(rules, [cl("Ranger", 20)]).slice(0, 6), [4, 3, 3, 3, 2, 0]);
  }
});

test("rules: Eldritch Knight / Arcane Trickster third-caster table", () => {
  for (const rules of ["2014", "2024"] as const) {
    assert.deepEqual(slots(rules, [cl("Fighter", 3, "Eldritch Knight")]).slice(0, 2), [2, 0]);
    assert.deepEqual(slots(rules, [cl("Rogue", 7, "Arcane Trickster")]).slice(0, 3), [4, 2, 0]);
    assert.deepEqual(slots(rules, [cl("Fighter", 13, "Eldritch Knight")]).slice(0, 4), [4, 3, 2, 0]);
    assert.deepEqual(slots(rules, [cl("Rogue", 19, "Arcane Trickster")]).slice(0, 5), [4, 3, 3, 1, 0]);
  }
});

test("rules: multiclass caster level rounds half casters down in 2014, up in 2024", () => {
  // Paladin 3 / Wizard 1: 2014 = 1 + 1 = 2 -> [3]; 2024 = 2 + 1 = 3 -> [4, 2]
  assert.deepEqual(slots("2014", [cl("Paladin", 3), cl("Wizard", 1)]).slice(0, 2), [3, 0]);
  assert.deepEqual(slots("2024", [cl("Paladin", 3), cl("Wizard", 1)]).slice(0, 2), [4, 2]);
  // a single level of Paladin adds nothing to a multiclass caster in 2014
  assert.deepEqual(slots("2014", [cl("Paladin", 1), cl("Sorcerer", 1)]).slice(0, 2), [2, 0]);
  // third casters round down in both editions: EK 4 (1) + Wizard 2 = 3 -> [4, 2]
  for (const rules of ["2014", "2024"] as const) assert.deepEqual(slots(rules, [cl("Fighter", 4, "Eldritch Knight"), cl("Wizard", 2)]).slice(0, 2), [4, 2]);
  // a non-caster class doesn't count, and the lone caster uses its own table
  assert.deepEqual(slots("2014", [cl("Paladin", 3), cl("Fighter", 2)]).slice(0, 2), [3, 0]);
  assert.equal(slots("2014", [cl("Paladin", 1), cl("Fighter", 4)])[0], 0);
});

test("rules: Warlock pact magic, kept apart from multiclass slots", () => {
  const pact = (l: number) => derive(char("2014", [cl("Warlock", l)])).pact;
  assert.deepEqual([1, 2, 3, 5, 7, 9, 11, 17, 20].map(pact), [
    { count: 1, level: 1 }, { count: 2, level: 1 }, { count: 2, level: 2 }, { count: 2, level: 3 }, { count: 2, level: 4 },
    { count: 2, level: 5 }, { count: 3, level: 5 }, { count: 4, level: 5 }, { count: 4, level: 5 },
  ]);
  const mc = derive(char("2024", [cl("Warlock", 3), cl("Sorcerer", 2)]));
  assert.deepEqual(mc.spellSlots.slice(0, 2), [3, 0]);
  assert.deepEqual(mc.pact, { count: 2, level: 2 });
});

test("rules: subclass levels differ in 2014 but are all 3rd level in 2024", () => {
  const early: Record<string, number> = { Cleric: 1, Sorcerer: 1, Warlock: 1, Druid: 2, Wizard: 2 };
  for (const name of Object.keys(CLASS_CREATION)) {
    assert.equal(subclassLevel(name, "2014"), early[name] ?? 3, name);
    assert.equal(subclassLevel(name, "2024"), 3, name);
  }
});

test("rules: ability score improvement levels", () => {
  assert.deepEqual(asiLevels("Wizard", "2014"), [4, 8, 12, 16, 19]);
  assert.deepEqual(asiLevels("Fighter", "2014"), [4, 6, 8, 12, 14, 16, 19]);
  assert.deepEqual(asiLevels("Rogue", "2014"), [4, 8, 10, 12, 16, 19]);
  assert.deepEqual(asiLevels("Wizard", "2024"), [4, 8, 12, 16]); // 19 is an Epic Boon
  assert.deepEqual(asiLevels("Fighter", "2024"), [4, 6, 8, 12, 14, 16]);
});

test("rules: standard array and point buy", () => {
  assert.deepEqual(STANDARD_ARRAY, [15, 14, 13, 12, 10, 8]);
  assert.equal(POINT_BUY_BUDGET, 27);
  assert.deepEqual([8, 9, 10, 11, 12, 13, 14, 15].map((s) => POINT_BUY_COST[s]), [0, 1, 2, 3, 4, 5, 7, 9]);
  // 15, 15, 15, 8, 8, 8 is exactly 27 points
  assert.equal([15, 15, 15, 8, 8, 8].reduce((s, v) => s + POINT_BUY_COST[v], 0), 27);
});

test("rules: class skill choices", () => {
  const count = Object.fromEntries(Object.entries(CLASS_CREATION).map(([k, v]) => [k, v.skillCount]));
  assert.deepEqual(count, { Barbarian: 2, Bard: 3, Cleric: 2, Druid: 2, Fighter: 2, Monk: 2, Paladin: 2, Ranger: 3, Rogue: 4, Sorcerer: 2, Warlock: 2, Wizard: 2 });
  assert.equal(classSkillChoices("Bard", "2024"), "any");
  assert.equal((classSkillChoices("Rogue", "2014") as string[]).length, 11);
  assert.ok((classSkillChoices("Rogue", "2014") as string[]).includes("performance"));
  assert.ok(!(classSkillChoices("Rogue", "2024") as string[]).includes("performance"));
  assert.ok(!(classSkillChoices("Fighter", "2014") as string[]).includes("persuasion"));
  assert.ok((classSkillChoices("Fighter", "2024") as string[]).includes("persuasion"));
  assert.ok((classSkillChoices("Wizard", "2024") as string[]).includes("nature"));
  assert.deepEqual(classSkillChoices("Cleric", "2024"), classSkillChoices("Cleric", "2014"));
});

test("rules: backgrounds give two skills; 2024 backgrounds list three abilities", () => {
  for (const rules of ["2014", "2024"] as const) for (const [bg, s] of Object.entries(BACKGROUND_SKILLS[rules])) assert.equal(new Set(s).size, 2, `${rules} ${bg}`);
  assert.deepEqual(BACKGROUND_SKILLS["2014"].Criminal, ["deception", "stealth"]);
  assert.deepEqual(BACKGROUND_SKILLS["2024"].Criminal, ["sleight_of_hand", "stealth"]);
  assert.equal(Object.keys(BACKGROUND_ABILITIES_2024).length, 16);
  for (const [bg, a] of Object.entries(BACKGROUND_ABILITIES_2024)) assert.equal(new Set(a).size, 3, bg);
  assert.deepEqual(BACKGROUND_ABILITIES_2024.Soldier, ["str", "dex", "con"]);
});

test("rules: 2014 racial ability increases and speeds", () => {
  const total = (r: string) => Object.values(SPECIES_2014[r].bonuses).reduce((s, v) => s + (v ?? 0), 0) + (SPECIES_2014[r].choose?.count ?? 0) * (SPECIES_2014[r].choose?.amount ?? 0);
  for (const r of Object.keys(SPECIES_2014)) assert.equal(total(r), r === "Human" ? 6 : r === "Mountain Dwarf" || r === "Half-Elf" ? 4 : r === "Variant Human" ? 2 : 3, r);
  assert.deepEqual(SPECIES_2014["Mountain Dwarf"].bonuses, { con: 2, str: 2 });
  assert.equal(speciesSpeed("Hill Dwarf", "2014"), 25);
  assert.equal(speciesSpeed("Lightfoot Halfling", "2014"), 25);
  assert.equal(speciesSpeed("Wood Elf", "2014"), 35);
  assert.equal(speciesSpeed("Human", "2014"), 30);
  // 2024: dwarves and halflings walk 30, goliaths and wood elves 35
  assert.equal(speciesSpeed("Dwarf", "2024"), 30);
  assert.equal(speciesSpeed("Halfling", "2024"), 30);
  assert.equal(speciesSpeed("Goliath", "2024"), 35);
  assert.equal(speciesSpeed("Elf (Wood Elf)", "2024"), 35);
  assert.equal(speciesSpeed("Elf (High Elf)", "2024"), 30);
});

test("rules: default darkvision by species and edition", () => {
  assert.equal(speciesDarkvision("Hill Dwarf", "2014"), 60);
  assert.equal(speciesDarkvision("Drow (Dark Elf)", "2014"), 120);
  assert.equal(speciesDarkvision("Half-Orc", "2014"), 60);
  assert.equal(speciesDarkvision("Dragonborn", "2014"), null); // no darkvision in the 2014 PHB
  assert.equal(speciesDarkvision("Human", "2014"), null);
  assert.equal(speciesDarkvision("Dwarf", "2024"), 120);
  assert.equal(speciesDarkvision("Orc", "2024"), 120);
  assert.equal(speciesDarkvision("Elf (Drow)", "2024"), 120);
  assert.equal(speciesDarkvision("Elf (Wood Elf)", "2024"), 60);
  assert.equal(speciesDarkvision("Dragonborn", "2024"), 60);
  assert.equal(speciesDarkvision("Goliath", "2024"), null);
  assert.equal(speciesDarkvision("Halfling", "2024"), null);
});

test("rules: XP by challenge rating", () => {
  assert.equal(Object.keys(XP_BY_CR).length, 34);
  assert.deepEqual(["0", "1/8", "1/4", "1/2", "1", "5", "10", "20", "30"].map(xpForCr), [10, 25, 50, 100, 200, 1800, 5900, 25000, 155000]);
  assert.equal(xpForCr(0.25), 50);
  assert.equal(xpForCr("1/2 (100 XP)"), 100);
});

test("rules: 2014 encounter multipliers for every group size", () => {
  const mult = (monsters: number, party = 4) => evaluateEncounter("2014", Array(party).fill(1), [{ cr: "0", count: monsters }]).multiplier;
  assert.deepEqual([1, 2, 3, 6, 7, 10, 11, 14, 15, 20].map((n) => mult(n)), [1, 1.5, 2, 2, 2.5, 2.5, 3, 3, 4, 4]);
  assert.deepEqual([1, 2, 3, 7, 15].map((n) => mult(n, 2)), [1.5, 2, 2.5, 3, 5]); // fewer than 3 characters: one step up
  assert.deepEqual([1, 2, 3, 7, 15].map((n) => mult(n, 6)), [0.5, 1, 1.5, 2, 3]); // 6 or more: one step down
  const r = evaluateEncounter("2014", [5, 5, 5, 5], [{ cr: "5", count: 1 }]);
  assert.deepEqual(r.levels.map((l) => l.xp), [1000, 2000, 3000, 4400]);
  assert.equal(r.difficulty, "Easy");
  assert.equal(evaluateEncounter("2014", [5, 5, 5, 5], [{ cr: "5", count: 2 }]).difficulty, "Deadly"); // 3600 x 1.5 = 5400
  assert.equal(evaluateEncounter("2014", [20], [{ cr: "1", count: 1 }]).levels[3].xp, 12700);
});

test("rules: 2024 encounter budgets have no multiplier", () => {
  const r = evaluateEncounter("2024", [3, 3, 3, 3], [{ cr: "1", count: 8 }]);
  assert.equal(r.multiplier, 1);
  assert.equal(r.adjustedXp, 1600);
  assert.deepEqual(r.levels.map((l) => l.xp), [600, 900, 1600]);
  assert.equal(r.difficulty, "High");
  assert.deepEqual(evaluateEncounter("2024", [20], []).levels.map((l) => l.xp), [6400, 13200, 22000]);
});

test("dice: disadvantage, keep-highest, drop-highest, percentile and natural 1s", () => {
  const dis = rollDice("dis-1", seq(0, 0.99)); // 1 and 20 -> keeps the 1
  assert.equal(dis.total, 0);
  assert.equal(dis.crit, "fail");
  assert.equal(rollDice("4d6kh3", seq(0, 0.5, 0.99, 0.99)).total, 16);
  assert.equal(rollDice("4d6k3", seq(0, 0.5, 0.99, 0.99)).total, 16);
  assert.equal(rollDice("3d6dh1", seq(0, 0.5, 0.99)).total, 1 + 4);
  assert.equal(rollDice("d%", seq(0.999)).total, 100);
  assert.equal(rollDice("1d20+1d4-2", seq(0.99, 0)).total, 20 + 1 - 2);
  assert.equal(rollDice("1d20+1d4-2", seq(0.99, 0)).crit, "success");
  assert.equal(rollDice("2d20", seq(0.99, 0.99)).crit, undefined); // two d20s added together aren't a "natural 20"
  assert.throws(() => rollDice("1d20 5")); // not a d205
  assert.equal(rollDice(" 1d20 + 5 ", seq(0)).total, 6);
});
