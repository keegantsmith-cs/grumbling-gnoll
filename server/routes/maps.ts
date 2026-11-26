import { Router } from "express";
import { all, one, run } from "../db.ts";
import { requireUser } from "../auth.ts";
import { campaignAccess, campaignAccessById, campaignContext, HttpError, imageUpload, num } from "../helpers.ts";
import { broadcastMap } from "../realtime.ts";
import { designMap } from "../ai.ts";
import { generateCave, generateDungeon, mapFromDesign, type GeneratedMap } from "../../shared/mapgen.ts";

export const mapRoutes = Router();
mapRoutes.use(requireUser);

const CELL = 70; // pixels per square for generated maps

const listOut = (m: any) => ({
  id: m.id,
  name: m.name,
  imageUrl: m.image_url,
  generated: !!m.generated,
  width: m.width,
  height: m.height,
  gridType: m.grid_type,
  gridSize: m.grid_size,
  gridOffsetX: m.grid_offset_x,
  gridOffsetY: m.grid_offset_y,
  feetPerCell: m.feet_per_cell,
  fogEnabled: !!m.fog_enabled,
  createdAt: m.created_at,
});

mapRoutes.get("/campaigns/:id/maps", (req, res) => {
  const { id } = campaignAccess(req, true);
  res.json(all("SELECT * FROM maps WHERE campaign_id = ? ORDER BY created_at DESC", id).map(listOut));
});

const gridType = (v: unknown) => (v === "hex" ? "hex" : v === "none" ? "none" : "square");

mapRoutes.post("/campaigns/:id/maps", imageUpload.single("image"), (req, res) => {
  const { id } = campaignAccess(req, true);
  if (!req.file) throw new HttpError(400, "Please choose a PNG, JPG, or WebP map image");
  const width = Math.round(num(req.body.width));
  const height = Math.round(num(req.body.height));
  const r = run(
    "INSERT INTO maps (campaign_id, name, image_url, width, height, grid_type, grid_size) VALUES (?,?,?,?,?,?,?)",
    id,
    String(req.body.name || req.file.originalname).slice(0, 80),
    `/uploads/${req.file.filename}`,
    width,
    height,
    gridType(req.body.gridType),
    Math.min(400, Math.max(10, Number(req.body.gridSize) || 70)),
  );
  res.json({ id: Number(r.lastInsertRowid) });
});

function insertGenerated(campaignId: number, name: string, g: GeneratedMap, grid: string, dmKey = "") {
  const r = run(
    "INSERT INTO maps (campaign_id, name, generated, width, height, grid_type, grid_size, dm_key) VALUES (?,?,?,?,?,?,?,?)",
    campaignId,
    name.slice(0, 80),
    JSON.stringify(g),
    g.cols * CELL,
    g.rows * CELL,
    grid,
    CELL,
    dmKey,
  );
  return Number(r.lastInsertRowid);
}

const clampSize = (v: unknown, def: number) => Math.min(80, Math.max(12, Math.round(Number(v) || def)));

mapRoutes.post("/campaigns/:id/maps/generate", (req, res) => {
  const { id } = campaignAccess(req, true);
  const b = req.body ?? {};
  const cols = clampSize(b.cols, 40), rows = clampSize(b.rows, 30);
  const seed = Number(b.seed) || Math.floor(Math.random() * 1e9);
  const theme = ["stone", "crypt", "forest"].includes(b.theme) ? b.theme : "stone";
  const g = b.kind === "cave" ? generateCave(cols, rows, seed) : generateDungeon(cols, rows, seed, Math.min(20, Math.max(2, Number(b.rooms) || 8)), theme);
  const mapId = insertGenerated(id, String(b.name || (b.kind === "cave" ? "Cavern" : "Dungeon")), g, gridType(b.gridType));
  res.json({ id: mapId });
});

mapRoutes.post("/campaigns/:id/maps/ai-design", async (req, res) => {
  const { id } = campaignAccess(req, true);
  const b = req.body ?? {};
  const description = String(b.description ?? "").trim();
  if (!description) throw new HttpError(400, "Describe the place you want a map of");
  const cols = clampSize(b.cols, 40), rows = clampSize(b.rows, 30);
  const design = await designMap(campaignContext(id), req.user!.id, description.slice(0, 3000), cols, rows);
  const g = mapFromDesign(cols, rows, Math.floor(Math.random() * 1e9), design.rooms, design.connections);
  const key = [
    `# ${design.name}`,
    design.overview,
    ...design.rooms.map((r) => `## ${r.label}. ${r.name}\n> ${r.read_aloud.replace(/\n/g, "\n> ")}\n\n${r.dm_notes}`),
  ].join("\n\n");
  const mapId = insertGenerated(id, design.name, g, gridType(b.gridType), key);
  res.json({ id: mapId });
});

mapRoutes.patch("/maps/:mapId", (req, res) => {
  const m = one("SELECT * FROM maps WHERE id = ?", num(req.params.mapId));
  if (!m) throw new HttpError(404, "Map not found");
  campaignAccessById(m.campaign_id, req.user!.id, true);
  const b = req.body ?? {};
  const set: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 80);
  if (b.gridType !== undefined) set.grid_type = gridType(b.gridType);
  if (b.gridSize !== undefined) set.grid_size = Math.min(400, Math.max(10, Number(b.gridSize) || 70));
  if (b.gridOffsetX !== undefined) set.grid_offset_x = Number(b.gridOffsetX) || 0;
  if (b.gridOffsetY !== undefined) set.grid_offset_y = Number(b.gridOffsetY) || 0;
  if (b.feetPerCell !== undefined) set.feet_per_cell = Math.max(1, Number(b.feetPerCell) || 5);
  if (b.fogEnabled !== undefined) set.fog_enabled = b.fogEnabled ? 1 : 0;
  if (typeof b.dmKey === "string") set.dm_key = b.dmKey.slice(0, 100000);
  const keys = Object.keys(set);
  if (keys.length) run(`UPDATE maps SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => set[k]), m.id);
  broadcastMap(m.campaign_id);
  res.json({ ok: true });
});

mapRoutes.delete("/maps/:mapId", (req, res) => {
  const m = one("SELECT * FROM maps WHERE id = ?", num(req.params.mapId));
  if (!m) throw new HttpError(404, "Map not found");
  campaignAccessById(m.campaign_id, req.user!.id, true);
  run("UPDATE campaigns SET active_map_id = NULL WHERE active_map_id = ?", m.id);
  run("DELETE FROM maps WHERE id = ?", m.id);
  broadcastMap(m.campaign_id);
  res.json({ ok: true });
});
