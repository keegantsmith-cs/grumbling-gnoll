// The combat math: attacks, criticals, damage with resistances, death saves, and reading stat blocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { blankCharacter, derive } from "../shared/character.ts";
import {
  adjustDamage, cantripDice, characterActions, deathSave, doubleDice, findWeapon, gainTempHp, heal, healthWord, d20Expression,
  monsterCombatData, parseDamageString, parseDefenses, parseMonsterActions, resolveAttack, takeDamage,
} from "../shared/combat.ts";

const srd = JSON.parse(fs.readFileSync("srd/srd-5.1.json", "utf8"));
const monster = (name: string) => srd.monsters.find((m: any) => m.name === name);

test("stat blocks: a dragon's bite, claws, multiattack and fire breath become buttons", () => {
  const acts = parseMonsterActions(monster("Adult Red Dragon"));
  const bite = acts.find((a) => a.name === "Bite")!;
  assert.equal(bite.toHit, 14);
  assert.deepEqual(bite.damage, [{ dice: "2d10+8", type: "piercing" }, { dice: "2d6", type: "fire" }]);
  const multi = acts.find((a) => a.kind === "multiattack")!;
  assert.deepEqual(multi.multi, [{ name: "Bite", count: 1 }, { name: "Claw", count: 2 }]);
  const breath = acts.find((a) => a.name === "Fire Breath")!;
  assert.equal(breath.kind, "save");
  assert.deepEqual(breath.save, { ability: "dex", dc: 21, half: true });
  assert.deepEqual(breath.damage, [{ dice: "18d6", type: "fire" }]);
  // legendary actions are separate and cost something
  assert.equal(acts.find((a) => a.name === "Wing Attack")?.cost, 2);
});

test("stat blocks: recharge, uses per day, 'dice written with a space' and versatile damage", () => {
  const acts = parseMonsterActions({ actions: [
    { name: "Fire Breath (Recharge 5-6)", description: "The drake exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save, or half as much damage on a successful one." },
    { name: "Dryad Club", description: "Melee Weapon Attack: +2 to hit (+6 to hit with shillelagh), reach 5 ft., one target. Hit: 2 (1 d4) bludgeoning damage." },
    { name: "Longsword", description: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) slashing damage, or 8 (1d10 + 3) slashing damage if used with two hands." },
  ] });
  assert.equal(acts[0].recharge, "5–6");
  assert.equal(acts[0].name, "Fire Breath");
  assert.deepEqual(acts[1].damage, [{ dice: "1d4", type: "bludgeoning" }]);
  assert.deepEqual(acts[2].damage, [{ dice: "1d8+3", type: "slashing" }]);
});

test("stat blocks: every SRD monster's attacks have a to-hit and (almost always) damage", () => {
  let attacks = 0, withDamage = 0;
  for (const m of srd.monsters) for (const a of parseMonsterActions(m)) if (a.kind === "attack") { attacks++; assert.equal(typeof a.toHit, "number"); if (a.damage?.length) withDamage++; }
  assert.ok(attacks > 400);
  assert.ok(withDamage / attacks > 0.97, `${withDamage}/${attacks}`);
});

test("stat blocks: AC, saves, resistances", () => {
  const d = monsterCombatData(monster("Adult Red Dragon"));
  assert.equal(d.ac, 19);
  assert.equal(d.saves.dex, 6);
  assert.deepEqual(d.immune.map((x) => x.type), ["fire"]);
  assert.deepEqual(parseDefenses("bludgeoning; poison, necrotic").map((x) => x.type).sort(), ["bludgeoning", "necrotic", "poison"]);
  const werewolf = parseDefenses("bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered");
  assert.deepEqual(werewolf.map((x) => [x.type, x.nonmagical]), [["bludgeoning", true], ["piercing", true], ["slashing", true]]);
});

test("characters: blank attack numbers are filled in from stats (finesse, ranged, proficiency, magic)", () => {
  const c = { ...blankCharacter(), classes: [{ name: "Fighter", subclass: "", level: 5 }], abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 } } as any;
  c.attacks = [
    { name: "Longsword", bonus: "", damage: "", notes: "" },
    { name: "Rapier", bonus: "", damage: "", notes: "" },
    { name: "Longbow", bonus: "", damage: "", notes: "" },
    { name: "+1 Warhammer", bonus: "+9", damage: "1d8+6 bludgeoning", notes: "" },
  ];
  const { actions } = characterActions(c, derive(c));
  const by = (n: string) => actions.find((a) => a.name === n)!;
  assert.equal(by("Longsword").toHit, 3 + 3); // Str +3, proficiency +3
  assert.deepEqual(by("Longsword").damage, [{ dice: "1d8+3", type: "slashing" }]);
  assert.equal(by("Rapier").toHit, 3 + 3); // finesse: best of Str +3 / Dex +2
  assert.equal(by("Longbow").toHit, 2 + 3); // ranged uses Dex
  assert.match(by("Longbow").range!, /150\/600/);
  // typed-in numbers are kept exactly
  assert.equal(by("+1 Warhammer").toHit, 9);
  assert.deepEqual(by("+1 Warhammer").damage, [{ dice: "1d8+6", type: "bludgeoning" }]);
  assert.equal(by("+1 Warhammer").auto, false);
  assert.ok(by("Unarmed strike"));
});

test("characters: a +2 weapon adds +2 to hit and damage when the sheet is blank", () => {
  const c = { ...blankCharacter(), classes: [{ name: "Fighter", subclass: "", level: 1 }], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } } as any;
  c.attacks = [{ name: "+2 Shortsword", bonus: "", damage: "", notes: "" }];
  const a = characterActions(c, derive(c)).actions.find((x) => x.name === "+2 Shortsword")!;
  assert.equal(a.toHit, 0 + 2 + 2);
  assert.deepEqual(a.damage, [{ dice: "1d6+2", type: "piercing" }]);
});

test("characters: spells become attack or save buttons using the caster's numbers; cantrips grow with level", () => {
  const c = { ...blankCharacter(), classes: [{ name: "Wizard", subclass: "", level: 5 }], abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 } } as any;
  c.spells = [{ name: "Fire Bolt", level: 0, prepared: true, notes: "" }, { name: "Fireball", level: 3, prepared: true, notes: "" }, { name: "Shield", level: 1, prepared: true, notes: "" }];
  const facts: any = {
    "Fire Bolt": { name: "Fire Bolt", level: 0, attack: "ranged", save: "", damage: "1d10", damageType: "Fire", range: "120 feet", duration: "Instantaneous", higher: "" },
    Fireball: { name: "Fireball", level: 3, attack: "", save: "DEX", damage: "8d6", damageType: "Fire", range: "150 feet", duration: "Instantaneous", higher: "the damage increases by 1d6 for each slot level above 3rd.", desc: "or half as much damage on a successful one." },
  };
  const { actions } = characterActions(c, derive(c), (n) => facts[n]);
  const bolt = actions.find((a) => a.name === "Fire Bolt")!;
  assert.equal(bolt.kind, "attack");
  assert.equal(bolt.toHit, 4 + 3); // Int +4, proficiency +3
  assert.deepEqual(bolt.damage, [{ dice: "2d10", type: "fire" }]); // level 5: two dice
  const ball = actions.find((a) => a.name === "Fireball")!;
  assert.deepEqual(ball.save, { ability: "dex", dc: 8 + 3 + 4, half: true });
  assert.deepEqual(ball.upcast, { dice: "1d6", above: 3 });
  assert.equal(actions.find((a) => a.name === "Shield")!.kind, "other");
});

test("weapons: names are matched loosely", () => {
  assert.equal(findWeapon("+1 Longsword of Flame")?.key, "longsword");
  assert.equal(findWeapon("Crossbow, light")?.key, "light crossbow");
  assert.equal(findWeapon("Greatsword")?.key, "greatsword");
  assert.equal(findWeapon("Tentacle"), null);
});

test("attacks: natural 20 always hits, natural 1 always misses, otherwise total vs AC", () => {
  assert.equal(resolveAttack(20, 20, 30), "crit");
  assert.equal(resolveAttack(1, 12, 5), "fumble");
  assert.equal(resolveAttack(10, 15, 15), "hit"); // meeting AC hits
  assert.equal(resolveAttack(10, 14, 15), "miss");
  assert.equal(resolveAttack(10, 14, null), "unknown");
});

test("dice: critical hits double the dice, never the bonus", () => {
  assert.equal(doubleDice("2d10+8"), "4d10+8");
  assert.equal(doubleDice("d8+3"), "2d8+3");
  assert.equal(doubleDice("1d8+1d6+4"), "2d8+2d6+4");
  assert.equal(cantripDice("1d10", 11), "3d10");
  assert.equal(d20Expression(5, "adv"), "2d20kh1+5");
  assert.equal(d20Expression(-1, "dis"), "2d20kl1-1");
  assert.deepEqual(parseDamageString("1d8+3 slashing plus 2d6 fire"), [{ dice: "1d8+3", type: "slashing" }, { dice: "2d6", type: "fire" }]);
});

test("damage: resistance halves (rounding down), vulnerability doubles, immunity stops it, nonmagical-only resistance ignores magic weapons", () => {
  const def = { resist: [{ type: "fire" }, { type: "slashing", nonmagical: true }], vuln: [{ type: "cold" }], immune: [{ type: "poison" }] };
  assert.equal(adjustDamage(9, "fire", def).amount, 4);
  assert.equal(adjustDamage(9, "cold", def).amount, 18);
  assert.equal(adjustDamage(9, "poison", def).amount, 0);
  assert.equal(adjustDamage(9, "radiant", def).amount, 9);
  assert.equal(adjustDamage(10, "slashing", def, { magical: false }).amount, 5);
  assert.equal(adjustDamage(10, "slashing", def, { magical: true }).amount, 10);
  // a successful save halves first, then resistance halves again
  assert.equal(adjustDamage(21, "fire", def, { half: true }).amount, 5);
  // resistance and vulnerability to the same type cancel out
  assert.equal(adjustDamage(8, "fire", { resist: [{ type: "fire" }], vuln: [{ type: "fire" }], immune: [] }).amount, 8);
});

test("hit points: temporary HP soaks up damage first, HP never goes below 0, concentration DC is 10 or half the damage", () => {
  const r = takeDamage({ hp: 20, max: 30, temp: 5, isCharacter: true }, 12, { concentrating: true });
  assert.deepEqual([r.temp, r.hp, r.absorbed, r.taken], [0, 13, 5, 7]);
  assert.equal(r.concentrationDC, 10);
  assert.equal(takeDamage({ hp: 40, max: 40, temp: 0, isCharacter: true }, 30, { concentrating: true }).concentrationDC, 15);
  assert.equal(takeDamage({ hp: 5, max: 30, temp: 0, isCharacter: true }, 9).hp, 0);
  assert.equal(takeDamage({ hp: 5, max: 30, temp: 0, isCharacter: false }, 9).dropped, true);
  assert.equal(takeDamage({ hp: 20, max: 30, temp: 0, isCharacter: true }, 0, { concentrating: true }).concentrationDC, null);
});

test("hit points: dropping to 0, damage while down, and instant death", () => {
  // 5 HP, 35 damage on a 30 max character: 30 left over = dead outright
  assert.equal(takeDamage({ hp: 5, max: 30, temp: 0, isCharacter: true }, 35).dead, true);
  assert.equal(takeDamage({ hp: 5, max: 30, temp: 0, isCharacter: true }, 34).dead, false);
  // at 0 HP a hit is one death-save failure; a critical hit is two; huge damage is death
  const down = { hp: 0, max: 30, temp: 0, isCharacter: true, deathSaves: { successes: 1, failures: 0 } };
  assert.equal(takeDamage(down, 4).deathSaves!.failures, 1);
  assert.equal(takeDamage(down, 4, { crit: true }).deathSaves!.failures, 2);
  assert.equal(takeDamage({ ...down, deathSaves: { successes: 0, failures: 2 } }, 4).dead, true);
  assert.equal(takeDamage(down, 30).dead, true);
  // a monster at 0 just stays at 0
  assert.equal(takeDamage({ hp: 0, max: 30, temp: 0, isCharacter: false }, 4).hp, 0);
});

test("healing: capped at max HP, wakes a downed character and clears death saves, temp HP doesn't stack", () => {
  const h = heal({ hp: 0, max: 20, temp: 0, isCharacter: true, deathSaves: { successes: 2, failures: 2 } }, 7);
  assert.equal(h.hp, 7); assert.equal(h.revived, true); assert.deepEqual(h.deathSaves, { successes: 0, failures: 0 });
  assert.equal(heal({ hp: 18, max: 20, temp: 0, isCharacter: true }, 9).hp, 20);
  assert.equal(gainTempHp(5, 3), 5);
  assert.equal(gainTempHp(5, 8), 8);
});

test("death saves: 10+ succeeds, 1 is two failures, 20 gets you up with 1 HP, three of a kind ends it", () => {
  assert.equal(deathSave({ successes: 0, failures: 0 }, 10).successes, 1);
  assert.equal(deathSave({ successes: 0, failures: 0 }, 9).failures, 1);
  assert.equal(deathSave({ successes: 0, failures: 0 }, 1).failures, 2);
  const nat20 = deathSave({ successes: 1, failures: 2 }, 20);
  assert.deepEqual([nat20.outcome, nat20.hp, nat20.successes, nat20.failures], ["revived", 1, 0, 0]);
  assert.equal(deathSave({ successes: 2, failures: 0 }, 15).outcome, "stable");
  assert.equal(deathSave({ successes: 0, failures: 2 }, 5).outcome, "dead");
  assert.equal(deathSave({ successes: 0, failures: 2 }, 1).outcome, "dead");
});

test("what players see of a monster's health is only a rough word", () => {
  assert.equal(healthWord(30, 30), "healthy");
  assert.equal(healthWord(15, 30), "bloodied");
  assert.equal(healthWord(7, 30), "near death");
  assert.equal(healthWord(0, 30), "down");
  assert.equal(healthWord(null, 30), null);
});

test("stat blocks: breath weapons recharge on 5-6 even though the bundled SRD data lost that note", () => {
  const breath = parseMonsterActions(monster("Adult Red Dragon")).find((a) => a.name === "Fire Breath")!;
  assert.equal(breath.recharge, "5–6");
  const wyrm = parseMonsterActions(monster("Young Red Dragon")).find((a) => a.name === "Fire Breath")!;
  assert.equal(wyrm.recharge, "5–6");
  // ordinary attacks and legendary actions don't recharge
  assert.equal(parseMonsterActions(monster("Adult Red Dragon")).find((a) => a.name === "Bite")!.recharge, undefined);
});
