import { useEffect, useState } from "react";
import { api } from "../api";
import { useStatus } from "../hooks";

interface Option { key: string; label: string; detail: string; entryId?: number; srdName?: string }

/** Pick a monster (your Compendium or the free SRD) and drop one or more onto the map. */
export function MonsterDrop({ campaignId, at, onDone }: { campaignId: number; at?: { x: number; y: number }; onDone?: () => void }) {
  const { toast } = useStatus();
  const [q, setQ] = useState("");
  const [mine, setMine] = useState<Option[]>([]);
  const [srd, setSrd] = useState<Option[]>([]);
  const [pick, setPick] = useState<Option | null>(null);
  const [count, setCount] = useState(1);
  const [rollHp, setRollHp] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [initiative, setInitiative] = useState<"each" | "group" | "none">("each");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<any[]>(`/campaigns/${campaignId}/compendium`).then((list) => setMine(
      list.filter((e) => e.kind === "monster" || (e.kind === "npc" && e.data.statblock))
        .map((e) => ({ key: `c${e.id}`, label: e.name, detail: `${e.kind === "npc" ? "NPC" : "Compendium"}${(e.data.statblock ?? e.data).challenge_rating ? ` · CR ${(e.data.statblock ?? e.data).challenge_rating}` : ""}${e.status === "draft" ? " · draft" : ""}`, entryId: e.id })),
    )).catch(() => {});
  }, [campaignId]);
  useEffect(() => {
    if (q.trim().length < 2) { setSrd([]); return; }
    const t = setTimeout(() => api.get<any[]>(`/srd/search?type=monster&q=${encodeURIComponent(q)}&limit=8`)
      .then((r) => setSrd(r.map((m) => ({ key: `s${m.name}`, label: m.name, detail: `SRD · CR ${m.challenge_rating} · ${m.hit_points} HP`, srdName: m.name })))).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q]);

  const ql = q.toLowerCase();
  const results = [...mine.filter((o) => !ql || o.label.toLowerCase().includes(ql)).slice(0, 8), ...srd];

  async function drop() {
    if (!pick) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { count, rollHp, hidden, initiative, ...(at ?? {}) };
      if (pick.entryId) body.entryId = pick.entryId;
      else body.monster = await api.get(`/srd/monster/${encodeURIComponent(pick.srdName!)}`);
      const r = await api.post(`/campaigns/${campaignId}/table/monsters`, body);
      toast(`Added ${r.added} × ${pick.label} to the map${initiative !== "none" ? " and initiative" : ""}`);
      setPick(null); setQ("");
      onDone?.();
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {!pick ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search monsters: goblin, wolf, your NPCs..." />
          <div style={{ maxHeight: 220, overflow: "auto", marginTop: 4 }}>
            {results.map((o) => (
              <div key={o.key} onClick={() => setPick(o)} style={{ padding: "4px 6px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
                <b>{o.label}</b> <span className="muted" style={{ fontSize: 12 }}>{o.detail}</span>
              </div>
            ))}
            {q.length >= 2 && results.length === 0 && <p className="muted">No matches.</p>}
          </div>
        </>
      ) : (
        <div>
          <div className="row"><b className="grow">{pick.label}</b><button className="small" onClick={() => setPick(null)}>change</button></div>
          <div className="row" style={{ margin: "6px 0" }}>
            <label>How many<input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 70 }} /></label>
            <label>Initiative
              <select value={initiative} onChange={(e) => setInitiative(e.target.value as any)} style={{ width: "auto" }}>
                <option value="each">Roll for each</option><option value="group">One roll for the group</option><option value="none">Don't add</option>
              </select>
            </label>
          </div>
          <label className="inline"><input type="checkbox" checked={rollHp} onChange={(e) => setRollHp(e.target.checked)} /> Roll hit points (instead of average)</label>
          <label className="inline"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden from players</label>
          <div style={{ marginTop: 8 }}><button className="primary" disabled={busy} onClick={drop}>{busy ? "Adding..." : `Add ${count} to the map`}</button></div>
        </div>
      )}
    </div>
  );
}
