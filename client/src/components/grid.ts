// Grid math (square and pointy-top hex) and drawing generated maps.
import type { MapState } from "../socket";

export const SQRT3 = Math.sqrt(3);

/** For hex grids, gridSize is the hex's width (flat side to flat side). */
export function hexRadius(gridSize: number) {
  return gridSize / SQRT3;
}

function hexRound(q: number, r: number) {
  let x = Math.round(q), z = Math.round(r), y = Math.round(-q - r);
  const dx = Math.abs(x - q), dz = Math.abs(z - r), dy = Math.abs(y + q + r);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dy <= dz) z = -x - y;
  return { q: x, r: z };
}

function toHex(m: MapState, x: number, y: number) {
  const R = hexRadius(m.gridSize);
  const px = x - m.gridOffsetX, py = y - m.gridOffsetY;
  return hexRound(((SQRT3 / 3) * px - (1 / 3) * py) / R, ((2 / 3) * py) / R);
}
function hexCenter(m: MapState, q: number, r: number) {
  const R = hexRadius(m.gridSize);
  return { x: m.gridOffsetX + R * SQRT3 * (q + r / 2), y: m.gridOffsetY + R * 1.5 * r };
}

/** Snap a point to the center of its grid cell. Large tokens (size 2, 4) snap to grid corners. */
export function snap(m: MapState, x: number, y: number, size = 1) {
  if (m.gridType === "none") return { x, y };
  if (m.gridType === "hex") {
    const h = toHex(m, x, y);
    return hexCenter(m, h.q, h.r);
  }
  const g = m.gridSize;
  const even = Math.round(size) % 2 === 0;
  const fx = (v: number, off: number) => (even ? Math.round((v - off) / g) * g + off : Math.floor((v - off) / g) * g + off + g / 2);
  return { x: fx(x, m.gridOffsetX), y: fx(y, m.gridOffsetY) };
}

/** Distance in feet between two points, using 5e's "every square counts as 5 feet" rule. */
export function distanceFeet(m: MapState, a: { x: number; y: number }, b: { x: number; y: number }) {
  if (m.gridType === "hex") {
    const h1 = toHex(m, a.x, a.y), h2 = toHex(m, b.x, b.y);
    const dq = h1.q - h2.q, dr = h1.r - h2.r;
    return ((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2) * m.feetPerCell;
  }
  const g = m.gridSize || 70;
  const cells = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / g;
  return Math.round(cells) * m.feetPerCell;
}

export function drawGrid(ctx: CanvasRenderingContext2D, m: MapState, scale: number) {
  if (m.gridType === "none") return;
  ctx.beginPath();
  ctx.lineWidth = 1 / scale;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  if (m.gridType === "square") {
    const g = m.gridSize;
    for (let x = m.gridOffsetX % g; x <= m.width; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, m.height); }
    for (let y = m.gridOffsetY % g; y <= m.height; y += g) { ctx.moveTo(0, y); ctx.lineTo(m.width, y); }
  } else {
    const R = hexRadius(m.gridSize);
    const w = R * SQRT3;
    const rows = Math.ceil(m.height / (R * 1.5)) + 2;
    const cols = Math.ceil(m.width / w) + 2;
    for (let r = -1; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        const cx = m.gridOffsetX % w + c * w + (r % 2 ? w / 2 : 0);
        const cy = m.gridOffsetY % (R * 3) + r * R * 1.5;
        for (let i = 0; i < 6; i++) {
          const a1 = (Math.PI / 3) * i - Math.PI / 6, a2 = (Math.PI / 3) * (i + 1) - Math.PI / 6;
          // draw only 3 edges per hex to avoid drawing every line twice
          if (i > 2) continue;
          ctx.moveTo(cx + R * Math.cos(a1), cy + R * Math.sin(a1));
          ctx.lineTo(cx + R * Math.cos(a2), cy + R * Math.sin(a2));
        }
      }
    }
  }
  ctx.stroke();
}

const THEMES = {
  stone: { rock: "#2a2622", floor: "#bfb39b", floor2: "#b3a68c", wall: "#4d4136" },
  crypt: { rock: "#1d1b22", floor: "#9c98a3", floor2: "#8f8a97", wall: "#3c3547" },
  cave: { rock: "#251e17", floor: "#8c7556", floor2: "#806a4c", wall: "#4a3826" },
  forest: { rock: "#1f3320", floor: "#7d9a5a", floor2: "#728f50", wall: "#2e4a2a" },
};

/** Paint a generated tile map onto a canvas. Secret doors ('S') only show for the DM. */
export function renderGenerated(gen: { cols: number; rows: number; tiles: string[]; rooms: any[]; theme: keyof typeof THEMES }, cell: number, showLabels: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = gen.cols * cell;
  canvas.height = gen.rows * cell;
  const ctx = canvas.getContext("2d")!;
  const t = THEMES[gen.theme] ?? THEMES.stone;
  ctx.fillStyle = t.rock;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const at = (x: number, y: number) => gen.tiles[y]?.[x] ?? " ";
  const open = (ch: string) => ch !== " ";
  for (let y = 0; y < gen.rows; y++) {
    for (let x = 0; x < gen.cols; x++) {
      const ch = at(x, y);
      if (!open(ch)) continue;
      ctx.fillStyle = (x + y) % 2 ? t.floor : t.floor2;
      ctx.fillRect(x * cell, y * cell, cell, cell);
      if (ch === "~") { ctx.fillStyle = "#3f6f8f"; ctx.fillRect(x * cell, y * cell, cell, cell); }
      if (ch === "^") {
        ctx.fillStyle = "rgba(60,45,30,0.55)";
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x * cell + cell * (0.25 + 0.5 * (i % 2)), y * cell + cell * (0.25 + 0.5 * Math.floor(i / 2)), cell * 0.12, 0, 7); ctx.fill(); }
      }
    }
  }
  // walls: thick line wherever open floor meets rock
  ctx.strokeStyle = t.wall;
  ctx.lineWidth = Math.max(3, cell * 0.12);
  ctx.lineCap = "square";
  ctx.beginPath();
  for (let y = 0; y < gen.rows; y++) for (let x = 0; x < gen.cols; x++) {
    if (!open(at(x, y))) continue;
    if (!open(at(x, y - 1))) { ctx.moveTo(x * cell, y * cell); ctx.lineTo((x + 1) * cell, y * cell); }
    if (!open(at(x, y + 1))) { ctx.moveTo(x * cell, (y + 1) * cell); ctx.lineTo((x + 1) * cell, (y + 1) * cell); }
    if (!open(at(x - 1, y))) { ctx.moveTo(x * cell, y * cell); ctx.lineTo(x * cell, (y + 1) * cell); }
    if (!open(at(x + 1, y))) { ctx.moveTo((x + 1) * cell, y * cell); ctx.lineTo((x + 1) * cell, (y + 1) * cell); }
  }
  ctx.stroke();
  // doors
  for (let y = 0; y < gen.rows; y++) for (let x = 0; x < gen.cols; x++) {
    const ch = at(x, y);
    if (ch !== "+" && ch !== "S" && ch !== "L") continue;
    const horiz = open(at(x - 1, y)) && open(at(x + 1, y));
    ctx.fillStyle = ch === "S" ? "rgba(150,80,200,0.8)" : "#7a4a24";
    const cx = x * cell + cell / 2, cy = y * cell + cell / 2;
    const w = horiz ? cell * 0.25 : cell * 0.8, h = horiz ? cell * 0.8 : cell * 0.25;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = "#2b1a0c"; ctx.lineWidth = 2; ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    if (ch === "L") { ctx.fillStyle = "#e3b866"; ctx.beginPath(); ctx.arc(cx, cy, cell * 0.1, 0, 7); ctx.fill(); }
    if (ch === "S") { ctx.fillStyle = "#fff"; ctx.font = `bold ${cell * 0.35}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("S", cx, cy); }
  }
  if (showLabels) {
    ctx.font = `bold ${cell * 0.6}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const r of gen.rooms) {
      ctx.fillStyle = "rgba(122,31,18,0.85)";
      ctx.fillText(r.label, (r.x + r.w / 2) * cell, (r.y + r.h / 2) * cell);
    }
  }
  return canvas;
}
