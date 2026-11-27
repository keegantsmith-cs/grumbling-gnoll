// Range rings (movement, reach, weapon & spell ranges, senses) and line of sight on the map.
import { useEffect, useMemo, useState } from "react";
import { Circle, Group, Line, Text } from "react-konva";
import { api } from "../api";
import type { CampaignSocket, MapState, Ring, Token } from "../socket";

const COLORS = { move: "#5cb85c", dash: "#9bd38f", reach: "#d9534f", ranged: "#e0a030", long: "#b07a1c", spell: "#a77ad6", sight: "#5b9cf0", custom: "#e3b866" };
export const feetToPx = (map: MapState, feet: number) => (feet / (map.feetPerCell || 5)) * map.gridSize;

/** Walls on generated maps: rock and closed doors block sight. */
function blocks(gen: { tiles: string[] }, cx: number, cy: number) {
  const ch = gen.tiles[cy]?.[cx];
  return ch === undefined || ch === " " || ch === "+" || ch === "L" || ch === "S";
}

/** What a token at (x, y) can see within `radius` pixels, as a polygon, by casting rays across the tile grid. */
export function visibilityPolygon(gen: { tiles: string[]; cols: number; rows: number }, cell: number, x: number, y: number, radius: number): number[] {
  const pts: number[] = [];
  const rays = 240;
  const step = cell / 5;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let d = 0;
    while (d < radius) {
      const nd = d + step;
      const px = x + dx * nd, py = y + dy * nd;
      if (blocks(gen, Math.floor(px / cell), Math.floor(py / cell))) {
        // let the light reach the wall's face so walls themselves are visible
        d = nd;
        break;
      }
      d = nd;
    }
    pts.push(x + dx * Math.min(d, radius), y + dy * Math.min(d, radius));
  }
  return pts;
}

/** Draws every token's rings. Put it under the tokens so they stay clickable. */
export function RingsLayer({ map, tokens, scale }: { map: MapState; tokens: Token[]; scale: number }) {
  return (
    <>
      {tokens.flatMap((t) => (t.rings ?? []).map((r, i) => {
        const radius = feetToPx(map, r.feet) + (map.gridSize * t.size) / 2 - map.gridSize / 2;
        if (r.kind === "sight") {
          const poly = map.generated ? visibilityPolygon(map.generated, map.gridSize, t.x, t.y, radius) : null;
          return (
            <Group key={`${t.id}-${i}`} listening={false}>
              {poly
                ? <Line points={poly} closed fill="rgba(255,236,170,0.14)" stroke={r.color} strokeWidth={1.5 / scale} />
                : <Circle x={t.x} y={t.y} radius={radius} fill="rgba(91,156,240,0.08)" stroke={r.color} strokeWidth={2 / scale} dash={[4 / scale, 6 / scale]} />}
              <Text x={t.x - 80} width={160} align="center" y={t.y - radius - 16 / scale} text={`${r.label} ${r.feet} ft`} fontSize={12 / scale} fill={r.color} stroke="#000" strokeWidth={0.4 / scale} fontStyle="bold" />
            </Group>
          );
        }
        return (
          <Group key={`${t.id}-${i}`} listening={false}>
            <Circle x={t.x} y={t.y} radius={radius} stroke={r.color} strokeWidth={2.5 / scale} dash={[10 / scale, 6 / scale]} fill={`${r.color}14`} />
            <Text x={t.x - 80} width={160} align="center" y={t.y - radius - 16 / scale} text={`${r.label} ${r.feet} ft`} fontSize={12 / scale} fill={r.color} stroke="#000" strokeWidth={0.4 / scale} fontStyle="bold" />
          </Group>
        );
      }))}
    </>
  );
}

const ftIn = (s: string) => [...String(s).matchAll(/(\d+)\s*(?:feet|ft)/gi)].map((m) => Number(m[1]));

/** Ring choices for a token, from its stat block (monsters) or character sheet (players). */
function usePresets(t: Token) {
  const [char, setChar] = useState<any>(null);
  useEffect(() => {
    if (t.characterId) api.get(`/characters/${t.characterId}`).then((c) => setChar(c.data)).catch(() => {});
  }, [t.characterId]);
  return useMemo(() => {
    const out: Ring[] = [];
    const speed = char?.speed ?? t.meta?.speed ?? 30;
    out.push({ label: "Move", feet: speed, color: COLORS.move, kind: "ring" });
    out.push({ label: "Dash", feet: speed * 2, color: COLORS.dash, kind: "ring" });
    for (const s of t.meta?.otherSpeeds ?? []) out.push({ label: s.kind[0].toUpperCase() + s.kind.slice(1), feet: s.feet, color: COLORS.move, kind: "ring" });
    if (char) {
      const reachWeapon = (char.attacks ?? []).some((a: any) => /reach/i.test(a.notes ?? ""));
      out.push({ label: "Reach", feet: reachWeapon ? 10 : 5, color: COLORS.reach, kind: "ring" });
      for (const a of char.attacks ?? []) {
        const m = String(a.notes ?? "").match(/(\d+)\/(\d+)\s*ft/);
        if (m) { out.push({ label: a.name, feet: Number(m[1]), color: COLORS.ranged, kind: "ring" }); out.push({ label: `${a.name} (long)`, feet: Number(m[2]), color: COLORS.long, kind: "ring" }); }
      }
      const spellRanges = new Map<number, string>();
      for (const sp of char.spells ?? []) for (const f of ftIn(sp.notes ?? "").slice(0, 1)) if (f > 5 && !spellRanges.has(f)) spellRanges.set(f, sp.name);
      for (const [f, name] of [...spellRanges.entries()].sort((a, b) => a[0] - b[0]).slice(0, 4)) out.push({ label: `${name} range`, feet: f, color: COLORS.spell, kind: "ring" });
      const dv = String(`${char.features ?? ""} ${char.species ?? ""}`).match(/darkvision\D{0,5}(\d+)/i)?.[1]
        ?? (/(dwarf|elf|gnome|half-orc|half-elf|tiefling|drow|orc|dragonborn)/i.test(char.species ?? "") ? (/drow/i.test(char.species) ? "120" : "60") : null);
      if (dv) out.push({ label: "Darkvision", feet: Number(dv), color: COLORS.sight, kind: "ring" });
    } else {
      for (const a of t.meta?.attacks ?? []) {
        if (a.reach) out.push({ label: `${a.name} reach`, feet: a.reach, color: COLORS.reach, kind: "ring" });
        if (a.normal) out.push({ label: a.name, feet: a.normal, color: COLORS.ranged, kind: "ring" });
        if (a.long) out.push({ label: `${a.name} (long)`, feet: a.long, color: COLORS.long, kind: "ring" });
      }
      if (!t.meta?.attacks?.length) out.push({ label: "Reach", feet: 5, color: COLORS.reach, kind: "ring" });
      for (const v of t.meta?.vision ?? []) out.push({ label: v.kind[0].toUpperCase() + v.kind.slice(1), feet: v.feet, color: COLORS.sight, kind: "ring" });
    }
    const sightFeet = Math.max(60, ...out.filter((r) => r.color === COLORS.sight).map((r) => r.feet));
    out.push({ label: "Line of sight", feet: sightFeet, color: COLORS.sight, kind: "sight" });
    // no duplicates
    const seen = new Set<string>();
    return out.filter((r) => { const k = `${r.label}-${r.feet}-${r.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [char, t.meta, t.characterId]);
}

/** Toggle rings on a token (everyone at the table sees them). */
export function RingEditor({ t, live, map }: { t: Token; live: CampaignSocket; map: MapState }) {
  const presets = usePresets(t);
  const [custom, setCustom] = useState({ label: "", feet: "" });
  const rings = t.rings ?? [];
  const has = (r: Ring) => rings.some((x) => x.label === r.label && x.feet === r.feet && x.kind === r.kind);
  const save = (next: Ring[]) => live.socket?.emit("token:update", { id: t.id, rings: next });
  const toggle = (r: Ring) => save(has(r) ? rings.filter((x) => !(x.label === r.label && x.feet === r.feet && x.kind === r.kind)) : [...rings, r]);
  return (
    <div>
      <div className="row" style={{ gap: 4 }}>
        {presets.map((r) => (
          <button key={`${r.label}-${r.feet}-${r.kind}`} className={`small ${has(r) ? "active" : ""}`} style={{ borderColor: has(r) ? r.color : undefined }} onClick={() => toggle(r)}
            title={r.kind === "sight" ? (map.generated ? "Shows what this token can see, blocked by walls and closed doors" : "On uploaded pictures there are no walls to block sight, so this shows the distance only") : undefined}>
            {r.kind === "sight" ? "👁 " : ""}{r.label} {r.feet}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        <input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="Other: label" style={{ width: 110 }} />
        <input type="number" value={custom.feet} onChange={(e) => setCustom({ ...custom, feet: e.target.value })} placeholder="ft" style={{ width: 60 }} />
        <button className="small" disabled={!custom.feet} onClick={() => { save([...rings, { label: custom.label || "Range", feet: Number(custom.feet), color: COLORS.custom, kind: "ring" }]); setCustom({ label: "", feet: "" }); }}>Add</button>
        {rings.length > 0 && <button className="small danger" onClick={() => save([])}>Clear</button>}
      </div>
    </div>
  );
}
