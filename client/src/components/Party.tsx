import { useEffect, useState } from "react";
import { api } from "../api";
import { go, useStatus } from "../hooks";
import type { CampaignSocket } from "../socket";
import type { Campaign } from "../pages/Campaign";
import { ABILITIES, ABILITY_NAMES, SKILLS, classSummary, derive, fmtMod, type CharacterData } from "../../../shared/character";

export function PartyPanel({ campaign, live }: { campaign: Campaign; live: CampaignSocket }) {
  const { status } = useStatus();
  const [chars, setChars] = useState<any[]>([]);
  const load = () => api.get<any[]>(`/characters?campaignId=${campaign.id}`).then(setChars).catch(() => {});
  useEffect(() => { load(); }, [campaign.id]);
  useEffect(() => { if (live.changed.what === "characters") load(); }, [live.changed]);

  const mine = chars.filter((c) => c.status === "approved" && (campaign.isDM || c.ownerId === status.user?.id));
  if (!mine.length) return <p className="muted">{campaign.isDM ? "No approved characters yet." : <>You don't have an approved character here yet. Make one in the <a href={`#/c/${campaign.id}/characters`}>Characters</a> tab.</>}</p>;
  return (
    <div className="col">
      {mine.map((c) => <QuickSheet key={c.id} c={c} live={live} compact={campaign.isDM} reload={load} />)}
    </div>
  );
}

function QuickSheet({ c, live, compact, reload }: { c: any; live: CampaignSocket; compact: boolean; reload: () => void }) {
  const d: CharacterData = c.data;
  const dv = derive(d);
  const [open, setOpen] = useState(!compact);
  const roll = (bonus: number, label: string) => live.socket?.emit("roll", { expr: `1d20${bonus >= 0 ? "+" : ""}${bonus}`, label: `${d.name}: ${label}` });
  const setHp = (current: number) => api.patch(`/characters/${c.id}/play`, { hp: { current } }).then(reload);
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="row">
        <button type="button" className="link grow" style={{ textDecoration: "none", color: "var(--text)", fontWeight: 700, textAlign: "left" }} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} {d.name}</button>
        <span className="muted">{c.ownerName}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>Lvl {dv.level} {classSummary(d)}</div>
      <div className="row" style={{ margin: "6px 0" }}>
        <span className="pill">AC {dv.ac}</span>
        <span className="pill">HP {d.hp.current}/{dv.maxHp}{d.hp.temp ? ` +${d.hp.temp}` : ""}</span>
        <span className="pill">PP {dv.passivePerception}</span>
        {dv.spellSaveDC && <span className="pill">DC {dv.spellSaveDC}</span>}
      </div>
      {open && (
        <>
          <button className="primary small" style={{ marginBottom: 4 }} onClick={() => live.socket?.emit("initiative", { op: "roll", name: d.name, bonus: dv.initiative })}>🎲 Roll initiative ({fmtMod(dv.initiative)})</button>
          <div className="group-label">Hit points</div>
          <div className="row" style={{ gap: 4 }}>
            {[-5, -1, 1, 5].map((n) => <button key={n} className="small" aria-label={`${n > 0 ? "Heal" : "Lose"} ${Math.abs(n)} HP`} onClick={() => setHp(d.hp.current + n)}>{n > 0 ? `+${n}` : n}</button>)}
          </div>
          <div className="group-label">Ability checks</div>
          <div className="row" style={{ gap: 4 }}>
            {ABILITIES.map((a) => <button key={a} className="small" title={`${ABILITY_NAMES[a]} check`} onClick={() => roll(dv.mods[a], `${ABILITY_NAMES[a]} check`)}>{a.toUpperCase()} {fmtMod(dv.mods[a])}</button>)}
          </div>
          <div className="group-label">Saving throws</div>
          <div className="row" style={{ gap: 4 }}>
            {ABILITIES.map((a) => <button key={a} className="small" title={`${ABILITY_NAMES[a]} save`} onClick={() => roll(dv.saves[a], `${ABILITY_NAMES[a]} save`)}>{a.toUpperCase()} {fmtMod(dv.saves[a])}</button>)}
          </div>
          <select style={{ marginTop: 8 }} aria-label="Roll a skill" value="" onChange={(e) => { const s = SKILLS.find((x) => x.key === e.target.value); if (s) roll(dv.skills[s.key], s.name); }}>
            <option value="">Roll a skill...</option>
            {SKILLS.map((s) => <option key={s.key} value={s.key}>{s.name} {fmtMod(dv.skills[s.key])}</option>)}
          </select>
          {d.attacks.length > 0 && <div className="group-label">Attacks</div>}
          {d.attacks.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              {d.attacks.map((at, i) => (
                <div key={i} className="row">
                  <span className="grow">{at.name}</span>
                  {at.bonus && <button className="small" onClick={() => roll(Number(at.bonus) || 0, `${at.name} attack`)}>Hit {at.bonus}</button>}
                  {at.damage && <button className="small" onClick={() => live.socket?.emit("roll", { expr: at.damage.split(" ")[0], label: `${d.name}: ${at.name} damage (${at.damage.split(" ").slice(1).join(" ")})` })}>Dmg {at.damage}</button>}
                </div>
              ))}
            </div>
          )}
          <button className="link" style={{ marginTop: 10, display: "block" }} onClick={() => go(`c/${c.campaignId}/characters/${c.id}`)}>Open full sheet</button>
        </>
      )}
    </div>
  );
}
