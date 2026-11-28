// Free 5e SRD 5.1 lookup (spells, equipment, magic items, monsters). See srd/NOTICE.md for the license.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "../auth.ts";
import { HttpError } from "../helpers.ts";

type Entry = { name: string; [k: string]: unknown };
let data: { license: string; spells: Entry[]; equipment: Entry[]; magicItems: Entry[]; monsters: Entry[] } | null = null;
function srd() {
  data ??= JSON.parse(fs.readFileSync(path.resolve("srd/srd-5.1.json"), "utf8"));
  return data!;
}
const TYPES = { spell: "spells", equipment: "equipment", magic: "magicItems", monster: "monsters" } as const;
type T = keyof typeof TYPES;

/** A monster's SRD stat block by exact name (used when placing saved encounters). */
export function srdMonster(name: string) {
  return srd().monsters.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** An SRD spell by name, ignoring case and a trailing "(ritual)". */
export function srdSpell(name: string) {
  const n = name.toLowerCase().replace(/\s*\(.*?\)\s*$/, "").trim();
  return srd().spells.find((s) => s.name.toLowerCase() === n) ?? null;
}

export const srdRoutes = Router();
srdRoutes.use(requireUser);

srdRoutes.get("/srd/license", (_req, res) => res.json({ license: srd().license }));

// /api/srd/search?type=spell&q=fire&limit=10  (type may be comma-separated)
srdRoutes.get("/srd/search", (req, res) => {
  const types = String(req.query.type ?? "spell").split(",").filter((t): t is T => t in TYPES);
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const limit = Math.min(50, Number(req.query.limit) || 12);
  const filter = String(req.query.filter ?? ""); // e.g. "weapon" or "armor" for equipment
  const out: (Entry & { type: T })[] = [];
  for (const t of types) {
    for (const e of srd()[TYPES[t]]) {
      if (filter && t === "equipment" && String(e.category).toLowerCase() !== filter) continue;
      if (!q || e.name.toLowerCase().includes(q)) out.push({ ...e, type: t });
    }
  }
  // names that start with the search first
  out.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
  res.json(out.slice(0, limit));
});

srdRoutes.get("/srd/:type/:name", (req, res) => {
  const t = req.params.type as T;
  if (!(t in TYPES)) throw new HttpError(404, "Unknown type");
  const name = decodeURIComponent(req.params.name).toLowerCase();
  const list = srd()[TYPES[t]];
  let e = list.find((x) => x.name.toLowerCase() === name);
  // Close matches: "Onyx Dog (figurine)" finds "Onyx Dog Figurine of Wondrous Power"
  if (!e) {
    const words = name.replace(/['’]/g, "").replace(/[^a-z0-9+ ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["of", "the", "a", "an"].includes(w));
    const hits = words.length ? list.filter((x) => { const n = x.name.toLowerCase().replace(/['’]/g, ""); return words.every((w) => n.includes(w)); }) : [];
    e = hits.sort((a, b) => a.name.length - b.name.length)[0];
  }
  if (!e) throw new HttpError(404, "Not in the SRD");
  res.json({ ...e, type: t });
});
