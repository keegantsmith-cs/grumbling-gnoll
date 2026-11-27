import crypto from "node:crypto";
import { Router } from "express";
import { all, one, run } from "../db.ts";
import { COOKIE, createSession, hashPassword, newInviteCode, requireAdmin, requireUser, setSessionCookie, verifyPassword } from "../auth.ts";
import { HttpError } from "../helpers.ts";
import { checkLimit, clearLimit, hit } from "../ratelimit.ts";
import { AI_MODEL, aiEnabled } from "../ai.ts";

export const authRoutes = Router();

authRoutes.get("/status", (req, res) => {
  const users = one("SELECT COUNT(*) AS n FROM users")!.n;
  res.json({ needsSetup: users === 0, aiEnabled: aiEnabled(), aiModel: AI_MODEL, user: req.user ?? null });
});

authRoutes.post("/register", (req, res) => {
  const { username, displayName, password, inviteCode } = req.body ?? {};
  checkLimit(`register:${req.ip}`, 10, 3600e3);
  hit(`register:${req.ip}`);
  if (typeof username !== "string" || !/^[a-zA-Z0-9_.-]{3,30}$/.test(username))
    throw new HttpError(400, "Username must be 3-30 letters, numbers, dots, dashes or underscores");
  if (typeof password !== "string" || password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  const firstUser = one("SELECT COUNT(*) AS n FROM users")!.n === 0;
  let invite;
  if (!firstUser) {
    invite = one("SELECT * FROM invites WHERE code = ? AND uses_left > 0", String(inviteCode ?? "").trim().toUpperCase());
    if (!invite) throw new HttpError(400, "That invite code isn't valid. Ask your DM for one.");
  }
  if (one("SELECT id FROM users WHERE username = ?", username)) throw new HttpError(400, "That username is taken");
  const name = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 40) : username;
  const r = run("INSERT INTO users (username, display_name, pass_hash, is_admin) VALUES (?,?,?,?)", username, name, hashPassword(password), firstUser ? 1 : 0);
  if (invite) {
    run("UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?", invite.code);
    // Invites made for a campaign drop the new player straight into it
    if (invite.campaign_id) run("INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, role) VALUES (?,?, 'player')", invite.campaign_id, Number(r.lastInsertRowid));
  }
  setSessionCookie(res, createSession(Number(r.lastInsertRowid)));
  res.json({ ok: true });
});

const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

authRoutes.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  const ipKey = `login-ip:${req.ip}`, userKey = `login-user:${String(username ?? "").toLowerCase()}`;
  checkLimit(ipKey, 20, 15 * 60e3);
  checkLimit(userKey, 8, 15 * 60e3);
  const u = one("SELECT * FROM users WHERE username = ?", String(username ?? ""));
  // Check a dummy password for unknown names too, so the answer takes the same time either way
  if (!verifyPassword(String(password ?? ""), u?.pass_hash ?? DUMMY_HASH) || !u) {
    hit(ipKey);
    hit(userKey);
    throw new HttpError(401, "Wrong username or password");
  }
  clearLimit(userKey);
  setSessionCookie(res, createSession(u.id));
  res.json({ ok: true });
});

authRoutes.post("/logout", (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) run("DELETE FROM sessions WHERE token = ?", token);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

authRoutes.post("/me/password", requireUser, (req, res) => {
  const { current, next } = req.body ?? {};
  const u = one("SELECT * FROM users WHERE id = ?", req.user!.id)!;
  checkLimit(`pw:${u.id}`, 8, 15 * 60e3);
  if (!verifyPassword(String(current ?? ""), u.pass_hash)) { hit(`pw:${u.id}`); throw new HttpError(400, "Current password is wrong"); }
  if (typeof next !== "string" || next.length < 8) throw new HttpError(400, "New password must be at least 8 characters");
  run("UPDATE users SET pass_hash = ? WHERE id = ?", hashPassword(next), u.id);
  // Log out everywhere else (e.g. a lost phone), but stay logged in here
  run("DELETE FROM sessions WHERE user_id = ? AND token != ?", u.id, String(req.cookies?.[COOKIE] ?? ""));
  res.json({ ok: true });
});

export const DICE_STYLES = ["ruby", "obsidian", "bone", "gold", "emerald", "sapphire", "amethyst", "wood", "ice", "galaxy"];
authRoutes.post("/me/dice", requireUser, (req, res) => {
  const style = String(req.body?.style ?? "");
  if (!DICE_STYLES.includes(style)) throw new HttpError(400, "Unknown dice style");
  run("UPDATE users SET dice_style = ? WHERE id = ?", style, req.user!.id);
  res.json({ ok: true });
});

authRoutes.get("/users", requireUser, (_req, res) => {
  res.json(all("SELECT id, username, display_name AS displayName, is_admin AS isAdmin FROM users ORDER BY display_name"));
});

// Lets the sign-up page show which campaign an invite is for
authRoutes.get("/invites/:code/info", (req, res) => {
  checkLimit(`invite:${req.ip}`, 30, 15 * 60e3);
  hit(`invite:${req.ip}`);
  const i = one("SELECT i.uses_left, c.name AS campaign FROM invites i LEFT JOIN campaigns c ON c.id = i.campaign_id WHERE i.code = ?", String(req.params.code).toUpperCase());
  if (!i || i.uses_left <= 0) throw new HttpError(404, "That invite has been used up or deleted");
  res.json({ campaign: i.campaign ?? null });
});

// ---- invites (admin) ----
authRoutes.get("/invites", requireUser, requireAdmin, (_req, res) => {
  res.json(all("SELECT i.code, i.uses_left AS usesLeft, i.created_at AS createdAt, i.note, c.name AS campaignName FROM invites i LEFT JOIN campaigns c ON c.id = i.campaign_id WHERE i.uses_left > 0 ORDER BY i.created_at DESC"));
});
authRoutes.post("/invites", requireUser, requireAdmin, (req, res) => {
  const uses = Math.min(20, Math.max(1, Number(req.body?.uses) || 1));
  const code = newInviteCode();
  const campaignId = req.body?.campaignId ? Number(req.body.campaignId) : null;
  if (campaignId && !one("SELECT id FROM campaigns WHERE id = ?", campaignId)) throw new HttpError(404, "Campaign not found");
  run("INSERT INTO invites (code, created_by, uses_left, campaign_id, note) VALUES (?,?,?,?,?)", code, req.user!.id, uses, campaignId, String(req.body?.note ?? "").slice(0, 200));
  res.json({ code, usesLeft: uses });
});
authRoutes.delete("/invites/:code", requireUser, requireAdmin, (req, res) => {
  run("DELETE FROM invites WHERE code = ?", req.params.code);
  res.json({ ok: true });
});

// Admin: download a full backup (database + uploaded files) right now
authRoutes.get("/admin/backup", requireUser, requireAdmin, async (_req, res) => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { execFile } = await import("node:child_process");
  const { db, DATA_DIR } = await import("../db.ts");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gnoll-dl-"));
  const out = path.join(tmp, "backup.tar.gz");
  try {
    await db.backup(path.join(tmp, "grumbling-gnoll.db"));
    const args = ["-czf", out, "-C", tmp, "grumbling-gnoll.db"];
    if (fs.existsSync(path.join(DATA_DIR, "uploads"))) args.push("-C", DATA_DIR, "uploads");
    await new Promise<void>((ok, fail) => execFile("tar", args, (e) => (e ? fail(e) : ok())));
    res.download(out, `grumbling-gnoll-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`, () => fs.rmSync(tmp, { recursive: true, force: true }));
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
});

// Admin can reset a forgotten password
authRoutes.post("/users/:id/reset-password", requireUser, requireAdmin, (req, res) => {
  const pw = String(req.body?.password ?? "");
  if (pw.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  run("UPDATE users SET pass_hash = ? WHERE id = ?", hashPassword(pw), Number(req.params.id));
  run("DELETE FROM sessions WHERE user_id = ?", Number(req.params.id));
  res.json({ ok: true });
});
