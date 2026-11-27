import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { one, run, type Row } from "./db.ts";

const SESSION_DAYS = 30;
export const COOKIE = "tt_session";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}

export function userFromToken(token: string | undefined): Row | undefined {
  if (!token) return undefined;
  const user = one(
    `SELECT u.id, u.username, u.display_name, u.is_admin, u.dice_style FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
    token,
    Date.now(),
  );
  return user;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    maxAge: SESSION_DAYS * 864e5,
  });
}

export function newInviteCode(): string {
  // Easy to read aloud: no 0/O or 1/I
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code.slice(0, 4) + "-" + code.slice(4);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: Row;
    }
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = userFromToken(req.cookies?.[COOKIE]);
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Please log in" });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.is_admin) return res.status(403).json({ error: "Admins only" });
  next();
}

/** Returns 'dm', 'player', or undefined if the user isn't in the campaign. */
export function campaignRole(campaignId: number, userId: number): "dm" | "player" | undefined {
  const c = one("SELECT dm_user_id FROM campaigns WHERE id = ?", campaignId);
  if (!c) return undefined;
  if (c.dm_user_id === userId) return "dm";
  const m = one("SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?", campaignId, userId);
  return m ? (m.role === "dm" ? "dm" : "player") : undefined;
}
