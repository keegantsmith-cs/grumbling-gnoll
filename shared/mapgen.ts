// Procedural map generation. Produces a tile grid the browser draws as a battle map.
// Tile codes: ' ' rock/empty, '.' floor, '+' door, 'S' secret door (shown to DM only), 'L' locked door, '~' water, '^' rubble/difficult terrain

export interface GeneratedMap {
  cols: number;
  rows: number;
  tiles: string[]; // one string per row
  rooms: { label: string; name: string; x: number; y: number; w: number; h: number }[];
  theme: "stone" | "cave" | "forest" | "crypt";
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = string[][];
const makeGrid = (cols: number, rows: number, fill = " "): Grid => Array.from({ length: rows }, () => Array(cols).fill(fill));
const inside = (g: Grid, x: number, y: number) => y >= 0 && y < g.length && x >= 0 && x < g[0].length;

interface Rect { x: number; y: number; w: number; h: number }
const center = (r: Rect) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) });

function carveRect(g: Grid, r: Rect) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inside(g, x, y)) g[y][x] = ".";
}

function carveBlob(g: Grid, r: Rect, rng: () => number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  for (let y = r.y - 1; y <= r.y + r.h; y++)
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (!inside(g, x, y)) continue;
      const dx = (x + 0.5 - cx) / (r.w / 2), dy = (y + 0.5 - cy) / (r.h / 2);
      if (dx * dx + dy * dy <= 0.85 + rng() * 0.35) g[y][x] = ".";
    }
}

function inRect(r: Rect, x: number, y: number) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** L-shaped corridor between two rooms; puts a door where it leaves each built room. */
function carveCorridor(g: Grid, a: Rect, b: Rect, rng: () => number, door: string, rooms: Rect[], doorsOn: boolean) {
  const p = center(a), q = center(b);
  const path: { x: number; y: number }[] = [];
  const horizFirst = rng() < 0.5;
  let x = p.x, y = p.y;
  const stepTo = (tx: number, ty: number) => {
    while (x !== tx) { x += Math.sign(tx - x); path.push({ x, y }); }
    while (y !== ty) { y += Math.sign(ty - y); path.push({ x, y }); }
  };
  if (horizFirst) { stepTo(q.x, p.y); stepTo(q.x, q.y); } else { stepTo(p.x, q.y); stepTo(q.x, q.y); }
  let prevInRoom = true;
  for (const c of path) {
    if (!inside(g, c.x, c.y)) continue;
    const nowInRoom = rooms.some((r) => inRect(r, c.x, c.y));
    if (g[c.y][c.x] === " ") g[c.y][c.x] = ".";
    // Door at the first corridor square outside a room, and the last one before entering a room
    if (doorsOn && !nowInRoom && prevInRoom) g[c.y][c.x] = door;
    if (doorsOn && nowInRoom && !prevInRoom) {
      const prev = path[path.indexOf(c) - 1];
      if (prev && inside(g, prev.x, prev.y) && g[prev.y][prev.x] === ".") g[prev.y][prev.x] = door;
    }
    prevInRoom = nowInRoom;
  }
}

/** Minimum spanning tree over room centers, plus a few extra links for loops. */
function connections(rooms: Rect[], rng: () => number, extra = 0.15): [number, number][] {
  const n = rooms.length;
  if (n < 2) return [];
  const dist = (i: number, j: number) => {
    const a = center(rooms[i]), b = center(rooms[j]);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  while (inTree.size < n) {
    let best: [number, number] | null = null, bestD = Infinity;
    for (const i of inTree) for (let j = 0; j < n; j++) if (!inTree.has(j) && dist(i, j) < bestD) { bestD = dist(i, j); best = [i, j]; }
    edges.push(best!);
    inTree.add(best![1]);
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (rng() < extra / n * 4 && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
  return edges;
}

function sprinkle(g: Grid, rng: () => number, tile: string, chance: number) {
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) if (g[y][x] === "." && rng() < chance) g[y][x] = tile;
}

export function generateDungeon(cols: number, rows: number, seed: number, roomCount = 8, theme: GeneratedMap["theme"] = "stone"): GeneratedMap {
  const rng = mulberry32(seed);
  const g = makeGrid(cols, rows);
  const rooms: Rect[] = [];
  for (let tries = 0; tries < 400 && rooms.length < roomCount; tries++) {
    const w = 3 + Math.floor(rng() * 6), h = 3 + Math.floor(rng() * 5);
    const r = { x: 1 + Math.floor(rng() * (cols - w - 2)), y: 1 + Math.floor(rng() * (rows - h - 2)), w, h };
    if (rooms.some((o) => r.x < o.x + o.w + 2 && r.x + r.w + 2 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y)) continue;
    rooms.push(r);
  }
  rooms.forEach((r) => carveRect(g, r));
  for (const [i, j] of connections(rooms, rng)) carveCorridor(g, rooms[i], rooms[j], rng, rng() < 0.1 ? "S" : rng() < 0.15 ? "L" : "+", rooms, true);
  sprinkle(g, rng, "^", 0.02);
  return {
    cols, rows, theme,
    tiles: g.map((r) => r.join("")),
    rooms: rooms.map((r, i) => ({ label: String(i + 1), name: `Room ${i + 1}`, ...r })),
  };
}

export function generateCave(cols: number, rows: number, seed: number): GeneratedMap {
  const rng = mulberry32(seed);
  let g = makeGrid(cols, rows);
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) g[y][x] = rng() < 0.55 ? "." : " ";
  for (let step = 0; step < 5; step++) {
    const next = makeGrid(cols, rows);
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[y + dy][x + dx] === " ") walls++;
      next[y][x] = walls >= 5 ? " " : ".";
    }
    g = next;
  }
  // keep only the largest connected cavern
  const seen = makeGrid(cols, rows, "0");
  let best: { x: number; y: number }[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (g[y][x] !== "." || seen[y][x] === "1") continue;
    const region: { x: number; y: number }[] = [];
    const stack = [{ x, y }];
    seen[y][x] = "1";
    while (stack.length) {
      const c = stack.pop()!;
      region.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy;
        if (inside(g, nx, ny) && g[ny][nx] === "." && seen[ny][nx] === "0") { seen[ny][nx] = "1"; stack.push({ x: nx, y: ny }); }
      }
    }
    if (region.length > best.length) best = region;
  }
  const out = makeGrid(cols, rows);
  for (const c of best) out[c.y][c.x] = ".";
  // a pool or two of water
  for (let p = 0; p < 2 && best.length; p++) {
    const c = best[Math.floor(rng() * best.length)];
    const r = 1 + Math.floor(rng() * 2);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (inside(out, c.x + dx, c.y + dy) && out[c.y + dy][c.x + dx] === "." && dx * dx + dy * dy <= r * r) out[c.y + dy][c.x + dx] = "~";
  }
  sprinkle(out, rng, "^", 0.03);
  return { cols, rows, theme: "cave", tiles: out.map((r) => r.join("")), rooms: [] };
}

export interface DesignRoom { label: string; name: string; x: number; y: number; w: number; h: number; shape: "rect" | "cave" }
export interface DesignLink { from: string; to: string; kind: "corridor" | "door" | "secret_door" | "locked_door" }

/** Turn an AI-written layout into tiles. Rooms are clamped to the grid so bad numbers can't break the map. */
export function mapFromDesign(cols: number, rows: number, seed: number, rooms: DesignRoom[], links: DesignLink[]): GeneratedMap {
  const rng = mulberry32(seed);
  const g = makeGrid(cols, rows);
  const clamped = rooms.map((r) => {
    const w = Math.max(3, Math.min(Math.round(r.w), cols - 2));
    const h = Math.max(3, Math.min(Math.round(r.h), rows - 2));
    const x = Math.max(1, Math.min(Math.round(r.x), cols - w - 1));
    const y = Math.max(1, Math.min(Math.round(r.y), rows - h - 1));
    return { ...r, x, y, w, h };
  });
  for (const r of clamped) (r.shape === "cave" ? carveBlob(g, r, rng) : carveRect(g, r));
  const byLabel = new Map(clamped.map((r) => [r.label, r]));
  const doorTile = { corridor: ".", door: "+", secret_door: "S", locked_door: "L" } as const;
  for (const l of links) {
    const a = byLabel.get(l.from), b = byLabel.get(l.to);
    if (a && b) carveCorridor(g, a, b, rng, doorTile[l.kind] ?? "+", clamped, l.kind !== "corridor");
  }
  // make sure every room is reachable even if the AI forgot a link
  const linked = new Set(links.flatMap((l) => [l.from, l.to]));
  for (const r of clamped) if (!linked.has(r.label) && clamped.length > 1) {
    const other = clamped.find((o) => o !== r)!;
    carveCorridor(g, r, other, rng, "+", clamped, true);
  }
  const caveCount = clamped.filter((r) => r.shape === "cave").length;
  return {
    cols, rows,
    theme: caveCount > clamped.length / 2 ? "cave" : "stone",
    tiles: g.map((r) => r.join("")),
    rooms: clamped.map(({ label, name, x, y, w, h }) => ({ label, name, x, y, w, h })),
  };
}
