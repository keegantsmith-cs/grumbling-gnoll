// Privacy and permission rules for the combat features, proven against a real server (REST + live sockets).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { io as ioClient, type Socket } from "socket.io-client";

const PORT = 4100 + Math.floor(Math.random() * 90);
const B = `http://localhost:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gnoll-combat-priv-"));
process.env.DATA_DIR = dataDir; // server modules imported inside tests read the same database
let server: ChildProcess;

class Client {
  cookie = "";
  async call(method: string, url: string, body?: unknown) {
    const r = await fetch(B + url, { method, headers: { "content-type": "application/json", cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, data };
  }
  get = (u: string) => this.call("GET", u);
  post = (u: string, b: unknown = {}) => this.call("POST", u, b);
  patch = (u: string, b: unknown) => this.call("PATCH", u, b);
  put = (u: string, b: unknown) => this.call("PUT", u, b);
}
const dm = new Client(), sam = new Client(), jo = new Client(), stranger = new Client();
let eveCampaignId = 0, campaignId = 0, mapId = 0, charId = 0, samTokenId = 0, joTokenId = 0, goblinId = 0, hiddenId = 0, dragonId = 0;

async function live(c: Client, campaign: number | null = campaignId) {
  const s: Socket = ioClient(`http://localhost:${PORT}`, { extraHeaders: { cookie: c.cookie }, transports: ["websocket"], forceNew: true });
  const events: { name: string; data: any }[] = [];
  s.onAny((name, data) => events.push({ name, data }));
  await new Promise<void>((ok, fail) => { s.on("connect", () => ok()); s.on("connect_error", (e) => { s.close(); fail(e); }); });
  if (campaign != null) { s.emit("join", campaign); await waitFor(() => events.some((e) => e.name === "chatHistory" || e.name === "toast")); }
  const ask = (name: string, payload: unknown) => new Promise<any>((ok) => s.emit(name, payload, ok));
  return { s, events, ask, last: (n: string) => [...events].reverse().find((e) => e.name === n)?.data, all: (n: string) => events.filter((e) => e.name === n).map((e) => e.data) };
}
type Live = Awaited<ReturnType<typeof live>>;
async function waitFor(fn: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 20)); }
}
const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const has = (x: unknown, s: string) => JSON.stringify(x ?? null).includes(s);
const tokenByName = (L: Live, name: string) => L.last("map")?.tokens?.find((t: any) => t.name === name);
const sharedChat = (L: Live) => [...(L.last("chatHistory") ?? []), ...L.all("chat")];
const close = (...ls: Live[]) => ls.forEach((l) => l.s.close());

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ANTHROPIC_API_KEY: "" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${B}/status`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  await dm.post("/register", { username: "keegan", password: "password1" });
  campaignId = (await dm.post("/campaigns", { name: "Privacy Test", rulesVersion: "2014" })).data.id;
  const code = (await dm.post("/invites", { uses: 2, campaignId })).data.code;
  await sam.post("/register", { username: "sam", displayName: "Sam", password: "password1", inviteCode: code });
  await jo.post("/register", { username: "joanna", displayName: "Jo", password: "password1", inviteCode: code });
  // an outsider who belongs to a different campaign only
  eveCampaignId = (await dm.post("/campaigns", { name: "Eve's table", rulesVersion: "2014" })).data.id;
  await stranger.post("/register", { username: "eve", displayName: "Eve", password: "password1", inviteCode: (await dm.post("/invites", { uses: 1, campaignId: eveCampaignId })).data.code });
  const data = {
    name: "Mirabel", hp: { max: 44, current: 44, temp: 0 }, classes: [{ name: "Fighter", subclass: "", level: 3 }], abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, saveProficiencies: ["str", "con"],
    attacks: [{ name: "Longsword", bonus: "", damage: "", notes: "" }],
    inventory: [{ name: "Chain Mail", qty: 1, weight: 55, equipped: true, attuned: false, notes: "" }],
  };
  charId = (await sam.post("/characters", { campaignId, data })).data.id;
  const joChar = (await jo.post("/characters", { campaignId, data: { ...data, name: "Tobin", hp: { max: 30, current: 30, temp: 0 } } })).data.id;
  for (const a of (await dm.get(`/campaigns/${campaignId}/approvals`)).data) await dm.post(`/changes/${a.id}/approve`, {});
  await dm.put(`/characters/${charId}/dm-notes`, { notes: "SECRET-DM-NOTE-XYZ" });
  mapId = (await dm.post(`/campaigns/${campaignId}/maps/generate`, { cols: 30, rows: 24, seed: 3, rooms: 6, theme: "stone", name: "Arena" })).data.id;
  await dm.post(`/campaigns/${campaignId}/active-map`, { mapId });
  await dm.patch(`/maps/${mapId}`, { fogEnabled: false });
  const D = await live(dm), S = await live(sam), J = await live(jo);
  S.s.emit("token:add", { name: "Mirabel", x: 200, y: 200, characterId: charId });
  J.s.emit("token:add", { name: "Tobin", x: 260, y: 200, characterId: joChar });
  await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: (await dm.get("/srd/monster/Goblin")).data, count: 1, initiative: "each", x: 400, y: 200 });
  await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: (await dm.get("/srd/monster/Orc")).data, count: 1, initiative: "each", hidden: true, x: 500, y: 200 });
  await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: (await dm.get("/srd/monster/Adult%20Red%20Dragon")).data, count: 1, initiative: "none", x: 600, y: 300 });
  await waitFor(() => D.last("map")?.tokens?.length === 5);
  samTokenId = tokenByName(D, "Mirabel").id; joTokenId = tokenByName(D, "Tobin").id;
  goblinId = tokenByName(D, "Goblin").id; dragonId = tokenByName(D, "Adult Red Dragon").id; hiddenId = tokenByName(D, "Orc").id;
  close(D, S, J);
});
after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const goblinAction = async (D: Live, name: string) => (await D.ask("combat:actor", { tokenId: goblinId })).actor.actions.find((a: any) => a.name === name);
const swordId = async (L: Live) => (await L.ask("combat:actor", { tokenId: samTokenId })).actor.actions.find((a: any) => a.name === "Longsword").id;

test("tokens: players never get a monster's AC, HP, stat block, concentration or timers, nor hidden tokens, in any payload", async () => {
  const D = await live(dm), S = await live(sam);
  await D.ask("combat:set", { tokenId: goblinId, concentrating: "Hold Person" });
  await D.ask("combat:condition", { tokenId: goblinId, name: "Poisoned", ends: { kind: "rounds", rounds: 3 } });
  await D.ask("combat:apply", { targets: [{ tokenId: goblinId, amount: 4 }] });
  await pause();
  const m = S.last("map");
  const g = m.tokens.find((t: any) => t.name === "Goblin");
  assert.equal(g.ac, undefined); assert.equal(g.hp, null); assert.equal(g.maxHp, null); assert.equal(g.tempHp, 0);
  assert.equal(g.concentrating, undefined); assert.equal(g.combat, undefined); assert.equal(g.effects, undefined); assert.deepEqual(g.meta, {});
  assert.equal(g.health, "bloodied");
  assert.equal(has(S.all("map"), "Hold Person"), false);
  assert.equal(has(S.all("map"), "Scimitar"), false);
  assert.equal(has(S.all("map"), "Orc"), false);
  assert.equal(m.tokens.some((t: any) => t.id === hiddenId), false);
  // the DM has all of it
  const gd = tokenByName(D, "Goblin");
  assert.equal(gd.ac, 15); assert.equal(gd.concentrating, "Hold Person");
  // the initiative the player gets never names the hidden orc
  assert.equal(has(S.all("initiative"), "Orc"), false);
  assert.equal(has(S.all("initiative"), "\"hidden\":true"), true); // shown as ???
  close(D, S);
});

test("character notes: the DM-only notes never come with the actor or map data", async () => {
  const D = await live(dm), S = await live(sam);
  assert.equal(has((await S.ask("combat:actor", { tokenId: samTokenId })), "SECRET-DM-NOTE"), false);
  assert.equal(has(S.events, "SECRET-DM-NOTE"), false);
  close(D, S);
});

test("who may call: outsiders, other campaigns, and players on tokens that aren't theirs get errors and change nothing", async () => {
  const S = await live(sam), J = await live(jo), X = await live(stranger, null);
  // Eve connects but never joined: no campaign, so everything is refused
  for (const ev of ["combat:actor", "combat:roll", "combat:do", "combat:heal", "combat:death", "combat:condition", "combat:set"]) {
    assert.ok((await X.ask(ev, { tokenId: samTokenId, key: "dash", kind: "check", ability: "str", name: "Prone", amount: 5, concentrating: "x" })).error, ev);
  }
  assert.ok((await X.ask("combat:apply", { targets: [{ tokenId: goblinId, amount: 5 }] })).error);
  // A real campaign member of another campaign (Eve makes her own and joins it) can't reach this one's tokens
  const E = await live(stranger, eveCampaignId);
  assert.ok((await E.ask("combat:actor", { tokenId: goblinId })).error);
  assert.ok((await E.ask("combat:roll", { tokenId: samTokenId, kind: "check", ability: "str" })).error);
  assert.ok((await E.ask("combat:apply", { targets: [{ tokenId: goblinId, amount: 5 }] })).error);
  // and can't join this campaign's table to begin with
  const blocked = await live(stranger, null);
  blocked.s.emit("join", campaignId);
  await pause();
  assert.equal(blocked.all("map").length, 0);
  close(E, blocked);
  // Jo can't touch Sam's character, nor a monster, nor the hidden orc, with any of the events
  const attempts: [string, any][] = [
    ["combat:actor", {}], ["combat:roll", { kind: "check", ability: "str" }], ["combat:do", { key: "dash" }], ["combat:heal", { amount: 5 }],
    ["combat:heal", { amount: 5, temp: true }], ["combat:death", {}], ["combat:condition", { name: "Prone" }], ["combat:set", { concentrating: "Bless", ac: 1 }],
  ];
  const errors = new Set<string>();
  for (const id of [samTokenId, goblinId, hiddenId, dragonId, 999999]) {
    for (const [ev, extra] of attempts) { const r = await J.ask(ev, { tokenId: id, ...extra }); assert.ok(r.error, `${ev} on ${id}`); errors.add(r.error); }
    const ap = await J.ask("combat:apply", { targets: [{ tokenId: id, amount: 50 }] });
    assert.ok(ap.error, `apply on ${id}`); errors.add(ap.error);
  }
  // a hidden token gives the same answer as one that doesn't exist: no way to probe for it
  assert.equal((await J.ask("combat:actor", { tokenId: hiddenId })).error, (await J.ask("combat:actor", { tokenId: 999999 })).error);
  assert.equal((await J.ask("combat:apply", { targets: [{ tokenId: hiddenId, amount: 1 }] })).error, (await J.ask("combat:apply", { targets: [{ tokenId: 999999, amount: 1 }] })).error);
  await pause();
  const D = await live(dm);
  assert.equal(tokenByName(D, "Mirabel").hp, 44);
  assert.equal(tokenByName(D, "Goblin").ac, 15);
  assert.equal((await D.ask("combat:actor", { tokenId: hiddenId })).actor.hp, (await D.ask("combat:actor", { tokenId: hiddenId })).actor.maxHp);
  // players can't set a monster's AC even on a token they control
  await D.ask("combat:set", { tokenId: samTokenId, ac: 3 });
  await S.ask("combat:set", { tokenId: samTokenId, ac: 3 });
  assert.equal(tokenByName(D, "Mirabel").ac, 16);
  // the sheets can't be changed by non-owners either (REST)
  assert.equal((await jo.patch(`/characters/${charId}/play`, { hp: { current: 1 } })).status >= 400, true);
  assert.equal((await jo.get(`/characters/${charId}`)).data.dmNotes, undefined);
  close(S, J, D, X);
});

test("bad input: NaN, huge numbers, junk payloads and 1000 targets don't crash the server or get past limits", async () => {
  const D = await live(dm), S = await live(sam);
  for (const bad of [undefined, null, 5, "x", [], { tokenId: "abc" }, { tokenId: NaN }, { tokenId: {} }]) {
    for (const ev of ["combat:actor", "combat:roll", "combat:do", "combat:heal", "combat:death", "combat:condition", "combat:set", "combat:apply"]) {
      await D.ask(ev, bad); await S.ask(ev, bad);
    }
  }
  // 1000 targets: at most 20 are looked at, and the answer comes back
  const many = Array.from({ length: 1000 }, () => ({ tokenId: samTokenId, amount: 1 }));
  const r = await S.ask("combat:apply", { targets: many });
  assert.ok(r.results.length <= 20);
  await S.ask("combat:heal", { tokenId: samTokenId, amount: 100 });
  // absurd numbers are clamped
  await S.ask("combat:heal", { tokenId: samTokenId, amount: "1e999", temp: true });
  await S.ask("combat:apply", { targets: [{ tokenId: samTokenId, amount: "1e999" }] });
  const sheet = (await sam.get(`/characters/${charId}`)).data;
  assert.ok(Number.isFinite(sheet.data.hp.temp) && sheet.data.hp.temp <= 9999);
  assert.ok(Number.isFinite(sheet.data.hp.current) && sheet.data.hp.current >= 0);
  // dice picks that make no sense, huge DCs, prototype-pollution-ish keys
  const id = await swordId(S);
  assert.ok((await S.ask("combat:roll", { tokenId: samTokenId, kind: "hack" })).error);
  assert.ok((await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: "__proto__" })).error);
  assert.equal((await S.ask("combat:roll", { tokenId: samTokenId, kind: "check", ability: "str", dc: 1e99, manual: 1e99 })).ok, true);
  assert.ok((await S.ask("combat:roll", { tokenId: samTokenId, kind: "check", ability: "constructor" })).error);
  const breath = (await D.ask("combat:actor", { tokenId: dragonId })).actor.actions.find((a: any) => a.name === "Fire Breath");
  const poll = await D.ask("combat:roll", { tokenId: dragonId, kind: "saveall", actionId: breath.id, targetIds: [goblinId, ...Array(500).fill(samTokenId)], manualSaves: JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1}}') });
  assert.ok(poll.ok);
  assert.equal(poll.rows.length, 2);
  assert.equal(({} as any).polluted, undefined);
  assert.ok((await D.ask("combat:roll", { tokenId: dragonId, kind: "saveall", actionId: breath.id, targetIds: [goblinId], manualSaves: "boom" })).ok);
  assert.ok(id);
  // the server is still answering
  assert.equal((await dm.get("/status")).status, 200);
  await D.ask("combat:heal", { tokenId: samTokenId, amount: 100 });
  close(D, S);
});

test("targets: a player can't aim at hidden tokens, tokens in fog, or tokens on another map of the campaign", async () => {
  const S = await live(sam);
  const id = await swordId(S);
  // hidden orc
  assert.equal((await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: hiddenId, manual: 15 })).targetId, null);
  // a monster waiting on a different map that isn't being shown
  const map2 = (await dm.post(`/campaigns/${campaignId}/maps/generate`, { cols: 20, rows: 20, seed: 9, rooms: 3, theme: "stone", name: "Next dungeon" })).data.id;
  await dm.patch(`/maps/${map2}`, { fogEnabled: false });
  await dm.post(`/campaigns/${campaignId}/active-map`, { mapId: map2 });
  await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: (await dm.get("/srd/monster/Wolf")).data, count: 1, initiative: "none", name: "SpoilerWolf" });
  await dm.post(`/campaigns/${campaignId}/active-map`, { mapId });
  const D = await live(dm);
  await dm.post(`/campaigns/${campaignId}/active-map`, { mapId: map2 });
  await waitFor(() => !!tokenByName(D, "SpoilerWolf"));
  const wolfId = tokenByName(D, "SpoilerWolf").id;
  await dm.post(`/campaigns/${campaignId}/active-map`, { mapId });
  await pause();
  const r = await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: wolfId, manual: 15 });
  assert.equal(r.targetId, null);
  assert.equal(r.outcome, "unknown");
  assert.equal(has(sharedChat(S), "SpoilerWolf"), false);
  assert.ok((await S.ask("combat:apply", { targets: [{ tokenId: wolfId, amount: 5 }] })).error);
  assert.ok((await D.ask("combat:actor", { tokenId: wolfId })).error); // not on the table now, even for the DM
  // fog: a goblin standing in fog can't be targeted, named in turn-by-turn chat, or narrated
  await dm.patch(`/maps/${mapId}`, { fogEnabled: true });
  await pause();
  const fogged = await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, manual: 15 });
  assert.equal(fogged.targetId, null);
  assert.equal(tokenByName(S, "Goblin"), undefined);
  const combat = await import("../server/combat.ts");
  process.env.DATA_DIR = dataDir;
  assert.equal(has(combat.narrationFacts(campaignId, { kind: "kill", attackerId: samTokenId, targetId: goblinId }), "Goblin"), false);
  // the DM "dashing" with a goblin in the fog doesn't announce it to the players
  D.s.emit("combat:do", { tokenId: goblinId, key: "dash" });
  await pause();
  assert.equal(has(sharedChat(S), "Goblin"), false);
  await dm.patch(`/maps/${mapId}`, { fogEnabled: false });
  close(S, D);
});

test("rolls: a player's secret attack never carries the target's AC, and a DM-shown roll never does either", async () => {
  const S = await live(sam), D = await live(dm);
  const id = await swordId(S);
  await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, manual: 10, secret: true });
  await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, manual: 10 });
  await pause();
  const mine = sharedChat(S).filter((m) => has(m.body, "Longsword") && m.kind === "roll");
  assert.ok(mine.length >= 2);
  for (const m of mine) assert.equal(m.body.combat.ac, undefined);
  // (the DM's own whispered monster rolls do carry the AC: see combat-api.test.ts)
  close(S, D);
});

test("rolls: saving throws against monsters show only saved/failed to players, and players can't type in a monster's die", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  const breath = (await D.ask("combat:actor", { tokenId: dragonId })).actor.actions.find((a: any) => a.name === "Fire Breath");
  // the DM's own roll is private: players see nothing; the DM sees the numbers
  const secret = await D.ask("combat:roll", { tokenId: dragonId, kind: "saveall", actionId: breath.id, targetIds: [goblinId, samTokenId], manualSaves: { [goblinId]: 12 } });
  const gobRow = secret.rows.find((r: any) => r.id === goblinId);
  assert.equal(gobRow.natural, 12);
  await pause();
  assert.equal(has(sharedChat(S), "Fire Breath"), false);
  // shown to the table: the goblin's dice and total stay with the DM, the PC's are shown
  const shown = await D.ask("combat:roll", { tokenId: dragonId, kind: "saveall", actionId: breath.id, targetIds: [goblinId, samTokenId], show: true, manualSaves: { [goblinId]: 12, [samTokenId]: 9 } });
  await waitFor(() => has(S.all("chat"), "Fire Breath"));
  const body = S.all("chat").find((m) => has(m.body, "Fire Breath")).body;
  const g = body.combat.rows.find((r: any) => r.id === goblinId), m = body.combat.rows.find((r: any) => r.id === samTokenId);
  assert.equal(g.total, null); assert.equal(g.natural, null);
  assert.equal(m.natural, 9);
  assert.equal(has(body.detail, "Goblin: ") && /Goblin: \d/.test(body.detail), false);
  assert.equal(shown.rows.find((r: any) => r.id === goblinId).total, null);
  // a player who controls the dragon (handed to them) can't type in the goblin's result: it's rolled for real
  const samId = ((await sam.get("/users")).data as any[]).find((u) => u.username === "sam").id;
  D.s.emit("token:update", { id: dragonId, controlledBy: samId });
  await pause(300);
  let allSaved = true;
  for (let i = 0; i < 8; i++) {
    const r = await S.ask("combat:roll", { tokenId: dragonId, kind: "saveall", actionId: breath.id, targetIds: [goblinId], manualSaves: { [goblinId]: 20 } });
    if (r.error) { allSaved = false; break; }
    allSaved = allSaved && r.rows[0].success; // a typed 20 would pass a DC 21 Dex save (+2) every time
    assert.equal(r.rows[0].total, null);
  }
  assert.equal(allSaved, false);
  D.s.emit("token:update", { id: dragonId, controlledBy: null });
  await pause();
  close(D, S, J);
});

test("damage and reminders: monster numbers only to the DM, characters' numbers to everyone, history and export agree", async () => {
  const D = await live(dm), S = await live(sam);
  await D.ask("combat:apply", { targets: [{ tokenId: goblinId, amount: 2 }, { tokenId: hiddenId, amount: 3 }, { tokenId: samTokenId, amount: 5 }] });
  await D.ask("combat:heal", { tokenId: goblinId, amount: 1 });
  await D.ask("combat:heal", { tokenId: goblinId, amount: 2, temp: true });
  await D.ask("combat:condition", { tokenId: goblinId, name: "Frightened", ends: { kind: "end" } });
  D.s.emit("initiative", { op: "next" }); D.s.emit("initiative", { op: "next" }); D.s.emit("initiative", { op: "next" }); D.s.emit("initiative", { op: "next" });
  await pause(400);
  const J = await live(jo); // joins late: sees only what the history lets them
  const publicHistory = [...sharedChat(S), ...(J.last("chatHistory") ?? [])];
  assert.equal(publicHistory.some((m) => /Goblin takes|Orc takes|Goblin regains|Goblin has \d+ temp|Frightened|Orc/.test(JSON.stringify(m.body))), false);
  assert.ok(publicHistory.some((m) => /Mirabel takes 5 damage.*HP \d+\/44/.test(m.body.text ?? ""))); // a PC's numbers are open
  assert.ok(D.all("chat").some((m) => /Goblin takes 2 .*\(\d+\/7 HP\)/.test(m.body.text ?? "") && m.whisperTo != null));
  // chat export: the player's copy has none of it, the DM's has it
  const exp = (await sam.get(`/campaigns/${campaignId}/chat/export`)).data as string;
  assert.equal(/Goblin takes|Orc takes/.test(exp), false);
  assert.match((await dm.get(`/campaigns/${campaignId}/chat/export`)).data, /Goblin takes 2/);
  // every chat line in the database that names a monster's damage is a whisper
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path.join(dataDir, "grumbling-gnoll.db"), { readonly: true });
  const rows = db.prepare("SELECT body, whisper_to FROM chat WHERE whisper_to IS NULL").all() as any[];
  db.close();
  assert.equal(rows.some((r) => /Goblin takes|Orc takes|\/7 HP|Orc/.test(r.body)), false);
  // "applied" updates for a whispered DM roll aren't pushed to players
  const adv = await D.ask("combat:roll", { tokenId: goblinId, kind: "attack", actionId: (await goblinAction(D, "Scimitar")).id, targetId: samTokenId, manual: 20, withDamage: true });
  assert.ok(adv.ok);
  await waitFor(() => D.all("chat").some((m) => m.body.combat?.apply));
  const withApply = [...D.all("chat")].reverse().find((m) => m.body.combat?.apply);
  const before = S.all("chat:update").length;
  await D.ask("combat:apply", { msgId: withApply.id, targets: [{ tokenId: samTokenId, amount: 1 }] });
  await pause();
  assert.equal(S.all("chat:update").length, before);
  assert.equal(has(S.events, "Scimitar"), false);
  D.s.emit("initiative", { op: "clear" });
  close(D, S, J);
});

test("turn order: players can't attach their entry to a monster, and hidden entries show as ???", async () => {
  const D = await live(dm), S = await live(sam);
  S.s.emit("initiative", { op: "add", name: "Sneaky", init: 5, tokenId: goblinId });
  await pause();
  const entry = (D.last("initiative").entries as any[]).find((e) => e.name === "Sneaky");
  assert.ok(entry);
  assert.equal(entry.tokenId, null);
  D.s.emit("initiative", { op: "roll", name: "Ghost", bonus: 0, hidden: true, tokenId: hiddenId });
  await pause();
  assert.equal(has(S.last("initiative"), "Ghost"), false);
  assert.equal(has(S.last("initiative"), "Orc"), false);
  D.s.emit("initiative", { op: "clear" });
  close(D, S);
});

test("recaps and Discord: whispered combat text never reaches the players' recap or a webhook", async () => {
  process.env.DATA_DIR = dataDir;
  const { chatLog } = await import("../server/routes/recaps.ts");
  const log = chatLog(campaignId, 0, null);
  assert.match(log.text, /Goblin/); // the DM's own copy keeps it
  assert.equal(/Goblin takes|Orc takes|\/7 HP|Orc/.test(log.publicText), false);
  assert.equal(has(log.publicText, "[private]"), false);
  // Discord: whispered messages return before anything is sent
  const discord = await import("../server/discord.ts");
  const { run } = await import("../server/db.ts");
  run("UPDATE campaigns SET discord_webhook = ? WHERE id = ?", "https://discord.com/api/webhooks/123/abc", campaignId);
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_u: any, init: any) => { sent.push(String(init?.body)); return new Response("{}", { status: 204 }); }) as typeof fetch;
  try {
    discord.discordChat(campaignId, "Keegan", "roll", { label: "Goblin: Scimitar attack", total: 17, detail: "AC 15", expression: "d20" }, true);
    discord.discordChat(campaignId, "Keegan", "text", { text: "Goblin takes 2 (5/7 HP)" }, true);
    await pause(150);
    assert.equal(sent.length, 0);
    discord.discordChat(campaignId, "Sam", "roll", { label: "Mirabel: Longsword attack", total: 12, detail: "d20", expression: "d20" }, false);
    await pause(150);
    assert.equal(sent.length, 1);
  } finally {
    globalThis.fetch = realFetch;
    run("UPDATE campaigns SET discord_webhook = '' WHERE id = ?", campaignId);
  }
});

test("narration: DM only, and the AI request never holds hidden or fogged monsters, numbers or DM notes", async () => {
  process.env.DATA_DIR = dataDir;
  const ev = { kind: "kill", attackerId: samTokenId, targetId: hiddenId };
  assert.equal((await sam.post(`/campaigns/${campaignId}/ai/narrate`, { event: ev })).status, 403);
  assert.equal((await jo.post(`/campaigns/${campaignId}/ai/narrate`, { event: ev })).status, 403);
  assert.ok([401, 403, 404].includes((await new Client().post(`/campaigns/${campaignId}/ai/narrate`, { event: ev })).status));
  const eve = await stranger.post(`/campaigns/${campaignId}/ai/narrate`, { event: ev });
  assert.ok(eve.status === 403 || eve.status === 404);
  // a stranger's own campaign can't be used to read this campaign's tokens either
  const combat = await import("../server/combat.ts");
  await dm.patch(`/campaigns/${campaignId}`, { dmNotes: "Orc secretly the duke's son" });
  const facts = combat.narrationFacts(campaignId, { kind: "hit", attackerId: hiddenId, targetId: goblinId, action: "Greataxe" });
  assert.equal(/Orc|duke|\bAC\b|\bHP\b|hit points:/i.test(facts), false);
  assert.equal(has(combat.narrationFacts(campaignId, { kind: "hit", attackerId: samTokenId, targetId: 999999 }), "undefined"), false);
});
