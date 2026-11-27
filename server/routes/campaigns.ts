import { Router } from "express";
import { all, one, run } from "../db.ts";
import { requireUser } from "../auth.ts";
import { campaignAccess, HttpError, imageUpload } from "../helpers.ts";
import { broadcastMap, notify } from "../realtime.ts";
import { discordAlertDM, discordMap, discordSessionAnnounce, sendWebhook, validWebhook } from "../discord.ts";

export const campaignRoutes = Router();
campaignRoutes.use(requireUser);

const out = (c: any, isDM: boolean) => ({
  id: c.id,
  name: c.name,
  description: c.description,
  rulesVersion: c.rules_version,
  dmUserId: c.dm_user_id,
  dmName: c.dm_name,
  activeMapId: c.active_map_id,
  dmNotes: isDM ? c.dm_notes : undefined,
  nextSessionAt: c.next_session_at,
  sessionNote: c.session_note,
  sessionWeekly: !!c.session_weekly,
  discord: isDM ? { webhook: c.discord_webhook, dmWebhook: c.discord_dm_webhook, options: JSON.parse(c.discord_options || "{}") } : undefined,
  isDM,
});

campaignRoutes.get("/campaigns", (req, res) => {
  const rows = all(
    `SELECT c.*, u.display_name AS dm_name FROM campaigns c JOIN users u ON u.id = c.dm_user_id
     WHERE c.dm_user_id = ? OR c.id IN (SELECT campaign_id FROM campaign_members WHERE user_id = ?)
     ORDER BY c.created_at DESC`,
    req.user!.id,
    req.user!.id,
  );
  res.json(rows.map((c) => out(c, c.dm_user_id === req.user!.id)));
});

campaignRoutes.post("/campaigns", (req, res) => {
  const { name, description, rulesVersion } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, "Give the campaign a name");
  const rv = rulesVersion === "2024" ? "2024" : "2014";
  const r = run("INSERT INTO campaigns (name, description, rules_version, dm_user_id) VALUES (?,?,?,?)", name.trim().slice(0, 80), String(description ?? "").slice(0, 2000), rv, req.user!.id);
  run("INSERT INTO campaign_members (campaign_id, user_id, role) VALUES (?,?, 'dm')", r.lastInsertRowid, req.user!.id);
  res.json({ id: Number(r.lastInsertRowid) });
});

campaignRoutes.get("/campaigns/:id", (req, res) => {
  const { id, isDM } = campaignAccess(req);
  const c = one("SELECT c.*, u.display_name AS dm_name FROM campaigns c JOIN users u ON u.id = c.dm_user_id WHERE c.id = ?", id);
  const members = all(
    "SELECT u.id, u.username, u.display_name AS displayName, m.role FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ? ORDER BY u.display_name",
    id,
  );
  res.json({ ...out(c, isDM), members });
});

campaignRoutes.patch("/campaigns/:id", (req, res) => {
  const { id } = campaignAccess(req, true);
  const b = req.body ?? {};
  if (typeof b.name === "string" && b.name.trim()) run("UPDATE campaigns SET name = ? WHERE id = ?", b.name.trim().slice(0, 80), id);
  if (typeof b.description === "string") run("UPDATE campaigns SET description = ? WHERE id = ?", b.description.slice(0, 2000), id);
  if (b.rulesVersion === "2014" || b.rulesVersion === "2024") run("UPDATE campaigns SET rules_version = ? WHERE id = ?", b.rulesVersion, id);
  if (typeof b.dmNotes === "string") run("UPDATE campaigns SET dm_notes = ? WHERE id = ?", b.dmNotes.slice(0, 200000), id);
  if (b.discord) {
    const wh = String(b.discord.webhook ?? "").trim(), dmWh = String(b.discord.dmWebhook ?? "").trim();
    if (!validWebhook(wh) || !validWebhook(dmWh)) throw new HttpError(400, "That doesn't look like a Discord webhook link. It should start with https://discord.com/api/webhooks/");
    const o = b.discord.options ?? {};
    const opts = { rolls: !!o.rolls, initiative: !!o.initiative, shares: !!o.shares, maps: !!o.maps, chat: !!o.chat };
    run("UPDATE campaigns SET discord_webhook = ?, discord_dm_webhook = ?, discord_options = ? WHERE id = ?", wh, dmWh, JSON.stringify(opts), id);
  }
  notify(id, "campaign");
  res.json({ ok: true });
});

campaignRoutes.delete("/campaigns/:id", (req, res) => {
  const { id, campaign } = campaignAccess(req, true);
  if (req.body?.confirm !== campaign.name) throw new HttpError(400, "Type the campaign's name to confirm");
  run("DELETE FROM campaigns WHERE id = ?", id);
  res.json({ ok: true });
});

campaignRoutes.post("/campaigns/:id/members", (req, res) => {
  const { id } = campaignAccess(req, true);
  const u = one("SELECT id FROM users WHERE id = ? OR username = ?", Number(req.body?.userId) || -1, String(req.body?.username ?? ""));
  if (!u) throw new HttpError(404, "No user with that name");
  run("INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, role) VALUES (?,?, 'player')", id, u.id);
  notify(id, "campaign");
  res.json({ ok: true });
});

campaignRoutes.delete("/campaigns/:id/members/:userId", (req, res) => {
  const { id, campaign } = campaignAccess(req, true);
  const uid = Number(req.params.userId);
  if (uid === campaign.dm_user_id) throw new HttpError(400, "The DM can't be removed");
  run("DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?", id, uid);
  notify(id, "campaign");
  res.json({ ok: true });
});

// Generic image upload (token art, portraits, handouts)
campaignRoutes.post("/campaigns/:id/images", imageUpload.single("image"), (req, res) => {
  campaignAccess(req);
  if (!req.file) throw new HttpError(400, "Please choose a PNG, JPG, WebP or GIF image");
  res.json({ url: `/uploads/${req.file.filename}` });
});

campaignRoutes.post("/campaigns/:id/active-map", (req, res) => {
  const { id } = campaignAccess(req, true);
  const mapId = req.body?.mapId ? Number(req.body.mapId) : null;
  if (mapId && !one("SELECT id FROM maps WHERE id = ? AND campaign_id = ?", mapId, id)) throw new HttpError(404, "Map not found");
  run("UPDATE campaigns SET active_map_id = ? WHERE id = ?", mapId, id);
  broadcastMap(id);
  if (mapId) discordMap(id, one("SELECT name FROM maps WHERE id = ?", mapId)!.name);
  res.json({ ok: true });
});

campaignRoutes.get("/campaigns/:id/chat/export", (req, res) => {
  const { id, isDM } = campaignAccess(req);
  const rows = all("SELECT c.*, u.display_name AS name FROM chat c LEFT JOIN users u ON u.id = c.user_id WHERE c.campaign_id = ? ORDER BY c.id", id);
  const lines = rows
    .filter((r) => r.whisper_to == null || isDM || r.user_id === req.user!.id || r.whisper_to === req.user!.id)
    .map((r) => {
      const b = JSON.parse(r.body);
      const what = r.kind === "roll" ? `rolled ${b.label ? b.label + " " : ""}${b.expression}: ${b.total}` : b.text ?? b.title ?? "";
      return `[${r.created_at}] ${r.name ?? "System"}: ${what}`;
    });
  res.type("text/plain").send(lines.join("\n"));
});

// ---- next session ----
campaignRoutes.post("/campaigns/:id/session", (req, res) => {
  const { id } = campaignAccess(req, true);
  const b = req.body ?? {};
  let at: string | null = null;
  if (b.at) {
    const t = new Date(String(b.at));
    if (!Number.isFinite(t.getTime())) throw new HttpError(400, "That date doesn't look right");
    at = t.toISOString();
  }
  run(
    "UPDATE campaigns SET next_session_at = ?, session_note = ?, session_weekly = ?, reminders_sent = '[]' WHERE id = ?",
    at,
    String(b.note ?? "").slice(0, 500),
    b.weekly ? 1 : 0,
    id,
  );
  if (at && b.announce !== false) discordSessionAnnounce(id);
  notify(id, "campaign");
  res.json({ ok: true });
});

// ---- test the Discord links ----
campaignRoutes.post("/campaigns/:id/discord/test", async (req, res) => {
  const { id, campaign } = campaignAccess(req, true);
  const which = req.body?.which === "dm" ? "dm" : "table";
  const url = which === "dm" ? campaign.discord_dm_webhook : campaign.discord_webhook;
  if (!url) throw new HttpError(400, "Save a webhook link first");
  try {
    if (which === "dm") {
      discordAlertDM(id, "🔔 DM alerts are working", "You'll get messages here when characters need approval, AI checks finish, and PDF conversions are done.");
    } else {
      await sendWebhook(url, { content: `🍺 **The Grumbling Gnoll** is connected to this channel for **${campaign.name}**! Dice rolls, turns and session reminders will show up here.` });
    }
  } catch (e) {
    throw new HttpError(400, `Discord didn't accept the message: ${(e as Error).message}`);
  }
  res.json({ ok: true });
});
