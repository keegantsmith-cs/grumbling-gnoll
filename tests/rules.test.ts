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
