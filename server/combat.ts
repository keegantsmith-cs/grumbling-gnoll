// Combat on the Table: who can do what, what the dice say, and what happens to hit points.
// Everything is worked out here on the server, from the character sheet or the monster's stat block,
// so players can't fake bonuses and DM-only numbers (monster AC, HP, actions) never leave the server.
import type { Socket } from "socket.io";
import { one, parseJSON, run, type Row } from "./db.ts";
import { describeRoll, diceList, rollDice, type DieGroup, type RolledDie, type RollResult } from "../shared/dice.ts";
import { broadcastMap, dmIdOf, fogOf, notify, postChat, tokenOnActiveMap, tokenVisible, type SocketData } from "./realtime.ts";
import { derive, normalizeCharacter, ABILITIES, ABILITY_NAMES, SKILLS, mod, fmtMod, type Ability } from "../shared/character.ts";
import {
  characterActions, monsterCombatData, healthWord, STANDARD_OPTIONS, d20Expression, doubleDice, addDice, resolveAttack,
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
      proficiencyBonus: dv.proficiencyBonus, spellSaveDC: dv.spellSaveDC ?? null, rulesVersion: data.rulesVersion, used: {},
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
    proficiencyBonus: null, spellSaveDC: null, used: parseJSON<any>(t.combat, {}).used ?? {},
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
    if (i === 0 && extraDice) expr += extraDice;
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
  socket.on("combat:roll", (p: any, ack?: (r: unknown) => void) => {
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      reply(handleRoll(d, p ?? {}));
    } catch (e) {
      reply({ error: (e as Error).message || "That roll didn't work" });
    }
  });
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
        ...(whisper != null && targetActor?.ac != null ? { ac: targetActor.ac } : {}),
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
      const manualSaves = (p.manualSaves ?? {}) as Record<string, unknown>;
      const rows = targets.map((x) => {
        const ta = buildActor(x);
        const r = rollD20(ta.saves[a.save!.ability], "normal", manualSaves[String(x.id)]);
        const success = r.total >= a.save!.dc;
        return { id: x.id, name: x.name, natural: r.natural, total: r.total, success, typed: r.typed };
      });
      const lines = rows.map((r) => `${r.name}: ${r.total} (${r.natural}${r.typed ? ", typed in" : ""}) ${r.success ? "✓ saves" : "✗ fails"}`);
      const apply = dmg ? { tokenIds: rows.map((r) => r.id), parts: dmg.parts, magical: !!a.magical, crit: false, source: `${who}'s ${a.name}`, halfFor: rows.filter((r) => r.success && a.save!.half).map((r) => r.id), noneFor: rows.filter((r) => r.success && !a.save!.half).map((r) => r.id) } : undefined;
      const combat = { kind: "saveall", actor: who, action: a.name, dc: a.save.dc, ability: a.save.ability, half: a.save.half, rows, ...(dmg ? { total: dmg.total, parts: dmg.parts } : {}), ...(apply ? { apply } : {}) };
      base({ total: dmg?.total ?? a.save.dc, detail: `${dmg ? `${dmg.detail}. ` : ""}DC ${a.save.dc} ${ABILITY_LABEL(a.save.ability)} save — ${lines.join("; ")}`, expression: dmg ? "damage" : `DC ${a.save.dc}`, dice: dmg?.dice ?? [] }, `${who}: ${a.name} (DC ${a.save.dc} ${a.save.ability.toUpperCase()} save)`, combat);
      return { ok: true, rows, total: dmg?.total, parts: dmg?.parts, apply, spellSlot: p.slot };
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
