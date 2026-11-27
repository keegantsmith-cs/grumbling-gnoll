import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { all, one, parseJSON } from "./db.ts";
import { UPLOAD_DIR } from "./db.ts";
import { campaignRole } from "./auth.ts";
import type { CampaignContext } from "./ai.ts";
import { classSummary, derive, normalizeCharacter, type RulesVersion } from "../shared/character.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, "Expected a number");
  return n;
};

/** Load the campaign named by :id (or :campaignId) and check the user belongs to it. */
export function campaignAccess(req: Request, needDM = false) {
  return campaignAccessById(num(req.params.campaignId ?? req.params.id), req.user!.id, needDM);
}

export function campaignAccessById(id: number, userId: number, needDM = false) {
  const role = campaignRole(id, userId);
  if (!role) throw new HttpError(404, "Campaign not found");
  if (needDM && role !== "dm") throw new HttpError(403, "Only the DM can do that");
  const campaign = one("SELECT * FROM campaigns WHERE id = ?", id)!;
  return { id, role, campaign, isDM: role === "dm" };
}

export function campaignContext(campaignId: number): CampaignContext {
  const c = one("SELECT * FROM campaigns WHERE id = ?", campaignId)!;
  const chars = all(
    `SELECT c.id, c.data, u.display_name, n.notes AS dm_notes FROM characters c JOIN users u ON u.id = c.owner_id
     LEFT JOIN character_dm_notes n ON n.character_id = c.id WHERE c.campaign_id = ? AND c.status = 'approved'`,
    campaignId,
  );
  const party = chars
    .map((row) => {
      const d = normalizeCharacter(parseJSON(row.data, {}), c.rules_version as RulesVersion);
      const dv = derive(d);
      const secret = row.dm_notes?.trim() ? `\n  DM's secret notes about ${d.name} (never reveal these to players directly): ${row.dm_notes.trim().slice(0, 2000)}` : "";
      const story = d.backstory?.trim() ? `\n  Backstory: ${d.backstory.trim().slice(0, 600)}` : "";
      const sugg = all("SELECT author_kind, text FROM character_suggestions WHERE character_id = ? AND resolved = 0 ORDER BY id DESC LIMIT 3", row.id)
        .map((s) => `${s.author_kind}: ${String(s.text).replace(/\s+/g, " ").slice(0, 250)}`).join(" | ");
      const suggLine = sugg ? `\n  Open suggestions shared with ${row.display_name}: ${sugg}` : "";
      return `- ${d.name} (played by ${row.display_name}): level ${dv.level} ${d.species} ${classSummary(d)}; AC ${dv.ac}, HP ${dv.maxHp}${story}${secret}${suggLine}`;
    })
    .join("\n");
  return { id: c.id, name: c.name, rulesVersion: c.rules_version, dmNotes: c.dm_notes, party, adventure: adventureContext(campaignId) };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  if (err && typeof err === "object" && err.constructor?.name === "AIError") return res.status(502).json({ error: (err as Error).message });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => cb(null, crypto.randomBytes(12).toString("hex") + path.extname(file.originalname).toLowerCase()),
});

export const imageUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});

export const pdfUpload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === "application/pdf"),
});

export const jsonUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// Character sheet photos/PDFs are read in memory and never saved to disk.
export const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype) || file.mimetype === "application/pdf"),
});

/** What the AI should know about the adventure the party is playing. */
function adventureContext(campaignId: number): string | undefined {
  const a = one("SELECT * FROM adventures WHERE campaign_id = ? AND active = 1 AND status = 'done'", campaignId);
  if (!a) return undefined;
  const sections = all("SELECT id, title, summary, done FROM adventure_sections WHERE adventure_id = ? ORDER BY position", a.id);
  const cur = sections.find((s) => s.id === a.current_section_id);
  const outline = sections.map((s) => `${s.id === a.current_section_id ? "▶ " : s.done ? "✓ " : "- "}${s.title}`).join("\n");
  return `The party is playing the adventure "${a.title}" (originally ${a.edition}).\n${a.synopsis.slice(0, 3000)}\n\nOutline (✓ done, ▶ current):\n${outline.slice(0, 4000)}${cur ? `\n\nCurrent section, "${cur.title}": ${cur.summary}` : ""}`;
}
