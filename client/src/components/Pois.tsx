// Points of interest on the map (from "Enrich with AI" or added by the DM).
import { Circle, Group, Rect, Text } from "react-konva";
import type { CampaignSocket, MapState, Poi } from "../socket";
import { Markdown } from "./Markdown";

export const POI_ICON: Record<string, string> = {
  area: "", treasure: "💰", trap: "⚠️", door: "🚪", secret: "🗝️", feature: "✦", hazard: "☠️", creature: "👁", clue: "🔍", light: "🔥", exit: "➜",
};

/** Konva markers. The DM sees all (unrevealed ones faded); players only get revealed ones from the server. */
export function PoiLayer({ map, scale, isDM, onPick }: { map: MapState; scale: number; isDM: boolean; onPick: (p: Poi, screen: { x: number; y: number }) => void }) {
  const r = Math.max(10, map.gridSize * 0.28);
  return (
    <>
      {(map.pois ?? []).map((p) => (
        <Group key={p.id} x={p.x} y={p.y} opacity={p.revealed ? 1 : 0.6}
          onMouseDown={(e) => { if (e.evt.button === 2) return; e.cancelBubble = true; const s = e.target.getStage()!.getPointerPosition()!; onPick(p, s); }}
          onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = "pointer"; }}
          onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = ""; }}>
          {p.kind === "area" ? (
            <>
              <Circle radius={r * 1.15} fill="rgba(122,31,18,0.9)" stroke={p.revealed ? "#e3b866" : "#fff"} strokeWidth={2 / scale} dash={p.revealed ? undefined : [4 / scale, 3 / scale]} />
              <Text text={p.label} fontSize={r * 1.1} fill="#fff3d6" fontStyle="bold" width={r * 4} x={-r * 2} y={-r * 0.55} align="center" />
            </>
          ) : (
            <>
              <Rect width={r * 1.8} height={r * 1.8} x={-r * 0.9} y={-r * 0.9} rotation={45} offsetX={0} fill="rgba(17,14,11,0.85)" stroke={p.revealed ? "#e3b866" : "#c77dff"} strokeWidth={2 / scale} cornerRadius={3} />
              <Text text={POI_ICON[p.kind] ?? "✦"} fontSize={r} width={r * 3} x={-r * 1.5} y={-r * 0.5} align="center" />
            </>
          )}
          {(isDM || p.revealed) && scale * map.gridSize > 28 && (
            <Text text={p.title} fontSize={Math.max(10, map.gridSize * 0.16)} fill="#fff" stroke="#000" strokeWidth={0.5 / scale} width={map.gridSize * 3} x={-map.gridSize * 1.5} y={r * 1.3} align="center" />
          )}
        </Group>
      ))}
    </>
  );
}

/** Small card shown when a marker is clicked. */
export function PoiCard({ p, isDM, live, at, close }: { p: Poi; isDM: boolean; live: CampaignSocket; at: { x: number; y: number }; close: () => void }) {
  return (
    <div className="ctx-menu" style={{ left: Math.max(4, at.x + 12), top: Math.max(4, at.y - 10), width: 280, whiteSpace: "normal", padding: 10 }}>
      <div className="row"><b className="grow" style={{ color: "var(--gold)" }}>{p.kind === "area" ? `${p.label}. ` : `${POI_ICON[p.kind] ?? ""} `}{p.title}</b><button className="small" onClick={close}>✕</button></div>
      {isDM && p.note && <div style={{ fontSize: 13, marginTop: 4 }}><Markdown text={p.note} /></div>}
      {isDM ? (
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`pill ${p.revealed ? "ok" : ""}`}>{p.revealed ? "players see it" : "only you see it"}</span>
          <button className="small" onClick={() => { live.socket?.emit("poi", { op: p.revealed ? "hide" : "reveal", id: p.id }); close(); }}>{p.revealed ? "Hide" : "Reveal to players"}</button>
          <button className="small danger" onClick={() => { live.socket?.emit("poi", { op: "delete", id: p.id }); close(); }}>Delete</button>
        </div>
      ) : <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Marked by the DM.</p>}
    </div>
  );
}
