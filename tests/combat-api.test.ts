// Combat on the live table, end to end: a DM and two players on a real server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { io as ioClient, type Socket } from "socket.io-client";

const PORT = 4000 + Math.floor(Math.random() * 90);
const B = `http://localhost:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gnoll-combat-"));
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
}
const dm = new Client(), sam = new Client(), jo = new Client();
let campaignId = 0, charId = 0, samTokenId = 0, joTokenId = 0, joCharId = 0, goblinId = 0, hiddenId = 0;

async function live(c: Client) {
  const s: Socket = ioClient(`http://localhost:${PORT}`, { extraHeaders: { cookie: c.cookie }, transports: ["websocket"], forceNew: true });
  const events: { name: string; data: any }[] = [];
  s.onAny((name, data) => events.push({ name, data }));
  await new Promise<void>((ok, fail) => { s.on("connect", () => ok()); s.on("connect_error", (e) => { s.close(); fail(e); }); });
  s.emit("join", campaignId);
  await waitFor(() => events.some((e) => e.name === "chatHistory"));
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

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ANTHROPIC_API_KEY: "" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${B}/status`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  await dm.post("/register", { username: "keegan", password: "password1" });
  campaignId = (await dm.post("/campaigns", { name: "Combat Test", rulesVersion: "2014" })).data.id;
  const code = (await dm.post("/invites", { uses: 2, campaignId })).data.code;
  await sam.post("/register", { username: "sam", displayName: "Sam", password: "password1", inviteCode: code });
  await jo.post("/register", { username: "joanna", displayName: "Jo", password: "password1", inviteCode: code });
  const data = {
    name: "Mirabel", classes: [{ name: "Fighter", subclass: "", level: 3 }], abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, saveProficiencies: ["str", "con"],
    attacks: [{ name: "Longsword", bonus: "", damage: "", notes: "" }, { name: "Handaxe", bonus: "+5", damage: "1d6+3 slashing", notes: "" }],
    inventory: [{ name: "Chain Mail", qty: 1, weight: 55, equipped: true, attuned: false, notes: "" }],
  };
  charId = (await sam.post("/characters", { campaignId, data })).data.id;
  joCharId = (await jo.post("/characters", { campaignId, data: { ...data, name: "Tobin" } })).data.id;
  for (const a of (await dm.get(`/campaigns/${campaignId}/approvals`)).data) await dm.post(`/changes/${a.id}/approve`, {});
  const mapId = (await dm.post(`/campaigns/${campaignId}/maps/generate`, { cols: 30, rows: 24, seed: 3, rooms: 6, theme: "stone", name: "Arena" })).data.id;
  await dm.post(`/campaigns/${campaignId}/active-map`, { mapId });
  await dm.patch(`/maps/${mapId}`, { fogEnabled: false });
  const D = await live(dm), S = await live(sam), J = await live(jo);
  S.s.emit("token:add", { name: "Mirabel", x: 200, y: 200, characterId: charId });
  J.s.emit("token:add", { name: "Tobin", x: 260, y: 200, characterId: joCharId });
  const goblin = (await dm.get("/srd/monster/Goblin")).data;
  await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: goblin, count: 1, initiative: "none", x: 400, y: 200 });
  await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: (await dm.get("/srd/monster/Orc")).data, count: 1, initiative: "none", hidden: true, x: 500, y: 200 });
  await waitFor(() => D.last("map")?.tokens?.length === 4);
  samTokenId = tokenByName(D, "Mirabel").id; joTokenId = tokenByName(D, "Tobin").id;
  goblinId = tokenByName(D, "Goblin").id; hiddenId = tokenByName(D, "Orc").id;
  for (const x of [D, S, J]) x.s.close();
});
after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("combat panel: a monster's AC, attacks and stat block go to the DM only, players get a rough health word", async () => {
  const D = await live(dm), S = await live(sam);
  await waitFor(() => D.last("map") && S.last("map"));
  const forDM = tokenByName(D, "Goblin");
  assert.equal(forDM.ac, 15);
  assert.equal(forDM.hp, 7);
  const forPlayer = tokenByName(S, "Goblin");
  assert.equal(forPlayer.ac, undefined);
  assert.equal(forPlayer.hp, null);
  assert.equal(forPlayer.health, "healthy");
  // none of the stat block (attacks, saves, actions) is anywhere in what the player was sent
  assert.equal(has(S.all("map"), "Scimitar"), false);
  assert.equal(has(S.all("map"), "combat"), false);
  assert.equal(has(S.all("map"), "Nimble Escape"), false);
  // hidden monsters aren't sent at all
  assert.equal(has(S.all("map"), "Orc"), false);
  // player characters' AC is open to the table
  assert.equal(tokenByName(S, "Mirabel").ac, 16);
  for (const x of [D, S]) x.s.close();
});

test("combat panel: the acting creature's attacks are only given to the DM or the token's controller", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  const mine = await S.ask("combat:actor", { tokenId: samTokenId });
  assert.equal(mine.actor.kind, "character");
  assert.equal(mine.actor.ac, 16);
  const sword = mine.actor.actions.find((a: any) => a.name === "Longsword");
  assert.equal(sword.toHit, 3 + 2); // Str +3, proficiency +2 at level 3
  assert.deepEqual(sword.damage, [{ dice: "1d8+3", type: "slashing" }]);
  assert.equal(mine.actor.actions.find((a: any) => a.name === "Handaxe").toHit, 5);
  // Sam can't read the goblin's, the hidden orc's, or Jo's character's numbers
  for (const id of [goblinId, hiddenId, joTokenId]) assert.ok((await S.ask("combat:actor", { tokenId: id })).error);
  assert.ok((await J.ask("combat:actor", { tokenId: samTokenId })).error);
  // The DM gets the goblin's full list
  const gob = (await D.ask("combat:actor", { tokenId: goblinId })).actor;
  assert.equal(gob.ac, 15);
  assert.ok(gob.actions.find((a: any) => a.name === "Scimitar" && a.toHit === 4));
  assert.ok(gob.actions.find((a: any) => a.name === "Shortbow"));
  assert.equal((await D.ask("combat:actor", { tokenId: hiddenId })).actor.name, "Orc");
  // "Dodge" etc. are announced in chat; a hidden monster's choice stays with the DM
  S.s.emit("combat:do", { tokenId: samTokenId, key: "dodge" });
  D.s.emit("combat:do", { tokenId: hiddenId, key: "dash" });
  S.s.emit("combat:do", { tokenId: hiddenId, key: "dash" });
  await waitFor(() => D.all("chat").filter((m) => has(m.body, "Dodge") || has(m.body, "Dash")).length >= 2);
  await pause();
  assert.equal(has(J.all("chat"), "Dodge"), true);
  assert.equal(has(J.all("chat"), "Dash"), false);
  assert.equal(D.all("chat").filter((m) => has(m.body, "Dash")).length, 1); // Sam's attempt was ignored
  for (const x of [D, S, J]) x.s.close();
});
