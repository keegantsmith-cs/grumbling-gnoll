import { useRef, useState } from "react";
import { api } from "../api";
import { go, useStatus } from "../hooks";

export interface AdvMap { id: number; page: number; title: string; kind: string; gridType: string; cellsAcross: number; description: string; mapId: number | null; adventureId?: number; adventure?: string }

/** Maps found in adventure PDFs: preview, crop, and add to the campaign's Maps. */
export function AdventureMaps({ campaignId, adventureId, maps, reload, showAdventure }: { campaignId: number; adventureId?: number; maps: AdvMap[]; reload: () => void; showAdventure?: boolean }) {
  const { toast } = useStatus();
  const [importing, setImporting] = useState<AdvMap | null>(null);
  const [page, setPage] = useState("");
  return (
    <div>
      {maps.length === 0 && <p className="muted">No maps found yet.</p>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
        {maps.map((m) => {
          const adv = m.adventureId ?? adventureId!;
          return (
            <div key={m.id} className="card" style={{ padding: 8, marginBottom: 0 }}>
              <img src={`/api/adventures/${adv}/page/${m.page}?size=thumb`} alt="" loading="lazy" style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 4, background: "#0006" }} />
              <div style={{ fontWeight: 600, marginTop: 4 }}>{m.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>{showAdventure && m.adventure ? `${m.adventure} · ` : ""}p. {m.page}{m.gridType !== "none" ? ` · ${m.gridType} grid` : ""}</div>
              {m.description && <div className="muted" style={{ fontSize: 11 }}>{m.description}</div>}
              <div className="row" style={{ marginTop: 6, gap: 4 }}>
                {m.mapId
                  ? <><span className="pill ok">in Maps</span><button className="small" onClick={() => go(`c/${campaignId}/maps`)}>Open</button></>
                  : <button className="small primary" onClick={() => setImporting({ ...m, adventureId: adv })}>Add to Maps</button>}
                <button className="small danger right" title="Not a map? Remove it from this list" onClick={() => api.del(`/adventure-maps/${m.id}`).then(reload)}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
      {adventureId && (
        <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); api.post(`/adventures/${adventureId}/maps`, { page: Number(page) }).then(() => { setPage(""); reload(); }).catch((err) => toast(err.message)); }}>
          <span className="muted">Missed one?</span>
          <input type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} placeholder="Page #" style={{ width: 90 }} />
          <button className="small" disabled={!page}>Add map page</button>
        </form>
      )}
      {importing && <MapImporter m={importing} campaignId={campaignId} close={() => setImporting(null)} done={() => { setImporting(null); reload(); }} />}
    </div>
  );
}

function MapImporter({ m, campaignId, close, done }: { m: AdvMap; campaignId: number; close: () => void; done: () => void }) {
  const { toast } = useStatus();
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null); // fractions of the image
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [name, setName] = useState(m.title);
  const [gridType, setGridType] = useState(m.gridType === "hex" ? "hex" : m.gridType === "square" ? "square" : "none");
  const [cells, setCells] = useState(m.cellsAcross || 0);
  const [busy, setBusy] = useState(false);

  const pos = (e: React.MouseEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  async function save() {
    const img = imgRef.current!;
    setBusy(true);
    try {
      const s = sel && sel.w > 0.02 && sel.h > 0.02 ? sel : { x: 0, y: 0, w: 1, h: 1 };
      const sx = Math.round(s.x * img.naturalWidth), sy = Math.round(s.y * img.naturalHeight);
      const sw = Math.round(s.w * img.naturalWidth), sh = Math.round(s.h * img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = sw; canvas.height = sh;
      canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't crop the page"))), "image/jpeg", 0.92));
      const fd = new FormData();
      fd.append("image", blob, "map.jpg");
      fd.append("name", name);
      fd.append("width", String(sw));
      fd.append("height", String(sh));
      fd.append("gridType", gridType);
      fd.append("gridSize", String(cells > 0 ? Math.max(10, Math.round(sw / cells)) : 70));
      const r = await api.post(`/campaigns/${campaignId}/maps`, fd);
      await api.patch(`/adventure-maps/${m.id}`, { mapId: r.id });
      toast("Added to Maps. Fine-tune the grid in the map's Settings if needed.");
      done();
    } catch (e) { toast((e as Error).message); setBusy(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 150, display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ maxWidth: 1100, width: "100%", maxHeight: "95vh", overflow: "auto", marginBottom: 0 }}>
        <div className="row"><h2 className="grow" style={{ margin: 0 }}>Add map from page {m.page}</h2><button className="small" onClick={close}>✕</button></div>
        <p className="muted">Drag a box around the map to cut out the rest of the page, or leave it to use the whole page.</p>
        <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", userSelect: "none", cursor: "crosshair" }}
          onMouseDown={(e) => { const p = pos(e); setDrag(p); setSel({ x: p.x, y: p.y, w: 0, h: 0 }); }}
          onMouseMove={(e) => { if (!drag) return; const p = pos(e); setSel({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }); }}
          onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
          <img ref={imgRef} src={`/api/adventures/${m.adventureId}/page/${m.page}`} alt="" draggable={false} onLoad={() => setLoaded(true)} onError={() => toast("Couldn't load that page")}
            style={{ maxWidth: "100%", maxHeight: "60vh", display: "block" }} />
          {!loaded && <div className="muted" style={{ padding: 40 }}>Drawing the page...</div>}
          {sel && sel.w > 0 && (
            <div style={{ position: "absolute", left: `${sel.x * 100}%`, top: `${sel.y * 100}%`, width: `${sel.w * 100}%`, height: `${sel.h * 100}%`, border: "2px dashed var(--gold)", boxShadow: "0 0 0 9999px #0008", pointerEvents: "none" }} />
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="grow">Map name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Grid<select value={gridType} onChange={(e) => setGridType(e.target.value)}><option value="square">Squares</option><option value="hex">Hexes</option><option value="none">None</option></select></label>
          {gridType !== "none" && <label>Squares across the map<input type="number" min={0} value={cells} onChange={(e) => setCells(Number(e.target.value))} style={{ width: 90 }} /></label>}
        </div>
        {gridType !== "none" && <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Count the grid squares across the part you're keeping; it sets the grid size. You can line it up exactly afterwards in Maps → Settings.</p>}
        <div className="row">
          <button className="primary" disabled={!loaded || busy} onClick={save}>{busy ? "Adding..." : sel && sel.w > 0.02 ? "Add selected area" : "Add whole page"}</button>
          {sel && <button onClick={() => setSel(null)}>Clear selection</button>}
        </div>
      </div>
    </div>
  );
}
