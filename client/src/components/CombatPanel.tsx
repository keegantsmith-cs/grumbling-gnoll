import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { fmtMod } from "../../../shared/character";
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

/** The combat panel: who is acting, their numbers, and everything they can do. */
export function CombatPanel({ campaign, live, tokenId, setTokenId }: { campaign: Campaign; live: CampaignSocket; tokenId: number | null; setTokenId: (id: number | null) => void }) {
  const { status } = useStatus();
  const me = status.user!.id;
  const tokens = live.map?.tokens ?? [];
  const owned = useOwnedCharacterIds(campaign.id, me);
  const [actor, setActor] = useState<Actor | null>(null);
  const [error, setError] = useState("");
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

  const say = (key: string) => token && live.socket?.emit("combat:do", { tokenId: token.id, key });

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
          {(["weapon", "spell", "action", "bonus", "reaction", "legendary"] as const).map((sec) => {
            const list = actor.actions.filter((a) => a.section === sec);
            if (!list.length) return null;
            return (
              <div key={sec}>
                <div className="group-label">{SECTION_LABEL[sec]}</div>
                <div className="col" style={{ gap: 6 }}>
                  {list.map((a) => <ActionRow key={a.id} a={a} actor={actor} />)}
                </div>
              </div>
            );
          })}
          <div className="group-label">Other things you can do</div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {STANDARD_OPTIONS.map((o) => <button key={o.key} className="small" title={o.hint} onClick={() => say(o.key)}>{o.label}</button>)}
          </div>
        </>
      )}
    </div>
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
