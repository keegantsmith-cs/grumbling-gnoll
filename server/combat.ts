// Combat on the Table: who can do what, what the dice say, and what happens to hit points.
// Everything is worked out here on the server, from the character sheet or the monster's stat block,
// so players can't fake bonuses and DM-only numbers (monster AC, HP, actions) never leave the server.
import type { Socket } from "socket.io";
import { all, one, parseJSON, run, type Row } from "./db.ts";
import { describeRoll, diceList, rollDice, type DieGroup, type RolledDie, type RollResult } from "../shared/dice.ts";
import { broadcastMap, canSee, chatOut, dmIdOf, eachSocket, fogOf, notify, postChat, tokenOnActiveMap, tokenVisible, type SocketData } from "./realtime.ts";
import { classSummary, derive, normalizeCharacter, ABILITIES, ABILITY_NAMES, SKILLS, mod, fmtMod, type Ability } from "../shared/character.ts";
import {
  characterActions, monsterCombatData, healthWord, STANDARD_OPTIONS, d20Expression, doubleDice, addDice, resolveAttack,
  adjustDamage, takeDamage, heal as healHp, gainTempHp, deathSave, CONDITIONS,
  type Actor, type AttackOutcome, type CombatAction, type MonsterCombat, type SpellFacts,
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
      proficiencyBonus: dv.proficiencyBonus, spellSaveDC: dv.spellSaveDC ?? null, rulesVersion: data.rulesVersion, used: {}, effects: effectsOf(t),
      slotsLeft: dv.spellSlots.map((n, i) => Math.max(0, n - (data.spellSlotsUsed[i] ?? 0))),
      pactLeft: dv.pact.count ? { count: Math.max(0, dv.pact.count - (data.pactSlotsUsed ?? 0)), level: dv.pact.level } : undefined,
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
    proficiencyBonus: null, spellSaveDC: null, used: parseJSON<any>(t.combat, {}).used ?? {}, effects: effectsOf(t),
  };
}

/** What anyone at the table may know about a token's health: numbers for player characters, a rough word for monsters. */
export function publicHealth(t: Row, isDM: boolean) {
  const monster = !t.character_id && !t.controlled_by;
  const sheet = t.character_id ? loadSheet(t.character_id) : null;
  const hp: number | null = sheet ? sheet.data.hp.current : t.hp;
  const max: number | null = sheet ? sheet.dv.maxHp : t.max_hp;
  const out: Record<string, unknown> = {
    // a character's HP always comes from their sheet, so the token and sheet can never disagree
    ...(sheet ? { hp, maxHp: max } : {}),
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


// ---------- rolling ----------

type Mode = "normal" | "adv" | "dis";
const clampInt = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n)) || 0));
const modeOf = (m: unknown): Mode => (m === "adv" || m === "dis" ? m : "normal");
const EXTRA_RE = /^[+-]\s*\d+(?:d\d+)?$/i;

interface D20 { total: number; natural: number; detail: string; expression: string; dice: RolledDie[]; crit?: "success" | "fail"; typed: boolean }

/** One d20 roll (real dice on the site, or a number typed in from physical dice) plus a bonus. */
function rollD20(bonus: number, mode: Mode, manual: unknown, extra?: string): D20 {
  const extraExpr = extra && EXTRA_RE.test(extra.trim()) ? extra.replace(/\s+/g, "") : "";
  if (manual !== undefined && manual !== null && manual !== "") {
    const natural = clampInt(manual, 1, 20);
    let total = natural + bonus, detail = `d20 [${natural}] (typed in)${bonus ? ` ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}` : ""}`;
    if (extraExpr) { const r = rollDice(extraExpr.replace(/^\+/, "")); total += r.total; detail += ` ${extraExpr[0] === "-" ? "-" : "+"} ${describeRoll(r).replace(/^[+-]\s*/, "")}`; }
    return { total, natural, detail, expression: `d20=${natural}${bonus ? fmtMod(bonus) : ""}${extraExpr}`, dice: [], crit: natural === 20 ? "success" : natural === 1 ? "fail" : undefined, typed: true };
  }
  const r = rollDice(d20Expression(bonus, mode) + extraExpr);
  const d20 = r.parts.find((p): p is DieGroup => p.kind === "dice" && p.sides === 20)!;
  const natural = d20.rolls.filter((_, i) => d20.kept[i])[0];
  return { total: r.total, natural, detail: describeRoll(r), expression: r.expression, dice: diceList(r), crit: r.crit, typed: false };
}

/** Damage dice rolled part by part, so each damage type stays separate (a critical hit doubles the dice). */
function rollDamage(parts: { dice: string; type: string }[], crit: boolean, manual: unknown, extraDice = ""): { total: number; parts: { amount: number; type: string }[]; detail: string; dice: RolledDie[]; typed: boolean } {
  if (manual !== undefined && manual !== null && manual !== "") {
    const amount = clampInt(manual, 0, 9999);
    return { total: amount, parts: [{ amount, type: parts[0]?.type ?? "" }], detail: `${amount} (typed in)`, dice: [], typed: true };
  }
  const out: { amount: number; type: string }[] = [];
  const details: string[] = [], dice: RolledDie[] = [];
  parts.forEach((p, i) => {
    let expr = crit ? doubleDice(p.dice) : p.dice;
    if (i === 0 && extraDice) expr += crit ? doubleDice(extraDice) : extraDice; // e.g. Sneak Attack dice double on a crit
    const r: RollResult = rollDice(expr);
    out.push({ amount: Math.max(0, r.total), type: p.type });
    details.push(`${describeRoll(r)}${p.type ? ` ${p.type}` : ""}`);
    dice.push(...diceList(r, 20));
  });
  return { total: out.reduce((n, p) => n + p.amount, 0), parts: out, detail: details.join(" + "), dice: dice.slice(0, 30), typed: false };
}

/** Does this token's roll stay behind the DM's screen? Monsters and hidden tokens do (unless the DM shows it); players can choose secret. */
function whisperTarget(cid: number, t: Row, d: SocketData, p: any): number | null {
  const dmId = dmIdOf(cid);
  const monster = !t.character_id && !t.controlled_by;
  if (d.isDM) return (monster || t.hidden) && !p.show ? dmId : null;
  return p.secret ? dmId : null;
}

function visibleTargets(cid: number, d: SocketData, ids: unknown): Row[] {
  const list = (Array.isArray(ids) ? ids : []).slice(0, 20).map((x) => Number(x));
  const out: Row[] = [];
  for (const id of list) {
    const t = tokenOnActiveMap(id, cid);
    if (!t || out.some((o) => o.id === t.id)) continue;
    if (tokenVisible(t, !!d.isDM, fogOf(t.map_id))) out.push(t);
  }
  return out;
}

/** Spend a spell slot of at least this level from a character's sheet. Returns the level used. */
function spendSlot(characterId: number, level: number, slotLevel: number): number {
  const sheet = loadSheet(characterId);
  if (!sheet) return slotLevel;
  const { data, dv } = sheet;
  for (let l = Math.max(level, slotLevel); l <= 9; l++) {
    const total = dv.spellSlots[l - 1] ?? 0;
    if ((data.spellSlotsUsed[l - 1] ?? 0) < total) {
      data.spellSlotsUsed = [...data.spellSlotsUsed]; while (data.spellSlotsUsed.length < 9) data.spellSlotsUsed.push(0);
      data.spellSlotsUsed[l - 1]++;
      run("UPDATE characters SET data = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(data), characterId);
      notifyChars(sheet.row.campaign_id);
      return l;
    }
  }
  if (dv.pact.count > 0 && dv.pact.level >= level && (data.pactSlotsUsed ?? 0) < dv.pact.count) {
    data.pactSlotsUsed = (data.pactSlotsUsed ?? 0) + 1;
    run("UPDATE characters SET data = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(data), characterId);
    notifyChars(sheet.row.campaign_id);
    return dv.pact.level;
  }
  throw new Error(`No spell slots left for a level ${level} spell. Untick "use a slot" to cast anyway.`);
}
const notifyChars = (campaignId: number | null) => { if (campaignId) notify(campaignId, "characters"); };

/** Used-up recharge abilities and daily uses live in the token's stat-block data. */
function markUsed(t: Row, a: CombatAction) {
  if (!a.recharge && !a.uses) return;
  const c = parseJSON<any>(t.combat, {});
  if (!Array.isArray(c.actions)) return; // tokens without stored data aren't tracked
  c.used = { ...(c.used ?? {}), [a.id]: (c.used?.[a.id] ?? 0) + 1 };
  run("UPDATE tokens SET combat = ? WHERE id = ?", JSON.stringify(c), t.id);
}

function setConcentration(cid: number, t: Row, name: string, whisper: number | null) {
  const old = String(t.concentrating ?? "");
  run("UPDATE tokens SET concentrating = ? WHERE id = ?", name, t.id);
  t.concentrating = name;
  if (old && old !== name) postChat(cid, null, "text", { text: `🔵 ${t.name} stops concentrating on ${old} to start ${name}.` }, whisper);
}

const ABILITY_LABEL = (a: Ability) => ABILITY_NAMES[a];

export function registerCombat(socket: Socket) {
  const d = socket.data as SocketData;
  const guard = (ack: unknown, fn: () => unknown) => {
    const reply = typeof ack === "function" ? (ack as (r: unknown) => void) : () => {};
    try { reply(fn()); } catch (e) { reply({ error: (e as Error).message || "That didn't work" }); }
  };
  /** The token a request is about, if this person is allowed to act on it. */
  const mine = (p: any): Row => {
    if (!d.campaignId) throw new Error("Not in a campaign");
    const t = tokenOnActiveMap(Number(p?.tokenId), d.campaignId);
    // Players get the same answer whether the token doesn't exist, is hidden, or just isn't theirs
    if (!t && !d.isDM) throw new Error("That isn't your token");
    if (!t) throw new Error("That token isn't on the map any more");
    if (!controlsToken(t, d.user.id, !!d.isDM)) throw new Error("That isn't your token");
    return t;
  };

  socket.on("combat:actor", (p: any, ack: unknown) => guard(ack, () => ({ actor: buildActor(mine(p)) })));
  socket.on("combat:roll", (p: any, ack: unknown) => guard(ack, () => handleRoll(d, p ?? {})));

  // "Dash", "Dodge"... announced in chat so everyone knows what was chosen. Dodge is remembered until your next turn.
  socket.on("combat:do", (p: any, ack: unknown) => guard(ack, () => {
    const t = mine(p);
    const opt = STANDARD_OPTIONS.find((o) => o.key === p?.key);
    if (!opt) throw new Error("Unknown option");
    postChat(d.campaignId!, d.user.id, "text", { text: `⚔ ${t.name}: ${opt.label}. ${opt.hint}` }, unseenByPlayers(t) ? dmIdOf(d.campaignId!) : null);
    if (opt.effect === "dodge") { addEffect(d.campaignId!, t, { name: "Dodging", at: "start", rounds: 0 }); broadcastMap(d.campaignId!); }
    return { ok: true };
  }));

  // Damage: the DM applies it to one or more targets (resistance, vulnerability and immunity are worked out from the stat block)
  socket.on("combat:apply", (p: any, ack: unknown) => guard(ack, () => {
    const cid = d.campaignId;
    if (!cid) throw new Error("Not in a campaign");
    const list = (Array.isArray(p?.targets) ? p.targets : []).slice(0, 20);
    const results = [];
    for (const x of list) {
      const t = tokenOnActiveMap(Number(x?.tokenId), cid);
      if (!t && d.isDM) continue;
      // Players may only apply damage to their own character (e.g. "you take 6 damage" from the DM)
      if (!d.isDM && !(t && controlsToken(t, d.user.id, false) && (t.character_id || t.controlled_by))) throw new Error("Only the DM can apply damage to others");
      results.push(applyDamageTo(cid, t!, x));
    }
    if (p?.msgId && d.isDM) markApplied(cid, Number(p.msgId));
    broadcastMap(cid);
    return { ok: true, results };
  }));

  socket.on("combat:heal", (p: any, ack: unknown) => guard(ack, () => {
    const t = mine(p);
    const kind = p?.temp ? "temp" : "heal";
    const out = kind === "temp" ? giveTempHp(d.campaignId!, t, clampInt(p.amount, 0, 9999)) : healToken(d.campaignId!, t, clampInt(p.amount, 0, 9999));
    broadcastMap(d.campaignId!);
    return { ok: true, ...out };
  }));

  socket.on("combat:death", (p: any, ack: unknown) => guard(ack, () => {
    const out = rollDeathSave(d.campaignId!, mine(p), p?.manual);
    broadcastMap(d.campaignId!);
    return out;
  }));

  // Conditions (with an optional timer), concentration and a monster's AC
  socket.on("combat:condition", (p: any, ack: unknown) => guard(ack, () => {
    const t = mine(p);
    const cid = d.campaignId!;
    const name = String(p?.name ?? "").trim().slice(0, 30);
    if (!name) throw new Error("Pick a condition");
    const pretty = CONDITIONS.find((c) => c.toLowerCase() === name.toLowerCase()) ?? name;
    let warning = "";
    if (p.op === "remove") {
      removeCondition(t, pretty);
      removeEffect(t, pretty);
    } else {
      const immune = buildActor(t).condImmune.some((c) => c.toLowerCase() === pretty.toLowerCase());
      if (immune && d.isDM) warning = `${t.name} is immune to ${pretty} (stat block). Added anyway.`;
      addCondition(t, pretty);
      const e = p.ends;
      if (e && (e.kind === "start" || e.kind === "end" || e.kind === "rounds")) addEffect(cid, t, { name: pretty, at: e.kind === "end" ? "end" : "start", rounds: e.kind === "rounds" ? clampInt(e.rounds, 1, 100) : 0, condition: true });
    }
    broadcastMap(cid);
    return { ok: true, warning };
  }));

  socket.on("combat:set", (p: any, ack: unknown) => guard(ack, () => {
    const t = mine(p);
    if (p.concentrating !== undefined) {
      run("UPDATE tokens SET concentrating = ? WHERE id = ?", String(p.concentrating ?? "").slice(0, 60), t.id);
      if (p.concentrating) postChat(d.campaignId!, d.user.id, "text", { text: `🔵 ${t.name} is concentrating on ${String(p.concentrating).slice(0, 60)}.` }, hiddenFromPlayers(t) ? dmIdOf(d.campaignId!) : null);
    }
    if (p.ac !== undefined && d.isDM) run("UPDATE tokens SET ac = ? WHERE id = ?", p.ac === null || p.ac === "" ? null : clampInt(p.ac, 0, 40), t.id);
    broadcastMap(d.campaignId!);
    return { ok: true };
  }));
}

/** Monsters and hidden tokens keep their business between the DM and the dice. */
const hiddenFromPlayers = (t: Row) => !!t.hidden || (!t.character_id && !t.controlled_by);
/** Hidden, or standing in fog the players can't see through: not to be named in anything players read. */
const unseenByPlayers = (t: Row) => !!t.hidden || !tokenVisible(t, false, fogOf(t.map_id));

// ----- hit points -----

/** Write a character's HP / temp HP / death saves to the sheet (and the token that mirrors it), or a monster's to its token. */
function writeHealth(t: Row, patch: { hp?: number; temp?: number; deathSaves?: { successes: number; failures: number } }) {
  const sheet = loadSheet(t.character_id);
  if (sheet) {
    const { data, dv } = sheet;
    if (patch.hp !== undefined) data.hp.current = Math.max(0, Math.min(dv.maxHp, Math.round(patch.hp)));
    if (patch.temp !== undefined) data.hp.temp = Math.max(0, Math.round(patch.temp));
    if (patch.deathSaves) data.deathSaves = patch.deathSaves;
    run("UPDATE characters SET data = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(data), t.character_id);
    if (patch.hp !== undefined) { run("UPDATE tokens SET hp = ? WHERE character_id = ?", data.hp.current, t.character_id); t.hp = data.hp.current; }
    notifyChars(sheet.row.campaign_id);
  } else {
    if (patch.hp !== undefined) { const max = t.max_hp ?? patch.hp; run("UPDATE tokens SET hp = ? WHERE id = ?", Math.max(0, Math.min(max, Math.round(patch.hp))), t.id); t.hp = Math.max(0, Math.min(max, Math.round(patch.hp))); }
    if (patch.temp !== undefined) { run("UPDATE tokens SET temp_hp = ? WHERE id = ?", Math.max(0, Math.round(patch.temp)), t.id); t.temp_hp = patch.temp; }
  }
}

const condList = (t: Row) => String(t.conditions ?? "").split(",").map((s) => s.trim()).filter(Boolean);
function addCondition(t: Row, name: string) {
  const list = condList(t);
  if (!list.some((c) => c.toLowerCase() === name.toLowerCase())) list.push(name);
  t.conditions = list.join(", ").slice(0, 200);
  run("UPDATE tokens SET conditions = ? WHERE id = ?", t.conditions, t.id);
}
function removeCondition(t: Row, name: string) {
  t.conditions = condList(t).filter((c) => c.toLowerCase() !== name.toLowerCase()).join(", ");
  run("UPDATE tokens SET conditions = ? WHERE id = ?", t.conditions, t.id);
}

export interface DamageRequest { parts?: { amount: number; type?: string }[]; amount?: number; type?: string; half?: boolean; magical?: boolean; crit?: boolean; ignoreDefenses?: boolean; source?: string }

/** Apply damage to one token, announce it the right way, and report what happened. */
function applyDamageTo(cid: number, t: Row, x: DamageRequest) {
  const a = buildActor(t);
  const parts = (Array.isArray(x.parts) && x.parts.length ? x.parts : [{ amount: x.amount ?? 0, type: x.type ?? "" }]).slice(0, 8);
  const def = x.ignoreDefenses ? { resist: [], vuln: [], immune: [] } : { resist: a.resist, vuln: a.vuln, immune: a.immune };
  let total = 0;
  const notes: string[] = [];
  for (const part of parts) {
    const adj = adjustDamage(clampInt(part?.amount, 0, 9999), String(part?.type ?? "").slice(0, 30), def, { half: !!x.half, magical: !!x.magical });
    total += adj.amount;
    if (adj.note) notes.push(adj.note);
  }
  const before = a.hp ?? 0;
  const max = a.maxHp ?? Math.max(1, before);
  const r = takeDamage({ hp: before, max, temp: a.tempHp, deathSaves: a.deathSaves ?? undefined, isCharacter: a.kind === "character" }, total, { crit: !!x.crit, concentrating: !!t.concentrating });
  writeHealth(t, { hp: r.hp, temp: r.temp, ...(r.deathSaves ? { deathSaves: r.deathSaves } : {}) });
  if (a.kind === "character" && r.dropped) { addCondition(t, "Unconscious"); }
  if (r.dead) addCondition(t, a.kind === "character" ? "Dead" : "Dead");
  const secret = hiddenFromPlayers(t);
  const typeText = parts.length === 1 && parts[0].type ? ` ${parts[0].type}` : "";
  const sourceText = x.source ? ` from ${String(x.source).slice(0, 80)}` : "";
  const hpText = a.kind === "character" || !secret ? "" : ` (${r.hp}/${max} HP)`;
  // Players hear about their own side in full, and only that a visible monster fell. Numbers about monsters go to the DM.
  if (a.kind === "character") {
    postChat(cid, null, "text", { text: `💥 ${t.name} takes ${total}${typeText} damage${sourceText}${notes.length ? ` (${notes.join(", ")})` : ""}. HP ${r.hp}/${max}${r.temp ? ` +${r.temp} temp` : ""}.${r.dropped ? " Down!" : ""}${r.dead ? " Dead." : ""}${r.deathSaves && !r.dropped && !r.dead && before <= 0 ? ` Death save failures: ${r.deathSaves.failures}/3.` : ""}` });
  } else {
    postChat(cid, null, "text", { text: `💥 ${t.name} takes ${total}${typeText} damage${sourceText}${notes.length ? ` (${notes.join(", ")})` : ""}${hpText}.${r.dropped ? " Drops to 0." : ""}` }, dmIdOf(cid));
    if (r.dropped && !unseenByPlayers(t)) postChat(cid, null, "text", { text: `☠ ${t.name} is down.` });
  }
  let conc: { tokenId: number; dc: number; spell: string } | null = null;
  if (r.concentrationDC && String(t.concentrating)) {
    conc = { tokenId: t.id, dc: r.concentrationDC, spell: String(t.concentrating) };
    postChat(cid, null, "text", { text: `🔵 ${t.name} is concentrating on ${t.concentrating}: Constitution save, DC ${r.concentrationDC}, or the spell ends.` }, secret ? dmIdOf(cid) : null);
  }
  if (r.dropped && t.concentrating) { run("UPDATE tokens SET concentrating = '' WHERE id = ?", t.id); postChat(cid, null, "text", { text: `🔵 ${t.name} loses concentration on ${t.concentrating} (knocked out).` }, secret ? dmIdOf(cid) : null); conc = null; }
  return { tokenId: t.id, name: t.name, character: a.kind === "character", dealt: total, hp: r.hp, max, temp: r.temp, notes: [...notes, ...r.notes], dropped: r.dropped, dead: r.dead, concentration: conc };
}

function healToken(cid: number, t: Row, amount: number) {
  const a = buildActor(t);
  const n = Math.max(0, Math.round(amount) || 0);
  if (!n) throw new Error("Type an amount to heal");
  const max = a.maxHp ?? Math.max(1, a.hp ?? 1);
  const h = healHp({ hp: a.hp ?? 0, max, temp: a.tempHp, deathSaves: a.deathSaves ?? undefined, isCharacter: a.kind === "character" }, n);
  writeHealth(t, { hp: h.hp, ...(h.deathSaves ? { deathSaves: h.deathSaves } : {}) });
  if (h.revived) { removeCondition(t, "Unconscious"); removeCondition(t, "Dead"); }
  postChat(cid, null, "text", { text: `💚 ${t.name} regains ${h.hp - (a.hp ?? 0)} HP${a.kind === "character" || !hiddenFromPlayers(t) ? ` (HP ${h.hp}/${max})` : ""}${h.revived ? " and is back on their feet" : ""}.` }, hiddenFromPlayers(t) ? dmIdOf(cid) : null);
  return { hp: h.hp, max };
}

function giveTempHp(cid: number, t: Row, amount: number) {
  const a = buildActor(t);
  const n = Math.max(0, Math.round(amount) || 0);
  if (!n) throw new Error("Type an amount");
  const temp = gainTempHp(a.tempHp, n);
  writeHealth(t, { temp });
  postChat(cid, null, "text", { text: `🛡 ${t.name} has ${temp} temporary HP${temp === a.tempHp ? " (they don't stack: the higher number is kept)" : ""}.` }, hiddenFromPlayers(t) ? dmIdOf(cid) : null);
  return { temp };
}

function rollDeathSave(cid: number, t: Row, manual: unknown) {
  const a = buildActor(t);
  if (a.kind !== "character" || !a.deathSaves) throw new Error("Only player characters make death saves");
  if ((a.hp ?? 1) > 0) throw new Error(`${t.name} isn't at 0 HP`);
  if (a.deathSaves.failures >= 3) throw new Error(`${t.name} is dead`);
  const r = rollD20(0, "normal", manual);
  const res = deathSave(a.deathSaves, r.natural);
  writeHealth(t, { deathSaves: { successes: res.successes, failures: res.failures }, ...(res.outcome === "revived" ? { hp: 1 } : {}) });
  if (res.outcome === "revived") removeCondition(t, "Unconscious");
  if (res.outcome === "dead") addCondition(t, "Dead");
  postChat(cid, null, "roll", { expression: r.expression, label: `${t.name}: death saving throw`, total: r.total, detail: `${r.detail} — ${res.text} (successes ${res.successes}/3, failures ${res.failures}/3)`, crit: r.crit, dice: r.dice, combat: { kind: "death", outcome: res.outcome } });
  return { ok: true, natural: r.natural, ...res };
}

/** Remember that a chat message's damage has been applied, so it can't be applied twice. */
function markApplied(cid: number, msgId: number) {
  const row = one("SELECT * FROM chat WHERE id = ? AND campaign_id = ?", msgId, cid);
  if (!row) return;
  const body = parseJSON<any>(row.body, {});
  if (!body.combat) return;
  body.combat.applied = true;
  run("UPDATE chat SET body = ? WHERE id = ?", JSON.stringify(body), msgId);
  const msg = chatOut({ ...one("SELECT c.*, u.display_name AS name FROM chat c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?", msgId)! });
  eachSocket(cid, (s, dd) => { if (canSee(msg, dd.user.id, !!dd.isDM)) s.emit("chat:update", msg); });
}

// ----- timed effects and turn reminders -----

interface Effect { id: string; name: string; at: "start" | "end"; round: number; entryId: number | null; condition?: boolean }
const effectsOf = (t: Row): Effect[] => parseJSON<Effect[]>(t.effects, []);
const saveEffects = (t: Row, list: Effect[]) => { t.effects = JSON.stringify(list); run("UPDATE tokens SET effects = ? WHERE id = ?", t.effects, t.id); };
function removeEffect(t: Row, name: string) { saveEffects(t, effectsOf(t).filter((e) => e.name.toLowerCase() !== name.toLowerCase())); }

function loadInitiative(cid: number) {
  return parseJSON<{ round: number; turn: number; entries: Row[] }>(one("SELECT initiative FROM campaigns WHERE id = ?", cid)?.initiative, { round: 1, turn: 0, entries: [] });
}
const entryOf = (state: { entries: Row[] }, t: Row) => state.entries.find((e) => e.tokenId === t.id) ?? state.entries.find((e) => String(e.name).toLowerCase() === String(t.name).toLowerCase());

/** A timer on a token: "start" fires at the start of its turn, "end" at the end of it; `rounds` counts whole rounds from now. */
function addEffect(cid: number, t: Row, e: { name: string; at: "start" | "end"; rounds: number; condition?: boolean }) {
  const state = loadInitiative(cid);
  const entry = entryOf(state, t);
  if (!entry) return; // not in the turn order: nothing to count turns by
  const isItsTurn = state.entries[state.turn]?.id === entry.id;
  // its turn is already underway, so the next start (or end) that counts is a round later
  const round = state.round + e.rounds + (isItsTurn && e.rounds === 0 ? 1 : 0);
  const list = effectsOf(t).filter((x) => x.name.toLowerCase() !== e.name.toLowerCase());
  list.push({ id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, name: e.name, at: e.at, round, entryId: entry.id, condition: e.condition });
  saveEffects(t, list);
}

/** Called after the turn order moves on: say which effects wear off and who needs to roll something. */
export function turnChanged(cid: number, ev: { prev?: Row; prevRound: number; cur: Row; round: number }) {
  const toks = tokensOnMap(cid);
  const due = (t: Row, entry: Row | undefined, at: "start" | "end", round: number) => {
    if (!entry) return [] as Effect[];
    const list = effectsOf(t);
    const fired = list.filter((e) => e.entryId === entry.id && e.at === at && round >= e.round);
    if (fired.length) saveEffects(t, list.filter((e) => !fired.includes(e)));
    return fired;
  };
  const say = (t: Row, text: string) => postChat(cid, null, "text", { text }, hiddenFromPlayers(t) ? dmIdOf(cid) : null);
  for (const t of toks) {
    for (const e of due(t, ev.prev && (ev.prev.tokenId === t.id || String(ev.prev.name).toLowerCase() === String(t.name).toLowerCase()) ? ev.prev : undefined, "end", ev.prevRound)) say(t, `⏰ End of ${t.name}'s turn: ${e.name} ${e.condition ? "should end now (remove it from the Combat tab, or roll the save if it says save ends)" : "has run out"}.`);
    const isCur = ev.cur.tokenId === t.id || String(ev.cur.name).toLowerCase() === String(t.name).toLowerCase();
    if (!isCur) continue;
    for (const e of due(t, ev.cur, "start", ev.round)) say(t, `⏰ Start of ${t.name}'s turn: ${e.name} ${e.condition ? "should end now (remove it from the Combat tab, or roll the save if it says save ends)" : "has run out"}.`);
    const a = buildActor(t);
    if (a.kind === "character" && (a.hp ?? 1) <= 0 && (a.deathSaves?.failures ?? 0) < 3 && (a.deathSaves?.successes ?? 0) < 3) postChat(cid, null, "text", { text: `💀 ${t.name} is at 0 HP: roll a death saving throw (Combat tab).` });
    for (const act of a.actions) if (act.recharge && (a.used[act.id] ?? 0) > 0) postChat(cid, null, "text", { text: `🔁 ${t.name}'s ${act.name} is spent: roll recharge (${act.recharge}) from the Combat tab.` }, dmIdOf(cid));
    if (t.concentrating && !hiddenFromPlayers(t)) postChat(cid, null, "text", { text: `🔵 ${t.name} is concentrating on ${t.concentrating}.` });
  }
}

function tokensOnMap(cid: number): Row[] {
  const c = one("SELECT active_map_id FROM campaigns WHERE id = ?", cid);
  return c?.active_map_id ? (all("SELECT * FROM tokens WHERE map_id = ?", c.active_map_id) as Row[]) : [];
}

function handleRoll(d: SocketData, p: any) {
  if (!d.campaignId) throw new Error("Not in a campaign");
  const cid = d.campaignId;
  const t = tokenOnActiveMap(Number(p.tokenId), cid);
  if (!t) throw new Error("That token isn't on the map any more");
  if (!controlsToken(t, d.user.id, !!d.isDM)) throw new Error("That isn't your token");
  const actor = buildActor(t);
  const mode = modeOf(p.mode);
  const whisper = whisperTarget(cid, t, d, p);
  const userId = d.user.id;
  const who = actor.name;
  const base = (r: { total: number; detail: string; expression: string; dice: RolledDie[]; crit?: "success" | "fail" }, label: string, combat?: Record<string, unknown>) =>
    postChat(cid, userId, "roll", { expression: r.expression, label, total: r.total, detail: r.detail, crit: r.crit, dice: r.dice, ...(combat ? { combat } : {}) }, whisper);
  const action = (): CombatAction => {
    const a = actor.actions.find((x) => x.id === p.actionId);
    if (!a) throw new Error("That action isn't available any more");
    return a;
  };
  const targetsOf = () => visibleTargets(cid, d, p.targetIds ?? (p.targetId != null ? [p.targetId] : []));
  const extra = typeof p.extra === "string" ? p.extra : undefined;

  switch (p.kind) {
    case "check":
    case "skill":
    case "save": {
      let bonus: number, label: string;
      if (p.kind === "check") {
        const a = p.ability as Ability; if (!ABILITIES.includes(a)) throw new Error("Pick an ability");
        bonus = actor.mods[a]; label = `${ABILITY_LABEL(a)} check`;
      } else if (p.kind === "skill") {
        const sk = SKILLS.find((s) => s.key === p.skill); if (!sk) throw new Error("Pick a skill");
        bonus = actor.skills[sk.key]; label = `${sk.name} check`;
      } else {
        const a = p.ability as Ability; if (!ABILITIES.includes(a)) throw new Error("Pick an ability");
        bonus = actor.saves[a]; label = `${ABILITY_LABEL(a)} save`;
      }
      const dc = p.dc != null && p.dc !== "" ? clampInt(p.dc, 1, 40) : null;
      const r = rollD20(bonus, mode, p.manual, extra);
      const success = dc != null ? r.total >= dc : null;
      const combat: Record<string, unknown> = { kind: p.kind, actor: who, ...(dc != null ? { dc, success } : {}), ...(p.concentration ? { concentration: true } : {}) };
      // Failing a concentration save ends the spell
      let drop = "";
      if (p.concentration && success === false && t.concentrating) { drop = String(t.concentrating); run("UPDATE tokens SET concentrating = '' WHERE id = ?", t.id); broadcastMap(cid); }
      base({ ...r, detail: `${r.detail}${mode !== "normal" && !r.typed ? (mode === "adv" ? " (advantage)" : " (disadvantage)") : ""}${dc != null ? ` vs DC ${dc}: ${success ? "success" : "failure"}` : ""}` }, `${who}: ${label}${p.concentration ? " to keep concentrating" : ""}`, combat);
      if (drop) postChat(cid, null, "text", { text: `🔵 ${who} loses concentration on ${drop}.` }, whisper);
      return { ok: true, total: r.total, natural: r.natural, success, dropped: drop || undefined };
    }

    case "attack": {
      const a = action();
      if (a.kind !== "attack" || a.toHit == null) throw new Error("That isn't an attack");
      const [target] = targetsOf();
      const targetActor = target ? buildActor(target) : null;
      if (a.level && p.useSlot !== false && actor.characterId) {
        const used = spendSlot(actor.characterId, a.level, clampInt(p.slot, a.level, 9) || a.level);
        p.slot = used;
      }
      if (a.concentration) setConcentration(cid, t, a.name, whisper);
      markUsed(t, a);
      const r = rollD20(a.toHit, mode, p.manual, extra);
      const outcome: AttackOutcome = resolveAttack(r.natural, r.total, targetActor?.ac ?? null);
      const hit = outcome === "hit" || outcome === "crit";
      // Optionally roll the damage straight away when it hits
      let dmg: ReturnType<typeof rollDamage> | null = null;
      if (p.withDamage && hit && a.damage?.length) dmg = rollDamage(upcastParts(a, p.slot), outcome === "crit", p.manualDamage);
      const combat = {
        kind: "attack", actor: who, action: a.name, target: target ? { id: target.id, name: target.name } : null, outcome,
        // The target's AC is only written into messages the DM alone can see
        ...(d.isDM && whisper != null && targetActor?.ac != null ? { ac: targetActor.ac } : {}),
        ...(dmg ? { damage: { total: dmg.total, parts: dmg.parts, crit: outcome === "crit" } } : {}),
        magical: !!a.magical, melee: !!a.melee,
        ...(dmg && target ? { apply: { tokenIds: [target.id], parts: dmg.parts, magical: !!a.magical, crit: outcome === "crit", source: `${who}'s ${a.name}` } } : {}),
      };
      const advTxt = mode !== "normal" && !r.typed ? (mode === "adv" ? " (advantage)" : " (disadvantage)") : "";
      base({ ...r, detail: `${r.detail}${advTxt}${dmg ? ` → ${dmg.total} damage: ${dmg.detail}` : ""}` }, `${who}: ${a.name} attack${target ? ` → ${target.name}` : ""}`, combat);
      if (dmg) base({ total: dmg.total, detail: dmg.detail, expression: "damage", dice: dmg.dice }, `${who}: ${a.name} damage${outcome === "crit" ? " (critical!)" : ""}`);
      return { ok: true, outcome, natural: r.natural, total: r.total, targetId: target?.id ?? null, damage: dmg ? { total: dmg.total, parts: dmg.parts } : undefined, spellSlot: p.slot };
    }

    case "damage": {
      const a = action();
      if (!a.damage?.length) throw new Error("That has no damage to roll");
      const targets = targetsOf();
      const crit = !!p.crit;
      const dmg = rollDamage(upcastParts(a, p.slot), crit, p.manual, typeof p.extraDice === "string" && /^[+-]\d+d\d+$/i.test(p.extraDice) ? p.extraDice : "");
      const combat = {
        kind: "damage", actor: who, action: a.name, crit, total: dmg.total, parts: dmg.parts, targets: targets.map((x) => ({ id: x.id, name: x.name })),
        ...(targets.length ? { apply: { tokenIds: targets.map((x) => x.id), parts: dmg.parts, magical: !!a.magical, crit, source: `${who}'s ${a.name}` } } : {}),
      };
      base({ total: dmg.total, detail: dmg.detail, expression: crit ? "damage (critical hit: dice doubled)" : "damage", dice: dmg.dice }, `${who}: ${a.name} damage${crit ? " (critical!)" : ""}`, combat);
      return { ok: true, total: dmg.total, parts: dmg.parts, crit };
    }

    case "saveall": {
      const a = action();
      if (a.kind !== "save" || !a.save) throw new Error("That isn't a saving-throw ability");
      const targets = targetsOf();
      if (!targets.length) throw new Error("Pick who it hits first");
      if (a.level && p.useSlot !== false && actor.characterId) p.slot = spendSlot(actor.characterId, a.level, clampInt(p.slot, a.level, 9) || a.level);
      if (a.concentration) setConcentration(cid, t, a.name, whisper);
      markUsed(t, a);
      const dmg = a.damage?.length ? rollDamage(upcastParts(a, p.slot), false, p.manualDamage) : null;
      const manualSaves = (p.manualSaves && typeof p.manualSaves === "object" ? p.manualSaves : {}) as Record<string, unknown>;
      const rows = targets.map((x) => {
        const ta = buildActor(x);
        // Typed-in dice only count for the DM or for a creature the roller controls (nobody types a result for the DM's monsters)
        const typedIn = d.isDM || controlsToken(x, d.user.id, false) ? manualSaves[String(x.id)] : undefined;
        const r = rollD20(ta.saves[a.save!.ability], "normal", typeof manualSaves === "object" && Object.prototype.hasOwnProperty.call(manualSaves, String(x.id)) ? typedIn : undefined);
        const success = r.total >= a.save!.dc;
        // A monster's save bonus must not leak: its dice and total are only shown when the DM rolled it for the DM's eyes
        const monster = !x.character_id && !x.controlled_by;
        return { id: x.id, name: x.name, natural: r.natural, total: r.total, success, typed: r.typed, monster };
      });
      const showNumbers = d.isDM && whisper != null;
      const lines = rows.map((r) => (r.monster && !showNumbers ? `${r.name}: ${r.success ? "✓ saves" : "✗ fails"}` : `${r.name}: ${r.total} (${r.natural}${r.typed ? ", typed in" : ""}) ${r.success ? "✓ saves" : "✗ fails"}`));
      const shownRows = rows.map(({ monster, ...r }) => (monster && !showNumbers ? { ...r, natural: null, total: null, typed: false } : r));
      const apply = dmg ? { tokenIds: rows.map((r) => r.id), parts: dmg.parts, magical: !!a.magical, crit: false, source: `${who}'s ${a.name}`, halfFor: rows.filter((r) => r.success && a.save!.half).map((r) => r.id), noneFor: rows.filter((r) => r.success && !a.save!.half).map((r) => r.id) } : undefined;
      const combat = { kind: "saveall", actor: who, action: a.name, dc: a.save.dc, ability: a.save.ability, half: a.save.half, rows: shownRows, ...(dmg ? { total: dmg.total, parts: dmg.parts } : {}), ...(apply ? { apply } : {}) };
      base({ total: dmg?.total ?? a.save.dc, detail: `${dmg ? `${dmg.detail}. ` : ""}DC ${a.save.dc} ${ABILITY_LABEL(a.save.ability)} save — ${lines.join("; ")}`, expression: dmg ? "damage" : `DC ${a.save.dc}`, dice: dmg?.dice ?? [] }, `${who}: ${a.name} (DC ${a.save.dc} ${a.save.ability.toUpperCase()} save)`, combat);
      return { ok: true, rows: shownRows, total: dmg?.total, parts: dmg?.parts, apply, spellSlot: p.slot };
    }

    case "cast": {
      const a = action();
      let slot: number | undefined;
      if (a.level && p.useSlot !== false && actor.characterId) slot = spendSlot(actor.characterId, a.level, clampInt(p.slot, a.level, 9) || a.level);
      if (a.concentration) setConcentration(cid, t, a.name, whisper);
      postChat(cid, userId, "text", { text: `✨ ${who} casts ${a.name}${slot && a.level && slot > a.level ? ` at level ${slot}` : a.level ? ` (level ${a.level})` : ""}.${a.concentration ? " (concentrating)" : ""}` }, whisper);
      broadcastMap(cid);
      return { ok: true, spellSlot: slot };
    }

    case "recharge": {
      const a = action();
      if (!a.recharge) throw new Error("That doesn't recharge");
      const min = Number(a.recharge[0]);
      const r = rollDice("1d6");
      const back = r.total >= min;
      if (back) {
        const c = parseJSON<any>(t.combat, {});
        if (c.used) { delete c.used[a.id]; run("UPDATE tokens SET combat = ? WHERE id = ?", JSON.stringify(c), t.id); }
      }
      base({ total: r.total, detail: `${describeRoll(r)} — ${back ? `${a.name} is ready again!` : "still recharging"}`, expression: `1d6 (needs ${a.recharge})`, dice: diceList(r) }, `${who}: ${a.name} recharge`);
      return { ok: true, total: r.total, back };
    }

    default:
      throw new Error("Unknown roll");
  }
}

/** A spell's damage at a higher slot level (and extra dice per level, if it has them). */
function upcastParts(a: CombatAction, slot: unknown): { dice: string; type: string }[] {
  const parts = (a.damage ?? []).map((x) => ({ ...x }));
  const lvl = clampInt(slot, 0, 9);
  if (a.upcast && a.level && lvl > a.level && parts.length) {
    const extra = Math.max(0, lvl - Math.max(a.level, a.upcast.above));
    parts[0].dice = addDice(parts[0].dice, a.upcast.dice, extra);
  }
  return parts;
}

// ---------- narration: only facts the players already know ----------

export const NARRATION_KINDS = ["hit", "crit", "miss", "fumble", "kill", "down", "dead"] as const;
export type NarrationKind = (typeof NARRATION_KINDS)[number];
export interface NarrationEvent { kind: NarrationKind; attackerId?: number; targetId?: number; action?: string; damageType?: string; melee?: boolean; tone?: string }

/**
 * The facts handed to the AI for text the players will read. Hidden creatures are never named, monsters are only
 * described by name and (at most) the same rough health word players already see. No HP, AC, stat blocks, DM notes or secrets.
 */
export function narrationFacts(cid: number, ev: NarrationEvent): string {
  const describe = (id?: number): string => {
    if (id == null) return "";
    const t = tokenOnActiveMap(Number(id), cid);
    if (!t) return "";
    if (unseenByPlayers(t)) return "an unseen creature (do not name it or say what it is)";
    if (t.character_id) {
      const sheet = loadSheet(t.character_id);
      return `${t.name}, a player character${sheet ? ` (${sheet.data.species ? `${sheet.data.species} ` : ""}${classSummary(sheet.data)})`.replace(/\(\s*\)/, "") : ""}`;
    }
    return `${String(t.name).replace(/\s+\d+$/, "")}${t.controlled_by ? ", an ally" : ", a monster"}`;
  };
  const attacker = describe(ev.attackerId), target = describe(ev.targetId);
  const result: Record<NarrationKind, string> = {
    hit: "The attack hits.", crit: "The attack is a critical hit: an especially devastating, well-placed strike.", miss: "The attack misses.",
    fumble: "The attacker rolled a natural 1: a clumsy fumble, the attack goes wildly astray.", kill: "The blow kills the target.",
    down: "The blow drops the target to 0 hit points: they fall unconscious and are dying.", dead: "The blow slays the target outright.",
  };
  const t = ev.targetId != null ? tokenOnActiveMap(Number(ev.targetId), cid) : null;
  // The same rough word players see on the map, never numbers
  const state = t && !unseenByPlayers(t) && !t.character_id && (ev.kind === "hit" || ev.kind === "crit") ? healthWord(t.hp, t.max_hp) : null;
  const clean = (s: unknown, n = 60) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, n).trim();
  return [
    "Narrate this moment of combat.",
    attacker && `Attacker: ${attacker}`,
    target && `Target: ${target}`,
    ev.action && `Weapon or spell: ${clean(ev.action)}${ev.melee === true ? " (in melee)" : ev.melee === false ? " (at range)" : ""}`,
    `Result: ${result[ev.kind]}`,
    ev.damageType && (ev.kind === "hit" || ev.kind === "crit" || ev.kind === "kill" || ev.kind === "down" || ev.kind === "dead") && `Damage type: ${clean(ev.damageType, 20)}`,
    state && state !== "healthy" && `The target is now visibly ${state}.`,
    ev.tone && `Tone: ${clean(ev.tone, 40)}`,
  ].filter(Boolean).join("\n");
}
