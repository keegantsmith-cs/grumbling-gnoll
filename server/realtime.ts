// Live table: maps, tokens, fog of war, chat, dice, initiative.
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { all, one, parseJSON, run, type Row } from "./db.ts";
import { COOKIE, campaignRole, userFromToken } from "./auth.ts";
import { describeRoll, rollDice } from "../shared/dice.ts";
import { discordChat, discordCombatEnd, discordTurn } from "./discord.ts";

let io: Server;

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

interface SocketData {
  user: Row;
  campaignId?: number;
  isDM?: boolean;
}

const room = (campaignId: number) => `campaign:${campaignId}`;

export function mapPayload(mapId: number | null, isDM: boolean) {
  if (!mapId) return null;
  const m = one("SELECT * FROM maps WHERE id = ?", mapId);
  if (!m) return null;
  const tokens = all("SELECT * FROM tokens WHERE map_id = ? ORDER BY id", mapId).filter((t) => isDM || !t.hidden);
  let generated = parseJSON<any>(m.generated, null);
  if (generated && !isDM) {
    // Players never see secret doors on generated maps: draw them as walls.
    generated = { ...generated, tiles: generated.tiles.map((r: string) => r.replace(/S/g, " ")) };
  }
  return {
    id: m.id,
    name: m.name,
    imageUrl: m.image_url,
    generated,
    width: m.width,
    height: m.height,
    gridType: m.grid_type,
    gridSize: m.grid_size,
    gridOffsetX: m.grid_offset_x,
    gridOffsetY: m.grid_offset_y,
    feetPerCell: m.feet_per_cell,
    fogEnabled: !!m.fog_enabled,
    fog: parseJSON(m.fog, []),
    dmKey: isDM ? m.dm_key : undefined,
    tokens: tokens.map(tokenOut),
  };
}

function tokenOut(t: Row) {
  return {
    id: t.id,
    name: t.name,
    x: t.x,
    y: t.y,
    size: t.size,
    color: t.color,
    imageUrl: t.image_url,
    characterId: t.character_id,
    controlledBy: t.controlled_by,
    hidden: !!t.hidden,
    hp: t.hp,
    maxHp: t.max_hp,
    conditions: t.conditions,
  };
}

function chatOut(c: Row) {
  return { id: c.id, userId: c.user_id, name: c.name ?? "System", kind: c.kind, body: parseJSON(c.body, {}), whisperTo: c.whisper_to, createdAt: c.created_at };
}

function canSee(msg: { userId: number | null; whisperTo: number | null }, userId: number, isDM: boolean) {
  if (msg.whisperTo == null) return true;
  return isDM || msg.userId === userId || msg.whisperTo === userId;
}

/** Send something to everyone in a campaign, letting each person get their own version (DM vs player). */
function eachSocket(campaignId: number, fn: (s: Socket, data: SocketData) => void) {
  for (const s of io.sockets.adapter.rooms.get(room(campaignId)) ?? []) {
    const sock = io.sockets.sockets.get(s);
    if (sock) fn(sock, sock.data as SocketData);
  }
}

export function broadcastMap(campaignId: number) {
  if (!io) return;
  const c = one("SELECT active_map_id FROM campaigns WHERE id = ?", campaignId);
  eachSocket(campaignId, (s, d) => s.emit("map", mapPayload(c?.active_map_id ?? null, !!d.isDM)));
}

export function broadcastInitiative(campaignId: number) {
  if (!io) return;
  const c = one("SELECT initiative FROM campaigns WHERE id = ?", campaignId);
  const state = parseJSON(c?.initiative, { round: 1, turn: 0, entries: [] });
  eachSocket(campaignId, (s, d) => s.emit("initiative", initiativeFor(state, !!d.isDM)));
}

/** Players see hidden monsters in the turn order as "???" so they can't count them in advance. */
function initiativeFor(state: { round: number; turn: number; entries: Row[] }, isDM: boolean) {
  if (isDM) return state;
  return { ...state, entries: state.entries.map((e) => (e.hidden ? { ...e, name: "???", init: null } : e)) };
}

export function postChat(campaignId: number, userId: number | null, kind: string, body: unknown, whisperTo: number | null = null) {
  const r = run("INSERT INTO chat (campaign_id, user_id, kind, body, whisper_to) VALUES (?,?,?,?,?)", campaignId, userId, kind, JSON.stringify(body), whisperTo);
  const row = one("SELECT c.*, u.display_name AS name FROM chat c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?", r.lastInsertRowid)!;
  const msg = chatOut(row);
  discordChat(campaignId, msg.name, kind, body, whisperTo != null);
  if (!io) return msg;
  eachSocket(campaignId, (s, d) => {
    if (canSee(msg, d.user.id, !!d.isDM)) s.emit("chat", msg);
  });
  return msg;
}

/** Tell everyone in the campaign to reload a list (characters, approvals, compendium...). */
export function notify(campaignId: number, what: string) {
  if (io) io.to(room(campaignId)).emit("changed", what);
}

function findUserInCampaign(campaignId: number, name: string): Row | undefined {
  const members = all(
    `SELECT u.id, u.username, u.display_name FROM users u WHERE u.id IN (
       SELECT user_id FROM campaign_members WHERE campaign_id = ? UNION SELECT dm_user_id FROM campaigns WHERE id = ?)`,
    campaignId,
    campaignId,
  );
  const n = name.toLowerCase();
  return (
    members.find((m) => m.username.toLowerCase() === n || m.display_name.toLowerCase() === n) ??
    (n === "dm" || n === "gm" ? one("SELECT u.id, u.username, u.display_name FROM campaigns c JOIN users u ON u.id = c.dm_user_id WHERE c.id = ?", campaignId) : undefined)
  );
}

function dmIdOf(campaignId: number): number {
  return one("SELECT dm_user_id FROM campaigns WHERE id = ?", campaignId)!.dm_user_id;
}

function doRoll(campaignId: number, userId: number, expr: string, label: string, whisperTo: number | null, socket: Socket) {
  try {
    const r = rollDice(expr);
    postChat(campaignId, userId, "roll", { expression: r.expression, label, total: r.total, detail: describeRoll(r), crit: r.crit }, whisperTo);
  } catch (e) {
    socket.emit("toast", (e as Error).message);
  }
}

function canMoveToken(t: Row, d: SocketData) {
  if (d.isDM) return true;
  if (t.controlled_by === d.user.id) return true;
  if (t.character_id) {
    const c = one("SELECT owner_id FROM characters WHERE id = ?", t.character_id);
    if (c?.owner_id === d.user.id) return true;
  }
  return false;
}

function tokenOnActiveMap(tokenId: number, campaignId: number) {
  return one(
    "SELECT t.* FROM tokens t JOIN maps m ON m.id = t.map_id WHERE t.id = ? AND m.campaign_id = ?",
    tokenId,
    campaignId,
  );
}

export function initRealtime(server: HttpServer) {
  io = new Server(server, { maxHttpBufferSize: 1e6 });

  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? "");
    const user = userFromToken(cookies[COOKIE]);
    if (!user) return next(new Error("Please log in"));
    (socket.data as SocketData).user = user;
    next();
  });

  io.on("connection", (socket) => {
    const d = socket.data as SocketData;

    socket.on("join", (campaignId: number) => {
      const role = campaignRole(Number(campaignId), d.user.id);
      if (!role) return socket.emit("toast", "You're not in that campaign");
      if (d.campaignId) socket.leave(room(d.campaignId));
      d.campaignId = Number(campaignId);
      d.isDM = role === "dm";
      socket.join(room(d.campaignId));
      const c = one("SELECT active_map_id, initiative FROM campaigns WHERE id = ?", d.campaignId)!;
      socket.emit("map", mapPayload(c.active_map_id, d.isDM));
      socket.emit("initiative", initiativeFor(parseJSON(c.initiative, { round: 1, turn: 0, entries: [] }), d.isDM));
      const history = all(
        "SELECT c.*, u.display_name AS name FROM chat c LEFT JOIN users u ON u.id = c.user_id WHERE c.campaign_id = ? ORDER BY c.id DESC LIMIT 150",
        d.campaignId,
      )
        .reverse()
        .map(chatOut)
        .filter((m) => canSee(m, d.user.id, !!d.isDM));
      socket.emit("chatHistory", history);
      socket.emit("presence", presence(d.campaignId));
      socket.to(room(d.campaignId)).emit("presence", presence(d.campaignId));
    });

    socket.on("disconnect", () => {
      if (d.campaignId) io.to(room(d.campaignId)).emit("presence", presence(d.campaignId));
    });

    // ---- chat & dice ----
    socket.on("chat", (text: string) => {
      if (!d.campaignId || typeof text !== "string") return;
      const t = text.trim().slice(0, 2000);
      if (!t) return;
      const cid = d.campaignId;
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^\/(?:r|roll)\s+(\S+)\s*(.*)$/i))) return doRoll(cid, d.user.id, m[1], m[2], null, socket);
      if ((m = t.match(/^\/(?:gmr|gmroll|dmroll)\s+(\S+)\s*(.*)$/i))) return doRoll(cid, d.user.id, m[1], m[2], dmIdOf(cid), socket);
      if ((m = t.match(/^\/(?:w|whisper)\s+("[^"]+"|\S+)\s+([\s\S]+)$/i))) {
        const target = findUserInCampaign(cid, m[1].replace(/"/g, ""));
        if (!target) return socket.emit("toast", `No one called ${m[1]} in this campaign`);
        return postChat(cid, d.user.id, "text", { text: m[2], toName: target.display_name }, target.id);
      }
      if (t.startsWith("/")) return socket.emit("toast", "Commands: /r 1d20+5, /gmr 1d20 (secret roll to DM), /w name message");
      postChat(cid, d.user.id, "text", { text: t });
    });

    socket.on("roll", (p: { expr: string; label?: string; secret?: boolean }) => {
      if (!d.campaignId || typeof p?.expr !== "string") return;
      doRoll(d.campaignId, d.user.id, p.expr, String(p.label ?? "").slice(0, 100), p.secret ? dmIdOf(d.campaignId) : null, socket);
    });

    socket.on("ping", (p: { x: number; y: number }) => {
      if (!d.campaignId) return;
      io.to(room(d.campaignId)).emit("ping", { x: Number(p.x), y: Number(p.y), name: d.user.display_name, userId: d.user.id });
    });

    // ---- tokens ----
    socket.on("token:move", (p: { id: number; x: number; y: number }) => {
      if (!d.campaignId) return;
      const t = tokenOnActiveMap(Number(p.id), d.campaignId);
      if (!t || !canMoveToken(t, d)) return;
      run("UPDATE tokens SET x = ?, y = ? WHERE id = ?", Number(p.x), Number(p.y), t.id);
      if (t.hidden) {
        eachSocket(d.campaignId, (s, sd) => sd.isDM && s.emit("token:moved", { id: t.id, x: Number(p.x), y: Number(p.y) }));
      } else io.to(room(d.campaignId)).emit("token:moved", { id: t.id, x: Number(p.x), y: Number(p.y) });
    });

    socket.on("token:add", (p: Row) => {
      if (!d.campaignId) return;
      const c = one("SELECT active_map_id FROM campaigns WHERE id = ?", d.campaignId)!;
      if (!c.active_map_id) return socket.emit("toast", "Pick a map to show first");
      // Players may place a token for their own character only.
      let characterId: number | null = p.characterId ? Number(p.characterId) : null;
      if (!d.isDM) {
        const ch = characterId ? one("SELECT owner_id FROM characters WHERE id = ? AND campaign_id = ?", characterId, d.campaignId) : null;
        if (!ch || ch.owner_id !== d.user.id) return socket.emit("toast", "Only the DM can add tokens that aren't your character");
      }
      run(
        "INSERT INTO tokens (map_id, name, x, y, size, color, image_url, character_id, controlled_by, hidden, hp, max_hp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        c.active_map_id,
        String(p.name ?? "Token").slice(0, 60),
        Number(p.x) || 0,
        Number(p.y) || 0,
        Math.min(6, Math.max(0.25, Number(p.size) || 1)),
        typeof p.color === "string" ? p.color.slice(0, 20) : "#c0392b",
        typeof p.imageUrl === "string" && p.imageUrl.startsWith("/uploads/") ? p.imageUrl : null,
        characterId,
        d.isDM ? (p.controlledBy ? Number(p.controlledBy) : null) : d.user.id,
        d.isDM && p.hidden ? 1 : 0,
        p.hp != null && p.hp !== "" ? Number(p.hp) : null,
        p.maxHp != null && p.maxHp !== "" ? Number(p.maxHp) : null,
      );
      broadcastMap(d.campaignId);
    });

    socket.on("token:update", (p: Row) => {
      if (!d.campaignId) return;
      const t = tokenOnActiveMap(Number(p.id), d.campaignId);
      if (!t) return;
      const owner = canMoveToken(t, d);
      if (!owner) return;
      // Players can change HP/conditions on their own tokens; everything else is DM-only.
      const fields: Record<string, unknown> = {};
      if (p.hp !== undefined) fields.hp = p.hp === null || p.hp === "" ? null : Number(p.hp);
      if (p.conditions !== undefined) fields.conditions = String(p.conditions).slice(0, 200);
      if (d.isDM) {
        if (p.name !== undefined) fields.name = String(p.name).slice(0, 60);
        if (p.size !== undefined) fields.size = Math.min(6, Math.max(0.25, Number(p.size) || 1));
        if (p.color !== undefined) fields.color = String(p.color).slice(0, 20);
        if (p.hidden !== undefined) fields.hidden = p.hidden ? 1 : 0;
        if (p.maxHp !== undefined) fields.max_hp = p.maxHp === null || p.maxHp === "" ? null : Number(p.maxHp);
        if (p.controlledBy !== undefined) fields.controlled_by = p.controlledBy ? Number(p.controlledBy) : null;
      }
      const keys = Object.keys(fields);
      if (!keys.length) return;
      run(`UPDATE tokens SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => fields[k]), t.id);
      broadcastMap(d.campaignId);
    });

    socket.on("token:delete", (id: number) => {
      if (!d.campaignId) return;
      const t = tokenOnActiveMap(Number(id), d.campaignId);
      if (!t || !(d.isDM || canMoveToken(t, d))) return;
      run("DELETE FROM tokens WHERE id = ?", t.id);
      broadcastMap(d.campaignId);
    });

    // ---- fog of war (DM only) ----
    socket.on("fog", (p: { op: "add" | "reset" | "clear" | "undo"; shape?: Row }) => {
      if (!d.campaignId || !d.isDM) return;
      const c = one("SELECT active_map_id FROM campaigns WHERE id = ?", d.campaignId)!;
      if (!c.active_map_id) return;
      const m = one("SELECT fog FROM maps WHERE id = ?", c.active_map_id)!;
      let fog = parseJSON<Row[]>(m.fog, []);
      if (p.op === "reset") fog = [];
      else if (p.op === "clear") fog = [{ mode: "reveal", kind: "all" }];
      else if (p.op === "undo") fog.pop();
      else if (p.op === "add" && p.shape) {
        const s = p.shape;
        fog.push({
          mode: s.mode === "hide" ? "hide" : "reveal",
          kind: s.kind === "rect" ? "rect" : s.kind === "poly" ? "poly" : "circle",
          x: Number(s.x) || 0,
          y: Number(s.y) || 0,
          r: Number(s.r) || 0,
          w: Number(s.w) || 0,
          h: Number(s.h) || 0,
          points: Array.isArray(s.points) ? s.points.slice(0, 2000).map(Number) : undefined,
        });
        if (fog.length > 3000) fog = fog.slice(-3000);
      }
      run("UPDATE maps SET fog = ? WHERE id = ?", JSON.stringify(fog), c.active_map_id);
      io.to(room(d.campaignId)).emit("fog", fog);
    });

    // ---- initiative ----
    socket.on("initiative", (p: Row) => {
      if (!d.campaignId) return;
      const c = one("SELECT initiative FROM campaigns WHERE id = ?", d.campaignId)!;
      const state = parseJSON<{ round: number; turn: number; entries: Row[] }>(c.initiative, { round: 1, turn: 0, entries: [] });
      const sortEntries = () => state.entries.sort((a, b) => b.init - a.init || (b.dex ?? 0) - (a.dex ?? 0));
      if (p.op === "roll") {
        // Server rolls initiative so nobody can fudge it: d20 + bonus, posted to chat too.
        const bonus = Math.max(-10, Math.min(20, Math.round(Number(p.bonus) || 0)));
        const r = rollDice(`1d20${bonus >= 0 ? "+" : ""}${bonus}`);
        const name = String(p.name ?? d.user.display_name).slice(0, 60);
        const hidden = d.isDM && !!p.hidden;
        postChat(d.campaignId, d.user.id, "roll", { expression: r.expression, label: `${name} initiative`, total: r.total, detail: describeRoll(r), crit: r.crit }, hidden ? dmIdOf(d.campaignId) : null);
        state.entries = state.entries.filter((e) => !(e.ownerId === d.user.id && e.name === name));
        state.entries.push({ id: Date.now() + Math.random(), name, init: r.total, dex: bonus, hidden, ownerId: d.user.id, tokenId: p.tokenId ?? null });
        sortEntries();
      } else if (p.op === "add") {
        // Players can add their own character; the DM can add anything.
        const entry = { id: Date.now() + Math.random(), name: String(p.name ?? "?").slice(0, 60), init: Number(p.init) || 0, dex: Number(p.dex) || 0, hidden: d.isDM && !!p.hidden, ownerId: d.user.id, tokenId: p.tokenId ?? null };
        if (!d.isDM) state.entries = state.entries.filter((e) => !(e.ownerId === d.user.id && e.name === entry.name));
        state.entries.push(entry);
        sortEntries();
      } else if (!d.isDM) {
        return socket.emit("toast", "Only the DM can change the turn order");
      } else if (p.op === "remove") {
        state.entries = state.entries.filter((e) => e.id !== p.id);
        state.turn = Math.min(state.turn, Math.max(0, state.entries.length - 1));
      } else if (p.op === "set") {
        const e = state.entries.find((x) => x.id === p.id);
        if (e) {
          if (p.init !== undefined) e.init = Number(p.init) || 0;
          if (p.hidden !== undefined) e.hidden = !!p.hidden;
        }
        sortEntries();
      } else if (p.op === "next") {
        if (state.entries.length) {
          state.turn++;
          let newRound = false;
          if (state.turn >= state.entries.length) { state.turn = 0; state.round++; newRound = true; }
          const cur = state.entries[state.turn];
          discordTurn(d.campaignId, state.round, cur.hidden ? null : cur.name, newRound);
        }
      } else if (p.op === "prev") {
        if (state.turn > 0) state.turn--;
        else if (state.round > 1) { state.round--; state.turn = Math.max(0, state.entries.length - 1); }
      } else if (p.op === "clear") {
        if (state.entries.length) discordCombatEnd(d.campaignId);
        state.entries = []; state.turn = 0; state.round = 1;
      }
      run("UPDATE campaigns SET initiative = ? WHERE id = ?", JSON.stringify(state), d.campaignId);
      broadcastInitiative(d.campaignId);
    });
  });
}

function presence(campaignId: number) {
  const names = new Map<number, string>();
  eachSocket(campaignId, (_s, d) => names.set(d.user.id, d.user.display_name));
  return [...names.entries()].map(([id, name]) => ({ id, name }));
}
