// Live table: maps, tokens, fog of war, chat, dice, initiative.
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { all, one, parseJSON, run, type Row } from "./db.ts";
import { COOKIE, campaignRole, userFromToken } from "./auth.ts";
import { describeRoll, diceList, rollDice } from "../shared/dice.ts";
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
    // Points of interest: the DM sees everything; players only see revealed markers, without the DM's notes
    pois: parseJSON<Row[]>(m.pois, []).filter((p) => isDM || p.revealed).map((p) => (isDM ? p : { id: p.id, kind: p.kind, label: p.label, title: p.title, x: p.x, y: p.y, revealed: true })),
    enrichment: isDM ? parseJSON(m.enrichment, {}) : undefined,
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
    rings: parseJSON(t.rings, []),
    meta: parseJSON(t.meta, {}),
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
  return { ...state, entries: state.entries.map((e) => (e.hidden ? { id: e.id, name: "???", init: null, hidden: true } : e)) };
}

export function postChat(campaignId: number, userId: number | null, kind: string, body: unknown, whisperTo: number | null = null) {
  // Rolls carry the roller's chosen dice look, so everyone sees their dice the way they picked
  if (kind === "roll" && userId && body && typeof body === "object") {
    (body as Record<string, unknown>).style = one("SELECT dice_style FROM users WHERE id = ?", userId)?.dice_style ?? "ruby";
  }
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

/** Someone was removed from a campaign: stop sending them its live table and chat. */
export function dropFromCampaign(campaignId: number, userId: number) {
  if (!io) return;
  eachSocket(campaignId, (s, d) => {
    if (d.user.id !== userId) return;
    s.leave(room(campaignId));
    d.campaignId = undefined;
    d.isDM = false;
  });
  io.to(room(campaignId)).emit("presence", presence(campaignId));
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
    postChat(campaignId, userId, "roll", { expression: r.expression, label, total: r.total, detail: describeRoll(r), crit: r.crit, dice: diceList(r) }, whisperTo);
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
      if ((m = t.match(/^\/(?:pr|publicroll)\s+(\S+)\s*(.*)$/i))) return doRoll(cid, d.user.id, m[1], m[2], null, socket);
      if ((m = t.match(/^\/(?:r|roll)\s+(\S+)\s*(.*)$/i))) return doRoll(cid, d.user.id, m[1], m[2], d.isDM ? d.user.id : null, socket);
      if ((m = t.match(/^\/(?:gmr|gmroll|dmroll)\s+(\S+)\s*(.*)$/i))) return doRoll(cid, d.user.id, m[1], m[2], dmIdOf(cid), socket);
      if ((m = t.match(/^\/(?:w|whisper)\s+("[^"]+"|\S+)\s+([\s\S]+)$/i))) {
        const target = findUserInCampaign(cid, m[1].replace(/"/g, ""));
        if (!target) return socket.emit("toast", `No one called ${m[1]} in this campaign`);
        return postChat(cid, d.user.id, "text", { text: m[2], toName: target.display_name }, target.id);
      }
      if (t.startsWith("/")) return socket.emit("toast", d.isDM ? "Commands: /r 1d20+5 (only you see it), /pr 1d20+5 (show the players), /w name message" : "Commands: /r 1d20+5, /gmr 1d20 (secret roll to DM), /w name message");
      postChat(cid, d.user.id, "text", { text: t });
    });

    socket.on("roll", (p: { expr: string; label?: string; secret?: boolean; public?: boolean }) => {
      if (!d.campaignId || typeof p?.expr !== "string") return;
      // The DM's rolls stay behind the screen unless the DM chooses to show one
      const whisper = d.isDM ? (p.public ? null : d.user.id) : p.secret ? dmIdOf(d.campaignId) : null;
      doRoll(d.campaignId, d.user.id, p.expr, String(p.label ?? "").slice(0, 100), whisper, socket);
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
      // Hit points never go below 0 (5e): extra damage doesn't stack up as negative HP
      if (p.hp !== undefined) fields.hp = p.hp === null || p.hp === "" ? null : Math.max(0, Math.round(Number(p.hp)) || 0);
      if (p.conditions !== undefined) fields.conditions = String(p.conditions).slice(0, 200);
      // Range rings (movement, reach, spell ranges, sight...) can be set by whoever controls the token
      if (Array.isArray(p.rings)) {
        fields.rings = JSON.stringify(p.rings.slice(0, 10).map((r: Row) => ({
          label: String(r.label ?? "").slice(0, 40),
          feet: Math.max(1, Math.min(2000, Math.round(Number(r.feet) || 5))),
          color: /^#[0-9a-f]{6}$/i.test(String(r.color)) ? r.color : "#e3b866",
          kind: r.kind === "sight" ? "sight" : "ring",
        })));
      }
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
      // Showing or hiding a token does the same to its place in the turn order
      if (fields.hidden !== undefined && fields.hidden !== t.hidden) {
        const c = one("SELECT initiative FROM campaigns WHERE id = ?", d.campaignId)!;
        const state = parseJSON<{ round: number; turn: number; entries: Row[] }>(c.initiative, { round: 1, turn: 0, entries: [] });
        if (state.entries.some((e) => e.tokenId === t.id)) {
          state.entries = state.entries.map((e) => (e.tokenId === t.id ? { ...e, hidden: !!fields.hidden } : e));
          run("UPDATE campaigns SET initiative = ? WHERE id = ?", JSON.stringify(state), d.campaignId);
          broadcastInitiative(d.campaignId);
        }
      }
      // A player character's token and sheet share the same current HP
      if (t.character_id && fields.hp != null) {
        const ch = one("SELECT data FROM characters WHERE id = ?", t.character_id);
        if (ch) {
          const data = parseJSON<Row>(ch.data, {});
          data.hp = { ...(data.hp ?? {}), current: fields.hp };
          run("UPDATE characters SET data = ? WHERE id = ?", JSON.stringify(data), t.character_id);
          run("UPDATE tokens SET hp = ? WHERE character_id = ?", fields.hp, t.character_id);
          notify(d.campaignId, "characters");
        }
      }
      broadcastMap(d.campaignId);
    });

    socket.on("token:delete", (id: number) => {
      if (!d.campaignId) return;
      const t = tokenOnActiveMap(Number(id), d.campaignId);
      if (!t || !(d.isDM || canMoveToken(t, d))) return;
      run("DELETE FROM tokens WHERE id = ?", t.id);
      broadcastMap(d.campaignId);
    });

    // ---- points of interest (DM only) ----
    socket.on("poi", (p: { op: "reveal" | "hide" | "delete" | "add" | "revealAll" | "hideAll"; id?: number; x?: number; y?: number; title?: string; note?: string }) => {
      if (!d.campaignId || !d.isDM) return;
      const c = one("SELECT active_map_id FROM campaigns WHERE id = ?", d.campaignId)!;
      if (!c.active_map_id) return;
      let pois = parseJSON<Row[]>(one("SELECT pois FROM maps WHERE id = ?", c.active_map_id)!.pois, []);
      if (p.op === "reveal" || p.op === "hide") pois = pois.map((x) => (x.id === p.id ? { ...x, revealed: p.op === "reveal" } : x));
      else if (p.op === "revealAll" || p.op === "hideAll") pois = pois.map((x) => ({ ...x, revealed: p.op === "revealAll" }));
      else if (p.op === "delete") pois = pois.filter((x) => x.id !== p.id);
      else if (p.op === "add") pois.push({ id: Math.max(0, ...pois.map((x) => x.id)) + 1, kind: "feature", label: "", title: String(p.title ?? "Note").slice(0, 80), note: String(p.note ?? "").slice(0, 1000), x: Number(p.x) || 0, y: Number(p.y) || 0, revealed: false });
      run("UPDATE maps SET pois = ? WHERE id = ?", JSON.stringify(pois.slice(0, 200)), c.active_map_id);
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
        // DM initiative rolls (monsters) are private; players' are public
        postChat(d.campaignId, d.user.id, "roll", { expression: r.expression, label: `${name} initiative`, total: r.total, detail: describeRoll(r), crit: r.crit, dice: diceList(r) }, d.isDM ? d.user.id : null);
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

// ---------- one-click monsters onto the map ----------

export interface MonsterDrop {
  meta?: Record<string, unknown>;
  name: string; count: number; hitPoints: number; hitDice?: string; rollHp?: boolean; size?: number; color?: string;
  hidden?: boolean; initiative?: "none" | "each" | "group"; dexMod?: number; x?: number; y?: number; imageUrl?: string | null;
}

const SIZE_CELLS: Record<string, number> = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
export const sizeToCells = (s: string) => SIZE_CELLS[String(s).toLowerCase()] ?? 1;

/** Places N tokens for a monster on the active map (and optionally rolls them into initiative). */
export function addMonsterTokens(campaignId: number, userId: number, m: MonsterDrop): number {
  const c = one("SELECT active_map_id, initiative FROM campaigns WHERE id = ?", campaignId)!;
  if (!c.active_map_id) throw new Error("Show a map on the table first (Maps tab → Show to players).");
  const map = one("SELECT * FROM maps WHERE id = ?", c.active_map_id)!;
  const count = Math.max(1, Math.min(20, Math.round(m.count) || 1));
  const g = map.grid_size || 70;
  const size = Math.min(6, Math.max(0.5, m.size ?? 1));
  const step = g * Math.max(1, size);
  const perRow = Math.min(count, 5);
  // Start from the given spot (or the middle of the map), laid out in a small block
  const x0 = (m.x ?? map.width / 2) - ((perRow - 1) * step) / 2;
  const y0 = m.y ?? map.height / 2;
  const state = parseJSON<{ round: number; turn: number; entries: Row[] }>(c.initiative, { round: 1, turn: 0, entries: [] });
  const dex = Math.round(m.dexMod ?? 0);
  const groupInit = m.initiative === "group" ? rollDice(`1d20${dex >= 0 ? "+" : ""}${dex}`).total : null;
  const dmId = dmIdOf(campaignId);
  for (let i = 0; i < count; i++) {
    let hp = Math.max(1, Math.round(m.hitPoints) || 1);
    if (m.rollHp && m.hitDice && /^\d+d\d+([+-]\d+)?$/.test(m.hitDice.replace(/\s/g, ""))) {
      try { hp = Math.max(1, rollDice(m.hitDice.replace(/\s/g, "")).total); } catch { /* keep the average */ }
    }
    const name = count > 1 ? `${m.name} ${i + 1}` : m.name;
    // line each token up with the grid
    const snapTo = (v: number, off: number) => (Math.round(size) % 2 === 0 ? Math.round((v - off) / g) * g + off : Math.floor((v - off) / g) * g + off + g / 2);
    const x = snapTo(x0 + (i % perRow) * step, map.grid_offset_x || 0), y = snapTo(y0 + Math.floor(i / perRow) * step, map.grid_offset_y || 0);
    const r = run(
      "INSERT INTO tokens (map_id, name, x, y, size, color, image_url, hidden, hp, max_hp, meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      map.id, name.slice(0, 60), x, y, size, m.color ?? "#7a2e1f", m.imageUrl ?? null, m.hidden ? 1 : 0, hp, hp, JSON.stringify(m.meta ?? {}),
    );
    if (m.initiative && m.initiative !== "none") {
      const init = groupInit ?? rollDice(`1d20${dex >= 0 ? "+" : ""}${dex}`).total;
      state.entries.push({ id: Date.now() + Math.random(), name, init, dex, hidden: !!m.hidden, ownerId: userId, tokenId: Number(r.lastInsertRowid) });
    }
  }
  if (m.initiative && m.initiative !== "none") {
    state.entries.sort((a, b) => b.init - a.init || (b.dex ?? 0) - (a.dex ?? 0));
    run("UPDATE campaigns SET initiative = ? WHERE id = ?", JSON.stringify(state), campaignId);
    postChat(campaignId, null, "text", { text: `🎲 Initiative rolled for ${count} × ${m.name}${groupInit != null ? ` (as a group: ${groupInit})` : ""}.` }, dmId);
    broadcastInitiative(campaignId);
  }
  broadcastMap(campaignId);
  return count;
}

/** Average hit points from a hit dice expression like "2d6" or "18d10+36". */
export function averageHp(expr: string, fallback: number) {
  const m = String(expr ?? "").replace(/\s/g, "").match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!m) return fallback;
  return Math.floor(Number(m[1]) * (Number(m[2]) + 1) / 2) + Number(m[3] ?? 0);
}

/** Movement, senses and attack ranges pulled from a stat block, for the range rings. */
export function monsterMeta(m: Row) {
  const speed = String(m.speed ?? "");
  const walk = Number(speed.match(/^(\d+)\s*ft/)?.[1] ?? speed.match(/walk\s*(\d+)/)?.[1] ?? 30);
  const other = [...speed.matchAll(/(fly|swim|climb|burrow)\s*(\d+)/g)].map((x) => ({ kind: x[1], feet: Number(x[2]) }));
  const senses = String(m.senses ?? "");
  const vision = [...senses.matchAll(/(darkvision|blindsight|tremorsense|truesight)\s*(\d+)/g)].map((x) => ({ kind: x[1], feet: Number(x[2]) }));
  const attacks: { name: string; reach?: number; normal?: number; long?: number }[] = [];
  for (const a of [...(m.actions ?? []), ...(m.bonus_actions ?? [])] as { name: string; description: string }[]) {
    const d = String(a.description ?? "");
    const reach = d.match(/reach\s*(\d+)\s*ft/);
    const range = d.match(/range\s*(\d+)(?:\/(\d+))?\s*ft/);
    if (reach || range) attacks.push({ name: a.name, reach: reach ? Number(reach[1]) : undefined, normal: range ? Number(range[1]) : undefined, long: range?.[2] ? Number(range[2]) : undefined });
  }
  return { speed: walk, otherSpeeds: other, vision, attacks: attacks.slice(0, 6) };
}
