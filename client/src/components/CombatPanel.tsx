import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ABILITIES, ABILITY_NAMES, SKILLS, fmtMod, type Ability } from "../../../shared/character";
import { CONDITIONS, STANDARD_OPTIONS, type Actor, type CombatAction } from "../../../shared/combat";
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
interface Last { text: string; tone: "good" | "bad" | "crit" | "plain"; damage?: { a: CombatAction; crit: boolean; slot?: number }; error?: boolean }

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
      setLast({ text: `${word} (${r.total})${r.damage ? ` — ${r.damage.total} damage` : ""}`, tone: r.outcome === "crit" ? "crit" : r.outcome === "hit" ? "good" : r.outcome === "miss" || r.outcome === "fumble" ? "bad" : "plain", damage: !r.damage && (r.outcome === "hit" || r.outcome === "crit" || r.outcome === "unknown") ? { a, crit: r.outcome === "crit" } : undefined });
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
  /** Which spell slot level a spell will use (0 = none) */
  function slotFor(a: CombatAction) { return !a.level ? 0 : slots[a.id] ?? a.level; }

  const candidates = campaign.isDM ? tokens : tokens;
  const toggleTarget = (id: number) => setTargets((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));

  return (
    <div className="combat">
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="grow" style={{ margin: 0 }}>
          <span className="muted" style={{ fontSize: 12 }}>Acting</span>
          <select value={tokenId ?? ""} onChange={(e) => setTokenId(e.target.value ? Number(e.target.value) : null)} aria-label="Who is acting">
            <option value="">Pick a token…</option>
            {(campaign.isDM ? tokens : mine).map((t) => <option key={t.id} value={t.id}>{t.name}{t.hidden ? " (hidden)" : ""}</option>)}
          </select>
        </label>
      </div>

      {!token && <p className="muted">{mine.length ? "Pick who is acting, or click a token on the map." : campaign.isDM ? "Put some monsters on the map, then click one to see what it can do." : "Your character needs a token on the map to fight. Ask the DM, or add it from the map's + button."}</p>}
      {token && !canAct && <p className="muted">{token.name} isn't yours to control. Pick one of your own tokens above.</p>}
      {error && <p className="notice">{error}</p>}

      {token && canAct && actor && (
        <>
          <Summary t={token} actor={actor} isDM={campaign.isDM} />
          {actor.notes.map((n, i) => <p key={i} className="muted" style={{ fontSize: 12 }}>{n}</p>)}

          <div className="roll-controls">
            <div className="seg" role="group" aria-label="Advantage or disadvantage for the next roll">
              {(["normal", "adv", "dis"] as const).map((m) => <button key={m} className={mode === m ? "active" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === "normal" ? "Normal" : m === "adv" ? "Advantage" : "Disadvantage"}</button>)}
            </div>
            <label className="inline" style={{ margin: 0 }} title="Roll your real dice, then type what they showed. The site still works out hit or miss.">
              <input type="checkbox" checked={ownDice} onChange={(e) => setOwnDice(e.target.checked)} /> ✍ I'll use my own dice
            </label>
            <label className="inline" style={{ margin: 0 }} title={visibilityNote}>
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> {campaign.isDM ? "Show rolls to players" : "Secret roll (DM only)"}
            </label>
          </div>

          <div className="group-label">Targets</div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {targets.map((id) => {
              const t = tokens.find((x) => x.id === id);
              return t ? <button key={id} className="small chip-on" onClick={() => toggleTarget(id)} title="Click to remove">{t.name} ✕</button> : null;
            })}
            <select aria-label="Add a target" value="" onChange={(e) => e.target.value && toggleTarget(Number(e.target.value))} style={{ width: "auto", maxWidth: 160 }}>
              <option value="">{targets.length ? "+ add another" : "Pick a target…"}</option>
              {candidates.filter((t) => !targets.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}{!t.characterId && t.health && t.health !== "healthy" ? ` (${t.health})` : ""}</option>)}
            </select>
          </div>

          {prompt && <OwnDicePrompt p={prompt} cancel={() => setPrompt(null)} />}
          {last && <div className={`last-result ${last.tone}`} role="status">
            <span>{last.text}</span>
            {last.damage && <button className="small primary" onClick={() => damage(last.damage!.a, last.damage!.crit)}>{last.damage.crit ? "💥 Roll critical damage" : "Roll damage"}</button>}
            <button className="small link" aria-label="Dismiss" onClick={() => setLast(null)}>✕</button>
          </div>}

          {(["weapon", "spell", "action", "bonus", "reaction", "legendary"] as const).map((sec) => {
            const list = actor.actions.filter((a) => a.section === sec);
            if (!list.length) return null;
            return (
              <div key={sec}>
                <div className="group-label">{SECTION_LABEL[sec]}</div>
                <div className="col" style={{ gap: 6 }}>
                  {list.map((a) => (
                    <ActionRow key={a.id} a={a} actor={actor}>
                      <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: "wrap" }}>
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

          <div className="group-label">Checks & saves</div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12, width: 46 }}>Check</span>
            {ABILITIES.map((ab) => <button key={ab} className="small" title={`${ABILITY_NAMES[ab]} check`} onClick={() => abilityRoll("check", ab)}>{ab.toUpperCase()} {fmtMod(actor.mods[ab])}</button>)}
          </div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            <span className="muted" style={{ fontSize: 12, width: 46 }}>Save</span>
            {ABILITIES.map((ab) => <button key={ab} className="small" title={`${ABILITY_NAMES[ab]} saving throw`} onClick={() => abilityRoll("save", ab)}>{ab.toUpperCase()} {fmtMod(actor.saves[ab])}</button>)}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            <select aria-label="Roll a skill check" value="" onChange={(e) => e.target.value && skillRoll(e.target.value)}>
              <option value="">Roll a skill…</option>
              {SKILLS.map((sk) => <option key={sk.key} value={sk.key}>{sk.name} {fmtMod(actor.skills[sk.key])}</option>)}
            </select>
            <button className="small" onClick={initiative} title="Add to the turn order">⏱ Initiative {fmtMod(actor.initiative)}</button>
          </div>

          <div className="group-label">Other things you can do</div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {STANDARD_OPTIONS.map((o) => <button key={o.key} className="small" title={o.hint} onClick={() => say(o.key)}>{o.label}</button>)}
          </div>
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

function Summary({ t, actor, isDM }: { t: Token; actor: Actor; isDM: boolean }) {
  const conds = t.conditions.split(",").map((c) => c.trim()).filter(Boolean);
  return (
    <div className="combat-summary">
      <div className="row" style={{ gap: 8 }}>
        <b className="grow">{actor.name}</b>
        {actor.ac != null && <span className="pill" title="Armor Class">🛡 AC {actor.ac}</span>}
      </div>
      <div className="row" style={{ gap: 8, margin: "4px 0" }}>
        <HpBar t={{ ...t, hp: actor.hp, maxHp: actor.maxHp, tempHp: actor.tempHp }} />
        {isDM && actor.kind === "monster" && <span className="muted" style={{ fontSize: 12 }}>only you see these numbers</span>}
      </div>
      {(conds.length > 0 || actor.concentrating) && (
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {actor.concentrating && <span className="pill warn" title="Concentrating">🔵 {actor.concentrating}</span>}
          {conds.map((c) => <span key={c} className="pill bad">{c}</span>)}
        </div>
      )}
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
