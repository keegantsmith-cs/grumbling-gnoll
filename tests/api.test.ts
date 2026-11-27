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
