// On-screen dice: every roll at the table tumbles across the screen and lands on the server's result.
import { useEffect, useRef } from "react";

export interface DieStyle { label: string; a: string; b: string; edge: string; text: string; alpha?: number; sparkle?: boolean }

export const DICE_STYLES: Record<string, DieStyle> = {
  ruby: { label: "Ruby", a: "#e0504a", b: "#7a1414", edge: "#3d0808", text: "#fff3d6" },
  obsidian: { label: "Obsidian", a: "#4a4a55", b: "#0d0d12", edge: "#000", text: "#e3b866" },
  bone: { label: "Bone", a: "#fbf3df", b: "#cdbb92", edge: "#7a6a48", text: "#3a2a14" },
  gold: { label: "Dragon gold", a: "#ffe29a", b: "#b07a1c", edge: "#5e3d06", text: "#3b2306" },
  emerald: { label: "Emerald", a: "#4fd18b", b: "#0d5c33", edge: "#04301a", text: "#f0fff4" },
  sapphire: { label: "Sapphire", a: "#5b9cf0", b: "#12357a", edge: "#071a40", text: "#f2f7ff" },
  amethyst: { label: "Amethyst", a: "#c48bf2", b: "#4b1a7a", edge: "#250a40", text: "#fff" },
  wood: { label: "Oak", a: "#c99a5e", b: "#6b4320", edge: "#3a220c", text: "#fff3dc" },
  ice: { label: "Frost (see-through)", a: "#e8f8ff", b: "#7cc4e8", edge: "#3d7fa3", text: "#0b3550", alpha: 0.75 },
  galaxy: { label: "Galaxy", a: "#5a3fb8", b: "#0b0630", edge: "#000", text: "#ffe9a8", sparkle: true },
};

const SIDES_TO_CORNERS: Record<number, number> = { 4: 3, 6: 4, 8: 4, 10: 4, 12: 5, 20: 6, 100: 4 };

/** Draw one die centered at (0,0). */
export function drawDie(ctx: CanvasRenderingContext2D, sides: number, face: number | string, size: number, style: DieStyle, opts: { dim?: boolean; glow?: string } = {}) {
  const corners = SIDES_TO_CORNERS[sides];
  const r = size / 2;
  ctx.save();
  ctx.globalAlpha = (style.alpha ?? 1) * (opts.dim ? 0.35 : 1);
  const pts: [number, number][] = [];
  if (corners) {
    for (let i = 0; i < corners; i++) {
      const a = (Math.PI * 2 * i) / corners - Math.PI / 2 + (corners === 4 && sides === 6 ? Math.PI / 4 : 0);
      const stretch = sides === 10 || sides === 100 ? (i % 2 ? 0.78 : 1.05) : 1;
      pts.push([Math.cos(a) * r * stretch, Math.sin(a) * r * (sides === 8 ? 1.12 : 1) * (sides === 10 || sides === 100 ? (i === 0 ? 1.1 : i === 2 ? 0.85 : 1) : 1)]);
    }
  }
  const path = () => {
    ctx.beginPath();
    if (!corners) ctx.arc(0, 0, r, 0, Math.PI * 2);
    else pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = size * 0.5; }
  else { ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = size * 0.18; ctx.shadowOffsetY = size * 0.08; }
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, style.a);
  g.addColorStop(1, style.b);
  path();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(1.5, size * 0.04);
  ctx.strokeStyle = style.edge;
  ctx.stroke();
  // facet lines give the shape some depth
  if (corners && corners >= 4) {
    ctx.globalAlpha *= 0.35;
    ctx.beginPath();
    const inner = sides === 20 ? 0.55 : sides === 12 ? 0.6 : 0.5;
    const ip = pts.map(([x, y]) => [x * inner, y * inner] as [number, number]);
    if (sides === 20) {
      [0, 2, 4].forEach((i, k) => { const p = ip[i]; k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      pts.forEach(([x, y], i) => { const p = ip[(Math.round(i / 2) * 2) % 6]; ctx.moveTo(x, y); ctx.lineTo(p[0], p[1]); });
    } else if (sides === 8 || sides === 10 || sides === 100) {
      ctx.moveTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[3][0], pts[3][1]);
    } else if (sides === 12) {
      ip.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      pts.forEach(([x, y], i) => { ctx.moveTo(x, y); ctx.lineTo(ip[i][0], ip[i][1]); });
    }
    ctx.strokeStyle = style.edge;
    ctx.stroke();
    ctx.globalAlpha = (style.alpha ?? 1) * (opts.dim ? 0.35 : 1);
  }
  if (style.sparkle) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 6; i++) {
      const sx = Math.sin(i * 12.9898 + sides) * r * 0.55, sy = Math.cos(i * 78.233 + sides) * r * 0.55;
      ctx.fillRect(sx, sy, size * 0.03, size * 0.03);
    }
  }
  // highlight
  ctx.globalAlpha *= 0.25;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(-r * 0.25, -r * 0.35, r * 0.35, r * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = (style.alpha ?? 1) * (opts.dim ? 0.35 : 1);
  // number
  const label = sides === 100 && typeof face === "number" ? `${face}` : String(face);
  ctx.fillStyle = style.text;
  ctx.font = `bold ${size * (label.length > 2 ? 0.28 : label.length > 1 ? 0.36 : 0.44)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, sides === 4 ? r * 0.18 : r * 0.04);
  if ((sides === 6 || sides === 9) && (face === 6 || face === 9)) ctx.fillRect(-size * 0.1, size * 0.2, size * 0.2, size * 0.03);
  ctx.restore();
}

// ---------------- settings ----------------
const get = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
export const diceSettings = {
  get animation() { return get("gnoll.dice.anim", "on") === "on"; },
  set animation(v: boolean) { set("gnoll.dice.anim", v ? "on" : "off"); },
  get sound() { return get("gnoll.dice.sound", "on") === "on"; },
  set sound(v: boolean) { set("gnoll.dice.sound", v ? "on" : "off"); },
};

// ---------------- sound: short filtered noise "clacks" ----------------
let audio: AudioContext | null = null;
let lastClack = 0;
function clack(strength: number) {
  if (!diceSettings.sound) return;
  const now = performance.now();
  if (now - lastClack < 35) return;
  lastClack = now;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const len = Math.floor(audio.sampleRate * 0.05);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = audio.createBufferSource();
    src.buffer = buf;
    const bp = audio.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800 + Math.random() * 2200;
    bp.Q.value = 4;
    const gain = audio.createGain();
    gain.gain.value = Math.min(0.6, 0.12 + strength * 0.5);
    src.connect(bp).connect(gain).connect(audio.destination);
    src.start();
  } catch { /* no audio available */ }
}

// ---------------- animation ----------------
interface DieState { sides: number; value: number; kept: boolean; x: number; y: number; vx: number; vy: number; a: number; va: number; size: number; face: number; nextFace: number; settled: boolean }
interface Group { dice: DieState[]; style: DieStyle; start: number; settledAt: number | null; banner: string; total: string; crit?: string; who: string }

export interface RollEvent { name: string; body: { dice?: { sides: number; value: number; kept: boolean }[]; total: number | string; label?: string; expression: string; crit?: string; style?: string } }

export function announceRoll(e: RollEvent) {
  window.dispatchEvent(new CustomEvent<RollEvent>("gnoll-roll", { detail: e }));
}

export function DiceTray() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const groups = useRef<Group[]>([]);
  const raf = useRef(0);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const resize = () => { const dpr = window.devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    window.addEventListener("resize", resize);
    // browsers only allow sound after the user has clicked something
    const unlock = () => { try { audio ??= new AudioContext(); void audio.resume(); } catch { /* ignore */ } };
    window.addEventListener("pointerdown", unlock, { once: true });

    const onRoll = (ev: Event) => {
      const { name, body } = (ev as CustomEvent<RollEvent>).detail;
      if (!body.dice?.length || !diceSettings.animation) return;
      const W = innerWidth, H = innerHeight;
      const n = body.dice.length;
      const size = n > 12 ? 44 : n > 6 ? 54 : 66;
      const fromLeft = Math.random() < 0.5;
      const now = performance.now();
      const dice = body.dice.map((d, i): DieState => ({
        ...d,
        x: fromLeft ? -40 - i * 18 : W + 40 + i * 18,
        y: H * (0.45 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (900 + Math.random() * 600),
        vy: -(200 + Math.random() * 500),
        a: Math.random() * 6,
        va: (Math.random() - 0.5) * 30,
        size,
        face: 1 + Math.floor(Math.random() * d.sides),
        nextFace: now,
        settled: false,
      }));
      if (reduceMotion) dice.forEach((d, i) => { d.x = W / 2 + (i - (n - 1) / 2) * (size + 8); d.y = H / 2; d.vx = d.vy = d.va = 0; d.a = 0; d.settled = true; d.face = d.value; });
      groups.current.push({
        dice, style: DICE_STYLES[body.style ?? "ruby"] ?? DICE_STYLES.ruby, start: now, settledAt: reduceMotion ? now : null,
        banner: body.label || body.expression, total: String(body.total), crit: body.crit, who: name,
      });
      if (!raf.current) raf.current = requestAnimationFrame(tick);
    };
    window.addEventListener("gnoll-roll", onRoll);

    let last = performance.now();
    function tick(t: number) {
      const dt = Math.min(0.033, (t - last) / 1000);
      last = t;
      const W = innerWidth, H = innerHeight;
      const left = 40, right = W - 40, top = H * 0.25, bottom = H - 60;
      ctx.clearRect(0, 0, W, H);
      groups.current = groups.current.filter((g) => !g.settledAt || t - g.settledAt < 2600);
      for (const g of groups.current) {
        const age = (t - g.start) / 1000;
        for (const d of g.dice) {
          if (d.settled) continue;
          d.vy += 1400 * dt; // gravity toward the "table"
          d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.va * dt;
          const half = d.size / 2;
          if (d.y > bottom - half) { d.y = bottom - half; if (Math.abs(d.vy) > 120) clack(Math.abs(d.vy) / 1500); d.vy *= -0.45; d.vx *= 0.8; d.va *= 0.7; }
          if (d.y < top + half && d.vy < 0) { d.vy *= -0.5; }
          if (age > 0.25) {
            if (d.x < left + half) { d.x = left + half; d.vx = Math.abs(d.vx) * 0.6; clack(Math.abs(d.vx) / 1500); }
            if (d.x > right - half) { d.x = right - half; d.vx = -Math.abs(d.vx) * 0.6; clack(Math.abs(d.vx) / 1500); }
          }
          d.vx *= Math.pow(0.35, dt); d.va *= Math.pow(0.3, dt);
          if (t > d.nextFace) { d.face = 1 + Math.floor(Math.random() * d.sides); d.nextFace = t + 60 + age * 90; }
          const speed = Math.hypot(d.vx, d.vy);
          if ((age > 1.1 && speed < 90 && d.y >= bottom - half - 2) || age > 2.4) { d.settled = true; d.face = d.value; d.vx = d.vy = d.va = 0; }
        }
        // keep dice from overlapping
        for (let i = 0; i < g.dice.length; i++) for (let j = i + 1; j < g.dice.length; j++) {
          const p = g.dice[i], q = g.dice[j];
          const dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy) || 1, min = (p.size + q.size) / 2;
          if (dist < min) {
            const push = (min - dist) / 2, nx = dx / dist, ny = dy / dist;
            p.x -= nx * push; p.y -= ny * push; q.x += nx * push; q.y += ny * push;
            if (!p.settled && !q.settled && Math.hypot(p.vx - q.vx, p.vy - q.vy) > 200) clack(0.3);
          }
        }
        if (!g.settledAt && g.dice.every((d) => d.settled)) g.settledAt = t;
        const fade = g.settledAt ? Math.max(0, 1 - Math.max(0, t - g.settledAt - 2000) / 600) : 1;
        ctx.globalAlpha = fade;
        for (const d of g.dice) {
          ctx.save();
          ctx.translate(d.x, d.y);
          // settle upright so the number is readable
          ctx.rotate(d.settled ? 0 : d.a);
          const glow = d.settled && d.kept && d.sides === 20 ? (d.value === 20 ? "#8fe07a" : d.value === 1 ? "#ff5a3c" : undefined) : undefined;
          drawDie(ctx, d.sides, d.face, d.size, g.style, { dim: d.settled && !d.kept, glow });
          ctx.restore();
        }
        if (g.settledAt) {
          const cx = g.dice.reduce((s, d) => s + d.x, 0) / g.dice.length;
          const cy = Math.min(...g.dice.map((d) => d.y)) - g.dice[0].size;
          const text = `${g.who}: ${g.banner}`;
          ctx.font = "bold 16px Georgia, serif";
          const tw = Math.max(ctx.measureText(text).width, 60);
          ctx.font = "bold 34px Georgia, serif";
          const bw = Math.max(tw, ctx.measureText(g.total).width) + 36;
          const bx = Math.max(10, Math.min(W - bw - 10, cx - bw / 2));
          ctx.fillStyle = "rgba(17,14,11,0.92)";
          ctx.strokeStyle = g.crit === "success" ? "#8fe07a" : g.crit === "fail" ? "#ff5a3c" : "#e3b866";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(bx, cy - 64, bw, 70, 10);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#b3a48a"; ctx.font = "bold 16px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
          ctx.fillText(text, bx + bw / 2, cy - 42);
          ctx.fillStyle = g.crit === "success" ? "#8fe07a" : g.crit === "fail" ? "#ff7a63" : "#efe4cf";
          ctx.font = "bold 34px Georgia, serif";
          ctx.fillText(g.total, bx + bw / 2, cy - 6);
        }
        ctx.globalAlpha = 1;
      }
      raf.current = groups.current.length ? requestAnimationFrame(tick) : 0;
      if (!groups.current.length) ctx.clearRect(0, 0, W, H);
    }

    return () => {
      window.removeEventListener("gnoll-roll", onRoll);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  return <canvas ref={canvas} style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 120 }} />;
}

/** Small picture of a die in a given style (for the dice picker). */
export function DiePreview({ style, sides = 20, face = 20, size = 56 }: { style: string; sides?: number; face?: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = (size + 16) * dpr; cv.height = (size + 16) * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size + 16, size + 16);
    ctx.translate((size + 16) / 2, (size + 16) / 2);
    drawDie(ctx, sides, face, size, DICE_STYLES[style] ?? DICE_STYLES.ruby);
  }, [style, sides, face, size]);
  return <canvas ref={ref} style={{ width: size + 16, height: size + 16 }} />;
}
