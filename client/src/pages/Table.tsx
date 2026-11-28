import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Rect, Circle, Group, Text, Line, Shape } from "react-konva";
import type Konva from "konva";
import { useStatus } from "../hooks";
import { derive, normalizeCharacter } from "../../../shared/character";
import { api } from "../api";
import type { CampaignSocket, MapState, Token, FogShape } from "../socket";
import type { Campaign } from "./Campaign";
import { distanceFeet, drawGrid, renderGenerated, snap } from "../components/grid";
import { ChatPanel } from "../components/Chat";
import { InitiativePanel } from "../components/Initiative";
import { PartyPanel } from "../components/Party";
import { Markdown } from "../components/Markdown";
import { MonsterDrop } from "../components/MonsterDrop";
import { NpcMaker } from "../components/NpcMaker";
import { RingEditor, RingsLayer } from "../components/Rings";
import { EncounterBuilder } from "../components/EncounterBuilder";
import { PoiCard, PoiLayer } from "../components/Pois";
import { CombatPanel, tokenForEntry, useOwnedCharacterIds } from "../components/CombatPanel";
import type { Poi } from "../socket";

type Tool = "select" | "measure" | "ping" | "reveal" | "revealRect" | "hideRect";

function useHtmlImage(url: string | null | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = url;
  }, [url]);
  return img;
}

export function TableView({ campaign, live }: { campaign: Campaign; live: CampaignSocket }) {
  const [side, setSide] = useState<"chat" | "init" | "combat" | "party" | "key">("chat");
  const [combatToken, setCombatToken] = useState<number | null>(null);
  const map = live.map;
  const { status } = useStatus();
  const owned = useOwnedCharacterIds(campaign.id, status.user!.id);
  // When the turn moves on, the combat panel jumps to whoever's turn it is (if it's yours, or you're the DM)
  const { turn, entries, round } = live.initiative;
  const turnKey = `${round}:${turn}:${entries[turn]?.id ?? ""}`;
  useEffect(() => {
    if (!entries.length || !map) return;
    const t = tokenForEntry(entries[turn], map.tokens);
    if (!t) return;
    const mineToken = campaign.isDM || t.controlledBy === status.user!.id || (t.characterId != null && owned.has(t.characterId));
    if (!mineToken) return;
    setCombatToken(t.id);
    setSide("combat");
  }, [turnKey]);
  return (
    <div className="table-layout">
      <div className="board">
        {map ? <Board key={map.id} map={map} campaign={campaign} live={live} onFocusToken={setCombatToken} openCombat={() => setSide("combat")} /> : (
          <div className="center-page muted" style={{ textAlign: "center" }}>
            {campaign.isDM ? <>No map is showing. Open the <b>Maps</b> tab to upload or generate one, then click "Show to players".</> : "The DM hasn't put a map on the table yet. Chat and dice still work!"}
          </div>
        )}
      </div>
      <div className="side">
        <div className="side-tabs">
          <button className={side === "chat" ? "active" : ""} onClick={() => setSide("chat")}>Chat & dice</button>
          <button className={side === "init" ? "active" : ""} onClick={() => setSide("init")}>Initiative</button>
          <button className={side === "combat" ? "active" : ""} onClick={() => setSide("combat")}>⚔ Combat</button>
          <button className={side === "party" ? "active" : ""} onClick={() => setSide("party")}>{campaign.isDM ? "Party" : "My character"}</button>
          {campaign.isDM && map?.dmKey && <button className={side === "key" ? "active" : ""} onClick={() => setSide("key")}>Map key</button>}
        </div>
        {side === "chat" && <ChatPanel campaign={campaign} live={live} />}
        {side === "init" && <div className="side-body"><InitiativePanel campaign={campaign} live={live} /></div>}
        {side === "combat" && <div className="side-body"><CombatPanel campaign={campaign} live={live} tokenId={combatToken} setTokenId={setCombatToken} /></div>}
        {side === "party" && <div className="side-body"><PartyPanel campaign={campaign} live={live} /></div>}
        {side === "key" && map?.dmKey && (
          <div className="side-body">
            <p className="notice" style={{ fontSize: 13 }}>🔒 Only you can see the map key.</p>
            {(map.pois?.length ?? 0) > 0 && (
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>{map.pois.filter((p) => p.revealed).length}/{map.pois.length} markers revealed</span>
                <button className="small" onClick={() => live.socket?.emit("poi", { op: "revealAll" })}>Reveal all</button>
                <button className="small" onClick={() => live.socket?.emit("poi", { op: "hideAll" })}>Hide all</button>
              </div>
            )}
            {(map.enrichment?.encounters?.length ?? 0) > 0 && (
              <div className="card" style={{ padding: 8 }}>
                <b>⚔️ Encounter ideas</b>
                {map.enrichment!.encounters!.map((e, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div><b>{e.name}</b> <span className="muted">(area {e.area_label})</span></div>
                    <div className="muted" style={{ fontSize: 12 }}>{e.monsters.map((m) => `${m.count}× ${m.name}`).join(", ")}</div>
                    <button className="small" onClick={() => window.dispatchEvent(new CustomEvent("gnoll-encounter", { detail: e.monsters }))}>Open in encounter builder</button>
                  </div>
                ))}
              </div>
            )}
            <Markdown text={map.dmKey} />
          </div>
        )}
      </div>
    </div>
  );
}

function Board({ map, campaign, live, onFocusToken, openCombat }: { map: MapState; campaign: Campaign; live: CampaignSocket; onFocusToken: (id: number) => void; openCombat: () => void }) {
  const { status } = useStatus();
  const me = status.user!.id;
  const isDM = campaign.isDM;
  const wrap = useRef<HTMLDivElement>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [brush, setBrush] = useState(2); // in grid cells (radius)
  const [selected, setSelected] = useState<number | null>(null);
  const [measure, setMeasure] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [draft, setDraft] = useState<FogShape | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // The DM's fog tools fold away behind one "Fog" button; open by default on roomy screens, and the choice is remembered
  const [fogOpen, setFogOpenState] = useState(() => {
    const saved = localStorage.getItem("gnoll-fog-tools");
    return saved ? saved === "open" : window.innerWidth >= 1300;
  });
  const setFogOpen = (open: boolean) => {
    setFogOpenState(open);
    localStorage.setItem("gnoll-fog-tools", open ? "open" : "closed");
    if (!open && (tool === "reveal" || tool === "revealRect" || tool === "hideRect")) setTool("select");
  };
  const [encounterAt, setEncounterAt] = useState<{ x: number; y: number } | null | undefined>(undefined); // undefined = closed
  const image = useHtmlImage(map.imageUrl);
  const generated = useMemo(() => (map.generated ? renderGenerated(map.generated, map.gridSize, isDM) : null), [map.generated, map.gridSize, isDM]);

  // Fit the map to the screen on first load (and from the "Fit" button)
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    // leave room for the toolbar on top and the hint line at the bottom, so nothing starts hidden under them
    const tb = el.querySelector<HTMLElement>(".board-toolbar");
    const top = tb ? tb.offsetTop + tb.offsetHeight + 8 : 0, bottom = 40;
    const h = Math.max(100, el.clientHeight - top - bottom);
    const scale = Math.min(el.clientWidth / map.width, h / map.height, 1.5);
    setView({ scale, x: (el.clientWidth - map.width * scale) / 2, y: top + (h - map.height * scale) / 2 });
  };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    fit();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.id]);

  const pointer = () => layerRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  // zoom buttons: zoom around the middle of the board (handy on tablets and trackpads)
  function zoomBy(factor: number) {
    const scale = Math.min(6, Math.max(0.1, view.scale * factor));
    const cx = size.w / 2, cy = size.h / 2;
    const mx = (cx - view.x) / view.scale, my = (cy - view.y) / view.scale;
    setView({ scale, x: cx - mx * scale, y: cy - my * scale });
  }
  const touch = useMemo(() => window.matchMedia?.("(pointer: coarse)").matches ?? false, []);

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage()!;
    const p = stage.getPointerPosition()!;
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12;
    const scale = Math.min(6, Math.max(0.1, view.scale * factor));
    const mx = (p.x - view.x) / view.scale, my = (p.y - view.y) / view.scale;
    setView({ scale, x: p.x - mx * scale, y: p.y - my * scale });
  }

  function onDown(e: Konva.KonvaEventObject<PointerEvent>) {
    const p = pointer();
    startLongPress(e);
    if (e.evt.button === 2) return;
    if (tool === "measure") setMeasure({ a: snap(map, p.x, p.y), b: snap(map, p.x, p.y) });
    else if (tool === "ping" || (e.evt.altKey && tool === "select")) live.socket?.emit("ping", p);
    else if (tool === "reveal") setDraft({ mode: "reveal", kind: "poly", x: 0, y: 0, r: brush * map.gridSize, w: 0, h: 0, points: [p.x, p.y, p.x + 0.1, p.y] });
    else if (tool === "revealRect" || tool === "hideRect") setDraft({ mode: tool === "hideRect" ? "hide" : "reveal", kind: "rect", x: p.x, y: p.y, w: 0, h: 0, r: 0 });
    else if (e.target === e.target.getStage() || e.target.name() === "bg") setSelected(null);
  }
  function onMove(e?: Konva.KonvaEventObject<PointerEvent>) {
    if (longPress.current.timer && e && Math.hypot(e.evt.clientX - longPress.current.x, e.evt.clientY - longPress.current.y) > 10) cancelLongPress();
    const p = pointer();
    if (measure && tool === "measure") setMeasure({ ...measure, b: snap(map, p.x, p.y) });
    if (draft?.kind === "poly") {
      const pts = draft.points!;
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) > map.gridSize / 4) setDraft({ ...draft, points: [...pts, p.x, p.y] });
    } else if (draft?.kind === "rect") setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
  }
  function onUp() {
    cancelLongPress();
    if (draft) {
      let shape = draft;
      if (shape.kind === "rect") shape = { ...shape, x: Math.min(shape.x, shape.x + shape.w), y: Math.min(shape.y, shape.y + shape.h), w: Math.abs(shape.w), h: Math.abs(shape.h) };
      if (shape.kind !== "rect" || (shape.w > 5 && shape.h > 5)) live.socket?.emit("fog", { op: "add", shape });
      setDraft(null);
    }
    if (tool === "measure") setTimeout(() => setMeasure(null), 1500);
  }

  const ownedChars = useOwnedCharacterIds(campaign.id, me);
  const canControl = (t: Token) => isDM || t.controlledBy === me || (t.characterId != null && ownedChars.has(t.characterId));
  const sel = map.tokens.find((t) => t.id === selected) ?? null;
  const [menu, setMenu] = useState<{ sx: number; sy: number; p: { x: number; y: number }; tokenId?: number } | null>(null);
  const [dropAt, setDropAt] = useState<{ x: number; y: number } | null>(null);
  const [npcAt, setNpcAt] = useState<{ x: number; y: number } | null>(null);
  const [poiOpen, setPoiOpen] = useState<{ p: Poi; at: { x: number; y: number } } | null>(null);
  const [encounterRows, setEncounterRows] = useState<any[] | undefined>(undefined);
  const partyChars = useApprovedCharacters(campaign.id);

  useEffect(() => {
    const open = (ev: Event) => { setEncounterRows((ev as CustomEvent).detail); setEncounterAt(null); };
    window.addEventListener("gnoll-encounter", open);
    return () => window.removeEventListener("gnoll-encounter", open);
  }, []);

  function openMenuFor(target: Konva.Node, stagePos: { x: number; y: number }) {
    let node: Konva.Node | null = target;
    let tokenId: number | undefined;
    while (node) {
      const m = node.name()?.match(/^token-(\d+)$/);
      if (m) { tokenId = Number(m[1]); break; }
      node = node.getParent();
    }
    const p = snap(map, (stagePos.x - view.x) / view.scale, (stagePos.y - view.y) / view.scale);
    setMenu({ sx: stagePos.x, sy: stagePos.y, p, tokenId });
  }
  function onContext(e: Konva.KonvaEventObject<PointerEvent>) {
    e.evt.preventDefault();
    // A touch long-press can also fire a contextmenu event; the long-press timer already handled it
    if (longPress.current.fired) return;
    openMenuFor(e.target, e.target.getStage()!.getPointerPosition()!);
  }
  // Touch screens have no right-click: holding a finger still on the map (or a token) opens the same menu
  const longPress = useRef<{ timer: number | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  function cancelLongPress() {
    if (longPress.current.timer) window.clearTimeout(longPress.current.timer);
    longPress.current.timer = null;
  }
  function startLongPress(e: Konva.KonvaEventObject<PointerEvent>) {
    cancelLongPress();
    longPress.current.fired = false;
    if (e.evt.pointerType !== "touch" || tool !== "select") return;
    const stage = e.target.getStage()!;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const target = e.target;
    longPress.current.x = e.evt.clientX;
    longPress.current.y = e.evt.clientY;
    longPress.current.timer = window.setTimeout(() => {
      longPress.current.timer = null;
      longPress.current.fired = true;
      if (navigator.vibrate) navigator.vibrate(15);
      stage.stopDrag?.();
      target.stopDrag?.();
      openMenuFor(target, pos);
    }, 550);
  }
  const stageDraggable = tool === "select";

  return (
    <div ref={wrap} style={{ position: "absolute", inset: 0 }} onContextMenu={(e) => e.preventDefault()}>
      <div className="board-toolbar">
        <ToolBtn t="select" cur={tool} set={setTool} label="✋ Move" title="Drag tokens, or drag the map to pan. Scroll to zoom. Alt+click to ping." />
        <ToolBtn t="measure" cur={tool} set={setTool} label="📏 Measure" />
        <ToolBtn t="ping" cur={tool} set={setTool} label="📍 Ping" />
        {isDM && map.fogEnabled && (
          <>
            <span className="sep" aria-hidden="true" />
            <button className="fog-toggle" aria-expanded={fogOpen} onClick={() => setFogOpen(!fogOpen)} title={fogOpen ? "Hide the fog tools" : "Show the fog tools"}>🌫️ Fog {fogOpen ? "▾" : "▸"}</button>
            {fogOpen && <span className="fog-group">
            <ToolBtn t="reveal" cur={tool} set={setTool} label="🖌️ Reveal" title="Paint to remove fog" />
            <ToolBtn t="revealRect" cur={tool} set={setTool} label="▭ Reveal area" />
            <ToolBtn t="hideRect" cur={tool} set={setTool} label="▬ Hide area" />
            {tool === "reveal" && (
              <select aria-label="Brush size" value={brush} onChange={(e) => setBrush(Number(e.target.value))} style={{ width: "auto", padding: "2px 4px" }}>
                {[0.5, 1, 2, 3, 5].map((b) => <option key={b} value={b}>Brush {b}</option>)}
              </select>
            )}
            <button onClick={() => live.socket?.emit("fog", { op: "undo" })} title="Undo last fog change" aria-label="Undo last fog change">↶ Undo</button>
            <button onClick={() => confirm("Reveal the whole map?") && live.socket?.emit("fog", { op: "clear" })}>Reveal all</button>
            <button onClick={() => confirm("Cover the whole map in fog again?") && live.socket?.emit("fog", { op: "reset" })}>Reset fog</button>
            </span>}
          </>
        )}
        <span className="sep" aria-hidden="true" />
        <button className={showAdd ? "active" : ""} aria-pressed={showAdd} onClick={() => setShowAdd(!showAdd)}>{isDM ? "+ Token" : "+ My token"}</button>
        {isDM && <button onClick={() => setEncounterAt(null)}>⚔️ Encounter</button>}
      </div>
      {!isDM && map.fogEnabled && !map.fog.some((f) => f.mode === "reveal") && (
        <div className="board-notice" role="status"><b>Shrouded in fog</b>Your DM will reveal the map as you explore. Chat and dice work as usual.</div>
      )}
      <div className="board-hint">{tool === "select" ? (touch ? <>Drag to pan · tap a token to edit it · hold a finger down for more · </> : <>Scroll to zoom · drag to pan · right-click for more · </>) : null}{map.name} · {map.gridType === "hex" ? "hex" : map.gridType === "square" ? "square" : "no"} grid · {map.feetPerCell} ft per {map.gridType === "hex" ? "hex" : "square"}</div>

      <div className="zoom-btns" role="group" aria-label="Zoom">
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out">−</button>
        <button onClick={fit} title="Fit the whole map on screen">Fit</button>
      </div>

      <Stage
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={stageDraggable}
        onDragEnd={(e) => { if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() })); }}
        onWheel={onWheel}
        onPointerDown={onDown}
        onContextMenu={onContext}
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ cursor: tool === "select" ? "grab" : "crosshair" }}
      >
        <Layer ref={layerRef} listening>
          <Rect name="bg" x={0} y={0} width={map.width} height={map.height} fill="#1a1612" />
          {image && <KImage name="bg" image={image} width={map.width} height={map.height} />}
          {generated && <KImage name="bg" image={generated} width={map.width} height={map.height} />}
          <Shape listening={false} sceneFunc={(ctx) => drawGrid(ctx._context, map, view.scale)} />
          <RingsLayer map={map} tokens={map.tokens} scale={view.scale} />
          <PoiLayer map={map} scale={view.scale} isDM={isDM} onPick={(p, s) => setPoiOpen({ p, at: s })} />
          {map.tokens.map((t) => (
            <TokenNode key={t.id} t={t} map={map} scale={view.scale} draggable={tool === "select" && canControl(t)} selected={t.id === selected}
              onSelect={() => { setSelected(t.id); onFocusToken(t.id); }}
              onMove={(x, y) => live.socket?.emit("token:move", { id: t.id, x, y })} />
          ))}
        </Layer>
        {map.fogEnabled && (
          <Layer listening={false} opacity={isDM ? 0.45 : 1}>
            <FogShapes map={map} draft={draft} />
          </Layer>
        )}
        <Layer listening={false}>
          {measure && (
            <>
              <Line points={[measure.a.x, measure.a.y, measure.b.x, measure.b.y]} stroke="#e3b866" strokeWidth={3 / view.scale} dash={[10 / view.scale, 6 / view.scale]} />
              <Text x={measure.b.x + 10 / view.scale} y={measure.b.y - 24 / view.scale} text={`${distanceFeet(map, measure.a, measure.b)} ft`} fontSize={20 / view.scale} fill="#fff" stroke="#000" strokeWidth={0.6 / view.scale} fontStyle="bold" />
            </>
          )}
          {live.pings.map((p) => (
            <Group key={p.at} x={p.x} y={p.y}>
              <Circle radius={map.gridSize * 0.8} stroke="#ffdf6b" strokeWidth={4 / view.scale} />
              <Circle radius={map.gridSize * 0.2} fill="#ffdf6b" />
              <Text y={map.gridSize * 0.9} x={-60} width={120} align="center" text={p.name} fill="#fff" fontSize={14 / view.scale} />
            </Group>
          ))}
        </Layer>
      </Stage>

      {poiOpen && <PoiCard p={map.pois.find((x) => x.id === poiOpen.p.id) ?? poiOpen.p} isDM={isDM} live={live} at={poiOpen.at} close={() => setPoiOpen(null)} />}
      {menu && (
        <ContextMenu menu={menu} map={map} isDM={isDM} me={me} live={live} chars={partyChars} ownedChars={ownedChars}
          canControl={canControl}
          close={() => setMenu(null)}
          openToken={(id) => setSelected(id)}
          openEncounter={(p) => setEncounterAt(p)}
          openMonster={(p) => setDropAt(p)}
          openNpcs={(p) => setNpcAt(p)} />
      )}
      {npcAt && (
        <div className="token-panel card">
          <div className="panel-head"><h3>🧑 Create NPCs here (AI)</h3><button className="small" aria-label="Close" onClick={() => setNpcAt(null)}>✕</button></div>
          <NpcMaker campaignId={campaign.id} at={npcAt} onDone={() => setNpcAt(null)} />
        </div>
      )}
      {dropAt && (
        <div className="token-panel card">
          <div className="panel-head"><h3>👹 Add monsters here</h3><button className="small" aria-label="Close" onClick={() => setDropAt(null)}>✕</button></div>
          <MonsterDrop campaignId={campaign.id} at={dropAt} onDone={() => setDropAt(null)} />
        </div>
      )}
      {encounterAt !== undefined && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "#000a", overflow: "auto", padding: 16 }} onMouseDown={(e) => e.target === e.currentTarget && setEncounterAt(undefined)}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <EncounterBuilder campaign={campaign} at={encounterAt ?? undefined} initialRows={encounterRows} close={() => { setEncounterAt(undefined); setEncounterRows(undefined); }} />
          </div>
        </div>
      )}
      {(sel || showAdd) && (
        <div className="token-panel card">
          {sel ? <TokenEditor t={sel} isDM={isDM} canEdit={canControl(sel)} live={live} close={() => setSelected(null)} campaign={campaign} map={map} openCombat={openCombat} />
            : <AddToken map={map} view={view} size={size} isDM={isDM} campaign={campaign} live={live} close={() => setShowAdd(false)} />}
        </div>
      )}
    </div>
  );
}

function ToolBtn({ t, cur, set, label, title }: { t: Tool; cur: Tool; set: (t: Tool) => void; label: string; title?: string }) {
  return <button className={cur === t ? "active" : ""} aria-pressed={cur === t} onClick={() => set(t)} title={title}>{label}</button>;
}

function FogShapes({ map, draft }: { map: MapState; draft: FogShape | null }) {
  const shapes = draft ? [...map.fog, draft] : map.fog;
  // Everything starts black; "reveal" shapes cut holes, "hide" shapes paint black again.
  return (
    <>
      <Rect x={-5000} y={-5000} width={map.width + 10000} height={map.height + 10000} fill="#000" />
      {shapes.map((s, i) => {
        const op = s.mode === "reveal" ? "destination-out" : "source-over";
        if (s.kind === "all") return <Rect key={i} x={-5000} y={-5000} width={map.width + 10000} height={map.height + 10000} fill="#000" globalCompositeOperation={op} />;
        if (s.kind === "rect") return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill="#000" globalCompositeOperation={op} />;
        if (s.kind === "poly") return <Line key={i} points={s.points} stroke="#000" strokeWidth={s.r * 2} lineCap="round" lineJoin="round" globalCompositeOperation={op} />;
        return <Circle key={i} x={s.x} y={s.y} radius={s.r} fill="#000" globalCompositeOperation={op} />;
      })}
    </>
  );
}

function TokenNode({ t, map, scale, draggable, selected, onSelect, onMove }: { t: Token; map: MapState; scale: number; draggable: boolean; selected: boolean; onSelect: () => void; onMove: (x: number, y: number) => void }) {
  const img = useHtmlImage(t.imageUrl);
  const r = (map.gridSize * t.size) / 2 * 0.92;
  const hpPct = t.hp != null && t.maxHp ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : null;
  const [hover, setHover] = useState(false);
  return (
    <Group
      name={`token-${t.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      x={t.x}
      y={t.y}
      draggable={draggable}
      onPointerDown={(e) => { if (e.evt.button === 2) return; e.cancelBubble = true; onSelect(); }}
      onTap={onSelect}
      onDragEnd={(e) => {
        const s = snap(map, e.target.x(), e.target.y(), t.size);
        e.target.position(s);
        onMove(s.x, s.y);
      }}
      opacity={t.hidden ? 0.5 : t.hp != null && t.hp <= 0 ? 0.65 : 1}
    >
      <Circle radius={r} fill={t.color} stroke={selected ? "#ffdf6b" : "#111"} strokeWidth={selected ? 4 : 2} shadowBlur={6} shadowColor="#000" />
      {img && (
        <Group clipFunc={(ctx) => { ctx.arc(0, 0, r - 2, 0, Math.PI * 2); }}>
          <KImage image={img} x={-r} y={-r} width={r * 2} height={r * 2} />
        </Group>
      )}
      {!img && <Text text={(t.name.match(/^(\S).*?\s(\d+)$/) ? `${t.name[0]}${t.name.match(/(\d+)$/)![1]}` : t.name.slice(0, 2)).toUpperCase()} fontSize={r * 0.8} fill="#fff" fontStyle="bold" width={r * 2} x={-r} y={-r * 0.4} align="center" />}
      <TokenLabel t={t} r={r} cell={map.gridSize * t.size} scale={scale} focus={selected || hover} />
      {hpPct != null && (
        <>
          <Rect x={-r} y={-r - 9} width={r * 2} height={6} fill="#000" cornerRadius={3} />
          <Rect x={-r} y={-r - 9} width={r * 2 * hpPct} height={6} fill={hpPct > 0.5 ? "#5cb85c" : hpPct > 0.25 ? "#e0a030" : "#d9534f"} cornerRadius={3} />
        </>
      )}
      <TokenBadges t={t} r={r} />
      {t.hp != null && t.hp <= 0 && (
        <>
          <Line points={[-r * 0.6, -r * 0.6, r * 0.6, r * 0.6]} stroke="#d9534f" strokeWidth={r * 0.18} lineCap="round" />
          <Line points={[r * 0.6, -r * 0.6, -r * 0.6, r * 0.6]} stroke="#d9534f" strokeWidth={r * 0.18} lineCap="round" />
        </>
      )}
    </Group>
  );
}

/** Condition letters, concentration, temporary HP, AC and death saves drawn on the token itself. */
function TokenBadges({ t, r }: { t: Token; r: number }) {
  const conds = t.conditions.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 4);
  const d = Math.max(14, r * 0.5);
  const down = t.hp != null && t.hp <= 0 && t.characterId != null && t.deathSaves;
  return (
    <>
      {conds.map((c, i) => (
        <Group key={c} x={r * 0.55 + (i % 2) * d * 0.9} y={-r + Math.floor(i / 2) * d * 0.9}>
          <Circle radius={d / 2} fill="#7a3fa0" stroke="#111" strokeWidth={1} />
          <Text text={c.slice(0, 1).toUpperCase()} fontSize={d * 0.6} fill="#fff" fontStyle="bold" width={d} x={-d / 2} y={-d * 0.3} align="center" />
        </Group>
      ))}
      {t.concentrating && (
        <Group x={-r * 0.8} y={-r * 0.6}>
          <Circle radius={d / 2} fill="#2a6fc7" stroke="#111" strokeWidth={1} />
          <Text text="C" fontSize={d * 0.6} fill="#fff" fontStyle="bold" width={d} x={-d / 2} y={-d * 0.3} align="center" />
        </Group>
      )}
      {t.hp == null && t.health && t.health !== "healthy" && <Text text={t.health} fontSize={Math.max(11, r * 0.4)} fill={t.health === "bloodied" ? "#f0b050" : "#ff7a63"} fontStyle="bold" width={r * 2} x={-r} y={-r - 16} align="center" />}
      {!!t.tempHp && <Text text={`+${t.tempHp}`} fontSize={Math.max(11, r * 0.4)} fill="#7fc4ff" fontStyle="bold" x={-r} y={-r - 24} />}
      {t.ac != null && (
        <Group x={r * 0.7} y={r * 0.7}>
          <Circle radius={d * 0.62} fill="#33291f" stroke="#e3b866" strokeWidth={1} />
          <Text text={String(t.ac)} fontSize={d * 0.62} fill="#e3b866" fontStyle="bold" width={d * 1.4} x={-d * 0.7} y={-d * 0.3} align="center" />
        </Group>
      )}
      {down && <Text text={`${"✓".repeat(t.deathSaves!.successes)}${"✗".repeat(t.deathSaves!.failures)}` || "☠"} fontSize={Math.max(12, r * 0.45)} fill="#ff9b85" fontStyle="bold" width={r * 2} x={-r} y={r * 0.1} align="center" />}
    </>
  );
}

/**
 * Name under a token, 12px on screen on a dark backdrop so it reads over any map art.
 * Short name normally ("Mirabel", "Skeleton 2"); full name when selected or pointed at.
 * When zoomed far out (or the name is too long for its square) the names would pile on top of each other,
 * so then they only show on hover/selection.
 */
function TokenLabel({ t, r, cell, scale, focus }: { t: Token; r: number; cell: number; scale: number; focus: boolean }) {
  if (!focus && cell * scale < 44) return null;
  const numbered = /\s\d+$/.test(t.name);
  const text = focus || numbered ? t.name : t.name.split(/\s+/)[0];
  const fontSize = 12 / scale;
  const maxW = focus ? 260 / scale : Math.max(cell * 1.15, r * 2);
  // measure so the backdrop hugs the text; a name that won't fit waits for hover/selection (the token shows its initials)
  const needed = text.length * fontSize * 0.58 + 8 / scale;
  if (!focus && needed > maxW) return null;
  const width = Math.min(maxW, needed);
  return (
    <Group y={r + 3 / scale} listening={false}>
      <Rect x={-width / 2} y={0} width={width} height={fontSize + 6 / scale} fill="#000" opacity={0.7} cornerRadius={4 / scale} />
      <Text text={text} fontSize={fontSize} fill="#fff" width={width} x={-width / 2} y={3 / scale} align="center" wrap="none" ellipsis />
    </Group>
  );
}

function TokenEditor({ t, isDM, canEdit, live, close, campaign, map, openCombat }: { t: Token; isDM: boolean; canEdit: boolean; live: CampaignSocket; close: () => void; campaign: Campaign; map: MapState; openCombat: () => void }) {
  const [f, setF] = useState(t);
  useEffect(() => setF(t), [t]);
  const save = (patch: Partial<Token>) => live.socket?.emit("token:update", { id: t.id, ...patch });
  return (
    <div>
      <div className="panel-head"><h3>{t.name}</h3>{canEdit && <button className="small" onClick={openCombat} title="Open this token in the Combat tab">⚔ Combat</button>}<button className="small" aria-label="Close" onClick={close}>✕</button></div>
      {!canEdit && <p className="muted">You can't control this token.</p>}
      {canEdit && (
        <>
          <div className="row" style={{ margin: "8px 0" }}>
            <label className="grow">HP<input type="number" value={f.hp ?? ""} onChange={(e) => setF({ ...f, hp: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => save({ hp: f.hp })} /></label>
            {isDM && <label className="grow">Max HP<input type="number" value={f.maxHp ?? ""} onChange={(e) => setF({ ...f, maxHp: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => save({ maxHp: f.maxHp })} /></label>}
          </div>
          <DamageBox t={t} save={save} />
          <div className="row" style={{ marginBottom: 8, gap: 4 }} aria-label="Quick HP changes">
            {[-10, -5, -1, 1, 5, 10].map((d) => <button key={d} className="small" onClick={() => save({ hp: (t.hp ?? 0) + d })}>{d > 0 ? `+${d}` : d}</button>)}
          </div>
          <details open={(t.rings ?? []).length > 0} style={{ marginBottom: 8 }}>
            <summary style={{ cursor: "pointer" }}>◎ Rings: movement, reach, ranges, sight</summary>
            <div style={{ marginTop: 6 }}><RingEditor t={t} live={live} map={map} /></div>
          </details>
          <label>Conditions<input value={f.conditions} placeholder="e.g. prone, poisoned" onChange={(e) => setF({ ...f, conditions: e.target.value })} onBlur={() => save({ conditions: f.conditions })} /></label>
          {isDM && (
            <>
              <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => save({ name: f.name })} /></label>
              <div className="row">
                <label>Size<select value={t.size} onChange={(e) => save({ size: Number(e.target.value) })}>
                  <option value={0.5}>Tiny</option><option value={1}>Small/Medium</option><option value={2}>Large</option><option value={3}>Huge</option><option value={4}>Gargantuan</option>
                </select></label>
                <label>Color<input type="color" value={t.color} onChange={(e) => save({ color: e.target.value })} /></label>
              </div>
              <label>Controlled by<select value={t.controlledBy ?? ""} onChange={(e) => save({ controlledBy: e.target.value ? Number(e.target.value) : null })}>
                <option value="">DM only</option>
                {campaign.members.filter((m) => m.role !== "dm").map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
              </select></label>
              <label className="inline"><input type="checkbox" checked={t.hidden} onChange={(e) => save({ hidden: e.target.checked })} /> Hidden from players</label>
              <hr />
              <div className="row">
                <button className="small" onClick={() => live.socket?.emit("initiative", { op: "add", name: t.name, init: 0, hidden: t.hidden, tokenId: t.id })}>Add to initiative</button>
                <button className="small danger right" onClick={() => { live.socket?.emit("token:delete", t.id); close(); }}>Delete</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function AddToken({ map, view, size, isDM, campaign, live, close }: { map: MapState; view: { x: number; y: number; scale: number }; size: { w: number; h: number }; isDM: boolean; campaign: Campaign; live: CampaignSocket; close: () => void }) {
  const { status } = useStatus();
  const [chars, setChars] = useState<any[]>([]);
  const [f, setF] = useState({ name: "Goblin", color: "#7a2e1f", size: 1, hp: "", hidden: false, characterId: "", imageUrl: "" });
  useEffect(() => {
    api.get<any[]>(`/characters?campaignId=${campaign.id}`).then((cs) => setChars(cs.filter((c) => c.status === "approved" && (isDM || c.ownerId === status.user!.id))));
  }, [campaign.id, isDM, status.user]);
  const center = snap(map, (size.w / 2 - view.x) / view.scale, (size.h / 2 - view.y) / view.scale);

  function placeCharacter(c: any) {
    live.socket?.emit("token:add", { name: c.name, color: "#2e6b8a", size: 1, characterId: c.id, imageUrl: c.data.portraitUrl || "", hp: c.data.hp.current, maxHp: derive(normalizeCharacter(c.data)).maxHp, ...center });
    close();
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("image", file);
    const r = await api.post(`/campaigns/${campaign.id}/images`, fd);
    setF({ ...f, imageUrl: r.url });
  }

  return (
    <div>
      <div className="panel-head"><h3>Add a token</h3><button className="small" aria-label="Close" onClick={close}>✕</button></div>
      <p className="muted">It appears in the middle of your view. Drag it into place.</p>
      {chars.length > 0 && <div className="group-label">{isDM ? "Player characters" : "Your character"}</div>}
      <div className="col" style={{ marginBottom: 8 }}>
        {chars.map((c) => <button key={c.id} onClick={() => placeCharacter(c)}>🧝 {c.name}</button>)}
        {!isDM && chars.length === 0 && <p className="muted">You need an approved character in this campaign first.</p>}
      </div>
      {isDM && (
        <>
          <hr />
          <h3 style={{ marginBottom: 4 }}>⚔️ Monsters</h3>
          <MonsterDrop campaignId={campaign.id} at={center} onDone={close} />
          <hr />
          <details>
            <summary style={{ cursor: "pointer" }}><b>🧑 Create NPCs with AI</b></summary>
            <div style={{ marginTop: 6 }}><NpcMaker campaignId={campaign.id} at={center} onDone={close} /></div>
          </details>
          <hr />
          <details>
          <summary className="muted">Or make a custom token</summary>
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <div className="row">
            <label>Size<select value={f.size} onChange={(e) => setF({ ...f, size: Number(e.target.value) })}>
              <option value={0.5}>Tiny</option><option value={1}>Medium</option><option value={2}>Large</option><option value={3}>Huge</option><option value={4}>Gargantuan</option>
            </select></label>
            <label>HP<input type="number" value={f.hp} onChange={(e) => setF({ ...f, hp: e.target.value })} style={{ width: 70 }} /></label>
            <label>Color<input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
          </div>
          <label>Picture (optional)<input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
          <label className="inline"><input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} /> Hidden from players</label>
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => live.socket?.emit("token:add", { ...f, hp: f.hp || null, maxHp: f.hp || null, ...center })}>Add</button>
          </div>
          </details>
          <div>
          </div>
        </>
      )}
    </div>
  );
}

/** Type an amount, then Damage or Heal (healing can't go over max HP). */
function DamageBox({ t, save }: { t: Token; save: (p: Partial<Token>) => void }) {
  const [amt, setAmt] = useState("");
  const n = Math.abs(Math.round(Number(amt) || 0));
  const apply = (dir: -1 | 1) => {
    if (!n) return;
    let hp = (t.hp ?? 0) + dir * n;
    if (dir > 0 && t.maxHp != null) hp = Math.min(t.maxHp, hp);
    save({ hp });
    setAmt("");
  };
  return (
    <div className="row" style={{ marginBottom: 6 }}>
      <input type="number" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Amount" aria-label="Damage or healing amount" style={{ width: 80 }}
        onKeyDown={(e) => { if (e.key === "Enter") apply(-1); }} />
      <button className="small danger" disabled={!n} onClick={() => apply(-1)}>💥 Damage</button>
      <button className="small" disabled={!n} onClick={() => apply(1)}>💚 Heal</button>
      {t.hp != null && t.hp <= 0 && <span className="pill bad">down</span>}
    </div>
  );
}

function useApprovedCharacters(campaignId: number) {
  const [chars, setChars] = useState<any[]>([]);
  useEffect(() => {
    api.get<any[]>(`/characters?campaignId=${campaignId}`).then((cs) => setChars(cs.filter((c) => c.status === "approved"))).catch(() => {});
  }, [campaignId]);
  return chars;
}

/** Right-click menu: add characters, monsters and encounters where you clicked; quick token actions. */
function ContextMenu({ menu, map, isDM, me, live, chars, ownedChars, canControl, close, openToken, openEncounter, openMonster, openNpcs }: {
  menu: { sx: number; sy: number; p: { x: number; y: number }; tokenId?: number }; map: MapState; isDM: boolean; me: number; live: CampaignSocket;
  chars: any[]; ownedChars: Set<number>; canControl: (t: Token) => boolean; close: () => void;
  openToken: (id: number) => void; openEncounter: (p: { x: number; y: number }) => void; openMonster: (p: { x: number; y: number }) => void;
  openNpcs: (p: { x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<string | null>(null);
  useEffect(() => {
    // focus the first choice so the menu works from the keyboard too
    ref.current?.querySelector<HTMLButtonElement>("button.ctx-item:not(:disabled)")?.focus();
  }, []);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    setTimeout(() => document.addEventListener("mousedown", off), 0);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [close]);

  const t = menu.tokenId ? map.tokens.find((x) => x.id === menu.tokenId) : undefined;
  const placeable = chars.filter((c) => isDM || ownedChars.has(c.id));
  const onMap = new Set(map.tokens.map((x) => x.characterId).filter(Boolean));
  const item = (label: string, action: () => void, opts: { danger?: boolean; hint?: string } = {}) => (
    <button type="button" role="menuitem" className="ctx-item" style={opts.danger ? { color: "#ff9b85" } : undefined} onClick={() => { action(); close(); }} title={opts.hint}>{label}</button>
  );
  const placeChar = (c: any) => live.socket?.emit("token:add", { name: c.name, color: "#2e6b8a", size: 1, characterId: c.id, imageUrl: c.data.portraitUrl || "", hp: c.data.hp.current, maxHp: derive(normalizeCharacter(c.data)).maxHp, ...menu.p });
  const ring = (label: string, feet: number, kind: "ring" | "sight", color: string) => {
    if (!t) return;
    const has = (t.rings ?? []).some((r) => r.label === label && r.kind === kind);
    live.socket?.emit("token:update", { id: t.id, rings: has ? t.rings.filter((r) => !(r.label === label && r.kind === kind)) : [...(t.rings ?? []), { label, feet, color, kind }] });
  };
  const speed = t?.meta?.speed ?? (t?.characterId ? chars.find((c) => c.id === t.characterId)?.data?.speed : undefined) ?? 30;
  const sight = Math.max(60, ...(t?.meta?.vision ?? []).map((v) => v.feet));

  // keep the menu on screen, using its real size once it has drawn
  const [{ left, top }, setPos] = useState({ left: menu.sx, top: menu.sy });
  useLayoutEffect(() => {
    const el = ref.current, box = el?.parentElement;
    if (!el || !box) return;
    setPos({
      left: Math.max(4, Math.min(menu.sx, box.clientWidth - el.offsetWidth - 4)),
      top: Math.max(4, Math.min(menu.sy, box.clientHeight - el.offsetHeight - 4)),
    });
  }, [menu.sx, menu.sy, sub]);
  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={t ? `${t.name} actions` : "Map actions"} style={{ left, top }} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button.ctx-item") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}>
      {t ? (
        <>
          <div className="ctx-title">{t.name}{t.hp != null ? ` · ${t.hp}${t.maxHp ? `/${t.maxHp}` : ""} HP` : ""}</div>
          {canControl(t) && item("💥 Damage / heal / details…", () => openToken(t.id))}
          {canControl(t) && item(`${(t.rings ?? []).some((r) => r.label === "Move") ? "✓" : "◯"} Movement ring (${speed} ft)`, () => ring("Move", speed, "ring", "#5cb85c"))}
          {canControl(t) && item(`${(t.rings ?? []).some((r) => r.label === "Dash") ? "✓" : "◯"} Dash ring (${speed * 2} ft)`, () => ring("Dash", speed * 2, "ring", "#9bd38f"))}
          {canControl(t) && item(`${(t.rings ?? []).some((r) => r.kind === "sight") ? "✓" : "◯"} Line of sight (${sight} ft)`, () => ring("Line of sight", sight, "sight", "#5b9cf0"))}
          {canControl(t) && item("◎ More rings (reach, ranges, spells)…", () => openToken(t.id))}
          {canControl(t) && (t.rings ?? []).length > 0 && item("Clear rings", () => live.socket?.emit("token:update", { id: t.id, rings: [] }))}
          {item("📍 Ping here", () => live.socket?.emit("ping", menu.p))}
          {(isDM || canControl(t)) && item("🎲 Roll initiative", () => {
            const c = t.characterId ? chars.find((x) => x.id === t.characterId) : null;
            const bonus = c ? derive(normalizeCharacter(c.data)).initiative : 0;
            live.socket?.emit("initiative", { op: "roll", name: t.name, bonus, hidden: t.hidden, tokenId: t.id });
          })}
          {isDM && item(t.hidden ? "👁 Show to players" : "🙈 Hide from players", () => live.socket?.emit("token:update", { id: t.id, hidden: !t.hidden }))}
          {(isDM || canControl(t)) && item("🗑 Remove from map", () => live.socket?.emit("token:delete", t.id), { danger: true })}
        </>
      ) : (
        <>
          <div className="ctx-title">Here</div>
          {placeable.length > 0 && (
            <button type="button" role="menuitem" aria-expanded={sub === "chars"} className="ctx-item" onMouseEnter={() => setSub("chars")} onClick={() => setSub(sub === "chars" ? null : "chars")}>🧝 {isDM ? "Add a player character" : "Place my character"} {sub === "chars" ? "▾" : "▸"}</button>
          )}
          {sub === "chars" && placeable.map((c) => (
            <button type="button" role="menuitem" key={c.id} className="ctx-item ctx-sub" onClick={() => { placeChar(c); close(); }}>
              {c.name} {onMap.has(c.id) && <span className="muted" style={{ fontSize: 12 }}>(already on map)</span>}
            </button>
          ))}
          {isDM && item("👹 Add monsters here…", () => openMonster(menu.p))}
          {isDM && item("🧑 Create NPCs here (AI)…", () => openNpcs(menu.p))}
          {isDM && item("⚔️ Build an encounter here…", () => openEncounter(menu.p))}
          {item("📍 Ping here", () => live.socket?.emit("ping", menu.p))}
          {isDM && item("📌 Add a marker here…", () => { const title = prompt("Marker name (only you see it until you reveal it):"); if (title) live.socket?.emit("poi", { op: "add", x: menu.p.x, y: menu.p.y, title, note: prompt("Notes for you (optional):") ?? "" }); })}
          {isDM && map.fogEnabled && item("☀️ Reveal fog around here", () => live.socket?.emit("fog", { op: "add", shape: { mode: "reveal", kind: "circle", x: menu.p.x, y: menu.p.y, r: map.gridSize * 3 } }))}
          {isDM && map.fogEnabled && item("🌑 Cover with fog around here", () => live.socket?.emit("fog", { op: "add", shape: { mode: "hide", kind: "circle", x: menu.p.x, y: menu.p.y, r: map.gridSize * 3 } }))}
          {!isDM && placeable.length === 0 && <div className="ctx-item muted" style={{ cursor: "default", whiteSpace: "normal" }}>You need an approved character to place a token.</div>}
        </>
      )}
    </div>
  );
}
