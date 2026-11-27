// Encounter difficulty math for 5e: 2014 DMG (thresholds + multiplier) and 2024 DMG (XP budget).
import type { RulesVersion } from "./character.ts";

export const XP_BY_CR: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900,
  "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000, "17": 18000, "18": 20000,
  "19": 22000, "20": 25000, "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000,
  "29": 135000, "30": 155000,
};

export function normalizeCr(cr: string | number): string {
  const s = String(cr ?? "").trim();
  if (s === "0.125") return "1/8";
  if (s === "0.25") return "1/4";
  if (s === "0.5") return "1/2";
  return s.replace(/\s*\(.*$/, "");
}
export const xpForCr = (cr: string | number) => XP_BY_CR[normalizeCr(cr)] ?? 0;

// 2014: per-character thresholds [easy, medium, hard, deadly]
const T2014: number[][] = [
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];
// 2024: per-character budgets [low, moderate, high]
const B2024: number[][] = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400], [750, 1300, 1700],
  [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100], [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400],
  [2900, 4900, 6200], [3300, 5400, 7800], [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
];
const MULT_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

function multiplier2014(monsterCount: number, partySize: number) {
  let i = monsterCount <= 1 ? 1 : monsterCount === 2 ? 2 : monsterCount <= 6 ? 3 : monsterCount <= 10 ? 4 : monsterCount <= 14 ? 5 : 6;
  if (partySize < 3) i += 1;
  else if (partySize >= 6) i -= 1;
  return MULT_STEPS[Math.max(0, Math.min(MULT_STEPS.length - 1, i))];
}

export interface EncounterResult {
  rules: RulesVersion;
  totalXp: number;
  adjustedXp: number; // 2014 only (same as total in 2024)
  multiplier: number;
  levels: { label: string; xp: number }[]; // thresholds or budgets for the whole party
  difficulty: string;
  xpPerCharacter: number;
}

export function evaluateEncounter(rules: RulesVersion, partyLevels: number[], monsters: { cr: string | number; count: number }[]): EncounterResult {
  const levels = partyLevels.map((l) => Math.max(1, Math.min(20, Math.round(l) || 1)));
  const count = monsters.reduce((s, m) => s + Math.max(0, m.count), 0);
  const totalXp = monsters.reduce((s, m) => s + xpForCr(m.cr) * Math.max(0, m.count), 0);
  const xpPerCharacter = levels.length ? Math.floor(totalXp / levels.length) : 0;
  if (rules === "2024") {
    const sums = [0, 1, 2].map((i) => levels.reduce((s, l) => s + B2024[l - 1][i], 0));
    // The budget is a ceiling: spending up to the Low budget makes a Low encounter, and so on
    const difficulty = !count ? "No monsters yet" : totalXp > sums[2] * 1.5 ? "Beyond High: very dangerous" : totalXp > sums[2] ? "Above High"
      : totalXp > sums[1] ? "High" : totalXp > sums[0] ? "Moderate" : totalXp >= sums[0] * 0.5 ? "Low" : "Trivial";
    return { rules, totalXp, adjustedXp: totalXp, multiplier: 1, xpPerCharacter, difficulty, levels: [{ label: "Low", xp: sums[0] }, { label: "Moderate", xp: sums[1] }, { label: "High", xp: sums[2] }] };
  }
  const sums = [0, 1, 2, 3].map((i) => levels.reduce((s, l) => s + T2014[l - 1][i], 0));
  const multiplier = count ? multiplier2014(count, levels.length) : 1;
  const adjustedXp = Math.round(totalXp * multiplier);
  const difficulty = !count ? "No monsters yet" : adjustedXp >= sums[3] ? "Deadly" : adjustedXp >= sums[2] ? "Hard" : adjustedXp >= sums[1] ? "Medium" : adjustedXp >= sums[0] ? "Easy" : "Trivial";
  return { rules, totalXp, adjustedXp, multiplier, xpPerCharacter, difficulty, levels: [{ label: "Easy", xp: sums[0] }, { label: "Medium", xp: sums[1] }, { label: "Hard", xp: sums[2] }, { label: "Deadly", xp: sums[3] }] };
}
