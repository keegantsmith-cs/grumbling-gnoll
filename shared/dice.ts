// Dice expression parser and roller.
// Supports: 1d20+5, 2d6+1d4+3, 4d6kh3 / 4d6dl1 (keep/drop), 2d20kh1 (advantage),
// 2d20kl1 (disadvantage), "adv"/"dis" shorthand for d20 rolls, d% (percentile).

export interface DieGroup {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  rolls: number[];
  kept: boolean[];
  subtotal: number;
  label: string;
}
export interface Modifier {
  kind: "mod";
  sign: 1 | -1;
  value: number;
}
export interface RollResult {
  expression: string;
  parts: (DieGroup | Modifier)[];
  total: number;
  crit?: "success" | "fail";
}

const MAX_DICE = 200;
const MAX_SIDES = 1000;

export function normalize(expr: string): string {
  let e = expr.trim().toLowerCase().replace(/\s+/g, "");
  // "adv" / "dis" shorthand: "adv+5" -> "2d20kh1+5"
  e = e.replace(/^adv/, "2d20kh1").replace(/^dis/, "2d20kl1");
  e = e.replace(/d%/g, "d100");
  return e;
}

export function rollDice(expr: string, rng: () => number = Math.random): RollResult {
  const e = normalize(expr);
  if (!e) throw new Error("Empty dice expression");
  // "1d20 5" must not silently become "1d205"
  if (/\d\s+\d/.test(expr)) throw new Error(`Missing + or - in "${expr}"`);
  const tokenRe = /([+-]?)(?:(\d*)d(\d+)(?:(kh|kl|dh|dl|k|d)(\d+))?|(\d+))/gy;
  const parts: (DieGroup | Modifier)[] = [];
  let pos = 0;
  let totalDice = 0;
  while (pos < e.length) {
    tokenRe.lastIndex = pos;
    const m = tokenRe.exec(e);
    if (!m || m.index !== pos || m[0] === "") throw new Error(`Can't read dice expression "${expr}"`);
    if (pos > 0 && !m[1]) throw new Error(`Missing + or - in "${expr}"`);
    pos = tokenRe.lastIndex;
    const sign: 1 | -1 = m[1] === "-" ? -1 : 1;
    if (m[6] !== undefined) {
      parts.push({ kind: "mod", sign, value: parseInt(m[6], 10) });
      continue;
    }
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const sides = parseInt(m[3], 10);
    if (count < 1 || sides < 1) throw new Error("Dice need at least 1 die with at least 1 side");
    totalDice += count;
    if (totalDice > MAX_DICE || sides > MAX_SIDES) throw new Error("That's too many dice");
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
    let kept = rolls.map(() => true);
    const op = m[4];
    if (op) {
      const n = Math.min(parseInt(m[5], 10), count);
      const order = rolls.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      // indices sorted ascending by value
      let keepIdx: number[];
      if (op === "kh" || op === "k") keepIdx = order.slice(count - n).map((o) => o.i);
      else if (op === "kl") keepIdx = order.slice(0, n).map((o) => o.i);
      else if (op === "dl" || op === "d") keepIdx = order.slice(n).map((o) => o.i);
      else keepIdx = order.slice(0, count - n).map((o) => o.i); // dh
      const set = new Set(keepIdx);
      kept = rolls.map((_, i) => set.has(i));
    }
    const subtotal = rolls.reduce((s, v, i) => s + (kept[i] ? v : 0), 0);
    parts.push({ kind: "dice", sign, count, sides, rolls, kept, subtotal, label: m[0].replace(/^[+-]/, "") });
  }
  const total = parts.reduce((s, p) => s + p.sign * (p.kind === "dice" ? p.subtotal : p.value), 0);
  const result: RollResult = { expression: e, parts, total };
  const d20s = parts.filter((p): p is DieGroup => p.kind === "dice" && p.sides === 20);
  if (d20s.length === 1) {
    const keptVals = d20s[0].rolls.filter((_, i) => d20s[0].kept[i]);
    if (keptVals.length === 1 && keptVals[0] === 20) result.crit = "success";
    if (keptVals.length === 1 && keptVals[0] === 1) result.crit = "fail";
  }
  return result;
}

export function describeRoll(r: RollResult): string {
  return r.parts
    .map((p, i) => {
      const s = p.sign === -1 ? "- " : i > 0 ? "+ " : "";
      if (p.kind === "mod") return `${s}${p.value}`;
      const dice = p.rolls.map((v, j) => (p.kept[j] ? `${v}` : `~~${v}~~`)).join(", ");
      return `${s}${p.label} [${dice}]`;
    })
    .join(" ");
}

export interface RolledDie { sides: number; value: number; kept: boolean }

/** Every individual die in a roll, for the on-screen dice animation (capped so huge rolls stay readable). */
export function diceList(r: RollResult, max = 30): RolledDie[] {
  const out: RolledDie[] = [];
  for (const p of r.parts) if (p.kind === "dice") p.rolls.forEach((v, i) => out.push({ sides: p.sides, value: v, kept: p.kept[i] }));
  return out.slice(0, max);
}
