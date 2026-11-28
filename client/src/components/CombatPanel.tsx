import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ABILITIES, ABILITY_NAMES, SKILLS, fmtMod, type Ability } from "../../../shared/character";
import { CONDITIONS, DAMAGE_TYPES, STANDARD_OPTIONS, type Actor, type CombatAction } from "../../../shared/combat";
import type { CampaignSocket, InitEntry, Token } from "../socket";
import type { Campaign } from "../pages/Campaign";
import { useStatus } from "../hooks";

/** Ids of the characters this person owns (to know which tokens they may act with). */
export function useOwnedCharacterIds(campaignId: number, me: number) {
  const [ids, setIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    api.get<any[]>(`/characters?campaignId=${campaignId}`).then((cs) => setIds(new Set(cs.filter((c) => c.ownerId === me).map((c) => c.id)))).catch(() => {});
  }, [campaignId, me]);
  return ids;
}

/** Which token goes with a turn-order entry (by link, or by matching name for characters added by hand). */
export function tokenForEntry(e: InitEntry | undefined, tokens: Token[]): Token | undefined {
  if (!e) return undefined;
  return (e.tokenId != null ? tokens.find((t) => t.id === e.tokenId) : undefined) ?? tokens.find((t) => t.name.toLowerCase() === e.name.toLowerCase());
}

export function HpBar({ t }: { t: Token }) {
  if (t.hp == null || !t.maxHp) return t.health ? <span className={`pill ${t.health === "healthy" ? "ok" : t.health === "bloodied" ? "warn" : "bad"}`}>{t.health}</span> : null;
  const pct = Math.max(0, Math.min(1, t.hp / t.maxHp));
  return (
    <span className="hpbar" title={`${t.hp} / ${t.maxHp} HP`}>
      <span className="hpbar-fill" style={{ width: `${pct * 100}%`, background: pct > 0.5 ? "#5cb85c" : pct > 0.25 ? "#e0a030" : "#d9534f" }} />
      <span className="hpbar-text">{t.hp}/{t.maxHp}{t.tempHp ? ` +${t.tempHp}` : ""}</span>
    </span>
  );
}

const SECTION_LABEL: Record<string, string> = {
  weapon: "Weapon attacks", spell: "Spells", action: "Actions", bonus: "Bonus actions", reaction: "Reactions", legendary: "Legendary actions",
};

type Mode = "normal" | "adv" | "dis";
interface Prompt { title: string; fields: { key: string; label: string; hint?: string }[]; submit: (vals: Record<string, string>) => void }
interface NarrEvent { kind: "hit" | "crit" | "miss" | "fumble" | "kill" | "down" | "dead"; attackerId?: number; targetId?: number; action?: string; damageType?: string; melee?: boolean }
interface Last { text: string; tone: "good" | "bad" | "crit" | "plain"; damage?: { a: CombatAction; crit: boolean; slot?: number }; error?: boolean; event?: NarrEvent }
interface Narr { event: NarrEvent; text: string; loading: boolean; error?: string }

const useLocalFlag = (key: string, initial = false) => {
  const [v, setV] = useState(() => { try { return localStorage.getItem(key) === "1" ? true : localStorage.getItem(key) === "0" ? false : initial; } catch { return initial; } });
  const set = (n: boolean) => { setV(n); try { localStorage.setItem(key, n ? "1" : "0"); } catch { /* private window */ } };
  return [v, set] as const;
};

/** The combat panel: who is acting, their numbers, and everything they can do. */
export function CombatPanel({ campaign, live, tokenId, setTokenId }: { campaign: Campaign; live: CampaignSocket; tokenId: number | null; setTokenId: (id: number | null) => void }) {
  const { status, toast } = useStatus();
  const me = status.user!.id;
  const tokens = live.map?.tokens ?? [];
  const owned = useOwnedCharacterIds(campaign.id, me);
  const [actor, setActor] = useState<Actor | null>(null);
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<number[]>([]);
  const [mode, setMode] = useState<Mode>("normal");
  const [ownDice, setOwnDice] = useLocalFlag("gnoll-own-dice");
  const [hidden, setHidden] = useState(false); // DM: show the roll to everyone / player: keep it secret
  const [last, setLast] = useState<Last | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [slots, setSlots] = useState<Record<string, number>>({});
  const [narr, setNarr] = useState<Narr | null>(null);
  const token = tokens.find((t) => t.id === tokenId) ?? null;

  // Tokens this person can act with: the DM any; players their own character and tokens handed to them
  const mine = useMemo(() => tokens.filter((t) => campaign.isDM || t.controlledBy === me || (t.characterId != null && owned.has(t.characterId))), [tokens, campaign.isDM, me, owned]);
  const canAct = !!token && mine.some((t) => t.id === token.id);

  const load = useCallback(() => {
    if (!token || !canAct || !live.socket) { setActor(null); return; }
    live.socket.emit("combat:actor", { tokenId: token.id }, (r: { actor?: Actor; error?: string }) => {
      setActor(r.actor ?? null);
      setError(r.error ?? "");
    });
  }, [token?.id, canAct, live.socket, live.map]);
  useEffect(load, [load]);
  useEffect(() => { setLast(null); setPrompt(null); }, [tokenId]);
  // forget targets that left the map
  useEffect(() => { setTargets((ts) => ts.filter((id) => tokens.some((t) => t.id === id))); }, [tokens.length]);

  const emit: Emit = (event, payload, cb) => live.socket?.emit(event, payload, (r: any) => { if (r?.error) toast(r.error); else cb?.(r); load(); });
  const say = (key: string) => token && live.socket?.emit("combat:do", { tokenId: token.id, key });
  const monsterActing = !!actor && actor.kind === "monster";
  const visibilityNote = campaign.isDM ? (monsterActing || token?.hidden ? (hidden ? "Everyone will see these rolls" : "Only you see these rolls") : "Everyone sees these rolls") : hidden ? "Only you and the DM see these rolls" : "Everyone sees these rolls";

  /** Send a roll to the server; the server does the dice (or uses the numbers typed from real dice) and the math. */
  function doRoll(payload: Record<string, unknown>, done?: (r: any) => void) {
    if (!token || !live.socket) return;
    live.socket.emit("combat:roll", { tokenId: token.id, mode, ...(campaign.isDM ? { show: hidden } : { secret: hidden }), targetIds: targets, targetId: targets[0], ...payload }, (r: any) => {
      if (r?.error) { toast(r.error); setLast({ text: r.error, tone: "bad", error: true }); return; }
      setMode("normal");
      done?.(r);
      load();
    });
  }
  /** With "I'll use my own dice" on, ask what the physical dice showed first; blank answers let the site roll instead. */
  function withOwnDice(title: string, fields: Prompt["fields"], go: (vals: Record<string, string>) => void) {
    if (!ownDice) return go({});
    setPrompt({ title, fields, submit: (v) => { setPrompt(null); go(v); } });
  }

  const targetName = (id?: number | null) => tokens.find((t) => t.id === id)?.name;
  const nums = (v: string | undefined) => (v != null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

  function attack(a: CombatAction, withDamage: boolean) {
    const fields = [{ key: "d20", label: `${a.name}: what did your d20 show?`, hint: "just the die, the site adds your bonus" }, ...(withDamage ? [{ key: "dmg", label: "If it hits: total damage", hint: "dice plus bonuses, doubled dice on a critical" }] : [])];
    withOwnDice(`Attack with ${a.name}`, fields, (v) => doRoll({ kind: "attack", actionId: a.id, manual: nums(v.d20), manualDamage: nums(v.dmg), withDamage, slot: slotFor(a), useSlot: slotFor(a) > 0 }, (r) => {
      const who = targetName(r.targetId);
      const tip = who ? ` → ${who}` : "";
      const word = r.outcome === "crit" ? `💥 Critical hit!${tip}` : r.outcome === "hit" ? `✔ Hit${tip}` : r.outcome === "miss" ? `✘ Miss${tip}` : r.outcome === "fumble" ? `✘ Natural 1: automatic miss${tip}` : `Rolled ${r.total}. Pick a target to see if it hits.`;
      setLast({ text: `${word} (${r.total})${r.damage ? ` — ${r.damage.total} damage` : ""}`, tone: r.outcome === "crit" ? "crit" : r.outcome === "hit" ? "good" : r.outcome === "miss" || r.outcome === "fumble" ? "bad" : "plain", damage: !r.damage && (r.outcome === "hit" || r.outcome === "crit" || r.outcome === "unknown") ? { a, crit: r.outcome === "crit" } : undefined,
        event: r.outcome === "unknown" ? undefined : { kind: r.outcome, attackerId: token?.id, targetId: r.targetId ?? undefined, action: a.name, damageType: a.damage?.[0]?.type, melee: a.melee } });
    }));
  }
  function damage(a: CombatAction, crit: boolean) {
    withOwnDice(`${a.name} damage`, [{ key: "dmg", label: `${a.name}: total damage${crit ? " (critical: dice doubled)" : ""}`, hint: "dice plus bonuses" }], (v) =>
      doRoll({ kind: "damage", actionId: a.id, crit, manual: nums(v.dmg), slot: slotFor(a) }, (r) => setLast({ text: `${r.total} damage${r.parts?.length ? ` (${r.parts.map((p: any) => `${p.amount} ${p.type}`.trim()).join(" + ")})` : ""}${crit ? " — critical!" : ""}`, tone: crit ? "crit" : "plain" })));
  }
  function saveAll(a: CombatAction) {
    if (!targets.length) { toast("Pick who it hits first (Targets, above)"); return; }
    const fields = [...(a.damage?.length ? [{ key: "dmg", label: `${a.name}: total damage`, hint: "rolled once for everyone" }] : []), ...targets.map((id) => ({ key: `s${id}`, label: `${targetName(id)}: save d20`, hint: `DC ${a.save!.dc} ${a.save!.ability.toUpperCase()}; blank = the site rolls` }))];
    withOwnDice(`${a.name}: saving throws`, fields, (v) => doRoll({ kind: "saveall", actionId: a.id, manualDamage: nums(v.dmg), manualSaves: Object.fromEntries(targets.map((id) => [id, nums(v[`s${id}`])]).filter(([, n]) => n !== undefined)), slot: slotFor(a), useSlot: slotFor(a) > 0 }, (r) => {
      const lines = (r.rows as any[]).map((x) => `${x.name} ${x.success ? "✓" : "✗"}`).join(", ");
      setLast({ text: `DC ${a.save!.dc} ${a.save!.ability.toUpperCase()}: ${lines}${r.total != null ? ` — ${r.total} damage${a.save!.half ? " (half on a save)" : ""}` : ""}`, tone: "plain" });
    }));
  }
  function cast(a: CombatAction) { doRoll({ kind: "cast", actionId: a.id, slot: slotFor(a), useSlot: slotFor(a) > 0 }, () => setLast({ text: `Cast ${a.name}`, tone: "plain" })); }
  function recharge(a: CombatAction) { doRoll({ kind: "recharge", actionId: a.id }, (r) => setLast({ text: r.back ? `${a.name} recharged (rolled ${r.total})!` : `${a.name} didn't recharge (rolled ${r.total})`, tone: r.back ? "good" : "bad" })); }
  function abilityRoll(kind: "check" | "save", ability: string) {
    withOwnDice(`${ABILITY_NAMES[ability as Ability]} ${kind}`, [{ key: "d20", label: `${ABILITY_NAMES[ability as Ability]} ${kind}: what did your d20 show?` }], (v) =>
      doRoll({ kind, ability, manual: nums(v.d20) }, (r) => setLast({ text: `${ABILITY_NAMES[ability as Ability]} ${kind}: ${r.total}`, tone: "plain" })));
  }
  function skillRoll(key: string) {
    const sk = SKILLS.find((x) => x.key === key)!;
    withOwnDice(sk.name, [{ key: "d20", label: `${sk.name}: what did your d20 show?` }], (v) => doRoll({ kind: "skill", skill: key, manual: nums(v.d20) }, (r) => setLast({ text: `${sk.name}: ${r.total}`, tone: "plain" })));
  }
  function initiative() {
    if (!actor || !token) return;
    withOwnDice("Initiative", [{ key: "d20", label: "Initiative: what did your d20 show?" }], (v) => {
      const typed = nums(v.d20);
      live.socket?.emit("initiative", typed !== undefined
        ? { op: "add", name: actor.name, init: typed + actor.initiative, dex: actor.initiative, hidden: !!token.hidden && campaign.isDM, tokenId: token.id }
        : { op: "roll", name: actor.name, bonus: actor.initiative, hidden: !!token.hidden && campaign.isDM, tokenId: token.id });
      setLast({ text: "Initiative sent to the turn order", tone: "plain" });
    });
  }
  /** Ask the AI for 1-3 sentences about a moment. Nothing is shown to players until the DM chooses to post it. */
  async function narrate(event: NarrEvent, avoid?: string) {
    setNarr({ event, text: avoid ?? "", loading: true });
    try {
      const r = await api.post<{ text: string }>(`/campaigns/${campaign.id}/ai/narrate`, { event, avoid });
      setNarr({ event, text: r.text, loading: false });
    } catch (e) { setNarr({ event, text: "", loading: false, error: (e as Error).message }); }
  }
  async function shareNarration(toMe: boolean) {
    if (!narr?.text.trim()) return;
    try {
      await api.post(`/campaigns/${campaign.id}/share`, { title: toMe ? "Narration (private)" : "⚔", text: narr.text.trim(), ...(toMe ? { toUserId: me } : {}) });
      toast(toMe ? "Saved privately in your chat" : "Posted to the chat");
      setNarr(null);
    } catch (e) { toast((e as Error).message); }
  }
  /** Which spell slot level a spell will use (0 = none) */
  function slotFor(a: CombatAction) { return !a.level ? 0 : slots[a.id] ?? a.level; }

  const candidates = campaign.isDM ? tokens : tokens;
  const healthIds = campaign.isDM ? (targets.length ? targets : token ? [token.id] : []) : token ? [token.id] : [];
  const toggleTarget = (id: number) => setTargets((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));

  return (
    <div className="combat">
      <div className="combat-pin">
        <label className="combat-acting">
          <span className="muted">Acting</span>
          <select value={tokenId ?? ""} onChange={(e) => setTokenId(e.target.value ? Number(e.target.value) : null)} aria-label="Who is acting">
            <option value="">Pick a token…</option>
            {(campaign.isDM ? tokens : mine).map((t) => <option key={t.id} value={t.id}>{t.name}{t.hidden ? " (hidden)" : ""}</option>)}
          </select>
        </label>
        {token && canAct && actor && <>
          {prompt && <OwnDicePrompt p={prompt} cancel={() => setPrompt(null)} />}
          {last && <div className={`last-result ${last.tone}`} role="status">
            <span>{last.text}</span>
            {last.damage && <button className="small primary" onClick={() => damage(last.damage!.a, last.damage!.crit)}>{last.damage.crit ? "💥 Roll critical damage" : "Roll damage"}</button>}
            {campaign.isDM && last.event && <button className="small" onClick={() => narrate(last.event!)} title="Ask the AI for a short description. You read it first; nothing is posted until you choose.">📖 Narrate</button>}
            <button className="small link" aria-label="Dismiss result" onClick={() => setLast(null)}>✕</button>
          </div>}
          {narr && (
            <div className="narration" role="region" aria-label="Narration">
              <b>📖 Narration</b>
              {narr.loading && <p className="muted">Writing…</p>}
              {narr.error && <p className="notice">{narr.error}</p>}
              {!narr.loading && !narr.error && <textarea aria-label="Narration text" rows={3} value={narr.text} onChange={(e) => setNarr({ ...narr, text: e.target.value })} />}
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button className="small primary" disabled={narr.loading || !!narr.error || !narr.text.trim()} onClick={() => shareNarration(false)}>📢 Post to chat</button>
                <button className="small" disabled={narr.loading || !!narr.error || !narr.text.trim()} onClick={() => shareNarration(true)}>🔒 Keep private</button>
                <button className="small" disabled={narr.loading} onClick={() => narrate(narr.event, narr.text || undefined)}>🎲 Reroll</button>
                <button className="small link" onClick={() => setNarr(null)}>Close</button>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Only the attacker, target, weapon and result are sent to the AI: never HP, AC, hidden monsters or your notes.</div>
            </div>
          )}
        </>}
      </div>

      {!token && <p className="muted">{mine.length ? "Pick who is acting, or click a token on the map." : campaign.isDM ? "Put some monsters on the map, then click one to see what it can do." : "Your character needs a token on the map to fight. Ask the DM, or add it from the map's + button."}</p>}
      {token && !canAct && <p className="muted">{token.name} isn't yours to control. Pick one of your own tokens above.</p>}
      {error && <p className="notice">{error}</p>}

      {token && canAct && actor && (
        <>
          <Summary t={token} actor={actor} isDM={campaign.isDM} emit={emit}
            onDeath={() => withOwnDice("Death saving throw", [{ key: "d20", label: "Death save: what did your d20 show?" }], (v) => emit("combat:death", { tokenId: token.id, manual: nums(v.d20) }, (r) => setLast({ text: r.text + ` (${r.successes} successes, ${r.failures} failures)`, tone: r.outcome === "failure" || r.outcome === "dead" ? "bad" : "good" })))}
            onConc={(dc) => doRoll({ kind: "save", ability: "con", dc, concentration: true }, (r) => setLast({ text: `Concentration save: ${r.total} vs DC ${dc} — ${r.success ? "kept" : `lost${r.dropped ? ` ${r.dropped}` : ""}`}`, tone: r.success ? "good" : "bad" }))} />
          {actor.notes.map((n, i) => <p key={i} className="muted" style={{ fontSize: 12 }}>{n}</p>)}

          <div className="roll-controls">
            <div className="seg" role="group" aria-label="Advantage or disadvantage for the next roll">
              {(["normal", "adv", "dis"] as const).map((m) => <button key={m} className={mode === m ? "active" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === "normal" ? "Normal" : m === "adv" ? "Advantage" : "Disadvantage"}</button>)}
            </div>
            <label className="inline" title="Roll your real dice, then type what they showed. The site still works out hit or miss.">
              <input type="checkbox" checked={ownDice} onChange={(e) => setOwnDice(e.target.checked)} /> ✍ I'll use my own dice
            </label>
            <label className="inline" title={visibilityNote}>
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> {campaign.isDM ? "Show rolls to players" : "Secret roll (DM only)"}
            </label>
          </div>

          <div className="group-label">Targets</div>
          <div className="row combat-targets">
            {targets.map((id) => {
              const t = tokens.find((x) => x.id === id);
              return t ? <button key={id} className="small chip-on" onClick={() => toggleTarget(id)} title="Click to remove" aria-label={`Remove target ${t.name}`}>{t.name} ✕</button> : null;
            })}
            <select aria-label="Add a target" value="" onChange={(e) => e.target.value && toggleTarget(Number(e.target.value))} >
              <option value="">{targets.length ? "+ add another" : "Pick a target…"}</option>
              {candidates.filter((t) => !targets.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}{!t.characterId && t.health && t.health !== "healthy" ? ` (${t.health})` : ""}</option>)}
            </select>
          </div>

          <div className="group-label">Damage &amp; healing</div>
          <DamageBox attackerId={token.id} onNarrate={campaign.isDM ? narrate : undefined} ids={healthIds} names={healthIds.map((id) => tokens.find((x) => x.id === id)?.name ?? "?")} isDM={campaign.isDM} emit={emit} defenses={campaign.isDM} />


          {(["weapon", "spell", "action", "bonus", "reaction", "legendary"] as const).map((sec) => {
            const list = actor.actions.filter((a) => a.section === sec);
            if (!list.length) return null;
            return (
              <div key={sec}>
                <div className="group-label">{SECTION_LABEL[sec]}</div>
                <div className="col" style={{ gap: 6 }}>
                  {list.map((a) => (
                    <ActionRow key={a.id} a={a} actor={actor}>
                      <div className="act-btns">
                        {a.level ? <SlotPicker a={a} actor={actor} value={slotFor(a)} onChange={(n) => setSlots({ ...slots, [a.id]: n })} /> : null}
                        {a.kind === "attack" && <>
                          <button className="small primary" onClick={() => attack(a, false)}>🎲 Attack</button>
                          {a.damage?.length ? <button className="small" onClick={() => damage(a, false)}>Damage</button> : null}
                          {a.damage?.length && campaign.isDM ? <button className="small" title="Roll the attack, and the damage too if it hits" onClick={() => attack(a, true)}>⚡ Both</button> : null}
                        </>}
                        {a.kind === "save" && <button className="small primary" onClick={() => saveAll(a)}>🎲 Use on targets</button>}
                        {a.kind === "save" && a.damage?.length ? <button className="small" onClick={() => damage(a, false)}>Damage only</button> : null}
                        {a.kind === "other" && a.section === "spell" && <button className="small" onClick={() => cast(a)}>✨ Cast</button>}
                        {a.kind === "multiattack" && a.multi?.map((m) => <span key={m.name} className="muted" style={{ fontSize: 12 }}>use {m.name} ×{m.count} below</span>)}
                        {a.recharge && (actor.used[a.id] ?? 0) > 0 && <><span className="pill bad">spent</span><button className="small" onClick={() => recharge(a)}>Roll recharge ({a.recharge})</button></>}
                        {a.uses && (actor.used[a.id] ?? 0) > 0 && <span className="pill warn">used {actor.used[a.id]}× ({a.uses})</span>}
                      </div>
                    </ActionRow>
                  ))}
                </div>
              </div>
            );
          })}

          <details className="combat-fold">
            <summary>Checks &amp; saves</summary>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <span className="muted combat-rowlabel">Check</span>
            {ABILITIES.map((ab) => <button key={ab} className="small" title={`${ABILITY_NAMES[ab]} check`} onClick={() => abilityRoll("check", ab)}>{ab.toUpperCase()} {fmtMod(actor.mods[ab])}</button>)}
          </div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            <span className="muted combat-rowlabel">Save</span>
            {ABILITIES.map((ab) => <button key={ab} className="small" title={`${ABILITY_NAMES[ab]} saving throw`} onClick={() => abilityRoll("save", ab)}>{ab.toUpperCase()} {fmtMod(actor.saves[ab])}</button>)}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            <select aria-label="Roll a skill check" value="" onChange={(e) => e.target.value && skillRoll(e.target.value)}>
              <option value="">Roll a skill…</option>
              {SKILLS.map((sk) => <option key={sk.key} value={sk.key}>{sk.name} {fmtMod(actor.skills[sk.key])}</option>)}
            </select>
            <button className="small" onClick={initiative} title="Add to the turn order">⏱ Initiative {fmtMod(actor.initiative)}</button>
          </div>

          </details>

          <details className="combat-fold">
            <summary>Other things you can do</summary>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {STANDARD_OPTIONS.map((o) => <button key={o.key} className="small" title={o.hint} onClick={() => say(o.key)}>{o.label}</button>)}
          </div>
          </details>
        </>
      )}
    </div>
  );
}

/** Choose which spell slot to use (or none). */
function SlotPicker({ a, actor, value, onChange }: { a: CombatAction; actor: Actor; value: number; onChange: (n: number) => void }) {
  const left = actor.slotsLeft ?? [];
  const opts: number[] = [];
  for (let l = a.level!; l <= 9; l++) if ((left[l - 1] ?? 0) > 0) opts.push(l);
  const pact = actor.pactLeft && actor.pactLeft.count > 0 && actor.pactLeft.level >= a.level! ? actor.pactLeft.level : 0;
  if (!opts.length && pact) opts.push(pact);
  return (
    <select aria-label={`Spell slot for ${a.name}`} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "auto" }} title="Which spell slot to spend">
      {opts.length === 0 && <option value={a.level}>no slots left</option>}
      {opts.map((l) => <option key={l} value={l}>Level {l} slot ({l === pact && !(left[l - 1] ?? 0) ? "pact" : `${left[l - 1]} left`})</option>)}
      <option value={0}>Don't spend a slot</option>
    </select>
  );
}

/** "What did your dice show?" Blank boxes let the site roll that part. */
function OwnDicePrompt({ p, cancel }: { p: Prompt; cancel: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <form className="own-dice" onSubmit={(e) => { e.preventDefault(); p.submit(vals); }}>
      <b>{p.title}</b>
      {p.fields.map((f, i) => (
        <label key={f.key} style={{ margin: "4px 0" }}>{f.label}{f.hint && <span className="muted" style={{ fontSize: 12 }}> ({f.hint})</span>}
          <input type="number" autoFocus={i === 0} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
        </label>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <button className="primary small">Use these numbers</button>
        <button type="button" className="small" onClick={() => p.submit({})} title="Skip typing: let the site roll instead">🎲 Roll for me</button>
        <button type="button" className="small link" onClick={cancel}>Cancel</button>
      </div>
    </form>
  );
}

type Emit = (event: string, payload: Record<string, unknown>, cb?: (r: any) => void) => void;

const DURATIONS: { key: string; label: string }[] = [
  { key: "none", label: "until removed" },
  { key: "start", label: "until the start of its next turn" },
  { key: "end", label: "until the end of its next turn" },
  { key: "rounds", label: "for a number of rounds…" },
];

function Summary({ t, actor, isDM, emit, onDeath, onConc }: { t: Token; actor: Actor; isDM: boolean; emit: Emit; onDeath: () => void; onConc: (dc: number) => void }) {
  const conds = t.conditions.split(",").map((c) => c.trim()).filter(Boolean);
  const [cond, setCond] = useState("");
  const [custom, setCustom] = useState("");
  const [dur, setDur] = useState("none");
  const [rounds, setRounds] = useState("10");
  const [dc, setDc] = useState("10");
  const [conc, setConc] = useState("");
  const down = actor.kind === "character" && (actor.hp ?? 1) <= 0;
  const ds = actor.deathSaves;
  const timer = (name: string) => actor.effects.find((e) => e.name.toLowerCase() === name.toLowerCase());
  const addCond = () => {
    const name = (cond === "__custom" ? custom : cond).trim();
    if (!name) return;
    emit("combat:condition", { tokenId: t.id, op: "add", name, ends: dur === "none" ? undefined : { kind: dur, rounds: Number(rounds) || 1 } }, (r) => { if (r.warning) alert(r.warning); setCond(""); setCustom(""); });
  };
  return (
    <div className="combat-summary">
      <div className="row" style={{ gap: 8 }}>
        <b className="grow">{actor.name}</b>
        {isDM && actor.kind === "monster"
          ? <label className="inline" style={{ margin: 0 }} title="Armor Class (only you see a monster's AC)">🛡 AC <input type="number" key={actor.ac ?? "x"} defaultValue={actor.ac ?? ""} style={{ width: 54, padding: 2 }} onBlur={(e) => emit("combat:set", { tokenId: t.id, ac: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          : actor.ac != null && <span className="pill" title="Armor Class">🛡 AC {actor.ac}</span>}
      </div>
      <div className="row" style={{ gap: 8, margin: "4px 0" }}>
        <HpBar t={{ ...t, hp: actor.hp, maxHp: actor.maxHp, tempHp: actor.tempHp }} />
        {isDM && actor.kind === "monster" && <span className="muted" style={{ fontSize: 12 }}>only you see these numbers</span>}
      </div>

      {down && ds && (
        <div className="death-saves" role="group" aria-label="Death saving throws">
          <b>☠ Death saves</b>
          <span title="Successes">{[0, 1, 2].map((i) => <span key={i} className={i < ds.successes ? "dot ok" : "dot"}>✓</span>)}</span>
          <span title="Failures">{[0, 1, 2].map((i) => <span key={i} className={i < ds.failures ? "dot bad" : "dot"}>✗</span>)}</span>
          {ds.failures < 3 ? <button className="small primary" onClick={onDeath}>🎲 Roll death save</button> : <span className="pill bad">dead</span>}
        </div>
      )}

      <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }} aria-label="Conditions">
        {conds.length === 0 && !actor.concentrating && <span className="muted" style={{ fontSize: 12 }}>No conditions</span>}
        {conds.map((c) => {
          const e = timer(c);
          return <span key={c} className="pill bad cond-chip" title={e ? `Reminder: ${e.at} of its turn, round ${e.round}` : "Until removed"}>{c}{e ? " ⏰" : ""} <button className="link" aria-label={`Remove ${c}`} onClick={() => emit("combat:condition", { tokenId: t.id, op: "remove", name: c })}>✕</button></span>;
        })}
        {actor.concentrating && <span className="pill warn cond-chip" title="Concentrating">🔵 {actor.concentrating} <button className="link" aria-label="Stop concentrating" onClick={() => emit("combat:set", { tokenId: t.id, concentrating: "" })}>✕</button></span>}
      </div>

      <details className="combat-more">
        <summary>＋ Condition, timer &amp; concentration</summary>
        <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 6 }}>
          <select aria-label="Condition" value={cond} onChange={(e) => setCond(e.target.value)} style={{ width: "auto" }}>
            <option value="">Add a condition…</option>
            {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            <option value="__custom">Something else…</option>
          </select>
          {cond === "__custom" && <input aria-label="Custom condition" placeholder="e.g. Hexed" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ width: 110 }} />}
          <select aria-label="How long it lasts" value={dur} onChange={(e) => setDur(e.target.value)} style={{ width: "auto" }}>{DURATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
          {dur === "rounds" && <input aria-label="Rounds" type="number" min={1} value={rounds} onChange={(e) => setRounds(e.target.value)} style={{ width: 60 }} />}
          <button className="small primary" disabled={!cond || (cond === "__custom" && !custom.trim())} onClick={addCond}>Add</button>
        </div>
        <div className="muted" style={{ fontSize: 12, margin: "4px 0" }}>With a timer, the table gets a reminder in chat when it should end. Nothing is removed for you.</div>
        {actor.concentrating ? (
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <span>🔵 Concentrating on {actor.concentrating}.</span>
            <label className="inline" style={{ margin: 0 }}>Save DC <input type="number" value={dc} onChange={(e) => setDc(e.target.value)} style={{ width: 56, padding: 2 }} /></label>
            <button className="small" onClick={() => onConc(Number(dc) || 10)}>🎲 Roll Con save</button>
          </div>
        ) : (
          <div className="row" style={{ gap: 4 }}>
            <input aria-label="Concentrating on" placeholder="Concentrating on… (e.g. Bless)" value={conc} onChange={(e) => setConc(e.target.value)} />
            <button className="small" disabled={!conc.trim()} onClick={() => { emit("combat:set", { tokenId: t.id, concentrating: conc.trim() }); setConc(""); }}>Set</button>
          </div>
        )}
      </details>
    </div>
  );
}

/** Damage, healing and temporary HP for the targets (or for the acting creature when none are picked). */
function DamageBox({ names, ids, isDM, emit, defenses, attackerId, onNarrate }: { names: string[]; ids: number[]; isDM: boolean; emit: Emit; defenses: boolean; attackerId: number; onNarrate?: (e: NarrEvent) => void }) {
  const [amt, setAmt] = useState("");
  const [type, setType] = useState("");
  const [half, setHalf] = useState<number[]>([]);
  const [msg, setMsg] = useState("");
  const [falls, setFalls] = useState<{ id: number; name: string; kind: NarrEvent["kind"] }[]>([]);
  const n = Math.abs(Math.round(Number(amt) || 0));
  const summarize = (rs: any[]) => rs.map((r) => `${r.name}: −${r.dealt}${r.notes?.length ? ` (${r.notes.join(", ")})` : ""} → ${r.hp}/${r.max}${r.dead ? " dead" : r.dropped ? " down" : ""}${r.concentration ? ` · concentration check DC ${r.concentration.dc}` : ""}`).join("; ");
  const damage = () => { if (!n) return; emit("combat:apply", { targets: ids.map((id) => ({ tokenId: id, amount: n, type, half: half.includes(id) })) }, (r) => { setMsg(summarize(r.results)); setAmt(""); setHalf([]); setFalls((r.results as any[]).filter((x) => x.dropped || x.dead).map((x) => ({ id: x.tokenId, name: x.name, kind: x.dead ? "dead" : x.character ? "down" : "kill" }))); }); };
  const healAll = () => { if (!n) return; ids.forEach((id) => emit("combat:heal", { tokenId: id, amount: n })); setMsg(`Healed ${names.join(", ")} for ${n}`); setAmt(""); };
  const tempAll = () => { if (!n) return; ids.forEach((id) => emit("combat:heal", { tokenId: id, amount: n, temp: true })); setMsg(`${names.join(", ")}: temporary HP ${n}`); setAmt(""); };
  return (
    <div className="damage-box">
      <div className="muted" style={{ fontSize: 13 }}>Applies to: <b>{names.join(", ") || "—"}</b></div>
      <div className="dmg-fields">
        <label className="dmg-amt"><span className="muted">Amount</span>
          <input type="number" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0" aria-label="Damage or healing amount" onKeyDown={(e) => e.key === "Enter" && damage()} />
        </label>
        {isDM && <label className="dmg-type"><span className="muted">Damage type</span>
          <select aria-label="Damage type" value={type} onChange={(e) => setType(e.target.value)} title={defenses ? "Resistance, vulnerability and immunity are applied from the stat block" : "Damage type"}>
            <option value="">Any / none</option>{DAMAGE_TYPES.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>}
      </div>
      <div className="dmg-buttons">
        <button className="danger" disabled={!n} onClick={damage}>💥 Damage</button>
        <button disabled={!n} onClick={healAll}>💚 Heal</button>
        <button disabled={!n} onClick={tempAll} title="Temporary hit points (don't stack: the higher number is kept)">🛡 Temp HP</button>
      </div>
      {isDM && ids.length > 1 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>Saved (half damage):</span>
          {ids.map((id, i) => <label key={id} className="inline" style={{ margin: 0, fontSize: 13 }}><input type="checkbox" checked={half.includes(id)} onChange={() => setHalf(half.includes(id) ? half.filter((x) => x !== id) : [...half, id])} /> {names[i]}</label>)}
        </div>
      )}
      {isDM && ids.length === 1 && <label className="inline" style={{ margin: "4px 0 0", fontSize: 13 }}><input type="checkbox" checked={half.includes(ids[0])} onChange={() => setHalf(half.length ? [] : [ids[0]])} /> Saved: half damage</label>}
      {msg && <div className="muted" style={{ fontSize: 12, marginTop: 4 }} role="status">{msg}</div>}
      {onNarrate && falls.map((f) => <button key={f.id} className="small" style={{ marginTop: 4 }} onClick={() => onNarrate({ kind: f.kind, attackerId, targetId: f.id })}>📖 Narrate: {f.name} {f.kind === "dead" ? "is slain" : f.kind === "down" ? "goes down" : "falls"}</button>)}
    </div>
  );
}

export const knownCondition = (c: string) => CONDITIONS.some((x) => x.toLowerCase() === c.trim().toLowerCase());

function describeDamage(a: CombatAction) {
  return (a.damage ?? []).map((d) => `${d.dice}${d.type ? ` ${d.type}` : ""}`).join(" + ");
}

/** One thing a creature can do, with its numbers. */
export function ActionRow({ a, actor, children }: { a: CombatAction; actor: Actor; children?: React.ReactNode }) {
  const tags = [a.recharge && `Recharge ${a.recharge}`, a.uses, a.cost && a.cost > 1 && `Costs ${a.cost}`, a.concentration && "Concentration"].filter(Boolean) as string[];
  return (
    <div className="act">
      <div className="act-head">
        <b>{a.name}</b>
        {a.kind === "attack" && a.toHit != null && <span className="pill" title={a.auto ? "Worked out from the sheet's stats" : "To hit"}>{a.auto ? "≈ " : ""}{fmtMod(a.toHit)} to hit</span>}
        {a.kind === "save" && a.save && <span className="pill warn">DC {a.save.dc} {a.save.ability.toUpperCase()} save{a.save.half ? " (half on success)" : ""}</span>}
        {a.kind === "multiattack" && <span className="pill">Multiattack</span>}
        {tags.map((t) => <span key={t} className="pill">{t}</span>)}
      </div>
      {a.kind === "multiattack" ? (
        <div className="muted act-sub">{a.multi?.length ? a.multi.map((m) => `${m.count}× ${m.name}`).join(", ") : a.text}</div>
      ) : (
        <div className="muted act-sub">
          {[describeDamage(a), a.range, !a.damage?.length && a.kind === "other" && a.text ? (a.text.length > 140 ? `${a.text.slice(0, 140)}…` : a.text) : ""].filter(Boolean).join(" · ")}
        </div>
      )}
      {children}
    </div>
  );
}
