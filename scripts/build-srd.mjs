// Builds srd/srd-5.1.json from the 5e-bits "5e-database" files (SRD 5.1 data).
// Usage: node scripts/build-srd.mjs <path to 5e-database/src/2014>
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const join = (a) => (Array.isArray(a) ? a.join("\n\n") : a ?? "");
const cr = (n) => (n === 0.125 ? "1/8" : n === 0.25 ? "1/4" : n === 0.5 ? "1/2" : String(n));
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

const spells = load("5e-SRD-Spells.json").map((s) => ({
  name: s.name,
  level: s.level,
  school: s.school?.name ?? "",
  castingTime: s.casting_time,
  range: s.range,
  components: s.components.join(", ") + (s.material ? ` (${s.material})` : ""),
  duration: (s.concentration ? "Concentration, " : "") + s.duration,
  ritual: !!s.ritual,
  classes: (s.classes ?? []).map((c) => c.name),
  attack: s.attack_type ?? "",
  save: s.dc?.dc_type?.name ?? "",
  damage: s.damage?.damage_at_slot_level?.[String(s.level)] ?? s.damage?.damage_at_character_level?.["1"] ?? "",
  damageType: s.damage?.damage_type?.name ?? "",
  desc: join(s.desc),
  higher: join(s.higher_level),
}));

const equipment = load("5e-SRD-Equipment.json").map((e) => ({
  name: e.name,
  category: e.equipment_category?.name ?? "",
  sub: e.category_range ?? e.armor_category ?? e.gear_category?.name ?? e.tool_category ?? "",
  cost: e.cost ? `${e.cost.quantity} ${e.cost.unit}` : "",
  weight: e.weight ?? 0,
  damage: e.damage ? `${e.damage.damage_dice} ${e.damage.damage_type?.name?.toLowerCase() ?? ""}`.trim() : "",
  twoHanded: e.two_handed_damage ? `${e.two_handed_damage.damage_dice}` : "",
  range: e.range?.long ? `${e.range.normal}/${e.range.long} ft.` : e.range?.normal && e.weapon_range === "Ranged" ? `${e.range.normal} ft.` : "",
  properties: (e.properties ?? []).map((p) => p.name),
  finesse: (e.properties ?? []).some((p) => p.index === "finesse"),
  ranged: e.weapon_range === "Ranged",
  ac: e.armor_class ? { base: e.armor_class.base, dex: !!e.armor_class.dex_bonus, max: e.armor_class.max_bonus ?? null } : null,
  strMin: e.str_minimum || 0,
  stealthDis: !!e.stealth_disadvantage,
  desc: join(e.desc),
}));

const magicItems = load("5e-SRD-Magic-Items.json").filter((m) => !m.variant).map((m) => ({
  name: m.name,
  category: m.equipment_category?.name ?? "",
  rarity: m.rarity?.name ?? "",
  attunement: join(m.desc).toLowerCase().includes("requires attunement"),
  desc: join(m.desc),
}));

const monsters = load("5e-SRD-Monsters.json").map((m) => {
  const prof = (prefix) => (m.proficiencies ?? []).filter((p) => p.proficiency.name.startsWith(prefix))
    .map((p) => `${p.proficiency.name.replace(prefix, "").trim()} ${sign(p.value)}`).join(", ");
  const ac = m.armor_class?.[0] ?? { value: 10 };
  const named = (list) => (list ?? []).map((a) => ({ name: a.name, description: a.desc }));
  const senses = Object.entries(m.senses ?? {}).map(([k, v]) => (k === "passive_perception" ? `passive Perception ${v}` : `${k.replace(/_/g, " ")} ${v}`)).join(", ");
  return {
    name: m.name,
    size: m.size,
    type: m.type + (m.subtype ? ` (${m.subtype})` : ""),
    alignment: m.alignment,
    armor_class: ac.value,
    armor_note: ac.armor ? ac.armor.map((x) => x.name.toLowerCase()).join(", ") : ac.type === "natural" ? "natural armor" : "",
    hit_points: m.hit_points,
    hit_dice: m.hit_points_roll ?? m.hit_dice,
    speed: Object.entries(m.speed ?? {}).map(([k, v]) => (k === "walk" ? v : `${k} ${v}`)).join(", "),
    str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma,
    saving_throws: prof("Saving Throw:"),
    skills: prof("Skill:"),
    damage_vulnerabilities: (m.damage_vulnerabilities ?? []).join(", "),
    damage_resistances: (m.damage_resistances ?? []).join(", "),
    damage_immunities: (m.damage_immunities ?? []).join(", "),
    condition_immunities: (m.condition_immunities ?? []).map((c) => c.name).join(", "),
    senses,
    languages: m.languages || "-",
    challenge_rating: cr(m.challenge_rating),
    proficiency_bonus: m.proficiency_bonus ?? 2,
    traits: named(m.special_abilities),
    actions: named(m.actions),
    bonus_actions: [],
    reactions: named(m.reactions),
    legendary_actions: named(m.legendary_actions),
    lore: "",
    conversion_notes: "",
    source_page: "SRD 5.1",
  };
});

const out = {
  license: "This data includes material from the System Reference Document 5.1 (\"SRD 5.1\") by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode). Data compiled by the 5e-bits 5e-database project (MIT License).",
  spells, equipment, magicItems, monsters,
};
fs.mkdirSync("srd", { recursive: true });
fs.writeFileSync("srd/srd-5.1.json", JSON.stringify(out));
console.log(`spells ${spells.length}, equipment ${equipment.length}, magic items ${magicItems.length}, monsters ${monsters.length}; ${(fs.statSync("srd/srd-5.1.json").size / 1e6).toFixed(2)} MB`);
