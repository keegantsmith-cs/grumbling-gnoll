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
let campaignId = 0, charId = 0, samTokenId = 0, joTokenId = 0, joCharId = 0, goblinId = 0, hiddenId = 0, dragonId = 0;

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
    name: "Mirabel", hp: { max: 44, current: 44, temp: 0 }, classes: [{ name: "Fighter", subclass: "", level: 3 }], abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, saveProficiencies: ["str", "con"],
    attacks: [{ name: "Longsword", bonus: "", damage: "", notes: "" }, { name: "Handaxe", bonus: "+5", damage: "1d6+3 slashing", notes: "" }],
    inventory: [{ name: "Chain Mail", qty: 1, weight: 55, equipped: true, attuned: false, notes: "" }],
  };
  charId = (await sam.post("/characters", { campaignId, data })).data.id;
  joCharId = (await jo.post("/characters", { campaignId, data: { ...data, name: "Tobin", hp: { max: 30, current: 30, temp: 0 } } })).data.id;
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
  await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: (await dm.get("/srd/monster/Adult%20Red%20Dragon")).data, count: 1, initiative: "none", x: 600, y: 300 });
  await waitFor(() => D.last("map")?.tokens?.length === 5);
  samTokenId = tokenByName(D, "Mirabel").id; joTokenId = tokenByName(D, "Tobin").id;
  goblinId = tokenByName(D, "Goblin").id; dragonId = tokenByName(D, "Adult Red Dragon").id; hiddenId = tokenByName(D, "Orc").id;
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

const swordId = async (L: Live) => (await L.ask("combat:actor", { tokenId: samTokenId })).actor.actions.find((a: any) => a.name === "Longsword").id;

test("rolling: a player's attack with a typed-in die works out hit, miss and critical against the DM's secret AC", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  const id = await swordId(S);
  const hit = await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, manual: 10 });
  assert.equal(hit.outcome, "hit"); // 10 + 5 = 15 meets the goblin's AC 15
  assert.equal(hit.total, 15);
  assert.equal((await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, manual: 9 })).outcome, "miss");
  assert.equal((await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, manual: 20 })).outcome, "crit");
  assert.equal((await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, manual: 1 })).outcome, "fumble");
  await waitFor(() => J.all("chat").filter((m) => m.kind === "roll").length >= 4);
  const seen = J.all("chat").filter((m) => m.kind === "roll");
  assert.deepEqual(seen.map((m) => m.body.combat.outcome), ["hit", "miss", "crit", "fumble"]);
  assert.equal(seen[0].body.combat.target.name, "Goblin");
  // players learn hit or miss, never the goblin's AC
  assert.equal(has(J.all("chat"), '"ac"'), false);
  assert.equal(has(S.all("chat"), '"ac"'), false);
  assert.equal(has(J.all("chat"), "AC 15"), false);
  // a real (server-rolled) attack with advantage
  const rolled = await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: goblinId, mode: "adv" });
  assert.ok(rolled.total >= 6 && rolled.total <= 25);
  assert.match(D.all("chat").filter((m) => m.kind === "roll").at(-1).body.expression, /2d20kh1/);
  for (const x of [D, S, J]) x.s.close();
});

test("rolling: damage doubles the dice (not the bonus) on a critical, and a typed total is used as-is", async () => {
  const S = await live(sam);
  const id = await swordId(S);
  for (let i = 0; i < 20; i++) {
    const r = await S.ask("combat:roll", { tokenId: samTokenId, kind: "damage", actionId: id, targetId: goblinId, crit: true });
    assert.ok(r.total >= 2 + 3 && r.total <= 16 + 3, `crit damage ${r.total}`);
    const n = await S.ask("combat:roll", { tokenId: samTokenId, kind: "damage", actionId: id, targetId: goblinId });
    assert.ok(n.total >= 1 + 3 && n.total <= 8 + 3);
  }
  const typed = await S.ask("combat:roll", { tokenId: samTokenId, kind: "damage", actionId: id, targetId: goblinId, manual: 11 });
  assert.equal(typed.total, 11);
  assert.deepEqual(typed.parts, [{ amount: 11, type: "slashing" }]);
  S.s.close();
});

test("rolling: checks, saves and skills use the sheet's numbers; typed-in dice work too", async () => {
  const S = await live(sam);
  assert.equal((await S.ask("combat:roll", { tokenId: samTokenId, kind: "check", ability: "str", manual: 14 })).total, 14 + 3);
  assert.equal((await S.ask("combat:roll", { tokenId: samTokenId, kind: "save", ability: "con", manual: 10, dc: 14 })).success, true); // Con +2, proficient +2
  const athletics = await S.ask("combat:roll", { tokenId: samTokenId, kind: "skill", skill: "athletics", manual: 5 });
  assert.equal(athletics.total, 5 + 3);
  assert.ok((await S.ask("combat:roll", { tokenId: samTokenId, kind: "check", ability: "nope" })).error);
  S.s.close();
});

test("rolling: the DM's monster rolls stay hidden from players unless the DM shows them", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  const scim = (await D.ask("combat:actor", { tokenId: goblinId })).actor.actions.find((a: any) => a.name === "Scimitar").id;
  const secret = await D.ask("combat:roll", { tokenId: goblinId, kind: "attack", actionId: scim, targetId: samTokenId, manual: 12 });
  assert.equal(secret.outcome, "hit"); // 12 + 4 = 16 vs Mirabel's AC 16
  await pause();
  assert.equal(has(S.all("chat"), "Scimitar"), false);
  assert.equal(has(J.all("chat"), "Scimitar"), false);
  const dmCopy = D.all("chat").find((m) => has(m.body, "Scimitar"));
  assert.equal(dmCopy.body.combat.ac, 16); // the DM sees what it was rolled against
  // Shown to the table: everyone sees the result, but still not the AC
  await D.ask("combat:roll", { tokenId: goblinId, kind: "attack", actionId: scim, targetId: samTokenId, manual: 3, show: true });
  await waitFor(() => has(S.all("chat"), "Scimitar"));
  const pub = S.all("chat").find((m) => has(m.body, "Scimitar"));
  assert.equal(pub.body.combat.outcome, "miss");
  assert.equal(pub.body.combat.ac, undefined);
  // A player's secret roll goes to the DM only
  const id = await swordId(S);
  await S.ask("combat:roll", { tokenId: samTokenId, kind: "check", ability: "dex", manual: 8, secret: true });
  await pause();
  assert.equal(has(J.all("chat"), "Dexterity check"), false);
  assert.equal(D.all("chat").some((m) => has(m.body, "Dexterity check")), true);
  assert.ok(id);
  for (const x of [D, S, J]) x.s.close();
});

test("rolling: nobody rolls for a creature they don't control, or targets what they can't see", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  const id = await swordId(S);
  assert.ok((await J.ask("combat:roll", { tokenId: samTokenId, kind: "check", ability: "str" })).error);
  assert.ok((await S.ask("combat:roll", { tokenId: goblinId, kind: "check", ability: "str" })).error);
  // Sam can name the hidden orc as a target, but it's ignored: the result carries no target
  const r = await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: id, targetId: hiddenId, manual: 15 });
  assert.equal(r.targetId, null);
  assert.equal(r.outcome, "unknown"); // with nothing to compare against, the site says so instead of guessing
  for (const x of [D, S, J]) x.s.close();
});

test("rolling: a breath weapon rolls damage once and a save for each target (typed saves allowed); half on a success", async () => {
  const D = await live(dm);
  const breath = (await D.ask("combat:actor", { tokenId: dragonId })).actor.actions.find((a: any) => a.name === "Fire Breath");
  const r = await D.ask("combat:roll", { tokenId: dragonId, kind: "saveall", actionId: breath.id, targetIds: [samTokenId, joTokenId], manualSaves: { [samTokenId]: 20, [joTokenId]: 2 } });
  const [sam1, jo1] = r.rows;
  assert.equal(sam1.success, true); // 20 + Dex 1 = 21 meets DC 21
  assert.equal(jo1.success, false);
  assert.equal(r.parts[0].type, "fire");
  assert.ok(r.total >= 18 && r.total <= 108);
  assert.deepEqual(r.apply.halfFor, [samTokenId]);
  assert.deepEqual(r.apply.tokenIds.sort(), [samTokenId, joTokenId].sort());
  // using it marks the recharge ability as spent; a recharge roll can bring it back
  const after = (await D.ask("combat:actor", { tokenId: dragonId })).actor;
  assert.equal(after.used[breath.id], 1);
  let back = false;
  for (let i = 0; i < 40 && !back; i++) back = (await D.ask("combat:roll", { tokenId: dragonId, kind: "recharge", actionId: breath.id })).back;
  assert.equal(back, true);
  assert.equal((await D.ask("combat:actor", { tokenId: dragonId })).actor.used[breath.id], undefined);
  D.s.close();
});

const hpOf = (L: Live, id: number) => L.last("map").tokens.find((t: any) => t.id === id);
const resetSam = async (D: Live) => { D.s.emit("token:update", { id: samTokenId, hp: 44 }); await pause(150); };

test("damage: the DM applies it with the stat block's resistances, and temp HP and half-on-a-save are worked out", async () => {
  const D = await live(dm), S = await live(sam);
  // Goblin has 7 HP and no defenses
  let r = await D.ask("combat:apply", { targets: [{ tokenId: goblinId, parts: [{ amount: 4, type: "slashing" }] }] });
  assert.equal(r.results[0].hp, 3);
  r = await D.ask("combat:apply", { targets: [{ tokenId: goblinId, amount: 4, half: true }] });
  assert.equal(r.results[0].hp, 1); // half of 4
  // The dragon is immune to fire, so a fireball does nothing
  r = await D.ask("combat:apply", { targets: [{ tokenId: dragonId, amount: 30, type: "fire" }, { tokenId: dragonId, amount: 10, type: "cold" }] });
  assert.equal(r.results[0].dealt, 0);
  assert.equal(r.results[1].dealt, 10);
  assert.equal(r.results[1].hp, 246);
  // players can't apply damage to others, but can to their own character
  assert.ok((await S.ask("combat:apply", { targets: [{ tokenId: goblinId, amount: 5 }] })).error);
  assert.ok((await S.ask("combat:apply", { targets: [{ tokenId: joTokenId, amount: 5 }] })).error);
  assert.equal((await S.ask("combat:apply", { targets: [{ tokenId: samTokenId, amount: 5 }] })).results[0].hp, 39);
  // temporary HP soaks up damage first and doesn't stack
  await S.ask("combat:heal", { tokenId: samTokenId, amount: 5, temp: true });
  await S.ask("combat:heal", { tokenId: samTokenId, amount: 3, temp: true });
  r = await D.ask("combat:apply", { targets: [{ tokenId: samTokenId, amount: 8 }] });
  assert.deepEqual([r.results[0].temp, r.results[0].hp], [0, 36]);
  // healing never goes above the maximum
  assert.equal((await S.ask("combat:heal", { tokenId: samTokenId, amount: 100 })).hp, 44);
  // a monster can't be healed or damaged by a player
  assert.ok((await S.ask("combat:heal", { tokenId: goblinId, amount: 3 })).error);
  for (const x of [D, S]) x.s.close();
});

test("damage: an Apply button on a chat roll works once, then is marked applied for everyone", async () => {
  const D = await live(dm), S = await live(sam);
  const sword = await swordId(S);
  await S.ask("combat:roll", { tokenId: samTokenId, kind: "attack", actionId: sword, targetId: joTokenId, manual: 15, withDamage: true, manualDamage: 6 });
  await waitFor(() => D.all("chat").some((m) => m.body.combat?.apply));
  const msg = D.all("chat").find((m) => m.body.combat?.apply);
  const before = hpOf(D, joTokenId).hp;
  const r = await D.ask("combat:apply", { msgId: msg.id, targets: [{ tokenId: joTokenId, parts: msg.body.combat.apply.parts }] });
  assert.equal(r.results[0].hp, before - 6);
  await waitFor(() => S.all("chat:update").some((m) => m.id === msg.id && m.body.combat.applied));
  assert.equal(D.all("chat:update").find((m) => m.id === msg.id).body.combat.applied, true);
  for (const x of [D, S]) x.s.close();
});

test("damage: monster numbers reach the DM only; players only hear that a monster fell", async () => {
  const D = await live(dm), S = await live(sam);
  await D.ask("combat:apply", { targets: [{ tokenId: dragonId, amount: 40, type: "cold" }] });
  await pause();
  assert.equal(has(S.all("chat"), "Adult Red Dragon takes"), false);
  assert.equal(has(S.all("chat"), "246"), false);
  assert.equal(tokenByName(S, "Adult Red Dragon").hp, null);
  assert.equal(tokenByName(S, "Adult Red Dragon").health, "healthy"); // 206/256 is still more than half
  await D.ask("combat:apply", { targets: [{ tokenId: dragonId, amount: 120, type: "cold" }] });
  await waitFor(() => tokenByName(S, "Adult Red Dragon").health === "bloodied");
  await D.ask("combat:apply", { targets: [{ tokenId: dragonId, amount: 70, type: "cold" }] });
  await waitFor(() => tokenByName(S, "Adult Red Dragon").health === "near death");
  assert.equal(has(S.all("map"), '"maxHp":256'), false);
  await D.ask("combat:apply", { targets: [{ tokenId: goblinId, amount: 50 }] });
  await waitFor(() => has(S.all("chat"), "Goblin is down") && tokenByName(S, "Goblin").hp === 0);
  for (const x of [D, S]) x.s.close();
});

test("dropping to 0: a character falls unconscious, makes death saves, and healing brings them back", async () => {
  const D = await live(dm), J = await live(jo);
  const elowen = (await J.ask("combat:actor", { tokenId: joTokenId })).actor;
  let r = await D.ask("combat:apply", { targets: [{ tokenId: joTokenId, amount: elowen.hp + 5 }] });
  assert.equal(r.results[0].dropped, true);
  assert.equal(r.results[0].hp, 0);
  await waitFor(() => /Unconscious/.test(hpOf(J, joTokenId)?.conditions ?? ""));
  assert.deepEqual(hpOf(J, joTokenId).deathSaves, { successes: 0, failures: 0 });
  // damage while down is a death save failure, a crit is two
  r = await D.ask("combat:apply", { targets: [{ tokenId: joTokenId, amount: 3 }] });
  assert.equal((await J.ask("combat:actor", { tokenId: joTokenId })).actor.deathSaves.failures, 1);
  // saves: typed 12 = success, typed 1 = two failures (now 3 = dead)
  const ok = await J.ask("combat:roll", { tokenId: joTokenId, kind: "check", ability: "dex", manual: 5 });
  assert.ok(ok.ok);
  let ds = await J.ask("combat:death", { tokenId: joTokenId, manual: 12 });
  assert.equal(ds.successes, 1);
  ds = await J.ask("combat:death", { tokenId: joTokenId, manual: 1 });
  assert.equal(ds.outcome, "dead");
  assert.ok((await J.ask("combat:death", { tokenId: joTokenId, manual: 15 })).error); // already dead
  // healing brings them back and clears the saves
  const h = await D.ask("combat:heal", { tokenId: joTokenId, amount: 9 });
  assert.equal(h.hp, 9);
  const after = (await J.ask("combat:actor", { tokenId: joTokenId })).actor;
  assert.deepEqual(after.deathSaves, { successes: 0, failures: 0 });
  assert.equal(/Unconscious|Dead/.test(after.conditions), false);
  // a natural 20 at 0 HP gets you up with 1 HP
  await D.ask("combat:apply", { targets: [{ tokenId: joTokenId, amount: 20 }] });
  const nat = await J.ask("combat:death", { tokenId: joTokenId, manual: 20 });
  assert.equal(nat.outcome, "revived");
  assert.equal((await J.ask("combat:actor", { tokenId: joTokenId })).actor.hp, 1);
  // only characters at 0 HP can make death saves
  assert.ok((await J.ask("combat:death", { tokenId: joTokenId, manual: 15 })).error);
  assert.ok((await D.ask("combat:death", { tokenId: goblinId })).error);
  for (const x of [D, J]) x.s.close();
});

test("concentration: damage to a concentrating creature reminds everyone of the Constitution save; failing it ends the spell", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  await resetSam(D);
  await S.ask("combat:set", { tokenId: samTokenId, concentrating: "Bless" });
  await waitFor(() => hpOf(J, samTokenId).concentrating === "Bless");
  const r = await D.ask("combat:apply", { targets: [{ tokenId: samTokenId, amount: 30 }] });
  assert.equal(r.results[0].concentration.dc, 15);
  await waitFor(() => has(J.all("chat"), "DC 15"));
  const fail = await S.ask("combat:roll", { tokenId: samTokenId, kind: "save", ability: "con", dc: 15, manual: 2, concentration: true });
  assert.equal(fail.success, false);
  assert.equal(fail.dropped, "Bless");
  await waitFor(() => !hpOf(J, samTokenId).concentrating);
  // a hidden monster's concentration is nobody else's business
  D.s.emit("token:update", { id: goblinId, hp: 7 });
  await D.ask("combat:set", { tokenId: goblinId, concentrating: "Hold Person" });
  await pause();
  assert.equal(has(S.all("map"), "Hold Person"), false);
  assert.equal(has(S.all("chat"), "Hold Person"), false);
  await resetSam(D);
  for (const x of [D, S, J]) x.s.close();
});

test("conditions: added with a timer, shown to everyone, and the table is reminded when they should end", async () => {
  const D = await live(dm), S = await live(sam), J = await live(jo);
  D.s.emit("initiative", { op: "clear" });
  D.s.emit("initiative", { op: "add", name: "Mirabel", init: 18, tokenId: samTokenId });
  D.s.emit("initiative", { op: "add", name: "Goblin", init: 12, tokenId: goblinId });
  D.s.emit("initiative", { op: "add", name: "Tobin", init: 5, tokenId: joTokenId });
  await waitFor(() => (D.last("initiative")?.entries?.length ?? 0) === 3);
  // Sam is up (turn 0). The DM makes the goblin prone until the end of its next turn; players can't do that to others
  assert.ok((await S.ask("combat:condition", { tokenId: goblinId, op: "add", name: "Prone" })).error);
  assert.ok((await D.ask("combat:condition", { tokenId: goblinId, op: "add", name: "Prone", ends: { kind: "end" } })).ok);
  assert.ok((await S.ask("combat:condition", { tokenId: samTokenId, op: "add", name: "Poisoned" })).ok);
  await waitFor(() => /Prone/.test(tokenByName(S, "Goblin")?.conditions ?? "") && /Poisoned/.test(tokenByName(J, "Mirabel")?.conditions ?? ""));
  // Next turn is the goblin's (nothing yet), and when it ends the prone is due
  const next = async () => { const n = D.all("chat").length; D.s.emit("initiative", { op: "next" }); await pause(200); return D.all("chat").slice(n); };
  let msgs = await next();
  assert.equal(has(msgs, "Prone"), false);
  msgs = await next();
  assert.equal(has(msgs, "Prone"), true);
  assert.equal(has(S.all("chat"), "Prone"), false); // the goblin is a secret monster: only the DM hears about it
  // players are told about their own character's effects: "for 1 round" fires at the start of Mirabel's next turn
  assert.ok((await S.ask("combat:condition", { tokenId: samTokenId, op: "add", name: "Frightened", ends: { kind: "rounds", rounds: 1 } })).ok);
  await next();
  await waitFor(() => has(S.all("chat"), "Frightened"));
  // removing a condition
  assert.ok((await S.ask("combat:condition", { tokenId: samTokenId, op: "remove", name: "Poisoned" })).ok);
  await waitFor(() => !/Poisoned/.test(tokenByName(J, "Mirabel").conditions));
  D.s.emit("initiative", { op: "clear" });
  for (const x of [D, S, J]) x.s.close();
});

test("narration: only the DM can ask, it needs a real event, and with no API key it says so plainly", async () => {
  const ev = { kind: "hit", attackerId: samTokenId, targetId: goblinId, action: "Warhammer", damageType: "bludgeoning" };
  assert.equal((await sam.post(`/campaigns/${campaignId}/ai/narrate`, { event: ev })).status, 403);
  assert.equal((await dm.post(`/campaigns/${campaignId}/ai/narrate`, { event: { kind: "explode" } })).status, 400);
  const r = await dm.post(`/campaigns/${campaignId}/ai/narrate`, { event: ev });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /AI is not set up/);
});

test("narration: the AI is only given facts players already know (no hidden monsters, HP, AC or stat blocks) and the cost is logged", async () => {
  process.env.DATA_DIR = dataDir;
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const ai = await import("../server/ai.ts");
  const combat = await import("../server/combat.ts");
  const calls: any[] = [];
  ai.setAIClientForTests({ beta: { messages: { create: async (req: any) => {
    calls.push(req);
    return { stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 120, output_tokens: 45 }, content: [{ type: "text", text: "Mirabel's warhammer crunches into the goblin." }] };
  } } } });
  try {
    // A visible, wounded goblin hit by a player character
    await dm.post(`/campaigns/${campaignId}/table/monsters`, { monster: (await dm.get("/srd/monster/Wolf")).data, count: 1, initiative: "none", x: 300, y: 300, name: "Wolf" });
    const D = await live(dm);
    await waitFor(() => !!tokenByName(D, "Wolf"));
    const wolfId = tokenByName(D, "Wolf").id;
    await D.ask("combat:apply", { targets: [{ tokenId: wolfId, amount: 9 }] }); // 11 HP -> 2: near death
    D.s.close();
    const visible = combat.narrationFacts(campaignId, { kind: "hit", attackerId: samTokenId, targetId: wolfId, action: "Warhammer", damageType: "bludgeoning", melee: true });
    assert.match(visible, /Attacker: Mirabel, a player character/);
    assert.match(visible, /Target: Wolf, a monster/);
    assert.match(visible, /near death/);
    assert.equal(/\b(HP|hit points?:|AC|armor class)\b/i.test(visible.replace("0 hit points", "")), false);
    assert.equal(/\b11\b|\b2 HP\b/.test(visible), false);
    // A hidden monster (the orc) is never named, whether it attacks or is attacked
    const hiddenAttack = combat.narrationFacts(campaignId, { kind: "crit", attackerId: hiddenId, targetId: samTokenId, action: "Greataxe" });
    assert.equal(has(hiddenAttack, "Orc"), false);
    assert.match(hiddenAttack, /unseen creature/);
    const hiddenTarget = combat.narrationFacts(campaignId, { kind: "kill", attackerId: samTokenId, targetId: hiddenId });
    assert.equal(has(hiddenTarget, "Orc"), false);
    // Facts only: nothing from the stat block, DM notes or other tokens sneaks in
    await dm.patch(`/campaigns/${campaignId}`, { dmNotes: "The Orc is secretly the duke's son" });
    // the AI call itself: short, cheap, uses the assistant model setting, logs its cost, and sends only the facts
    const text = await ai.narrateCombat(campaignId, 1, hiddenAttack + "\nTone: grim");
    assert.equal(text, "Mirabel's warhammer crunches into the goblin.");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].max_tokens <= 400);
    const sent = JSON.stringify(calls[0]);
    for (const bad of ["Orc", "duke", "Scimitar", "Nimble Escape", "dm_key", "DM's private"]) assert.equal(sent.includes(bad), false, `AI request contained "${bad}"`);
    const rerolled = await ai.narrateCombat(campaignId, 1, visible, "the old text");
    assert.ok(rerolled && has(calls[1], "clearly different"));
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(path.join(dataDir, "grumbling-gnoll.db"), { readonly: true });
    const rows = db.prepare("SELECT kind, cost_usd, output_tokens FROM ai_history WHERE kind = 'narration'").all() as any[];
    db.close();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.cost_usd > 0 && r.output_tokens === 45));
  } finally {
    ai.setAIClientForTests(null);
  }
});
