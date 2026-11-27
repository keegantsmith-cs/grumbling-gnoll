import { Router } from "express";
import { all, one, parseJSON, run } from "../db.ts";
import { requireUser } from "../auth.ts";
import { campaignAccess, campaignAccessById, campaignContext, HttpError, num } from "../helpers.ts";
import { notify, postChat } from "../realtime.ts";
import { aiEnabled, writeSessionRecap } from "../ai.ts";

export const recapRoutes = Router();
recapRoutes.use(requireUser);

const out = (r: any, isDM: boolean) => ({
  id: r.id, title: r.title, playerRecap: r.player_recap, dmNotes: isDM ? r.dm_notes : undefined,
  shared: !!r.shared, addedToNotes: !!r.added_to_notes, createdAt: r.created_at,
});

recapRoutes.get("/campaigns/:id/recaps", (req, res) => {
  const { id, isDM } = campaignAccess(req);
  const rows = isDM
    ? all("SELECT * FROM session_recaps WHERE campaign_id = ? ORDER BY id DESC", id)
    : all("SELECT * FROM session_recaps WHERE campaign_id = ? AND shared = 1 ORDER BY id DESC", id);
  res.json(rows.map((r) => out(r, isDM)));
});

/** Turn chat into a readable log for the AI. */
function chatLog(campaignId: number, fromId: number, hours: number | null) {
  const rows = all(
    `SELECT c.*, u.display_name AS name FROM chat c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.campaign_id = ? AND c.id > ? ${hours ? "AND c.created_at >= datetime('now', ?)" : ""} ORDER BY c.id`,
    ...(hours ? [campaignId, fromId, `-${hours} hours`] : [campaignId, fromId]),
  );
  const lines = rows.map((r) => {
    const b = parseJSON<any>(r.body, {});
    const who = r.name ?? "System";
    const priv = r.whisper_to != null ? "[private] " : "";
    const time = String(r.created_at).slice(11, 16);
    if (r.kind === "roll") return `${time} ${priv}${who} rolled ${b.label || b.expression}: ${b.total}${b.crit === "success" ? " (natural 20!)" : b.crit === "fail" ? " (natural 1)" : ""}`;
    if (r.kind === "share") return `${time} ${priv}DM shared ${b.title ? `"${b.title}"` : "a handout"}: ${String(b.text).slice(0, 600)}`;
    return `${time} ${priv}${who}: ${String(b.text ?? "").slice(0, 500)}`;
  });
  let text = lines.join("\n");
  if (text.length > 60000) text = "(earlier part trimmed)\n" + text.slice(-60000);
  return { text, lastId: rows.length ? rows[rows.length - 1].id : fromId, count: rows.length };
}

recapRoutes.post("/campaigns/:id/recaps", async (req, res) => {
  const { id } = campaignAccess(req, true);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  const range = String(req.body?.range ?? "since-last");
  const last = one("SELECT MAX(last_chat_id) AS id FROM session_recaps WHERE campaign_id = ?", id)?.id ?? 0;
  const hours = range === "6h" ? 6 : range === "24h" ? 24 : range === "7d" ? 168 : null;
  const log = chatLog(id, range === "since-last" ? last : 0, hours);
  if (log.count < 3 && !String(req.body?.extra ?? "").trim()) throw new HttpError(400, "There isn't enough chat in that time to recap. Pick a longer range or add your own notes.");
  const recap = await writeSessionRecap(campaignContext(id), req.user!.id, log.text || "(no chat)", String(req.body?.extra ?? "").slice(0, 4000));
  const r = run("INSERT INTO session_recaps (campaign_id, title, player_recap, dm_notes, last_chat_id) VALUES (?,?,?,?,?)", id, recap.title.slice(0, 200), recap.player_recap, recap.dm_notes, log.lastId);
  res.json({ id: Number(r.lastInsertRowid) });
});

function loadRecap(rid: number, userId: number) {
  const r = one("SELECT * FROM session_recaps WHERE id = ?", rid);
  if (!r) throw new HttpError(404, "Recap not found");
  campaignAccessById(r.campaign_id, userId, true);
  return r;
}

recapRoutes.patch("/recaps/:rid", (req, res) => {
  const r = loadRecap(num(req.params.rid), req.user!.id);
  const b = req.body ?? {};
  if (typeof b.title === "string") run("UPDATE session_recaps SET title = ? WHERE id = ?", b.title.slice(0, 200), r.id);
  if (typeof b.playerRecap === "string") run("UPDATE session_recaps SET player_recap = ? WHERE id = ?", b.playerRecap.slice(0, 20000), r.id);
  if (typeof b.dmNotes === "string") run("UPDATE session_recaps SET dm_notes = ? WHERE id = ?", b.dmNotes.slice(0, 20000), r.id);
  res.json({ ok: true });
});

// Post the players' recap in chat (and Discord, if connected) and show it on the campaign page
recapRoutes.post("/recaps/:rid/share", (req, res) => {
  const r = loadRecap(num(req.params.rid), req.user!.id);
  postChat(r.campaign_id, req.user!.id, "share", { title: `📜 Previously: ${r.title}`, text: r.player_recap });
  run("UPDATE session_recaps SET shared = 1 WHERE id = ?", r.id);
  notify(r.campaign_id, "recaps");
  res.json({ ok: true });
});

// Append to the campaign notes so the AI remembers what happened
recapRoutes.post("/recaps/:rid/add-to-notes", (req, res) => {
  const r = loadRecap(num(req.params.rid), req.user!.id);
  const c = one("SELECT dm_notes FROM campaigns WHERE id = ?", r.campaign_id)!;
  const entry = `\n\n## Session: ${r.title} (${String(r.created_at).slice(0, 10)})\n${r.player_recap}${r.dm_notes ? `\n\nDM notes:\n${r.dm_notes}` : ""}`;
  run("UPDATE campaigns SET dm_notes = ? WHERE id = ?", (c.dm_notes + entry).slice(-200000), r.campaign_id);
  run("UPDATE session_recaps SET added_to_notes = 1 WHERE id = ?", r.id);
  notify(r.campaign_id, "campaign");
  res.json({ ok: true });
});

recapRoutes.delete("/recaps/:rid", (req, res) => {
  const r = loadRecap(num(req.params.rid), req.user!.id);
  run("DELETE FROM session_recaps WHERE id = ?", r.id);
  res.json({ ok: true });
});
