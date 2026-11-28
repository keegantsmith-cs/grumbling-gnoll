import { Router } from "express";
import { all, one, parseJSON, run } from "../db.ts";
import { requireUser } from "../auth.ts";
import { campaignAccess, campaignContext, HttpError, imageUpload } from "../helpers.ts";
import { addMonsterTokens, averageHp, broadcastMap, dropFromCampaign, monsterMeta, notify, sizeToCells } from "../realtime.ts";
import { srdMonster } from "./srd.ts";
import { monsterCombatData } from "../../shared/combat.ts";
import { aiEnabled, condenseNotes, generateNpcs } from "../ai.ts";
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
  hasNotesBackup: isDM ? !!c.dm_notes_backup : undefined,
  nextSessionAt: c.next_session_at,
  sessionNote: c.session_note,
  sessionWeekly: !!c.session_weekly,
  discord: isDM ? { webhook: c.discord_webhook, dmWebhook: c.discord_dm_webhook, options: JSON.parse(c.discord_options || "{}"), invite: c.discord_invite, serverId: c.discord_server_id } : undefined,
  discordVoice: { invite: c.discord_invite || null, widget: !!c.discord_server_id },
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
  if ((b.rulesVersion === "2014" || b.rulesVersion === "2024") && b.rulesVersion !== one("SELECT rules_version FROM campaigns WHERE id = ?", id)?.rules_version) {
    run("UPDATE campaigns SET rules_version = ? WHERE id = ?", b.rulesVersion, id);
    // Everyone's characters (and sheets waiting for approval) switch to the campaign's new rules too
    for (const ch of all("SELECT id, data FROM characters WHERE campaign_id = ?", id)) {
      run("UPDATE characters SET data = ? WHERE id = ?", JSON.stringify({ ...parseJSON<Record<string, unknown>>(ch.data, {}), rulesVersion: b.rulesVersion }), ch.id);
    }
    for (const ch of all("SELECT cc.id, cc.proposed FROM character_changes cc JOIN characters c ON c.id = cc.character_id WHERE c.campaign_id = ? AND cc.status = 'pending'", id)) {
      run("UPDATE character_changes SET proposed = ? WHERE id = ?", JSON.stringify({ ...parseJSON<Record<string, unknown>>(ch.proposed, {}), rulesVersion: b.rulesVersion }), ch.id);
    }
    notify(id, "characters");
  }
  if (typeof b.dmNotes === "string") run("UPDATE campaigns SET dm_notes = ? WHERE id = ?", b.dmNotes.slice(0, 200000), id);
  if (b.discord) {
    const wh = String(b.discord.webhook ?? "").trim(), dmWh = String(b.discord.dmWebhook ?? "").trim();
    if (!validWebhook(wh) || !validWebhook(dmWh)) throw new HttpError(400, "That doesn't look like a Discord webhook link. It should start with https://discord.com/api/webhooks/");
    const o = b.discord.options ?? {};
    const opts = { rolls: !!o.rolls, initiative: !!o.initiative, shares: !!o.shares, maps: !!o.maps, chat: !!o.chat };
    run("UPDATE campaigns SET discord_webhook = ?, discord_dm_webhook = ?, discord_options = ? WHERE id = ?", wh, dmWh, JSON.stringify(opts), id);
    const invite = String(b.discord.invite ?? "").trim();
    if (invite && !/^https:\/\/(discord\.gg|(www\.)?discord(app)?\.com\/invite)\/[\w-]+$/.test(invite)) throw new HttpError(400, "The invite link should look like https://discord.gg/abc123");
    const serverId = String(b.discord.serverId ?? "").trim();
    if (serverId && !/^\d{15,22}$/.test(serverId)) throw new HttpError(400, "The Server ID is a long number, like 123456789012345678");
    run("UPDATE campaigns SET discord_invite = ?, discord_server_id = ? WHERE id = ?", invite, serverId, id);
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
  dropFromCampaign(id, uid);
  notify(id, "campaign");
  res.json({ ok: true });
});

// Image upload not tied to a campaign (character portraits)
campaignRoutes.post("/images", imageUpload.single("image"), (req, res) => {
  if (!req.file) throw new HttpError(400, "Please choose a PNG, JPG, WebP or GIF image");
  res.json({ url: `/uploads/${req.file.filename}` });
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
campaignRoutes.post("/campaigns/:id/session", async (req, res) => {
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
  const hasWebhook = !!one("SELECT discord_webhook FROM campaigns WHERE id = ?", id)?.discord_webhook;
  let announced: boolean | null = null; // null = nothing was sent
  if (at && b.announce !== false && hasWebhook) announced = await discordSessionAnnounce(id);
  notify(id, "campaign");
  res.json({ ok: true, announced });
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

// Put monsters (from the Compendium, an adventure, or the SRD) onto the map
campaignRoutes.post("/campaigns/:id/table/monsters", (req, res) => {
  const { id } = campaignAccess(req, true);
  const b = req.body ?? {};
  let m = b.monster as Record<string, any> | undefined;
  if (b.entryId) {
    const e = one("SELECT * FROM compendium WHERE id = ? AND campaign_id = ?", Number(b.entryId), id);
    if (!e) throw new HttpError(404, "Entry not found");
    const data = JSON.parse(e.data);
    m = e.kind === "npc" ? { name: e.name, ...(data.statblock ?? {}) } : data;
    if (!m!.name) m!.name = e.name;
  }
  if (!m?.name) throw new HttpError(400, "Pick a monster");
  try {
    const hp = Number(m.hit_points) || averageHp(m.hit_dice, 10);
    const n = addMonsterTokens(id, req.user!.id, {
      name: String(b.name || m.name), count: Number(b.count) || 1, hitPoints: hp, hitDice: m.hit_dice, rollHp: !!b.rollHp,
      size: sizeToCells(m.size), hidden: !!b.hidden, initiative: b.initiative ?? "each", dexMod: Math.floor(((Number(m.dex) || 10) - 10) / 2),
      x: b.x != null ? Number(b.x) : undefined, y: b.y != null ? Number(b.y) : undefined, color: b.color, meta: monsterMeta(m), combat: monsterCombatData(m),
    });
    res.json({ added: n });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

// Who's in Discord voice right now (from Discord's public server widget), cached for a minute
const voiceCache = new Map<string, { at: number; data: unknown }>();
campaignRoutes.get("/campaigns/:id/discord/voice", async (req, res) => {
  const { campaign } = campaignAccess(req);
  const serverId = campaign.discord_server_id;
  if (!serverId) return res.json({ invite: campaign.discord_invite || null, enabled: false, channels: [] });
  const cached = voiceCache.get(serverId);
  if (cached && Date.now() - cached.at < 60_000) return res.json({ ...(cached.data as object), invite: campaign.discord_invite || (cached.data as any).invite });
  try {
    const r = await fetch(`https://discord.com/api/guilds/${serverId}/widget.json`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) {
      const data = { enabled: false, error: r.status === 403 ? "The server widget is turned off in Discord (Server Settings → Widget)." : `Discord said ${r.status}`, channels: [], invite: null };
      voiceCache.set(serverId, { at: Date.now(), data });
      return res.json({ ...data, invite: campaign.discord_invite || null });
    }
    const w = (await r.json()) as { name: string; instant_invite: string | null; channels: { id: string; name: string; position: number }[]; members: { username: string; avatar_url?: string; channel_id?: string }[] };
    const channels = w.channels
      .sort((a, b) => a.position - b.position)
      .map((ch) => ({ name: ch.name, members: w.members.filter((m) => m.channel_id === ch.id).map((m) => ({ name: m.username, avatar: m.avatar_url ?? null })) }));
    const data = { enabled: true, server: w.name, invite: w.instant_invite, channels, online: w.members.length };
    voiceCache.set(serverId, { at: Date.now(), data });
    res.json({ ...data, invite: campaign.discord_invite || w.instant_invite });
  } catch {
    res.json({ enabled: false, error: "Couldn't reach Discord right now.", channels: [], invite: campaign.discord_invite || null });
  }
});

// ---------- saved encounters ----------

type EncMonster = { name: string; cr: string; count: number; entryId?: number; srdName?: string };
const cleanMonsters = (list: unknown): EncMonster[] => (Array.isArray(list) ? list : []).slice(0, 30).map((m: any) => ({
  name: String(m.name ?? "?").slice(0, 80), cr: String(m.cr ?? "0").slice(0, 8), count: Math.max(1, Math.min(20, Math.round(Number(m.count) || 1))),
  entryId: m.entryId ? Number(m.entryId) : undefined, srdName: m.srdName ? String(m.srdName).slice(0, 80) : undefined,
}));
const encOut = (e: any) => ({ id: e.id, name: e.name, monsters: JSON.parse(e.monsters), notes: e.notes, createdAt: e.created_at });

campaignRoutes.get("/campaigns/:id/encounters", (req, res) => {
  const { id } = campaignAccess(req, true);
  res.json(all("SELECT * FROM encounters WHERE campaign_id = ? ORDER BY id DESC", id).map(encOut));
});
campaignRoutes.post("/campaigns/:id/encounters", (req, res) => {
  const { id } = campaignAccess(req, true);
  const r = run("INSERT INTO encounters (campaign_id, name, monsters, notes) VALUES (?,?,?,?)", id, String(req.body?.name || "Encounter").slice(0, 100), JSON.stringify(cleanMonsters(req.body?.monsters)), String(req.body?.notes ?? "").slice(0, 2000));
  res.json({ id: Number(r.lastInsertRowid) });
});
campaignRoutes.put("/campaigns/:id/encounters/:eid", (req, res) => {
  const { id } = campaignAccess(req, true);
  run("UPDATE encounters SET name = ?, monsters = ?, notes = ? WHERE id = ? AND campaign_id = ?", String(req.body?.name || "Encounter").slice(0, 100), JSON.stringify(cleanMonsters(req.body?.monsters)), String(req.body?.notes ?? "").slice(0, 2000), Number(req.params.eid), id);
  res.json({ ok: true });
});
campaignRoutes.delete("/campaigns/:id/encounters/:eid", (req, res) => {
  const { id } = campaignAccess(req, true);
  run("DELETE FROM encounters WHERE id = ? AND campaign_id = ?", Number(req.params.eid), id);
  res.json({ ok: true });
});

/** Put a whole encounter on the map in one go (each monster group in its own row). */
campaignRoutes.post("/campaigns/:id/encounters/place", (req, res) => {
  const { id } = campaignAccess(req, true);
  const b = req.body ?? {};
  const monsters = cleanMonsters(b.monsters);
  if (!monsters.length) throw new HttpError(400, "Add some monsters first");
  const map = one("SELECT m.* FROM campaigns c JOIN maps m ON m.id = c.active_map_id WHERE c.id = ?", id);
  if (!map) throw new HttpError(400, "Show a map on the table first (Maps tab → Show to players).");
  const g = map.grid_size || 70;
  let y = b.y != null ? Number(b.y) : map.height / 2 - ((monsters.length - 1) * g * 1.5) / 2;
  let added = 0;
  for (const em of monsters) {
    let m: Record<string, any> | null = null;
    if (em.entryId) {
      const e = one("SELECT * FROM compendium WHERE id = ? AND campaign_id = ?", em.entryId, id);
      if (e) { const d = JSON.parse(e.data); m = e.kind === "npc" ? { name: e.name, ...(d.statblock ?? {}) } : { ...d, name: d.name || e.name }; }
    } else if (em.srdName) m = srdMonster(em.srdName) as Record<string, any> | null;
    m ??= { name: em.name, hit_points: 10, size: "Medium", dex: 10 };
    const size = sizeToCells(m.size);
    added += addMonsterTokens(id, req.user!.id, {
      name: em.name, count: em.count, hitPoints: Number(m.hit_points) || averageHp(m.hit_dice, 10), hitDice: m.hit_dice, rollHp: !!b.rollHp,
      size, hidden: !!b.hidden, initiative: b.initiative ?? "each", dexMod: Math.floor(((Number(m.dex) || 10) - 10) / 2),
      x: b.x != null ? Number(b.x) : undefined, y, meta: monsterMeta(m), combat: monsterCombatData(m),
    });
    y += g * Math.max(1, size) + g * 0.5;
  }
  res.json({ added });
});

// ---------- condense campaign notes ----------
campaignRoutes.post("/campaigns/:id/notes/condense", async (req, res) => {
  const { id, campaign } = campaignAccess(req, true);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  if ((campaign.dm_notes ?? "").trim().length < 800) throw new HttpError(400, "Your notes are already short. Nothing to condense yet.");
  res.json({ text: await condenseNotes(campaignContext(id), req.user!.id, campaign.dm_notes) });
});
campaignRoutes.post("/campaigns/:id/notes/apply", (req, res) => {
  const { id, campaign } = campaignAccess(req, true);
  const text = String(req.body?.text ?? "").slice(0, 200000);
  if (!text.trim()) throw new HttpError(400, "Nothing to save");
  run("UPDATE campaigns SET dm_notes_backup = ?, dm_notes = ? WHERE id = ?", campaign.dm_notes, text, id);
  notify(id, "campaign");
  res.json({ ok: true });
});
campaignRoutes.post("/campaigns/:id/notes/undo", (req, res) => {
  const { id, campaign } = campaignAccess(req, true);
  if (!campaign.dm_notes_backup) throw new HttpError(400, "There's nothing to undo");
  run("UPDATE campaigns SET dm_notes = ?, dm_notes_backup = ? WHERE id = ?", campaign.dm_notes_backup, campaign.dm_notes, id);
  notify(id, "campaign");
  res.json({ ok: true });
});

// ---------- AI NPCs for the current map: saved to the Compendium and placed as tokens ----------
campaignRoutes.post("/campaigns/:id/table/npcs", async (req, res) => {
  const { id } = campaignAccess(req, true);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  const map = one("SELECT m.* FROM campaigns c JOIN maps m ON m.id = c.active_map_id WHERE c.id = ?", id);
  if (!map) throw new HttpError(400, "Show a map on the table first (Maps tab → Show to players).");
  const b = req.body ?? {};
  const count = Math.max(1, Math.min(6, Math.round(Number(b.count) || 1)));
  // Tell the AI about the place: map name, its key, and any markers near the click
  const pois = JSON.parse(map.pois || "[]") as { title: string; x: number; y: number; kind: string }[];
  const near = b.x != null ? pois.filter((p) => Math.hypot(p.x - Number(b.x), p.y - Number(b.y)) < map.grid_size * 6).map((p) => p.title) : [];
  const place = [`Map: ${map.name}`, near.length ? `Right next to: ${near.join(", ")}` : "", String(map.dm_key ?? "").slice(0, 2500)].filter(Boolean).join("\n");
  const batch = await generateNpcs(campaignContext(id), req.user!.id, { count, request: String(b.request ?? "").slice(0, 1500), place });
  const g = map.grid_size || 70;
  const placed: { name: string; entryId: number }[] = [];
  batch.npcs.slice(0, count).forEach((n, i) => {
    const markdown = `# ${n.name}\n*${n.role}* · ${n.attitude}\n\n${n.appearance}\n\n**Personality:** ${n.personality}\n\n**Voice:** ${n.voice}\n\n**Wants:** ${n.wants}\n\n**Secret:** ${n.secret}\n\n**Sample lines:**\n${n.sample_lines.map((l) => `- "${l}"`).join("\n")}`;
    const r = run(
      "INSERT INTO compendium (campaign_id, kind, name, data, source, status, player_visible, created_by) VALUES (?, 'npc', ?, ?, ?, 'approved', 0, ?)",
      id, n.name.slice(0, 120), JSON.stringify({ markdown, statblock: n.statblock }), `AI NPC for ${map.name}`, req.user!.id,
    );
    placed.push({ name: n.name, entryId: Number(r.lastInsertRowid) });
    const sb = n.statblock as Record<string, any>;
    addMonsterTokens(id, req.user!.id, {
      name: n.name, count: 1, hitPoints: Number(sb.hit_points) || averageHp(sb.hit_dice, 8), hitDice: sb.hit_dice,
      size: sizeToCells(sb.size), hidden: !!b.hidden, initiative: "none", color: "#2f7d6d", meta: monsterMeta(sb), combat: monsterCombatData(sb),
      x: b.x != null ? Number(b.x) + (i % 3) * g : undefined, y: b.y != null ? Number(b.y) + Math.floor(i / 3) * g : undefined,
    });
  });
  notify(id, "compendium");
  res.json({ npcs: placed });
});
