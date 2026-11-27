import { useState } from "react";
import { api, imageSize } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import type { CampaignSocket } from "../socket";
import { AdventureMaps, type AdvMap } from "../components/AdventureMaps";
import { shrinkImage } from "../components/ScanSheet";

export function MapsTab({ campaign, live, onChange }: { campaign: Campaign; live: CampaignSocket; onChange: () => void }) {
  const { status, toast } = useStatus();
  const maps = useLoad<any[]>(`/campaigns/${campaign.id}/maps`);
  const advMaps = useLoad<AdvMap[]>(`/campaigns/${campaign.id}/adventure-maps`);
  const [mode, setMode] = useState<"upload" | "generate" | "ai" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [up, setUp] = useState({ name: "", gridType: "square", gridSize: 70, file: null as File | null });
  const [gen, setGen] = useState({ name: "", kind: "dungeon", cols: 40, rows: 30, rooms: 8, theme: "stone", gridType: "square" });
  const [ai, setAi] = useState({ description: "", cols: 40, rows: 30, gridType: "square" });

  async function run(fn: () => Promise<{ id: number }>) {
    setBusy(true); setError("");
    try { await fn(); maps.reload(); setMode(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const show = async (mapId: number | null) => {
    await api.post(`/campaigns/${campaign.id}/active-map`, { mapId });
    onChange();
    if (mapId) go(`c/${campaign.id}/table`);
  };
  const activeId = live.map?.id ?? null;

  return (
    <div>
      <div className="row">
        <h1 className="grow">Maps</h1>
        <button onClick={() => setMode("upload")}>⬆ Upload a map</button>
        <button onClick={() => setMode("generate")}>🎲 Random dungeon/cave</button>
        <button onClick={() => setMode("ai")} disabled={!status.aiEnabled} title={status.aiEnabled ? "" : "AI isn't set up on the server"}>🧙 AI-designed map</button>
      </div>
      {error && <div className="error">{error}</div>}

      {mode === "upload" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (!up.file) return; run(async () => {
          const { width, height } = await imageSize(up.file!);
          const fd = new FormData();
          fd.append("image", up.file!); fd.append("name", up.name || up.file!.name.replace(/\.\w+$/, ""));
          fd.append("width", String(width)); fd.append("height", String(height));
          fd.append("gridType", up.gridType); fd.append("gridSize", String(up.gridSize));
          return api.post(`/campaigns/${campaign.id}/maps`, fd);
        }); }}>
          <h3>Upload a map image</h3>
          <p className="muted">PNG, JPG or WebP up to 25 MB. Battle maps from the internet usually say how many pixels each square is (often 70, 100, or 140). You can fine-tune the grid after uploading.</p>
          <label>Image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setUp({ ...up, file: e.target.files?.[0] ?? null })} required /></label>
          <div className="row">
            <label className="grow">Name<input value={up.name} onChange={(e) => setUp({ ...up, name: e.target.value })} /></label>
            <GridPicker value={up.gridType} onChange={(gridType) => setUp({ ...up, gridType })} />
            <label>Pixels per square<input type="number" value={up.gridSize} onChange={(e) => setUp({ ...up, gridSize: Number(e.target.value) })} style={{ width: 90 }} /></label>
          </div>
          <button className="primary" disabled={busy}>{busy ? "Uploading..." : "Upload"}</button> <button type="button" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}

      {mode === "generate" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/campaigns/${campaign.id}/maps/generate`, gen)); }}>
          <h3>Random map</h3>
          <div className="row">
            <label className="grow">Name<input value={gen.name} onChange={(e) => setGen({ ...gen, name: e.target.value })} placeholder="Goblin warren" /></label>
            <label>Type<select value={gen.kind} onChange={(e) => setGen({ ...gen, kind: e.target.value })}><option value="dungeon">Dungeon (rooms & corridors)</option><option value="cave">Natural cave</option></select></label>
            {gen.kind === "dungeon" && <label>Style<select value={gen.theme} onChange={(e) => setGen({ ...gen, theme: e.target.value })}><option value="stone">Stone</option><option value="crypt">Crypt</option><option value="forest">Overgrown</option></select></label>}
          </div>
          <div className="row">
            <label>Width (squares)<input type="number" min={12} max={80} value={gen.cols} onChange={(e) => setGen({ ...gen, cols: Number(e.target.value) })} style={{ width: 90 }} /></label>
            <label>Height (squares)<input type="number" min={12} max={80} value={gen.rows} onChange={(e) => setGen({ ...gen, rows: Number(e.target.value) })} style={{ width: 90 }} /></label>
            {gen.kind === "dungeon" && <label>Rooms<input type="number" min={2} max={20} value={gen.rooms} onChange={(e) => setGen({ ...gen, rooms: Number(e.target.value) })} style={{ width: 70 }} /></label>}
            <GridPicker value={gen.gridType} onChange={(gridType) => setGen({ ...gen, gridType })} />
          </div>
          <p className="muted">Doors are brown, locked doors have a gold dot, and secret doors (purple "S") only show for you.</p>
          <button className="primary" disabled={busy}>Generate</button> <button type="button" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}

      {mode === "ai" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/campaigns/${campaign.id}/maps/ai-design`, ai)); }}>
          <h3>AI-designed map</h3>
          <p className="muted">Describe the place. The AI lays out the rooms and writes a key with read-aloud text and DM notes. Only you see the key, on the Table's "Map key" tab. Takes about 30-60 seconds.</p>
          <label>Description<textarea rows={4} value={ai.description} onChange={(e) => setAi({ ...ai, description: e.target.value })} required
            placeholder="A flooded temple to a forgotten sea god, taken over by kuo-toa. Entrance through a collapsed bell tower, a shrine with a trapped altar, and a hidden vault." /></label>
          <div className="row">
            <label>Width<input type="number" min={12} max={80} value={ai.cols} onChange={(e) => setAi({ ...ai, cols: Number(e.target.value) })} style={{ width: 80 }} /></label>
            <label>Height<input type="number" min={12} max={80} value={ai.rows} onChange={(e) => setAi({ ...ai, rows: Number(e.target.value) })} style={{ width: 80 }} /></label>
            <GridPicker value={ai.gridType} onChange={(gridType) => setAi({ ...ai, gridType })} />
          </div>
          <button className="primary" disabled={busy}>{busy ? "Designing... ✨" : "Design it"}</button> <button type="button" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}

      {maps.data && maps.data.length > 0 && <table className="list">
        <thead><tr><th>Map</th><th>Grid</th><th>Fog</th><th></th></tr></thead>
        <tbody>
          {maps.data?.map((m) => <MapRow key={m.id} m={m} active={m.id === activeId} show={show} reload={maps.reload} toast={toast} />)}
        </tbody>
      </table>}
      {maps.data?.length === 0 && !mode && <div className="empty"><b>No maps yet.</b><br />Upload a picture of a map, or let the site draw a random dungeon for you, using the buttons above.</div>}
      {activeId && <button style={{ marginTop: 10 }} onClick={() => show(null)}>Take the map off the table</button>}
      {advMaps.data && advMaps.data.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>📚 Maps from your adventures</h2>
          <AdventureMaps campaignId={campaign.id} maps={advMaps.data} reload={() => { advMaps.reload(); maps.reload(); }} showAdventure />
        </div>
      )}
    </div>
  );
}

function GridPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>Grid<select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="square">Squares</option><option value="hex">Hexes</option><option value="none">None</option>
    </select></label>
  );
}

function MapRow({ m, active, show, reload, toast }: { m: any; active: boolean; show: (id: number) => void; reload: () => void; toast: (s: string) => void }) {
  const { status } = useStatus();
  const [edit, setEdit] = useState(false);
  const [enrich, setEnrich] = useState(false);
  const [f, setF] = useState({ name: m.name, gridType: m.gridType, gridSize: m.gridSize, gridOffsetX: m.gridOffsetX, gridOffsetY: m.gridOffsetY, feetPerCell: m.feetPerCell, fogEnabled: m.fogEnabled });
  const save = async () => { await api.patch(`/maps/${m.id}`, f); toast("Map updated"); setEdit(false); reload(); };
  return (
    <>
      <tr>
        <td>{m.name} {active && <span className="pill ok">on the table</span>}<div className="muted" style={{ fontSize: 12 }}>{m.generated ? "Generated" : "Uploaded"} · {m.width}×{m.height}px</div></td>
        <td>{m.gridType}{m.gridType !== "none" ? ` · ${m.gridSize}px` : ""}</td>
        <td>{m.fogEnabled ? "On" : "Off"}</td>
        <td style={{ textAlign: "right" }}>
          <button className="primary small" onClick={() => show(m.id)}>{active ? "Open table" : "Show to players"}</button>{" "}
          {m.imageUrl && status.aiEnabled && <button className="small" onClick={() => setEnrich(!enrich)} title="AI reads the map and writes a room key, markers and encounter ideas">✨ Enrich</button>}{" "}
          <button className="small" onClick={() => setEdit(!edit)}>Settings</button>{" "}
          <button className="small danger" onClick={async () => { if (confirm(`Delete ${m.name}?`)) { await api.del(`/maps/${m.id}`); reload(); } }}>Delete</button>
        </td>
      </tr>
      {enrich && <tr><td colSpan={4}><EnrichPanel m={m} done={() => { setEnrich(false); reload(); }} /></td></tr>}
      {edit && (
        <tr><td colSpan={4}>
          <div className="row">
            <label className="grow">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <GridPicker value={f.gridType} onChange={(gridType) => setF({ ...f, gridType })} />
            <label>Square size (px)<input type="number" value={f.gridSize} onChange={(e) => setF({ ...f, gridSize: Number(e.target.value) })} style={{ width: 80 }} /></label>
            <label>Shift grid X<input type="number" value={f.gridOffsetX} onChange={(e) => setF({ ...f, gridOffsetX: Number(e.target.value) })} style={{ width: 70 }} /></label>
            <label>Shift grid Y<input type="number" value={f.gridOffsetY} onChange={(e) => setF({ ...f, gridOffsetY: Number(e.target.value) })} style={{ width: 70 }} /></label>
            <label>Feet per square<input type="number" value={f.feetPerCell} onChange={(e) => setF({ ...f, feetPerCell: Number(e.target.value) })} style={{ width: 70 }} /></label>
            <label className="inline"><input type="checkbox" checked={f.fogEnabled} onChange={(e) => setF({ ...f, fogEnabled: e.target.checked })} /> Fog of war</label>
            <button className="primary" onClick={save}>Save</button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Tip: show the map, then adjust square size and shift until the drawn grid lines up with the picture.</p>
        </td></tr>
      )}
    </>
  );
}

/** "Enrich with AI": Claude reads the picture and adds a room key, markers and encounter ideas. */
function EnrichPanel({ m, done }: { m: any; done: () => void }) {
  const { toast } = useStatus();
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  async function run() {
    setBusy(true);
    try {
      const blob = await fetch(m.imageUrl).then((r) => r.blob());
      const small = await shrinkImage(new File([blob], "map.jpg", { type: blob.type || "image/jpeg" }), 1568);
      const fd = new FormData();
      fd.append("image", small, "map.jpg");
      fd.append("request", request);
      setResult(await api.post(`/maps/${m.id}/enrich`, fd));
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  const gridSize = result?.grid?.has_grid && result.grid.cells_across > 0 ? Math.round(m.width / result.grid.cells_across) : null;
  return (
    <div className="card" style={{ border: "1px solid var(--gold)", marginBottom: 0 }}>
      <b>✨ Enrich "{m.name}" with AI</b>
      {!result ? (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            The AI studies the picture and adds: a <b>room key</b> with read-aloud text and DM notes (Table → Map key), <b>markers</b> for treasure, traps, doors and other features (only you see them until you reveal them), <b>atmosphere</b>, <b>encounter ideas</b> for your party, and a grid size estimate. The picture itself isn't changed. About 1–3¢.
            {m.hasKey ? " This replaces the map's current key and markers." : ""}
          </p>
          <div className="row">
            <input className="grow" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Optional: e.g. 'a haunted temple of a drowned god', 'make it a goblin lair'" />
            <button className="primary" disabled={busy} onClick={run}>{busy ? "Studying the map... (about a minute)" : "Enrich"}</button>
          </div>
        </>
      ) : (
        <>
          <p>Added {result.areas} areas, {result.points} markers and {result.encounters} encounter ideas. Open the map on the Table and look at the <b>Map key</b> tab.</p>
          <div className="row">
            {result.suggestedName && result.suggestedName !== m.name && <button className="small" onClick={() => api.patch(`/maps/${m.id}`, { name: result.suggestedName }).then(() => toast("Renamed"))}>Rename to "{result.suggestedName}"</button>}
            {gridSize && gridSize !== m.gridSize && <button className="small" onClick={() => api.patch(`/maps/${m.id}`, { gridSize, gridType: "square" }).then(() => toast(`Grid set to ${gridSize}px squares`))}>Use the AI's grid guess ({result.grid.cells_across} squares across, {gridSize}px)</button>}
            <button className="small" onClick={done}>Done</button>
          </div>
        </>
      )}
    </div>
  );
}
