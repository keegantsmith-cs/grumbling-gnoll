import { Router } from "express";
import { all, one, run } from "../db.ts";
import { requireUser } from "../auth.ts";
import { campaignAccess, campaignContext, HttpError } from "../helpers.ts";
import { postChat } from "../realtime.ts";
import { AI_MODEL, ASSIST_KINDS, dmAssist, type AssistKind } from "../ai.ts";

export const aiRoutes = Router();
aiRoutes.use(requireUser);

aiRoutes.get("/ai/kinds", (_req, res) => res.json(ASSIST_KINDS));

aiRoutes.post("/campaigns/:id/ai/assist", async (req, res) => {
  const { id } = campaignAccess(req, true);
  const kind = String(req.body?.kind ?? "freeform") as AssistKind;
  if (!(kind in ASSIST_KINDS)) throw new HttpError(400, "Unknown request type");
  const text = await dmAssist(campaignContext(id), req.user!.id, kind, String(req.body?.request ?? "").slice(0, 4000));
  res.json({ text });
});

aiRoutes.get("/campaigns/:id/ai/history", (req, res) => {
  const { id } = campaignAccess(req, true);
  res.json(
    all(
      "SELECT id, kind, prompt, output, created_at AS createdAt FROM ai_history WHERE campaign_id = ? AND kind LIKE 'assist:%' ORDER BY id DESC LIMIT 50",
      id,
    ).map((r) => ({ ...r, kind: r.kind.replace("assist:", "") })),
  );
});

// Rough monthly spend so the DM can keep an eye on the budget.
// Prices are per million tokens; update them if Anthropic's pricing changes.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

aiRoutes.get("/campaigns/:id/ai/usage", (req, res) => {
  campaignAccess(req, true);
  const row = one(
    "SELECT COALESCE(SUM(input_tokens),0) AS inTok, COALESCE(SUM(output_tokens),0) AS outTok, COUNT(*) AS calls FROM ai_history WHERE created_at >= date('now','start of month')",
  )!;
  const [pin, pout] = PRICES[AI_MODEL] ?? [4, 20];
  res.json({ model: AI_MODEL, calls: row.calls, inputTokens: row.inTok, outputTokens: row.outTok, estimatedUSD: (row.inTok * pin + row.outTok * pout) / 1e6 });
});

// Share an AI result (or any DM text) with the players in chat
aiRoutes.post("/campaigns/:id/share", (req, res) => {
  const { id } = campaignAccess(req, true);
  const text = String(req.body?.text ?? "").trim().slice(0, 20000);
  if (!text) throw new HttpError(400, "Nothing to share");
  const whisperTo = req.body?.toUserId ? Number(req.body.toUserId) : null;
  postChat(id, req.user!.id, "share", { title: String(req.body?.title ?? "").slice(0, 120), text }, whisperTo);
  res.json({ ok: true });
});

// Remember an AI-generated NPC in the compendium
aiRoutes.post("/campaigns/:id/ai/save-npc", (req, res) => {
  const { id } = campaignAccess(req, true);
  const text = String(req.body?.text ?? "");
  const name = String(req.body?.name || text.match(/^#+\s*(.+)$/m)?.[1] || "NPC").replace(/[*_]/g, "").slice(0, 120);
  const r = run(
    "INSERT INTO compendium (campaign_id, kind, name, data, source, status, created_by) VALUES (?,?,?,?,?, 'approved', ?)",
    id,
    "npc",
    name,
    JSON.stringify({ markdown: text }),
    "AI assistant",
    req.user!.id,
  );
  res.json({ id: Number(r.lastInsertRowid) });
});
