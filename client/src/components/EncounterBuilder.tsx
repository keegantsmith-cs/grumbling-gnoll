import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";
import type { Campaign } from "../pages/Campaign";
import { derive, normalizeCharacter } from "../../../shared/character";
import { evaluateEncounter, normalizeCr, xpForCr } from "../../../shared/encounter";

interface Row { name: string; cr: string; count: number; entryId?: number; srdName?: string }
interface Option { key: string; label: string; cr: string; detail: string; entryId?: number; srdName?: string }

const DIFF_COLOR: Record<string, string> = {
  Trivial: "#8a8a8a", Easy: "#6aa05a", Low: "#6aa05a", Medium: "#c9a33b", Moderate: "#c9a33b", Hard: "#d9783a", High: "#d9783a",
  Deadly: "#d9534f", "Above High": "#d9534f", "Beyond High: very dangerous": "#b0161a",
};

/** Build an encounter, see how hard it is for this party, save it, and put it on the map. */
export function EncounterBuilder({ campaign, at, onPlaced, close }: { campaign: Campaign; at?: { x: number; y: number }; onPlaced?: () => void; close: () => void }) {
  const { toast } = useStatus();
  const chars = useLoad<any[]>(`/characters?campaignId=${campaign.id}`);
  const saved = useLoad<any[]>(`/campaigns/${campaign.id}/encounters`);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [extra, setExtra] = useState({ count: 0, level: 1 });
  const [q, setQ] = useState("");
  const [mine, setMine] = useState<Option[]>([]);
  const [srd, setSrd] = useState<Option[]>([]);
  const [opts, setOpts] = useState({ initiative: "each", hidden: false, rollHp: false });
  const [busy, setBusy] = useState(false);

  const party = (chars.data ?? []).filter((c) => c.status === "approved");
  const levels = [
    ...party.filter((c) => !excluded.has(c.id)).map((c) => derive(normalizeCharacter(c.data)).level),
    ...Array.from({ length: extra.count }, () => extra.level),
  ];
  const result = useMemo(() => evaluateEncounter(campaign.rulesVersion, levels, rows), [campaign.rulesVersion, levels.join(","), JSON.stringify(rows)]);

  useEffect(() => {
    api.get<any[]>(`/campaigns/${campaign.id}/compendium`).then((list) => setMine(list
      .filter((e) => e.kind === "monster" || (e.kind === "npc" && e.data.statblock))
      .map((e) => { const d = e.data.statblock ?? e.data; return { key: `c${e.id}`, label: e.name, cr: normalizeCr(d.challenge_rating ?? "0"), detail: e.kind === "npc" ? "NPC" : "Compendium", entryId: e.id }; }))).catch(() => {});
  }, [campaign.id]);
  useEffect(() => {
    if (q.trim().length < 2) { setSrd([]); return; }
    const t = setTimeout(() => api.get<any[]>(`/srd/search?type=monster&q=${encodeURIComponent(q)}&limit=8`)
      .then((r) => setSrd(r.map((m) => ({ key: `s${m.name}`, label: m.name, cr: normalizeCr(m.challenge_rating), detail: "SRD", srdName: m.name })))).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q]);
  const ql = q.toLowerCase();
  const results = q.trim().length < 2 ? [] : [...mine.filter((o) => o.label.toLowerCase().includes(ql)).slice(0, 6), ...srd];

  const add = (o: Option) => {
    const i = rows.findIndex((r) => r.name === o.label && r.entryId === o.entryId && r.srdName === o.srdName);
    if (i >= 0) setRows(rows.map((r, j) => (j === i ? { ...r, count: r.count + 1 } : r)));
    else setRows([...rows, { name: o.label, cr: o.cr, count: 1, entryId: o.entryId, srdName: o.srdName }]);
    setQ("");
  };
  const setCount = (i: number, n: number) => setRows(n <= 0 ? rows.filter((_, j) => j !== i) : rows.map((r, j) => (j === i ? { ...r, count: Math.min(20, n) } : r)));

  async function save() {
    const body = { name: name || "Encounter", monsters: rows };
    if (editingId) await api.put(`/campaigns/${campaign.id}/encounters/${editingId}`, body);
    else setEditingId((await api.post(`/campaigns/${campaign.id}/encounters`, body)).id);
    saved.reload();
    toast("Encounter saved");
  }
  async function place() {
    setBusy(true);
    try {
      const r = await api.post(`/campaigns/${campaign.id}/encounters/place`, { monsters: rows, ...opts, ...(at ?? {}) });
      toast(`Placed ${r.added} monsters${opts.initiative !== "none" ? " and rolled initiative" : ""}`);
      onPlaced?.();
      close();
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  const max = Math.max(result.levels[result.levels.length - 1]?.xp ?? 1, result.adjustedXp) * 1.15 || 1;
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="row"><h2 className="grow" style={{ margin: 0 }}>⚔️ Encounter builder</h2><span className="pill">{campaign.rulesVersion} rules</span><button className="small" onClick={close}>✕</button></div>

      <div className="row top" style={{ marginTop: 10, gap: 16 }}>
        <div className="grow" style={{ minWidth: 280 }}>
          <h3>Monsters</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: goblin, owlbear, your NPCs..." />
          {results.length > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 6, maxHeight: 200, overflow: "auto", marginTop: 4 }}>
              {results.map((o) => (
                <div key={o.key} onClick={() => add(o)} style={{ padding: "4px 8px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
                  <b>{o.label}</b> <span className="muted" style={{ fontSize: 12 }}>CR {o.cr} · {xpForCr(o.cr)} XP · {o.detail}</span>
                </div>
              ))}
            </div>
          )}
          <table className="list" style={{ marginTop: 8 }}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}<div className="muted" style={{ fontSize: 12 }}>CR {r.cr} · {xpForCr(r.cr)} XP each</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="small" onClick={() => setCount(i, r.count - 1)}>−</button> <b>{r.count}</b> <button className="small" onClick={() => setCount(i, r.count + 1)}>+</button>
                  </td>
                  <td>{(xpForCr(r.cr) * r.count).toLocaleString()} XP</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">Search above to add monsters.</p>}
        </div>

        <div style={{ width: 300 }}>
          <h3>Party</h3>
          {party.map((c) => {
            const lvl = derive(normalizeCharacter(c.data)).level;
            return (
              <label key={c.id} className="inline" style={{ display: "flex", color: "var(--text)" }}>
                <input type="checkbox" checked={!excluded.has(c.id)} onChange={(e) => { const s = new Set(excluded); e.target.checked ? s.delete(c.id) : s.add(c.id); setExcluded(s); }} />
                {c.name} <span className="muted">level {lvl}</span>
              </label>
            );
          })}
          <div className="row" style={{ marginTop: 6 }}>
            <label>Extra heroes<input type="number" min={0} max={8} value={extra.count} onChange={(e) => setExtra({ ...extra, count: Number(e.target.value) })} style={{ width: 60 }} /></label>
            <label>at level<input type="number" min={1} max={20} value={extra.level} onChange={(e) => setExtra({ ...extra, level: Number(e.target.value) })} style={{ width: 60 }} /></label>
          </div>
          {levels.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No approved characters yet. Add "extra heroes" to plan anyway.</p>}
        </div>
      </div>

      <div className="card" style={{ background: "var(--panel-2)", marginTop: 10 }}>
        <div className="row">
          <span style={{ fontSize: 22, fontWeight: 700, color: DIFF_COLOR[result.difficulty] ?? "var(--text)", fontFamily: "Cinzel, serif" }}>{result.difficulty}</span>
          <span className="muted right">
            {result.totalXp.toLocaleString()} XP{result.rules === "2014" && result.multiplier !== 1 ? ` × ${result.multiplier} (${rows.reduce((s, r) => s + r.count, 0)} monsters) = ${result.adjustedXp.toLocaleString()} adjusted XP` : ""}
            {levels.length ? ` · ${result.xpPerCharacter.toLocaleString()} XP each when defeated` : ""}
          </span>
        </div>
        <div style={{ position: "relative", height: 26, background: "#0006", borderRadius: 6, marginTop: 8, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (result.adjustedXp / max) * 100)}%`, background: DIFF_COLOR[result.difficulty] ?? "#888", opacity: 0.8 }} />
          {result.levels.map((l) => (
            <div key={l.label} style={{ position: "absolute", left: `${(l.xp / max) * 100}%`, top: 0, bottom: 0, borderLeft: "2px solid #fff8" }}>
              <span style={{ position: "absolute", left: 3, top: 4, fontSize: 11, whiteSpace: "nowrap" }}>{l.label}</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
          {result.levels.map((l) => `${l.label} ${l.xp.toLocaleString()}`).join(" · ")} XP for this party.{" "}
          {result.rules === "2014" ? "2014 rules: monster XP is multiplied for groups of monsters." : "2024 rules: compare total monster XP to the party's budget."}
        </p>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <label>Initiative
          <select value={opts.initiative} onChange={(e) => setOpts({ ...opts, initiative: e.target.value })} style={{ width: "auto" }}>
            <option value="each">Roll for each</option><option value="group">One roll per group</option><option value="none">Don't add</option>
          </select>
        </label>
        <label className="inline"><input type="checkbox" checked={opts.hidden} onChange={(e) => setOpts({ ...opts, hidden: e.target.checked })} /> Hidden</label>
        <label className="inline"><input type="checkbox" checked={opts.rollHp} onChange={(e) => setOpts({ ...opts, rollHp: e.target.checked })} /> Roll HP</label>
        <button className="primary right" disabled={!rows.length || busy} onClick={place}>{busy ? "Placing..." : `Put ${rows.reduce((s, r) => s + r.count, 0) || ""} on the map`}</button>
      </div>

      <hr />
      <div className="row">
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name to save it, e.g. 'Goblin ambush'" />
        <button disabled={!rows.length} onClick={save}>{editingId ? "Save changes" : "Save for later"}</button>
        {editingId && <button onClick={() => { setEditingId(null); setName(""); setRows([]); }}>New</button>}
      </div>
      {(saved.data?.length ?? 0) > 0 && (
        <div style={{ marginTop: 8 }}>
          <b style={{ fontSize: 13 }}>Saved encounters</b>
          {saved.data!.map((e) => {
            const r = evaluateEncounter(campaign.rulesVersion, levels, e.monsters);
            return (
              <div key={e.id} className="row" style={{ marginTop: 4 }}>
                <span className="grow">{e.name} <span className="muted" style={{ fontSize: 12 }}>{e.monsters.map((m: Row) => `${m.count}× ${m.name}`).join(", ")}</span></span>
                <span className="pill" style={{ borderColor: DIFF_COLOR[r.difficulty], color: DIFF_COLOR[r.difficulty] }}>{r.difficulty}</span>
                <button className="small" onClick={() => { setRows(e.monsters); setName(e.name); setEditingId(e.id); }}>Open</button>
                <button className="small danger" onClick={() => confirm(`Delete "${e.name}"?`) && api.del(`/campaigns/${campaign.id}/encounters/${e.id}`).then(saved.reload)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
