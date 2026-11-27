import { Router } from "express";
import { all, one, run } from "../db.ts";
import { requireAdmin, requireUser } from "../auth.ts";
import { campaignAccess, campaignContext, HttpError } from "../helpers.ts";
import { postChat } from "../realtime.ts";
import { AI_MODEL, ASSIST_KINDS, FEATURES, MODELS, dmAssist, getSetting, modelFor, monthSpend, setSetting, type AssistKind, type Feature } from "../ai.ts";

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

aiRoutes.get("/campaigns/:id/ai/usage", (req, res) => {
  campaignAccess(req, true);
  const row = one("SELECT COUNT(*) AS calls FROM ai_history WHERE created_at >= date('now','start of month')")!;
  res.json({ model: modelFor("assistant"), calls: row.calls, estimatedUSD: monthSpend(), capUSD: Number(getSetting("monthlyCapUSD") || 0) });
});

// ---- AI settings & costs (admin) ----
const KIND_FEATURE: Record<string, Feature> = {
  "character-review": "review", "npc-stats": "review", convert: "reading", adventure: "reading", "sheet-scan": "reading", "map-design": "maps",
};
const featureOfKind = (k: string): Feature => KIND_FEATURE[k] ?? "assistant";

aiRoutes.get("/ai/settings", requireAdmin, (_req, res) => {
  const rows = all("SELECT kind, model, COUNT(*) AS n, SUM(cost_usd) AS cost FROM ai_history WHERE created_at >= date('now','start of month') GROUP BY kind, model");
  const byFeature: Record<string, { requests: number; cost: number }> = {};
  for (const r of rows) {
    const f = featureOfKind(r.kind.replace(/^assist:.*/, "assist"));
    byFeature[f] ??= { requests: 0, cost: 0 };
    byFeature[f].requests += r.n;
    byFeature[f].cost += r.cost ?? 0;
  }
  const recent = all("SELECT kind, model, input_tokens AS inputTokens, output_tokens AS outputTokens, cost_usd AS cost, created_at AS createdAt FROM ai_history ORDER BY id DESC LIMIT 40");
  res.json({
    models: MODELS,
    features: FEATURES,
    selected: Object.fromEntries(Object.keys(FEATURES).map((f) => [f, modelFor(f as Feature)])),
    defaultModel: AI_MODEL,
    capUSD: Number(getSetting("monthlyCapUSD") || 0),
    monthSpend: monthSpend(),
    byFeature,
    recent,
  });
});

aiRoutes.put("/ai/settings", requireAdmin, (req, res) => {
  const b = req.body ?? {};
  for (const f of Object.keys(FEATURES)) {
    const m = b.selected?.[f];
    if (typeof m === "string" && MODELS[m]) setSetting(`model.${f}`, m);
  }
  if (b.capUSD !== undefined) setSetting("monthlyCapUSD", String(Math.max(0, Number(b.capUSD) || 0)));
  res.json({ ok: true });
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
