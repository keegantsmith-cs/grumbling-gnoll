// Starts a real server on a spare port with an empty database and checks the important flows and privacy rules.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3900 + Math.floor(Math.random() * 90);
const B = `http://localhost:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gnoll-test-"));
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
  put = (u: string, b: unknown) => this.call("PUT", u, b);
  patch = (u: string, b: unknown) => this.call("PATCH", u, b);
}

const dm = new Client(), sam = new Client(), jo = new Client();
let campaignId = 0, charId = 0;

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ANTHROPIC_API_KEY: "" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${B}/status`); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("server didn't start");
});
after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("first account becomes admin; others need an invite", async () => {
  assert.equal((await dm.post("/register", { username: "keegan", password: "password1" })).status, 200);
  assert.equal((await sam.post("/register", { username: "sam", password: "password1" })).status, 400);
});

test("campaign invite signs a player up straight into the campaign", async () => {
  campaignId = (await dm.post("/campaigns", { name: "Test Campaign", rulesVersion: "2014" })).data.id;
  const code = (await dm.post("/invites", { uses: 2, campaignId })).data.code;
  assert.equal((await sam.post("/register", { username: "sam", displayName: "Sam", password: "password1", inviteCode: code })).status, 200);
  assert.equal((await jo.post("/register", { username: "joanna", displayName: "Jo", password: "password1", inviteCode: code })).status, 200);
  const members = (await dm.get(`/campaigns/${campaignId}`)).data.members.map((m: any) => m.displayName);
  assert.ok(members.includes("Sam") && members.includes("Jo"));
});

test("player's new character waits for the DM, then is approved", async () => {
  charId = (await sam.post("/characters", { campaignId, data: { name: "Mirabel" } })).data.id;
  assert.equal((await sam.get(`/characters/${charId}`)).data.status, "pending");
  const approvals = (await dm.get(`/campaigns/${campaignId}/approvals`)).data;
  assert.equal(approvals.length, 1);
  assert.equal((await dm.post(`/changes/${approvals[0].id}/approve`, {})).status, 200);
  assert.equal((await sam.get(`/characters/${charId}`)).data.status, "approved");
});

test("DM-only notes are never sent to players", async () => {
  await dm.put(`/characters/${charId}/dm-notes`, { notes: "Secret heir" });
  assert.equal((await dm.get(`/characters/${charId}`)).data.dmNotes, "Secret heir");
  const forOwner = await sam.get(`/characters/${charId}`);
  assert.equal(JSON.stringify(forOwner.data).includes("Secret heir"), false);
  assert.equal((await sam.put(`/characters/${charId}/dm-notes`, { notes: "x" })).status, 403);
});

test("suggestions: player and DM only, not other players", async () => {
  assert.equal((await dm.post(`/characters/${charId}/suggestions`, { text: "Try the Lucky feat" })).status, 200);
  assert.equal((await sam.get(`/characters/${charId}/suggestions`)).data.length, 1);
  assert.equal((await jo.get(`/characters/${charId}/suggestions`)).status, 404);
  // Jo can see the approved sheet, but nothing secret is in it
  const forJo = await jo.get(`/characters/${charId}`);
  assert.equal(forJo.status, 200);
  assert.equal(JSON.stringify(forJo.data).includes("Lucky feat") || JSON.stringify(forJo.data).includes("Secret heir"), false);
});

test("NPC stat blocks are hidden from players", async () => {
  await dm.post(`/campaigns/${campaignId}/compendium`, { kind: "npc", name: "Grukk", data: { markdown: "Innkeeper", statblock: { name: "Grukk", hit_points: 58 } }, playerVisible: true });
  const forPlayer = (await sam.get(`/campaigns/${campaignId}/compendium`)).data;
  assert.equal(forPlayer[0].name, "Grukk");
  assert.equal(forPlayer[0].data.statblock, undefined);
});

test("the DM can hand a character to another player", async () => {
  const pregen = (await dm.post("/characters", { campaignId, data: { name: "Pregen" } })).data.id;
  const joId = (await jo.get("/status")).data.user.id;
  assert.equal((await sam.post(`/characters/${pregen}/owner`, { userId: joId })).status, 403);
  assert.equal((await dm.post(`/characters/${pregen}/owner`, { userId: joId })).status, 200);
  assert.equal((await jo.get(`/characters/${pregen}`)).data.canEdit, true);
});

test("character creator rolls are recorded for the DM", async () => {
  const roll = (await sam.post("/characters/creator-roll", { kind: "abilities", campaignId })).data;
  assert.equal(roll.values.length, 6);
  for (const v of roll.values) assert.ok(v >= 3 && v <= 18);
  const id = (await sam.post("/characters", { campaignId, data: { name: "Rolled" }, rollIds: [roll.rollId] })).data.id;
  const approval = (await dm.get(`/campaigns/${campaignId}/approvals`)).data.find((a: any) => a.characterId === id);
  assert.ok(approval.note.includes(roll.values.join(", ")));
});

test("SRD lookup works", async () => {
  const r = (await sam.get("/srd/search?type=spell&q=fireball")).data;
  assert.equal(r[0].name, "Fireball");
  assert.equal(r[0].level, 3);
});

test("only the admin can download backups", async () => {
  assert.equal((await sam.get("/admin/backup")).status, 403);
  assert.equal((await dm.get("/admin/backup")).status, 200);
});

test("too many wrong passwords are slowed down", async () => {
  const c = new Client();
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await c.post("/login", { username: "joanna", password: "nope" })).status;
  assert.equal(last, 429);
});

test("items not in the SRD: player drafts are private until the DM approves; close SRD matches work", async () => {
  assert.equal((await sam.get("/srd/magic/Onyx%20Dog%20(figurine)")).data.name, "Onyx Dog Figurine of Wondrous Power");
  const r = (await sam.post(`/campaigns/${campaignId}/compendium/custom`, { kind: "item", name: "Grukk's Lucky Tankard", data: { description: "Never spills." } })).data;
  assert.equal(r.status, "draft");
  assert.equal((await sam.get(`/campaigns/${campaignId}/compendium/lookup?kind=item&name=grukks%20lucky%20tankard`)).data.name, "Grukk's Lucky Tankard");
  assert.equal((await jo.get(`/campaigns/${campaignId}/compendium/lookup?kind=item&name=grukks%20lucky%20tankard`)).data, null);
  await dm.patch(`/compendium/${r.id}`, { status: "approved" });
  assert.equal((await jo.get(`/campaigns/${campaignId}/compendium/lookup?kind=item&name=lucky%20tankard`)).data.name, "Grukk's Lucky Tankard");
});

// ---------------------------------------------------------------------------
// Privacy & permission rules: each test proves one rule with real requests / live socket events.
// ---------------------------------------------------------------------------
import { io as ioClient, type Socket } from "socket.io-client";
import { generateDungeon } from "../shared/mapgen.ts";

const eve = new Client(); // logged in, but not in the campaign
let mapId = 0, hiddenTokenId = 0, samTokenId = 0;

/** A live table connection for a client, joined to a campaign. Collects every event it receives. */
async function live(c: Client, cid = campaignId) {
  const s: Socket = ioClient(`http://localhost:${PORT}`, { extraHeaders: { cookie: c.cookie }, transports: ["websocket"], forceNew: true });
  const events: { name: string; data: any }[] = [];
  s.onAny((name, data) => events.push({ name, data }));
  await new Promise<void>((ok, fail) => { s.on("connect", () => ok()); s.on("connect_error", (e) => { s.close(); fail(e); }); });
  s.emit("join", cid);
  await waitFor(() => events.some((e) => e.name === "chatHistory" || e.name === "toast"));
  const last = (name: string) => [...events].reverse().find((e) => e.name === name)?.data;
  return { s, events, last, all: (name: string) => events.filter((e) => e.name === name).map((e) => e.data) };
}
async function waitFor(fn: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 20)); }
}
const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const has = (x: unknown, s: string) => JSON.stringify(x ?? null).includes(s);

test("strangers: someone outside the campaign can't see or join it", async () => {
  const code = (await dm.post("/invites", { uses: 1 })).data.code;
  assert.equal((await eve.post("/register", { username: "eve", password: "password1", inviteCode: code })).status, 200);
  assert.equal((await eve.get(`/campaigns/${campaignId}`)).status, 404);
  assert.equal((await eve.get(`/characters/${charId}`)).status, 404);
  assert.equal((await eve.get(`/characters?campaignId=${campaignId}`)).status, 404);
  assert.equal((await eve.get(`/campaigns/${campaignId}/compendium`)).status, 404);
  assert.equal((await eve.get(`/campaigns/${campaignId}/chat/export`)).status, 404);
  assert.equal((await eve.get(`/campaigns/${campaignId}/recaps`)).status, 404);
  assert.equal((await eve.post(`/characters`, { campaignId, data: { name: "Spy" } })).status, 404);
  assert.equal((await eve.get("/campaigns")).data.length, 0);
  const t = await live(eve);
  assert.equal(t.last("toast"), "You're not in that campaign");
  assert.equal(t.all("chatHistory").length, 0);
  t.s.close();
  // Not logged in at all: no API, no live table, no uploaded files
  const anon = new Client();
  assert.equal((await anon.get(`/campaigns`)).status, 401);
  assert.equal((await fetch(`http://localhost:${PORT}/uploads/abc.png`)).status, 401);
  await assert.rejects(live(anon));
});

test("campaign DM notes and Discord webhook links stay with the DM", async () => {
  const hook = "https://discord.com/api/webhooks/123456/secret-token_abc";
  assert.equal((await dm.patch(`/campaigns/${campaignId}`, { dmNotes: "The innkeeper is a lich", discord: { webhook: hook, dmWebhook: "", options: { chat: true } } })).status, 200);
  assert.equal((await dm.get(`/campaigns/${campaignId}`)).data.dmNotes, "The innkeeper is a lich");
  for (const r of [await sam.get(`/campaigns/${campaignId}`), await sam.get("/campaigns")]) {
    assert.equal(r.status, 200);
    assert.equal(has(r.data, "lich") || has(r.data, "secret-token"), false);
  }
  assert.equal((await sam.patch(`/campaigns/${campaignId}`, { dmNotes: "hacked" })).status, 403);
  // Turn Discord back off so the rest of the tests don't try to post to it
  await dm.patch(`/campaigns/${campaignId}`, { discord: { webhook: "", dmWebhook: "", options: {} } });
});

test("DM-only pages refuse players", async () => {
  for (const url of ["/maps", "/adventures", "/adventure-maps", "/encounters", "/approvals", "/conversions", "/compendium/duplicates", "/ai/history", "/ai/usage"])
    assert.equal((await sam.get(`/campaigns/${campaignId}${url}`)).status, 403, url);
  assert.equal((await sam.post(`/campaigns/${campaignId}/compendium`, { kind: "npc", name: "x" })).status, 403);
  assert.equal((await sam.post(`/campaigns/${campaignId}/share`, { text: "x" })).status, 403);
  assert.equal((await sam.post(`/campaigns/${campaignId}/members`, { username: "eve" })).status, 403);
  assert.equal((await sam.post(`/campaigns/${campaignId}/table/monsters`, { monster: { name: "Goblin" } })).status, 403);
});

test("admin-only: AI settings, costs, invites, password resets and backups", async () => {
  assert.equal((await sam.get("/ai/settings")).status, 403);
  assert.equal((await sam.put("/ai/settings", { capUSD: 9999 })).status, 403);
  assert.equal((await sam.get("/invites")).status, 403);
  assert.equal((await sam.post("/invites", { uses: 5 })).status, 403);
  assert.equal((await sam.post(`/users/1/reset-password`, { password: "password2" })).status, 403);
  assert.equal((await dm.get("/ai/settings")).status, 200);
});

test("players can't edit, take over or peek at other players' characters", async () => {
  // Jo vs Sam's approved character
  assert.equal((await jo.put(`/characters/${charId}`, { data: { name: "Stolen" } })).status, 403);
  assert.equal((await jo.patch(`/characters/${charId}/play`, { hp: { current: 0 } })).status, 403);
  assert.equal((await jo.call("DELETE", `/characters/${charId}`)).status, 403);
  assert.equal((await jo.get(`/characters/${charId}/history`)).status, 403);
  assert.equal((await jo.post(`/characters/${charId}/suggestions`, { text: "x" })).status, 404);
  assert.equal((await jo.post(`/characters/${charId}/import`, { campaignId })).status, 403);
  // A character still waiting for approval is only for its player and the DM
  const pendingId = (await sam.post("/characters", { campaignId, data: { name: "Secret Alt" } })).data.id;
  assert.equal((await jo.get(`/characters/${pendingId}`)).status, 404);
  assert.equal((await jo.get(`/characters/${pendingId}/pdf`)).status, 404);
  assert.equal(has((await jo.get(`/characters?campaignId=${campaignId}`)).data, "Secret Alt"), false);
  assert.equal((await sam.get(`/characters/${pendingId}`)).status, 200);
  assert.equal((await dm.get(`/characters/${pendingId}`)).status, 200);
  // Only the DM approves
  const ch = (await dm.get(`/campaigns/${campaignId}/approvals`)).data.find((a: any) => a.characterId === pendingId);
  assert.equal((await sam.post(`/changes/${ch.id}/approve`, {})).status, 404);
  assert.equal((await sam.get(`/characters/${pendingId}`)).data.status, "pending");
});

test("DM notes and suggestions never reach the AI prompts that players read", async () => {
  process.env.DATA_DIR = dataDir;
  const { publicCampaignContext, campaignContext } = await import("../server/helpers.ts");
  await dm.put(`/characters/${charId}/dm-notes`, { notes: "Line one\n- Secret heir to the throne" });
  const full = campaignContext(campaignId), pub = publicCampaignContext(campaignId);
  assert.ok(full.party.includes("Secret heir") && full.dmNotes.includes("lich"), "the DM's own AI still knows everything");
  assert.ok(pub.party.includes("Mirabel"));
  assert.equal(has(pub, "Secret heir") || has(pub, "lich") || has(pub, "Lucky feat"), false);
  assert.equal(pub.adventure, undefined);
});

test("NPC stat blocks don't leak through Compendium lookup or search", async () => {
  await dm.post(`/campaigns/${campaignId}/compendium`, { kind: "npc", name: "Vorna", data: { markdown: "A guard", statblock: { hit_points: 77 }, statReference: "Veteran p.350" }, playerVisible: true });
  const look = (await sam.get(`/campaigns/${campaignId}/compendium/lookup?kind=npc&name=vorna`)).data;
  assert.equal(look.name, "Vorna");
  assert.equal(look.data.statblock, undefined);
  assert.equal(look.data.statReference, undefined);
  const found = (await sam.get(`/campaigns/${campaignId}/compendium/search?kind=npc&q=vorna`)).data;
  assert.equal(found.length, 1);
  assert.equal(has(found, "hit_points") || has(found, "Veteran"), false);
  assert.equal((await dm.get(`/campaigns/${campaignId}/compendium/lookup?kind=npc&name=vorna`)).data.data.statblock.hit_points, 77);
  // Hidden (not player-visible) entries and other players' drafts aren't findable at all
  await dm.post(`/campaigns/${campaignId}/compendium`, { kind: "item", name: "Hidden Relic", data: {}, playerVisible: false });
  assert.equal((await sam.get(`/campaigns/${campaignId}/compendium/lookup?kind=item&name=hidden%20relic`)).data, null);
  assert.equal((await sam.get(`/campaigns/${campaignId}/compendium/search?kind=item&q=relic`)).data.length, 0);
  await sam.post(`/campaigns/${campaignId}/compendium/custom`, { kind: "item", name: "Sam's Draft Dagger", data: {} });
  assert.equal(has((await jo.get(`/campaigns/${campaignId}/compendium`)).data, "Draft Dagger"), false);
  assert.equal((await jo.get(`/campaigns/${campaignId}/compendium/search?kind=item&q=draft%20dagger&loose=1`)).data.length, 0);
});

test("the live map: players never get hidden tokens, secret doors, the map key, unrevealed markers, marker notes or AI enrichment", async () => {
  // Find a dungeon layout that has a secret door, then make it
  let seed = 1;
  while (!generateDungeon(30, 24, seed, 8, "stone").tiles.some((r) => r.includes("S"))) seed++;
  mapId = (await dm.post(`/campaigns/${campaignId}/maps/generate`, { cols: 30, rows: 24, seed, rooms: 8, theme: "stone", name: "Crypt" })).data.id;
  await dm.patch(`/maps/${mapId}`, { dmKey: "Room 3: the lich's phylactery" });
  assert.equal((await dm.post(`/campaigns/${campaignId}/active-map`, { mapId })).status, 200);
  assert.equal((await sam.post(`/campaigns/${campaignId}/active-map`, { mapId: null })).status, 403);
  assert.equal((await sam.patch(`/maps/${mapId}`, { dmKey: "" })).status, 403);

  const D = await live(dm), S = await live(sam);
  D.s.emit("token:add", { name: "Lurking Ghoul", x: 100, y: 100, hidden: true });
  D.s.emit("poi", { op: "add", title: "Trapdoor", note: "DC 15 to spot", x: 50, y: 50 });
  D.s.emit("poi", { op: "add", title: "Altar", note: "Cursed: DC 18", x: 80, y: 80 });
  await waitFor(() => (D.last("map")?.pois?.length ?? 0) === 2 && D.last("map").tokens.length === 1);
  D.s.emit("poi", { op: "reveal", id: 2 });
  S.s.emit("token:add", { name: "Mirabel", x: 200, y: 200, characterId: charId });
  await waitFor(() => D.last("map").tokens.length === 2 && D.last("map").pois.some((p: any) => p.revealed));
  hiddenTokenId = D.last("map").tokens.find((t: any) => t.hidden).id;
  samTokenId = D.last("map").tokens.find((t: any) => t.characterId === charId).id;

  // Enrichment is only written by the AI; put some in directly to check it's filtered
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(path.join(dataDir, "grumbling-gnoll.db"));
  db.prepare("UPDATE maps SET enrichment = ? WHERE id = ?").run(JSON.stringify({ atmosphere: "Smells of grave-dirt", encounters: [{ name: "Ghoul ambush" }] }), mapId);
  db.close();
  D.s.emit("fog", { op: "reset" });
  await dm.patch(`/maps/${mapId}`, { fogEnabled: false }); // re-sends the map to everyone
  await pause();

  const dmMap = D.last("map"), pMap = S.last("map");
  assert.ok(dmMap.generated.tiles.some((r: string) => r.includes("S")), "DM sees secret doors");
  assert.ok(dmMap.dmKey.includes("phylactery") && dmMap.enrichment.atmosphere && dmMap.tokens.length === 2 && dmMap.pois.length === 2);
  assert.equal(pMap.generated.tiles.some((r: string) => r.includes("S")), false);
  assert.equal(pMap.tokens.length, 1);
  assert.equal(pMap.tokens[0].name, "Mirabel");
  assert.deepEqual(pMap.pois.map((p: any) => p.title), ["Altar"]);
  for (const bad of ["phylactery", "Lurking Ghoul", "Trapdoor", "DC 15", "Cursed", "grave-dirt", "Ghoul ambush"])
    assert.equal(S.all("map").some((m) => has(m, bad)), false, `player saw "${bad}"`);
  // The same on a fresh join (initial snapshot)
  const S2 = await live(jo);
  assert.equal(has(S2.last("map"), "Lurking Ghoul") || has(S2.last("map"), "phylactery"), false);
  for (const x of [D, S, S2]) x.s.close();
});

test("hidden tokens: their moves go to the DM only; players can't touch other tokens or DM tools", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  D.s.emit("token:move", { id: hiddenTokenId, x: 300, y: 300 });
  await waitFor(() => D.all("token:moved").length === 1);
  await pause();
  assert.equal(S.all("token:moved").length, 0);
  // Jo can't move Sam's token or the hidden one, delete them, or reveal markers / clear fog
  J.s.emit("token:move", { id: samTokenId, x: 1, y: 1 });
  J.s.emit("token:move", { id: hiddenTokenId, x: 1, y: 1 });
  J.s.emit("token:update", { id: hiddenTokenId, hidden: false });
  J.s.emit("token:delete", samTokenId);
  J.s.emit("poi", { op: "revealAll" });
  J.s.emit("fog", { op: "clear" });
  J.s.emit("token:add", { name: "Not mine", characterId: charId, x: 5, y: 5 });
  await pause(400);
  const dmMap = (await live(dm)).last("map");
  assert.equal(dmMap.tokens.length, 2);
  assert.equal(dmMap.tokens.find((t: any) => t.id === samTokenId).x, 200);
  assert.equal(dmMap.tokens.find((t: any) => t.id === hiddenTokenId).hidden, true);
  assert.equal(dmMap.pois.filter((p: any) => p.revealed).length, 1);
  assert.equal(J.all("fog").length, 0);
  // Sam can't un-hide or rename even his own token (only HP / conditions / rings)
  S.s.emit("token:update", { id: samTokenId, name: "Renamed", hidden: true });
  await pause();
  assert.equal((await live(dm)).last("map").tokens.find((t: any) => t.id === samTokenId).name, "Mirabel");
  for (const x of [D, S, J]) x.s.close();
});

test("dice and whispers: DM rolls, secret rolls and whispers only reach the right people (live, on join, export)", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  D.s.emit("roll", { expr: "1d20", label: "DMhidden" });
  D.s.emit("roll", { expr: "1d20", label: "DMpublic", public: true });
  D.s.emit("chat", "/r 1d6 DMslash");
  S.s.emit("roll", { expr: "1d20", label: "SamSecret", secret: true });
  S.s.emit("chat", "/gmr 1d4 SamGmr");
  S.s.emit("chat", "/w Jo meet me behind the inn");
  J.s.emit("roll", { expr: "1d8", label: "JoOpen" });
  await waitFor(() => D.all("chat").length >= 6 && J.all("chat").length >= 3);
  await pause();
  const labels = (x: typeof D) => x.all("chat").map((m) => m.body.label ?? m.body.text);
  // (The DM sees everything, including players' whispers to each other.)
  assert.deepEqual(new Set(labels(D)), new Set(["DMhidden", "DMpublic", "DMslash", "SamSecret", "SamGmr", "meet me behind the inn", "JoOpen"]));
  assert.deepEqual(new Set(labels(S)), new Set(["DMpublic", "SamSecret", "SamGmr", "meet me behind the inn", "JoOpen"]));
  assert.deepEqual(new Set(labels(J)), new Set(["DMpublic", "meet me behind the inn", "JoOpen"]));
  // Chat history for someone joining later, and the chat export
  const J2 = await live(jo);
  const hist = J2.last("chatHistory");
  for (const secret of ["DMhidden", "DMslash", "SamSecret", "SamGmr"]) {
    assert.equal(has(hist, secret), false, secret);
    assert.equal(has((await jo.get(`/campaigns/${campaignId}/chat/export`)).data, secret), false, secret);
  }
  assert.ok(has(hist, "DMpublic") && has(hist, "behind the inn"));
  const dmExport = (await dm.get(`/campaigns/${campaignId}/chat/export`)).data;
  assert.ok(dmExport.includes("DMhidden") && dmExport.includes("SamSecret"));
  // Eve (another user) whispered by name from outside the campaign gets nothing
  S.s.emit("chat", "/w eve psst");
  await waitFor(() => S.events.some((e) => e.name === "toast"));
  for (const x of [D, S, J, J2]) x.s.close();
});

test("initiative: hidden monsters show as ??? with nothing that gives them away", async () => {
  const D = await live(dm), S = await live(sam);
  D.s.emit("initiative", { op: "add", name: "Lurking Ghoul", init: 17, dex: 2, hidden: true, tokenId: hiddenTokenId });
  S.s.emit("initiative", { op: "add", name: "Mirabel", init: 12, dex: 1 });
  await waitFor(() => (S.last("initiative")?.entries.length ?? 0) === 2);
  const e = S.last("initiative").entries.find((x: any) => x.hidden);
  assert.equal(e.name, "???");
  assert.equal(e.init, null);
  assert.equal(e.tokenId, undefined);
  assert.equal(e.dex, undefined);
  assert.equal(has(S.all("initiative"), "Lurking"), false);
  // Players can't run the turn order
  S.s.emit("initiative", { op: "clear" });
  await waitFor(() => S.events.some((x) => x.name === "toast"));
  assert.equal(D.last("initiative").entries.length, 2);
  D.s.emit("initiative", { op: "clear" });
  for (const x of [D, S]) x.s.close();
});

test("a removed player stops getting the live table and chat", async () => {
  const code = (await dm.post("/invites", { uses: 1, campaignId })).data.code;
  const kim = new Client();
  assert.equal((await kim.post("/register", { username: "kim", password: "password1", inviteCode: code })).status, 200);
  const K = await live(kim), D = await live(dm);
  const kimId = (await kim.get("/status")).data.user.id;
  assert.equal((await dm.call("DELETE", `/campaigns/${campaignId}/members/${kimId}`)).status, 200);
  D.s.emit("roll", { expr: "1d20", label: "AfterKick", public: true });
  await waitFor(() => D.all("chat").some((m) => m.body.label === "AfterKick"));
  await pause();
  assert.equal(K.all("chat").some((m) => m.body.label === "AfterKick"), false);
  assert.equal((await kim.get(`/campaigns/${campaignId}`)).status, 404);
  for (const x of [D, K]) x.s.close();
});

test("logins: session cookie is httpOnly + SameSite; logout ends it; a new password logs out other devices", async () => {
  const phone = new Client(), laptop = new Client();
  const r = await fetch(`${B}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "sam", password: "password1" }) });
  const sc = r.headers.get("set-cookie") ?? "";
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
  phone.cookie = sc.split(";")[0];
  await laptop.post("/login", { username: "sam", password: "password1" });
  assert.notEqual(phone.cookie, laptop.cookie);
  assert.equal((await laptop.post("/me/password", { current: "password1", next: "password2" })).status, 200);
  assert.equal((await laptop.get("/status")).data.user.username, "sam");
  assert.equal((await phone.get("/status")).data.user, null);
  await laptop.post("/logout");
  const old = laptop.cookie;
  assert.equal((await (await fetch(`${B}/status`, { headers: { cookie: old } })).json()).user, null);
  // Unknown user and wrong password give the same answer
  assert.equal((await new Client().post("/login", { username: "nobody-here", password: "x" })).data.error, "Wrong username or password");
  // Sam's other session (used by the tests above) was logged out too; log back in with the new password
  assert.equal((await sam.get("/status")).data.user, null);
  assert.equal((await sam.post("/login", { username: "sam", password: "password2" })).status, 200);
});

test("uploads: only real image types, saved with a safe name, served so browsers can't run them", async () => {
  const before = fs.readdirSync(path.join(dataDir, "uploads")).length;
  const send = async (url: string, field: string, name: string, type: string, who = dm) => {
    const fd = new FormData();
    fd.append(field, new Blob(["<script>alert(1)</script>"], { type }), name);
    const res = await fetch(B + url, { method: "POST", headers: { cookie: who.cookie }, body: fd });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  // An HTML page pretending to be a PNG is stored as .png, never .html
  const up = await send(`/campaigns/${campaignId}/images`, "image", "evil.html", "image/png");
  assert.equal(up.status, 200);
  assert.match(up.data.url, /^\/uploads\/[0-9a-f]+\.png$/);
  const got = await fetch(`http://localhost:${PORT}${up.data.url}`, { headers: { cookie: dm.cookie } });
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.match(got.headers.get("content-security-policy") ?? "", /sandbox/);
  // SVG and HTML are refused
  assert.equal((await send(`/campaigns/${campaignId}/images`, "image", "x.svg", "image/svg+xml")).status, 400);
  assert.equal((await send(`/campaigns/${campaignId}/images`, "image", "x.html", "text/html")).status, 400);
  // Path tricks don't get out of the uploads folder
  assert.equal((await fetch(`http://localhost:${PORT}/uploads/..%2fgrumbling-gnoll.db`, { headers: { cookie: dm.cookie } })).status, 404);
  // A refused upload (not this player's campaign / not the DM) leaves nothing behind on disk
  assert.equal((await send(`/campaigns/${campaignId}/maps`, "image", "m.png", "image/png", jo)).status, 403);
  assert.equal((await send(`/campaigns/${campaignId}/adventures`, "pdf", "a.pdf", "application/pdf", eve)).status, 404);
  assert.equal(fs.readdirSync(path.join(dataDir, "uploads")).length, before + 1);
});

// Bugs found in the simulated game night
// ---------------------------------------------------------------------------
test("the DM's tweaks to a sheet waiting for approval are kept when they approve it", async () => {
  // A new character: the DM fixes the race on the sheet, then approves
  const id = (await sam.post("/characters", { campaignId, data: { name: "Pip", species: "" } })).data.id;
  const sheet = (await dm.get(`/characters/${id}`)).data;
  const saved = await dm.put(`/characters/${id}`, { data: { ...sheet.pending.data, species: "Lightfoot Halfling", speed: 25 } });
  assert.equal(saved.data.pending, true);
  const change = (await dm.get(`/campaigns/${campaignId}/approvals`)).data.find((a: any) => a.characterId === id);
  assert.equal((await dm.post(`/changes/${change.id}/approve`, {})).status, 200);
  const after = (await sam.get(`/characters/${id}`)).data;
  assert.equal(after.status, "approved");
  assert.equal(after.data.species, "Lightfoot Halfling");
  assert.equal(after.data.speed, 25);
  // An approved character's official sheet doesn't change until the DM approves the player's edit
  await sam.put(`/characters/${id}`, { data: { ...after.data, features: "Lucky" }, note: "added Lucky" });
  await dm.put(`/characters/${id}`, { data: { ...after.data, features: "Lucky (halfling)" } });
  assert.equal((await jo.get(`/characters/${id}`)).data.data.features, after.data.features);
  const edit = (await dm.get(`/campaigns/${campaignId}/approvals`)).data.find((a: any) => a.characterId === id);
  await dm.post(`/changes/${edit.id}/approve`, {});
  assert.equal((await jo.get(`/characters/${id}`)).data.data.features, "Lucky (halfling)");
});

test("hit points never go below 0, on the sheet or on the map", async () => {
  await sam.patch(`/characters/${charId}/play`, { hp: { current: -7 } });
  assert.equal((await sam.get(`/characters/${charId}`)).data.data.hp.current, 0);
  const D = await live(dm);
  D.s.emit("token:update", { id: hiddenTokenId, hp: -13 });
  await waitFor(() => D.last("map")?.tokens.find((t: any) => t.id === hiddenTokenId)?.hp === 0);
  D.s.close();
});

test("showing a hidden monster on the map shows it in the turn order too (and hiding hides it)", async () => {
  const D = await live(dm), S = await live(sam);
  D.s.emit("initiative", { op: "add", name: "Lurking Ghoul", init: 15, hidden: true, tokenId: hiddenTokenId });
  await waitFor(() => (S.last("initiative")?.entries.length ?? 0) === 1);
  assert.equal(S.last("initiative").entries[0].name, "???");
  D.s.emit("token:update", { id: hiddenTokenId, hidden: false });
  await waitFor(() => S.last("initiative").entries[0].name === "Lurking Ghoul");
  D.s.emit("token:update", { id: hiddenTokenId, hidden: true });
  await waitFor(() => S.last("initiative").entries[0].name === "???");
  D.s.emit("initiative", { op: "clear" });
  for (const x of [D, S]) x.s.close();
});

test("monster HP is DM-only: players see when a monster is down, never its numbers; player characters' HP stays visible", async () => {
  const D = await live(dm), S = await live(sam);
  D.s.emit("token:add", { name: "Ogre Brute", x: 400, y: 400, hp: 59, maxHp: 59 });
  await waitFor(() => D.last("map").tokens.some((t: any) => t.name === "Ogre Brute"));
  const ogreId = D.last("map").tokens.find((t: any) => t.name === "Ogre Brute").id;
  D.s.emit("token:update", { id: ogreId, hp: 31 });
  await waitFor(() => D.last("map").tokens.find((t: any) => t.id === ogreId).hp === 31);
  await pause();
  const dmOgre = D.last("map").tokens.find((t: any) => t.id === ogreId);
  assert.equal(dmOgre.maxHp, 59);
  const pOgre = S.last("map").tokens.find((t: any) => t.id === ogreId);
  assert.equal(pOgre.hp, null);
  assert.equal(pOgre.maxHp, null);
  assert.equal(S.all("map").some((m) => m?.tokens?.some((t: any) => t.id === ogreId && (t.hp === 31 || t.hp === 59 || t.maxHp === 59))), false);
  // Sam's own character still shows HP to players
  assert.notEqual(S.last("map").tokens.find((t: any) => t.id === samTokenId).hp, null);
  // A downed monster shows as down (0) for players
  D.s.emit("token:update", { id: ogreId, hp: 0 });
  await waitFor(() => S.last("map").tokens.find((t: any) => t.id === ogreId)?.hp === 0);
  // Fresh join snapshot too
  D.s.emit("token:update", { id: ogreId, hp: 12 });
  await waitFor(() => D.last("map").tokens.find((t: any) => t.id === ogreId).hp === 12);
  const J = await live(jo);
  assert.equal(J.last("map").tokens.find((t: any) => t.id === ogreId).hp, null);
  D.s.emit("token:delete", ogreId);
  await pause();
  for (const x of [D, S, J]) x.s.close();
});

test("session recaps: the players' recap is written without whispers, secret rolls, DM notes or the adventure", async () => {
  const D = await live(dm), S = await live(sam);
  S.s.emit("chat", "We kick open the crypt door!");
  D.s.emit("roll", { expr: "1d20", label: "Ghoul stealth SECRETROLL" });
  S.s.emit("chat", "/w Jo WHISPERTEXT I'm stealing the gem");
  D.s.emit("chat", "The door creaks open onto a dusty hall.");
  await waitFor(() => D.all("chat").length >= 4);
  for (const x of [D, S]) x.s.close();

  process.env.DATA_DIR = dataDir;
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const ai = await import("../server/ai.ts");
  const { chatLog } = await import("../server/routes/recaps.ts");
  const { publicCampaignContext, campaignContext } = await import("../server/helpers.ts");
  const calls: any[] = [];
  ai.setAIClientForTests({ beta: { messages: { parse: async (req: any) => {
    calls.push(req);
    return { stop_reason: "end_turn", model: "test-model", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: { title: "T", player_recap: "P", dm_notes: "D" } };
  } } } });
  try {
    const log = chatLog(campaignId, 0, null);
    const r = await ai.writeSessionRecap(publicCampaignContext(campaignId), campaignContext(campaignId), 1, { publicText: log.publicText, fullText: log.text }, "They bowed to the statue");
    assert.deepEqual(r, { title: "T", player_recap: "P", dm_notes: "D" });
    assert.equal(calls.length, 2);
    const player = calls.find((c) => JSON.stringify(c.messages).includes("player_recap"));
    const dmCall = calls.find((c) => c !== player);
    assert.ok(has(player, "crypt door") && has(player, "bowed to the statue"), "players' recap sees the public log and the DM's spoken notes");
    for (const bad of ["SECRETROLL", "WHISPERTEXT", "lich", "Secret heir", "[private]"]) assert.equal(has(player, bad), false, `players' recap request saw "${bad}"`);
    assert.ok(has(dmCall, "SECRETROLL") && has(dmCall, "WHISPERTEXT") && has(dmCall, "lich"), "the DM's notes request still sees everything");
  } finally {
    ai.setAIClientForTests(null);
  }
});

test("current HP never goes above the maximum, on the sheet or on the map", async () => {
  const max = (await sam.get(`/characters/${charId}`)).data.derived?.maxHp;
  await sam.patch(`/characters/${charId}/play`, { hp: { current: 999 } });
  const cur = (await sam.get(`/characters/${charId}`)).data.data.hp.current;
  assert.ok(cur < 999 && cur > 0, `sheet HP was capped (got ${cur}${max ? `, max ${max}` : ""})`);
  const D = await live(dm);
  D.s.emit("token:update", { id: samTokenId, hp: 999 });
  await pause();
  assert.equal(D.last("map").tokens.find((t: any) => t.id === samTokenId).hp, cur);
  D.s.emit("token:add", { name: "Wolf", x: 10, y: 10, hp: 11, maxHp: 11 });
  await waitFor(() => D.last("map").tokens.some((t: any) => t.name === "Wolf"));
  const wolf = D.last("map").tokens.find((t: any) => t.name === "Wolf").id;
  D.s.emit("token:update", { id: wolf, hp: 50 });
  await pause();
  assert.equal(D.last("map").tokens.find((t: any) => t.id === wolf).hp, 11);
  D.s.emit("token:delete", wolf);
  await pause();
  D.s.close();
});

test("switching a campaign's rules switches its characters too", async () => {
  assert.equal((await sam.patch(`/campaigns/${campaignId}`, { rulesVersion: "2024" })).status, 403);
  await dm.patch(`/campaigns/${campaignId}`, { rulesVersion: "2024" });
  assert.equal((await sam.get(`/characters/${charId}`)).data.data.rulesVersion, "2024");
  await dm.patch(`/campaigns/${campaignId}`, { rulesVersion: "2014" });
  assert.equal((await sam.get(`/characters/${charId}`)).data.data.rulesVersion, "2014");
});

// ---------------------------------------------------------------------------
// Resubmitted characters show what changed since the version the DM sent back
// ---------------------------------------------------------------------------
test("a resubmitted character lists what changed since the version the DM sent back", async () => {
  const id = (await sam.post("/characters", { campaignId, data: { name: "Resub", species: "Human" } })).data.id;
  const first = (await dm.get(`/campaigns/${campaignId}/approvals`)).data.find((a: any) => a.characterId === id);
  assert.deepEqual(first.changes, ["New character"]);
  await dm.post(`/changes/${first.id}/reject`, { comment: "Please pick a real species" });
  const sheet = (await sam.get(`/characters/${id}`)).data;
  await sam.put(`/characters/${id}`, { data: { ...sheet.data, species: "Dwarf", speed: 25 }, note: "fixed" });
  const again = (await dm.get(`/campaigns/${campaignId}/approvals`)).data.find((a: any) => a.characterId === id);
  assert.ok(!again.changes.includes("New character"));
  assert.ok(again.changes.length >= 2, `expected a list of changes, got ${JSON.stringify(again.changes)}`);
  assert.ok(again.changes.join("|").includes("Dwarf"));
  await dm.post(`/changes/${again.id}/approve`, {});
});

// ---------------------------------------------------------------------------
// Fog of war: players are only told about tokens standing in revealed areas
// ---------------------------------------------------------------------------
test("fog of war: players never receive tokens standing in fog (server-side), the DM gets everything", async () => {
  const fogMap = (await dm.post(`/campaigns/${campaignId}/maps/generate`, { cols: 30, rows: 24, seed: 3, rooms: 8, theme: "stone", name: "Fog Test" })).data.id;
  assert.equal((await dm.post(`/campaigns/${campaignId}/active-map`, { mapId: fogMap })).status, 200);
  const D = await live(dm), S = await live(sam), J = await live(jo);
  const names = (L: { last: (n: string) => any }) => (L.last("map")?.tokens ?? []).map((t: any) => t.name).sort();
  const idOf = (L: { last: (n: string) => any }, name: string) => L.last("map").tokens.find((t: any) => t.name === name)?.id;

  D.s.emit("token:add", { name: "Fogged Orc", x: 100, y: 100 });
  D.s.emit("token:add", { name: "Open Orc", x: 500, y: 500 });
  S.s.emit("token:add", { name: "Mirabel", x: 100, y: 120, characterId: charId }); // Sam's own character, standing in fog
  await waitFor(() => names(D).length === 3);
  const fogged = idOf(D, "Fogged Orc"), open = idOf(D, "Open Orc");

  // Nothing revealed yet: the fogged orc, the open orc and every other monster are invisible to players, but their own character is not
  await waitFor(() => has(S.last("map"), "Mirabel"));
  assert.deepEqual(names(S), ["Mirabel"]);
  assert.deepEqual(names(J), ["Mirabel"], "other players' characters are always sent");
  assert.deepEqual(names(D), ["Fogged Orc", "Mirabel", "Open Orc"]);

  // Reveal the area around the open orc
  D.s.emit("fog", { op: "add", shape: { mode: "reveal", kind: "circle", x: 500, y: 500, r: 100 } });
  await waitFor(() => names(S).includes("Open Orc") && names(J).includes("Open Orc"));
  assert.deepEqual(names(S), ["Mirabel", "Open Orc"]);
  assert.equal(has(S.last("map"), "Fogged Orc") || has(J.last("map"), "Fogged Orc"), false);

  // A player who joins later gets the same filtered map
  const late = await live(jo);
  assert.deepEqual(names(late), ["Mirabel", "Open Orc"]);
  late.s.close();

  // The open orc walks into the fog: it disappears for players (and is never told about again)
  D.s.emit("token:move", { id: open, x: 100, y: 300 });
  await waitFor(() => !names(S).includes("Open Orc") && !names(J).includes("Open Orc"));
  const eventsBefore = S.events.length;
  D.s.emit("token:move", { id: open, x: 110, y: 310 });
  await pause();
  assert.equal(has(S.events.slice(eventsBefore), "Open Orc") || S.events.slice(eventsBefore).some((e) => e.name === "token:moved" && e.data.id === open), false);

  // The fogged orc walks out of the fog into the revealed circle: it appears
  D.s.emit("token:move", { id: fogged, x: 510, y: 520 });
  await waitFor(() => names(S).includes("Fogged Orc") && names(J).includes("Fogged Orc"));
  // ...and while it stays visible, ordinary live moves reach players
  D.s.emit("token:move", { id: fogged, x: 520, y: 530 });
  await waitFor(() => S.all("token:moved").some((m: any) => m.id === fogged && m.x === 520));
  // The DM watched all of it, including the moves in the fog
  assert.ok(D.all("token:moved").some((m: any) => m.id === open && m.x === 110));

  // A player's own token is always sent, even when they walk it deep into fog
  S.s.emit("token:move", { id: idOf(D, "Mirabel"), x: 900, y: 700 });
  await waitFor(() => D.last("map") && D.all("token:moved").some((m: any) => m.x === 900));
  assert.ok(names(S).includes("Mirabel") && names(J).includes("Mirabel"));
  await waitFor(() => J.all("token:moved").some((m: any) => m.x === 900));

  // Covering the area with fog again hides the orc from players on the spot
  D.s.emit("fog", { op: "add", shape: { mode: "hide", kind: "rect", x: 400, y: 400, w: 200, h: 200 } });
  await waitFor(() => !names(S).includes("Fogged Orc"));

  // With fog turned off for this map, fog hides nothing (hidden tokens stay hidden)
  D.s.emit("token:update", { id: open, hidden: true });
  assert.equal((await dm.patch(`/maps/${fogMap}`, { fogEnabled: false })).status, 200);
  await waitFor(() => names(S).includes("Fogged Orc"));
  assert.deepEqual(names(S), ["Fogged Orc", "Mirabel"]);
  assert.deepEqual(names(D), ["Fogged Orc", "Mirabel", "Open Orc"]);
  for (const L of [D, S, J]) L.s.close();
});
