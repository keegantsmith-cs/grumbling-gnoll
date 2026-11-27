import { useEffect, useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";

/** Finds compendium entries with the same name and type, and deletes the extras. */
export function Duplicates({ campaignId, onChanged, close }: { campaignId: number; onChanged: () => void; close: () => void }) {
  const { toast } = useStatus();
  const { data, reload } = useLoad<any[][]>(`/campaigns/${campaignId}/compendium/duplicates`);
  const [keep, setKeep] = useState<Record<string, number>>({});
  useEffect(() => {
    if (data) setKeep(Object.fromEntries(data.map((g) => [key(g), g[0].id])));
  }, [data]);

  const key = (g: any[]) => `${g[0].kind}:${g[0].name.toLowerCase()}`;
  const removeIds = (g: any[]) => g.filter((e) => e.id !== keep[key(g)]).map((e) => e.id);
  const del = async (ids: number[]) => {
    const r = await api.post(`/campaigns/${campaignId}/compendium/delete-many`, { ids });
    toast(`Deleted ${r.deleted} duplicate${r.deleted === 1 ? "" : "s"}`);
    reload();
    onChanged();
  };
  const detail = (e: any) => [
    e.status === "draft" ? "draft" : "approved",
    e.kind === "monster" && e.data.challenge_rating ? `CR ${e.data.challenge_rating}` : "",
    e.kind === "monster" && e.data.hit_points ? `${e.data.hit_points} HP` : "",
    e.kind === "item" && e.data.rarity ? e.data.rarity : "",
    e.source,
    e.createdAt?.slice(0, 10),
  ].filter(Boolean).join(" · ");

  if (!data) return <div className="card">Looking for duplicates...</div>;
  const total = data.reduce((s, g) => s + g.length - 1, 0);
  return (
    <div className="card" style={{ border: "1px solid var(--gold)" }}>
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>🧹 Duplicates</h3>
        {total > 0 && <button className="primary" onClick={() => confirm(`Delete ${total} duplicate entr${total === 1 ? "y" : "ies"}, keeping the selected one in each group?`) && del(data.flatMap(removeIds))}>Clean up all ({total})</button>}
        <button className="small" onClick={close}>Close</button>
      </div>
      {data.length === 0 ? <p>No duplicates found. 🍺</p> : (
        <>
          <p className="muted">Entries with the same name and type. The one most likely to be best is picked to keep (approved first, then the most complete). Change the pick if you like.</p>
          {data.map((g) => (
            <div key={key(g)} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <div className="row">
                <b className="grow">{g[0].name} <span className="muted" style={{ fontWeight: 400 }}>({g[0].kind}, {g.length} copies)</span></b>
                <button className="small danger" onClick={() => del(removeIds(g))}>Delete the other {g.length - 1}</button>
              </div>
              {g.map((e) => (
                <label key={e.id} className="inline" style={{ display: "flex", margin: "4px 0 0 8px", color: "var(--text)" }}>
                  <input type="radio" name={key(g)} checked={keep[key(g)] === e.id} onChange={() => setKeep({ ...keep, [key(g)]: e.id })} />
                  <span>{keep[key(g)] === e.id ? <b>Keep</b> : <span className="muted">delete</span>} · <span className="muted">{detail(e)}</span></span>
                </label>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
