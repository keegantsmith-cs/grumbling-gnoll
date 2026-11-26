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
  const chars = all("SELECT c.data, u.display_name FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.campaign_id = ? AND c.status = 'approved'", campaignId);
  const party = chars
    .map((row) => {
      const d = normalizeCharacter(parseJSON(row.data, {}), c.rules_version as RulesVersion);
      const dv = derive(d);
      return `- ${d.name} (played by ${row.display_name}): level ${dv.level} ${d.species} ${classSummary(d)}; AC ${dv.ac}, HP ${dv.maxHp}`;
    })
    .join("\n");
  return { id: c.id, name: c.name, rulesVersion: c.rules_version, dmNotes: c.dm_notes, party };
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
