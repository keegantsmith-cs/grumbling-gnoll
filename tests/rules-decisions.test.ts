// Rules the DM decided on: automatic armor AC, Tough / Dwarven Toughness, Artificer casting, one spell DC per class.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankCharacter, derive, isArmorOrShield, type CharacterData, type RulesVersion } from "../shared/character.ts";

function char(over: Partial<CharacterData> = {}, rules: RulesVersion = "2014"): CharacterData {
  return { ...blankCharacter(rules), ...over };
}
const item = (name: string, equipped = true) => ({ name, qty: 1, weight: 0, equipped, attuned: false, notes: "" });
const abil = (o: Partial<CharacterData["abilities"]>) => ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...o });

test("AC: no armor is 10 + Dex", () => {
  assert.equal(derive(char({ abilities: abil({ dex: 14 }) })).ac, 12);
});

test("AC: light armor adds full Dex, medium caps Dex at +2, heavy ignores Dex", () => {
  const dex18 = abil({ dex: 18 });
  assert.equal(derive(char({ abilities: dex18, inventory: [item("Studded Leather Armor")] })).ac, 16);
  assert.equal(derive(char({ abilities: dex18, inventory: [item("Half Plate")] })).ac, 17);
  assert.equal(derive(char({ abilities: dex18, inventory: [item("Chain mail")] })).ac, 16);
  assert.equal(derive(char({ abilities: abil({ dex: 8 }), inventory: [item("Plate Armor")] })).ac, 18, "heavy armor: low Dex doesn't count against you");
  assert.equal(derive(char({ abilities: abil({ dex: 8 }), inventory: [item("Scale mail")] })).ac, 13, "medium armor: negative Dex still applies");
});

test("AC: shields add 2, magic bonuses count, unworn armor is ignored", () => {
  const d = derive(char({ abilities: abil({ dex: 12 }), inventory: [item("+1 Chain Mail"), item("Shield")] }));
  assert.equal(d.ac, 19);
  assert.match(d.acSource, /Chain Mail \+ Shield/);
  assert.equal(derive(char({ abilities: abil({ dex: 12 }), inventory: [item("Plate", false)] })).ac, 11);
  assert.equal(derive(char({ inventory: [item("Leather pouch"), item("Shield +2")] })).ac, 14);
});

test("AC: Unarmored Defense for Barbarians (Dex + Con, shield OK) and Monks (Dex + Wis, no shield)", () => {
  const barb = char({ classes: [{ name: "Barbarian", subclass: "", level: 1 }], abilities: abil({ dex: 14, con: 16 }) });
  assert.equal(derive(barb).ac, 15);
  assert.equal(derive({ ...barb, inventory: [item("Shield")] }).ac, 17);
  assert.equal(derive({ ...barb, inventory: [item("Hide armor")] }).ac, 14, "wearing armor replaces Unarmored Defense");
  const monk = char({ classes: [{ name: "Monk", subclass: "", level: 1 }], abilities: abil({ dex: 16, wis: 14 }) });
  assert.equal(derive(monk).ac, 15);
  assert.equal(derive({ ...monk, inventory: [item("Shield")] }).ac, 15, "monks lose Unarmored Defense with a shield: 10 + 3 + 2");
});

test("AC: Draconic Bloodline sorcerers are 13 + Dex unarmored", () => {
  assert.equal(derive(char({ classes: [{ name: "Sorcerer", subclass: "Draconic Bloodline", level: 1 }], abilities: abil({ dex: 14 }) })).ac, 15);
});

test("AC typed in by hand always wins", () => {
  const d = derive(char({ ac: 21, inventory: [item("Plate")] }));
  assert.equal(d.ac, 21);
  assert.equal(d.acSource, "");
});

test("new characters start out wearing their armor and shield", () => {
  assert.equal(isArmorOrShield("Chain Mail"), true);
  assert.equal(isArmorOrShield("Leather Armor"), true);
  assert.equal(isArmorOrShield("Shield"), true);
  assert.equal(isArmorOrShield("Explorer's Pack"), false);
  assert.equal(isArmorOrShield("Leather pouch"), false);
});

test("HP: Tough feat adds 2 per level", () => {
  const base = char({ classes: [{ name: "Fighter", subclass: "", level: 4 }], abilities: abil({ con: 14 }) });
  // 10 + 2, then 3 × (6 + 2) = 36
  assert.equal(derive(base).maxHp, 36);
  assert.equal(derive({ ...base, features: "Second Wind\n- Tough\nAction Surge" }).maxHp, 44);
  assert.equal(derive({ ...base, features: "Feat: Tough" }).maxHp, 44);
  assert.equal(derive({ ...base, features: "Mountain-born: tough as stone" }).maxHp, 36, "the word in a sentence doesn't count");
});

test("HP: Dwarven Toughness is Hill Dwarf only in 2014, every Dwarf in 2024", () => {
  const cls = [{ name: "Cleric", subclass: "", level: 3 }];
  // Cleric 3, Con 10: 8 + 5 + 5 = 18
  assert.equal(derive(char({ classes: cls, species: "Hill Dwarf" })).maxHp, 21);
  assert.equal(derive(char({ classes: cls, species: "Mountain Dwarf" })).maxHp, 18);
  assert.equal(derive(char({ classes: cls, species: "Dwarf" }, "2024")).maxHp, 21);
  assert.equal(derive(char({ classes: cls, species: "Dwarf", features: "Tough" }, "2024")).maxHp, 27);
});

test("Artificer: casts from level 1 and rounds up, alone or multiclassed (both editions)", () => {
  for (const rules of ["2014", "2024"] as const) {
    assert.equal(derive(char({ classes: [{ name: "Artificer", subclass: "", level: 1 }] }, rules)).spellSlots[0], 2);
    assert.deepEqual(derive(char({ classes: [{ name: "Artificer", subclass: "", level: 5 }] }, rules)).spellSlots.slice(0, 2), [4, 2]);
    // Artificer 3 (rounds up to 2) + Wizard 1 = caster level 3 → 4 / 2
    assert.deepEqual(derive(char({ classes: [{ name: "Artificer", subclass: "", level: 3 }, { name: "Wizard", subclass: "", level: 1 }] }, rules)).spellSlots.slice(0, 2), [4, 2]);
  }
  const art = derive(char({ classes: [{ name: "Artificer", subclass: "", level: 2 }], abilities: abil({ int: 16 }) }));
  assert.equal(art.spellAbility, "int");
  assert.equal(art.spellSaveDC, 13);
  assert.equal(art.hitDice, "2d8");
});

test("multiclass casters get a spell save DC for each class", () => {
  const d = derive(char({ classes: [{ name: "Wizard", subclass: "", level: 3 }, { name: "Cleric", subclass: "", level: 2 }], abilities: abil({ int: 18, wis: 14 }) }));
  // Level 5: proficiency +3
  assert.deepEqual(d.casters.map((x) => [x.className, x.dc, x.attack]), [["Wizard", 15, 7], ["Cleric", 13, 5]]);
  assert.equal(d.spellSaveDC, 15, "the headline DC is still the highest-level casting class");
});
