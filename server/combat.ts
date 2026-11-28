// Combat on the Table: who can do what, what the dice say, and what happens to hit points.
// Everything is worked out here on the server, from the character sheet or the monster's stat block,
// so players can't fake bonuses and DM-only numbers (monster AC, HP, actions) never leave the server.
import type { Socket } from "socket.io";
import { one, parseJSON, type Row } from "./db.ts";
import { derive, normalizeCharacter, ABILITIES, SKILLS, mod, type Ability, type CharacterData } from "../shared/character.ts";
import {
  characterActions, monsterCombatData, healthWord, STANDARD_OPTIONS,
  type Actor, type MonsterCombat, type SpellFacts,
} from "../shared/combat.ts";
import { srdMonster, srdSpell } from "./routes/srd.ts";


/** Loaded once per request: the sheet of a player's character, with its derived numbers. */
export function loadSheet(characterId: number | null | undefined) {
  if (!characterId) return null;
  const row = one("SELECT c.id, c.owner_id, c.campaign_id, c.data, ca.rules_version FROM characters c LEFT JOIN campaigns ca ON ca.id = c.campaign_id WHERE c.id = ?", characterId);
  if (!row) return null;
  const data = normalizeCharacter(parseJSON(row.data, {}), row.rules_version ?? "2014");
  return { row, data, dv: derive(data) };
}

/** A monster token's stored stat-block data, or (for tokens placed before this existed) the SRD entry with the same name. */
export function monsterData(t: Row): MonsterCombat | null {
  const stored = parseJSON<Partial<MonsterCombat>>(t.combat, {});
  if (stored && Array.isArray(stored.actions)) return stored as MonsterCombat;
  const base = String(t.name).replace(/\s+\d+$/, "").replace(/\s*\(\d+\)$/, "");
  const srd = srdMonster(base);
  return srd ? monsterCombatData(srd) : null;
}

function spellFacts(name: string): SpellFacts | undefined {
  const s = srdSpell(name) as any;
  if (!s) return undefined;
  return { name: s.name, level: s.level, attack: s.attack, save: s.save, damage: s.damage, damageType: s.damageType, range: s.range, duration: s.duration, higher: s.higher, desc: s.desc };
}

const ZERO = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } as Record<Ability, number>;

/** The full fighting profile of whatever stands behind a token. Only ever sent to the DM or the token's controller. */
export function buildActor(t: Row): Actor {
  const base = {
    tokenId: t.id as number, name: t.name as string, hp: t.hp as number | null, maxHp: t.max_hp as number | null,
    conditions: String(t.conditions ?? ""), concentrating: String(t.concentrating ?? ""),
  };
  const sheet = loadSheet(t.character_id);
  if (sheet) {
    const { data, dv } = sheet;
    const { actions, notes } = characterActions(data, dv, spellFacts);
    return {
      ...base, kind: "character", characterId: t.character_id, ownerId: sheet.row.owner_id,
      hp: data.hp.current, maxHp: dv.maxHp, tempHp: data.hp.temp ?? 0, deathSaves: data.deathSaves,
      ac: dv.ac, mods: dv.mods, saves: dv.saves, skills: dv.skills, initiative: dv.initiative,
      actions, resist: [], vuln: [], immune: [], condImmune: [], traits: [], notes,
      proficiencyBonus: dv.proficiencyBonus, spellSaveDC: dv.spellSaveDC ?? null, rulesVersion: data.rulesVersion,
    };
  }
  const m = monsterData(t);
  const abilities = m?.abilities ?? ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } as Record<Ability, number>);
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, mod(abilities[a])])) as Record<Ability, number>;
  const saves = Object.fromEntries(ABILITIES.map((a) => [a, m?.saves?.[a] ?? mods[a]])) as Record<Ability, number>;
  const skills: Record<string, number> = {};
  for (const s of SKILLS) skills[s.key] = m?.skills?.[s.key] ?? mods[s.ability];
  return {
    ...base, kind: "monster", characterId: null, ownerId: t.controlled_by ?? null,
    tempHp: Number(t.temp_hp) || 0, deathSaves: null,
    ac: t.ac ?? m?.ac ?? null, mods: m ? mods : ZERO, saves, skills, initiative: mods.dex,
    actions: m?.actions ?? [], resist: m?.resist ?? [], vuln: m?.vuln ?? [], immune: m?.immune ?? [], condImmune: m?.condImmune ?? [],
    traits: m?.traits ?? [], notes: m ? [] : ["No stat block is saved for this token, so there are no attacks to show. You can still type damage and conditions."],
    proficiencyBonus: null, spellSaveDC: null,
  };
}

/** What anyone at the table may know about a token's health: numbers for player characters, a rough word for monsters. */
export function publicHealth(t: Row, isDM: boolean) {
  const monster = !t.character_id && !t.controlled_by;
  const sheet = t.character_id ? loadSheet(t.character_id) : null;
  const hp: number | null = sheet ? sheet.data.hp.current : t.hp;
  const max: number | null = sheet ? sheet.dv.maxHp : t.max_hp;
  const out: Record<string, unknown> = {
    health: healthWord(hp, max),
    tempHp: sheet ? sheet.data.hp.temp ?? 0 : isDM || !monster ? Number(t.temp_hp) || 0 : 0,
  };
  if (isDM || !monster) {
    out.ac = sheet ? sheet.dv.ac : t.ac ?? (isDM ? monsterData(t)?.ac ?? null : null);
    out.concentrating = t.concentrating || "";
    if (sheet && (hp ?? 1) <= 0) out.deathSaves = sheet.data.deathSaves;
  }
  return out;
}

/** Can this person act as, roll for or change this token? The DM always; players for their own character or a token handed to them. */
export function controlsToken(t: Row, userId: number, isDM: boolean) {
  if (isDM) return true;
  if (t.controlled_by === userId) return true;
  if (t.character_id) return one("SELECT owner_id FROM characters WHERE id = ?", t.character_id)?.owner_id === userId;
  return false;
}

export { STANDARD_OPTIONS };
export type { Socket };
