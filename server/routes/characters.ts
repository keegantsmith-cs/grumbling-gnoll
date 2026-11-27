import { Router } from "express";
import { all, one, parseJSON, run, type Row } from "../db.ts";
import { campaignRole, requireUser } from "../auth.ts";
import { campaignAccess, campaignContext, HttpError, num, sheetUpload } from "../helpers.ts";
import { notify, broadcastMap, postChat } from "../realtime.ts";
import { describeRoll, diceList, rollDice } from "../../shared/dice.ts";
import { aiEnabled, characterArtPrompt, fixCharacter, reviewCharacter, scanCharacterSheet, type SheetFile } from "../ai.ts";
import { PDFDocument, PDFCheckBox, PDFTextField, PDFDropdown } from "pdf-lib";
import { discordAlertDM } from "../discord.ts";
import { characterSheetPdf } from "../sheetpdf.ts";
import { derive, diffCharacter, normalizeCharacter, type CharacterData, type RulesVersion } from "../../shared/character.ts";

export const characterRoutes = Router();
characterRoutes.use(requireUser);

function rulesOf(campaignId: number | null): RulesVersion {
  if (!campaignId) return "2014";
  return (one("SELECT rules_version FROM campaigns WHERE id = ?", campaignId)?.rules_version ?? "2014") as RulesVersion;
}

function characterOut(c: Row, viewerId: number) {
  const role = c.campaign_id ? campaignRole(c.campaign_id, viewerId) : undefined;
  const isOwner = c.owner_id === viewerId;
  const isDM = role === "dm";
  const pending = isOwner || isDM ? one("SELECT * FROM character_changes WHERE character_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", c.id) : undefined;
  const lastReview = isOwner || isDM
    ? one("SELECT status, dm_comment AS dmComment, reviewed_at AS reviewedAt FROM character_changes WHERE character_id = ? AND status != 'pending' ORDER BY id DESC LIMIT 1", c.id)
    : undefined;
  return {
    id: c.id,
    ownerId: c.owner_id,
    ownerName: c.owner_name,
    campaignId: c.campaign_id,
    campaignName: c.campaign_name,
    status: c.status,
    name: c.name,
    data: normalizeCharacter(parseJSON(c.data, {}), rulesOf(c.campaign_id)),
    pending: pending
      ? { id: pending.id, kind: pending.kind, note: pending.note, data: normalizeCharacter(parseJSON(pending.proposed, {})), aiReview: parseJSON(pending.ai_review, null), createdAt: pending.created_at }
      : null,
    lastReview: lastReview ?? null,
    canEdit: isOwner || isDM,
    isDM,
    // Secret DM notes go only to this campaign's DM
    dmNotes: isDM ? one("SELECT notes FROM character_dm_notes WHERE character_id = ?", c.id)?.notes ?? "" : undefined,
  };
}

const SELECT = `SELECT c.*, u.display_name AS owner_name, cp.name AS campaign_name FROM characters c
  JOIN users u ON u.id = c.owner_id LEFT JOIN campaigns cp ON cp.id = c.campaign_id`;

function loadCharacter(id: number, viewerId: number, needEdit = false) {
  const c = one(`${SELECT} WHERE c.id = ?`, id);
  if (!c) throw new HttpError(404, "Character not found");
  const role = c.campaign_id ? campaignRole(c.campaign_id, viewerId) : undefined;
  const isOwner = c.owner_id === viewerId;
  if (!isOwner && !role) throw new HttpError(404, "Character not found");
  if (needEdit && !isOwner && role !== "dm") throw new HttpError(403, "That's not your character");
  return { c, isOwner, isDM: role === "dm" };
}

function cleanData(raw: unknown, rules: RulesVersion): CharacterData {
  const d = normalizeCharacter(raw, rules);
  const s = JSON.stringify(d);
  if (s.length > 500_000) throw new HttpError(400, "That character sheet is too large");
  d.name = String(d.name || "Unnamed").slice(0, 80);
  return d;
}

/** Runs the AI rules check in the background and stores the result on the change. */
async function runReview(changeId: number, userId: number) {
  const ch = one("SELECT cc.*, c.campaign_id, c.data AS current FROM character_changes cc JOIN characters c ON c.id = cc.character_id WHERE cc.id = ?", changeId);
  if (!ch || !ch.campaign_id || !aiEnabled()) return;
  run("UPDATE character_changes SET ai_review = ?, ai_fix = NULL WHERE id = ?", JSON.stringify({ status: "running" }), changeId);
  notify(ch.campaign_id, "approvals");
  try {
    const proposed = normalizeCharacter(parseJSON(ch.proposed, {}), rulesOf(ch.campaign_id));
    const char = one("SELECT status FROM characters WHERE id = ?", ch.character_id)!;
    const previous = char.status === "approved" && ch.kind === "update" ? parseJSON(ch.current, null) : null;
    const reason =
      ch.kind === "import"
        ? "This character was brought over from another campaign (or uploaded from a file). Check it carefully for correctness under this campaign's rules."
        : ch.kind === "create"
          ? "This is a brand-new character submitted for approval."
          : "The player edited their character (for example, leveled up) and submitted the changes for approval.";
    const review = await reviewCharacter({ campaign: campaignContext(ch.campaign_id), userId, character: proposed, derived: derive(proposed), previous, reason });
    run("UPDATE character_changes SET ai_review = ? WHERE id = ?", JSON.stringify({ status: "done", ...review }), changeId);
    const verdict = { looks_good: "✅ Looks good", minor_issues: "⚠️ Minor issues", needs_changes: "❌ Needs changes" }[review.verdict];
    discordAlertDM(ch.campaign_id, `🧙 AI check finished: ${proposed.name}`, `${verdict}: ${review.summary}`, `/#/c/${ch.campaign_id}/approvals`);
  } catch (e) {
    run("UPDATE character_changes SET ai_review = ? WHERE id = ?", JSON.stringify({ status: "error", error: (e as Error).message }), changeId);
  }
  notify(ch.campaign_id, "approvals");
}

function submitChange(characterId: number, userId: number, kind: "create" | "update" | "import", data: CharacterData, note: string) {
  const info = one("SELECT c.campaign_id, u.display_name FROM characters c, users u WHERE c.id = ? AND u.id = ?", characterId, userId);
  if (info?.campaign_id && campaignRole(info.campaign_id, userId) !== "dm") {
    const what = { create: "submitted a new character", update: "submitted changes to", import: "brought in a character from another campaign:" }[kind];
    discordAlertDM(info.campaign_id, "📝 Waiting for your approval", `**${info.display_name}** ${what} **${data.name}**${note ? `\n> ${note}` : ""}`, `/#/c/${info.campaign_id}/approvals`);
  }
  // One pending change per character: a new submission replaces the old one.
  run("DELETE FROM character_changes WHERE character_id = ? AND status = 'pending'", characterId);
  const r = run(
    "INSERT INTO character_changes (character_id, submitted_by, kind, proposed, note) VALUES (?,?,?,?,?)",
    characterId,
    userId,
    kind,
    JSON.stringify(data),
    note.slice(0, 1000),
  );
  return Number(r.lastInsertRowid);
}

characterRoutes.get("/characters", (req, res) => {
  const uid = req.user!.id;
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
  let rows: Row[];
  if (campaignId) {
    const role = campaignRole(campaignId, uid);
    if (!role) throw new HttpError(404, "Campaign not found");
    rows = all(`${SELECT} WHERE c.campaign_id = ? AND (c.status = 'approved' OR c.owner_id = ? OR ?) ORDER BY c.name`, campaignId, uid, role === "dm" ? 1 : 0);
  } else {
    rows = all(`${SELECT} WHERE c.owner_id = ? ORDER BY c.updated_at DESC`, uid);
  }
  res.json(rows.map((c) => characterOut(c, uid)));
});

characterRoutes.get("/characters/:id", (req, res) => {
  const { c } = loadCharacter(num(req.params.id), req.user!.id);
  res.json(characterOut(c, req.user!.id));
});

characterRoutes.post("/characters", (req, res) => {
  const uid = req.user!.id;
  const campaignId = req.body?.campaignId ? Number(req.body.campaignId) : null;
  const role = campaignId ? campaignRole(campaignId, uid) : undefined;
  if (campaignId && !role) throw new HttpError(404, "Campaign not found");
  const data = cleanData(req.body?.data, rulesOf(campaignId));
  // Characters outside a campaign, or made by the DM, don't need approval.
  const autoApprove = !campaignId || role === "dm";
  const r = run(
    "INSERT INTO characters (owner_id, campaign_id, name, data, status) VALUES (?,?,?,?,?)",
    uid,
    campaignId,
    data.name,
    JSON.stringify(data),
    autoApprove ? "approved" : "pending",
  );
  const id = Number(r.lastInsertRowid);
  const note = [String(req.body?.note ?? ""), rollSummary(uid, campaignId, req.body?.rollIds)].filter(Boolean).join("\n");
  if (!autoApprove) submitChange(id, uid, "create", data, note);
  if (campaignId) notify(campaignId, "characters");
  res.json({ id });
});

// ---------- dice for the character creator (rolled here so nobody can fudge them) ----------
const CREATOR_ROLLS: Record<string, (p: any) => { expr: string; times: number; label: string }> = {
  abilities: () => ({ expr: "4d6dl1", times: 6, label: "ability scores (4d6, drop lowest)" }),
  hp: (p) => {
    const die = [6, 8, 10, 12].includes(Number(p.hitDie)) ? Number(p.hitDie) : 8;
    const times = Math.max(1, Math.min(19, Math.round(Number(p.levels) || 1)));
    return { expr: `1d${die}`, times, label: `hit points (${times} × d${die})` };
  },
  gold: (p) => {
    const m = String(p.dice ?? "").match(/^([2-5])d4$/);
    const mult = Number(p.multiplier) === 1 ? 1 : 10;
    return { expr: m ? m[0] : "4d4", times: 1, label: `starting gold (${m ? m[0] : "4d4"}${mult === 10 ? " × 10" : ""})`, mult } as any;
  },
};

characterRoutes.post("/characters/creator-roll", (req, res) => {
  const uid = req.user!.id;
  const kind = String(req.body?.kind ?? "");
  const make = CREATOR_ROLLS[kind];
  if (!make) throw new HttpError(400, "Unknown roll");
  const campaignId = req.body?.campaignId ? Number(req.body.campaignId) : null;
  if (campaignId && !campaignRole(campaignId, uid)) throw new HttpError(404, "Campaign not found");
  const spec = make(req.body ?? {}) as { expr: string; times: number; label: string; mult?: number };
  const rolls = Array.from({ length: spec.times }, () => rollDice(spec.expr));
  let values = rolls.map((r) => r.total);
  if (kind === "gold") values = [values[0] * (spec.mult ?? 10)];
  const detail = rolls.map((r) => describeRoll(r)).join("; ");
  const r = run("INSERT INTO character_rolls (user_id, campaign_id, kind, result) VALUES (?,?,?,?)", uid, campaignId, kind, JSON.stringify({ values, detail, label: spec.label }));
  // Everyone at the table sees creation rolls, like rolling at a real table
  if (campaignId) {
    const total = kind === "abilities" ? values.join(", ") : String(values.reduce((a, b) => a + b, 0));
    postChat(campaignId, uid, "roll", { expression: spec.expr + (spec.times > 1 ? ` ×${spec.times}` : ""), label: `Character creation: ${spec.label}`, total, detail, dice: rolls.flatMap((x) => diceList(x)).slice(0, 30) });
  }
  const rollCount = one("SELECT COUNT(*) AS n FROM character_rolls WHERE user_id = ? AND kind = ? AND created_at >= datetime('now', '-1 day')", uid, kind)!.n;
  res.json({ rollId: Number(r.lastInsertRowid), values, detail, rollCount });
});

function rollSummary(uid: number, campaignId: number | null, ids: unknown): string {
  if (!Array.isArray(ids) || !ids.length) return "";
  const rows = ids.slice(0, 10).map((id) => one("SELECT * FROM character_rolls WHERE id = ? AND user_id = ? AND used = 0", Number(id), uid)).filter(Boolean) as Row[];
  const lines = rows.map((r) => {
    const v = parseJSON<{ values: number[]; label: string }>(r.result, { values: [], label: r.kind });
    const tries = one("SELECT COUNT(*) AS n FROM character_rolls WHERE user_id = ? AND kind = ? AND created_at BETWEEN datetime(?, '-1 day') AND ?", uid, r.kind, r.created_at, r.created_at)!.n;
    return `Rolled on the site: ${v.label} = ${v.values.join(", ")}${tries > 1 ? ` (rolled ${tries} times in the 24 hours before)` : ""}`;
  });
  for (const r of rows) run("UPDATE character_rolls SET used = 1 WHERE id = ?", r.id);
  return lines.join("\n");
}

// Full edit. Players' edits wait for the DM; the DM's edits apply right away.
characterRoutes.put("/characters/:id", (req, res) => {
  const uid = req.user!.id;
  const { c, isDM } = loadCharacter(num(req.params.id), uid, true);
  const data = cleanData(req.body?.data, rulesOf(c.campaign_id));
  if (isDM || !c.campaign_id) {
    run("UPDATE characters SET data = ?, name = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(data), data.name, c.id);
    if (c.campaign_id) notify(c.campaign_id, "characters");
    return res.json({ applied: true });
  }
  // A character that was never approved has no "official" version to protect, so show the latest draft everywhere.
  if (c.status !== "approved") run("UPDATE characters SET data = ?, name = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(data), data.name, c.id);
  const kind = c.status === "approved" ? "update" : (one("SELECT kind FROM character_changes WHERE character_id = ? AND status = 'pending'", c.id)?.kind ?? "create");
  const changeId = submitChange(c.id, uid, kind, data, String(req.body?.note ?? ""));
  notify(c.campaign_id, "approvals");
  res.json({ applied: false, changeId });
});

// In-play tracking: HP, slots, death saves, etc. These change every session, so no approval needed.
characterRoutes.patch("/characters/:id/play", (req, res) => {
  const uid = req.user!.id;
  const { c } = loadCharacter(num(req.params.id), uid, true);
  const data = normalizeCharacter(parseJSON(c.data, {}), rulesOf(c.campaign_id));
  const b = req.body ?? {};
  if (b.hp) {
    if (b.hp.current !== undefined) data.hp.current = Number(b.hp.current) || 0;
    if (b.hp.temp !== undefined) data.hp.temp = Math.max(0, Number(b.hp.temp) || 0);
  }
  if (b.deathSaves) data.deathSaves = { successes: Math.min(3, Number(b.deathSaves.successes) || 0), failures: Math.min(3, Number(b.deathSaves.failures) || 0) };
  if (Array.isArray(b.spellSlotsUsed)) data.spellSlotsUsed = b.spellSlotsUsed.slice(0, 9).map((n: unknown) => Math.max(0, Number(n) || 0));
  if (b.pactSlotsUsed !== undefined) data.pactSlotsUsed = Math.max(0, Number(b.pactSlotsUsed) || 0);
  if (b.inspiration !== undefined) data.inspiration = !!b.inspiration;
  if (typeof b.notes === "string") data.notes = b.notes.slice(0, 50000);
  if (typeof b.fullBodyUrl === "string") {
    const u = b.fullBodyUrl.trim();
    if (u && !/^\/uploads\/[\w.-]+$/.test(u)) throw new HttpError(400, "That picture link isn't valid");
    data.fullBodyUrl = u;
    run("UPDATE character_changes SET proposed = json_set(proposed, '$.fullBodyUrl', ?) WHERE character_id = ? AND status = 'pending'", u, c.id);
  }
  // A new portrait doesn't change any rules, so it doesn't need DM approval
  if (typeof b.portraitUrl === "string") {
    const u = b.portraitUrl.trim();
    if (u && !/^\/uploads\/[\w.-]+$/.test(u) && !/^https:\/\/\S+$/.test(u)) throw new HttpError(400, "That picture link isn't valid");
    data.portraitUrl = u;
    run("UPDATE character_changes SET proposed = json_set(proposed, '$.portraitUrl', ?) WHERE character_id = ? AND status = 'pending'", u, c.id);
    run("UPDATE tokens SET image_url = ? WHERE character_id = ? AND (? = '' OR ? LIKE '/uploads/%')", u || null, c.id, u, u);
    if (c.campaign_id) broadcastMap(c.campaign_id);
  }
  run("UPDATE characters SET data = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(data), c.id);
  // keep linked tokens' HP in sync
  if (b.hp?.current !== undefined) {
    run("UPDATE tokens SET hp = ? WHERE character_id = ?", data.hp.current, c.id);
    if (c.campaign_id) broadcastMap(c.campaign_id);
  }
  if (c.campaign_id) notify(c.campaign_id, "characters");
  res.json({ ok: true });
});

// Bring a character into another campaign (copy). Gets an automatic AI rules check.
// Ask the AI for a picture description to paste into an image generator
characterRoutes.post("/characters/:id/art-prompt", async (req, res) => {
  const { c } = loadCharacter(num(req.params.id), req.user!.id, true);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  const d = normalizeCharacter(parseJSON(c.data, {}));
  const prompt = await characterArtPrompt(c.campaign_id, req.user!.id, d, String(req.body?.style ?? "").slice(0, 200), req.body?.framing === "fullbody" ? "fullbody" : "portrait");
  res.json({ prompt });
});

characterRoutes.post("/characters/:id/import", async (req, res) => {
  const uid = req.user!.id;
  const { c } = loadCharacter(num(req.params.id), uid);
  if (c.owner_id !== uid) throw new HttpError(403, "You can only bring over your own characters");
  const target = num(req.body?.campaignId);
  const role = campaignRole(target, uid);
  if (!role) throw new HttpError(404, "Campaign not found");
  const data = cleanData(parseJSON(c.data, {}), rulesOf(target));
  const from = c.campaign_name ? `"${c.campaign_name}"` : "your personal characters";
  data.rulesVersion = rulesOf(target);
  const r = run("INSERT INTO characters (owner_id, campaign_id, name, data, status) VALUES (?,?,?,?, 'pending')", uid, target, data.name, JSON.stringify(data));
  const id = Number(r.lastInsertRowid);
  const changeId = submitChange(id, uid, "import", data, `Brought over from ${from}. ${String(req.body?.note ?? "")}`.trim());
  notify(target, "approvals");
  res.json({ id });
  void runReview(changeId, uid);
});

// Upload a character file (exported from this app) into a campaign
characterRoutes.post("/characters/upload", (req, res) => {
  const uid = req.user!.id;
  const target = num(req.body?.campaignId);
  if (!campaignRole(target, uid)) throw new HttpError(404, "Campaign not found");
  const raw = req.body?.data?.data ?? req.body?.data; // accept an exported wrapper or bare data
  const data = cleanData(raw, rulesOf(target));
  data.rulesVersion = rulesOf(target);
  const r = run("INSERT INTO characters (owner_id, campaign_id, name, data, status) VALUES (?,?,?,?, 'pending')", uid, target, data.name, JSON.stringify(data));
  const id = Number(r.lastInsertRowid);
  const changeId = submitChange(id, uid, "import", data, "Uploaded from a file.");
  notify(target, "approvals");
  res.json({ id });
  void runReview(changeId, uid);
});

// Read a photo / scan / PDF of a filled-in character sheet with the AI and turn it into a character.
characterRoutes.post("/characters/scan", sheetUpload.array("files", 8), async (req, res) => {
  const uid = req.user!.id;
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  const campaignId = req.body?.campaignId ? Number(req.body.campaignId) : null;
  const role = campaignId ? campaignRole(campaignId, uid) : undefined;
  if (campaignId && !role) throw new HttpError(404, "Campaign not found");
  const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!uploaded.length) throw new HttpError(400, "Add at least one photo or PDF of the sheet");

  const files: SheetFile[] = [];
  for (const f of uploaded) {
    if (f.mimetype === "application/pdf") {
      files.push({ kind: "pdf", mediaType: f.mimetype, base64: f.buffer.toString("base64"), formFields: await pdfFormFields(f.buffer) });
    } else {
      if (f.size > 5 * 1024 * 1024) throw new HttpError(400, `${f.originalname} is too large (5 MB max per photo)`);
      files.push({ kind: "image", mediaType: f.mimetype === "image/jpg" ? "image/jpeg" : f.mimetype, base64: f.buffer.toString("base64") });
    }
  }
  const rules = rulesOf(campaignId);
  const s = await scanCharacterSheet({ campaignId, userId: uid, files, rulesVersion: rules });

  const data = cleanData({
    name: s.name || "Imported Character",
    rulesVersion: rules,
    species: s.species,
    background: s.background,
    alignment: s.alignment,
    classes: s.classes.length ? s.classes.map((c) => ({ name: c.name, subclass: c.subclass, level: Math.max(1, Math.min(20, Math.round(c.level) || 1)) })) : undefined,
    experience: s.experience,
    abilities: s.abilities,
    saveProficiencies: s.saveProficiencies,
    skillProficiencies: s.skillProficiencies,
    skillExpertise: s.skillExpertise,
    hp: { max: s.hpMax, current: s.hpCurrent ?? s.hpMax ?? 10, temp: s.hpTemp },
    ac: s.armorClass,
    speed: s.speed || 30,
    attacks: s.attacks,
    spells: s.spells.map((sp) => ({ ...sp, level: Math.max(0, Math.min(9, Math.round(sp.level))), notes: "" })),
    inventory: s.inventory.map((it) => ({ ...it, weight: 0, notes: "" })),
    currency: s.currency,
    features: s.features,
    proficienciesText: s.proficienciesText,
    personality: s.personality,
    backstory: s.backstory,
    notes: s.notes,
  }, rules);

  const note = `Imported from ${uploaded.length === 1 ? "a picture/PDF" : `${uploaded.length} pictures/PDFs`} of a character sheet.${s.readingProblems ? ` The AI wasn't sure about: ${s.readingProblems}` : ""}`;
  const autoApprove = !campaignId || role === "dm";
  const r = run("INSERT INTO characters (owner_id, campaign_id, name, data, status) VALUES (?,?,?,?,?)", uid, campaignId, data.name, JSON.stringify(data), autoApprove ? "approved" : "pending");
  const id = Number(r.lastInsertRowid);
  if (!autoApprove) {
    const changeId = submitChange(id, uid, "import", data, note);
    notify(campaignId!, "approvals");
    void runReview(changeId, uid);
  } else if (campaignId) notify(campaignId, "characters");
  res.json({ id, readingProblems: s.readingProblems });
});

/** Values typed into a fillable PDF sheet, as "field: value" lines. */
async function pdfFormFields(buf: Buffer): Promise<string | undefined> {
  try {
    const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
    const lines: string[] = [];
    for (const f of pdf.getForm().getFields()) {
      let v = "";
      if (f instanceof PDFTextField) v = f.getText() ?? "";
      else if (f instanceof PDFCheckBox) v = f.isChecked() ? "checked" : "";
      else if (f instanceof PDFDropdown) v = f.getSelected().join(", ");
      if (v.trim()) lines.push(`${f.getName()}: ${v.trim()}`);
    }
    return lines.length ? lines.join("\n").slice(0, 60000) : undefined;
  } catch {
    return undefined;
  }
}

// What happened to this character over time: approvals, send-backs, and every AI adjustment with its reasons.
characterRoutes.get("/characters/:id/history", (req, res) => {
  const { c, isOwner, isDM } = loadCharacter(num(req.params.id), req.user!.id);
  if (!isOwner && !isDM) throw new HttpError(403, "Only the player and the DM can see this character's history");
  const rows = all(
    `SELECT cc.*, u.display_name AS submitter FROM character_changes cc JOIN users u ON u.id = cc.submitted_by
     WHERE cc.character_id = ? AND cc.status != 'pending' ORDER BY cc.reviewed_at DESC, cc.id DESC LIMIT 60`,
    c.id,
  );
  const rules = rulesOf(c.campaign_id);
  res.json(rows.map((r) => {
    const fix = r.ai_fix_applied ? parseJSON<any>(r.ai_fix, null) : null;
    const proposed = normalizeCharacter(parseJSON(r.proposed, {}), rules);
    const review = parseJSON<any>(r.ai_review, null);
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      submitter: r.submitter,
      submittedAt: r.created_at,
      reviewedAt: r.reviewed_at,
      note: r.note,
      dmComment: r.dm_comment,
      aiCheck: review?.status === "done" ? { verdict: review.verdict, summary: review.summary } : null,
      aiFix: fix?.status === "done"
        ? {
            summary: fix.summary,
            reasons: (fix.changes ?? []).filter((x: any) => x.ok).map((x: any) => ({ field: x.field, reason: x.reason })),
            changes: diffCharacter(proposed, normalizeCharacter(fix.data, rules)),
          }
        : null,
    };
  }));
});

// DM-only notes about a character
characterRoutes.put("/characters/:id/dm-notes", (req, res) => {
  const { c, isDM } = loadCharacter(num(req.params.id), req.user!.id);
  if (!isDM) throw new HttpError(403, "Only the DM can see or edit these notes");
  const notes = String(req.body?.notes ?? "").slice(0, 50000);
  run("INSERT INTO character_dm_notes (character_id, notes, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(character_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at", c.id, notes);
  res.json({ ok: true });
});

// Printable PDF of the character sheet (owner, DM, and the rest of the party can download it)
characterRoutes.get("/characters/:id/pdf", async (req, res) => {
  const { c, isOwner, isDM } = loadCharacter(num(req.params.id), req.user!.id);
  if (!isOwner && !isDM && c.status !== "approved") throw new HttpError(404, "Character not found");
  const data = normalizeCharacter(parseJSON(c.data, {}), rulesOf(c.campaign_id));
  const bytes = await characterSheetPdf(data, { player: c.owner_name, campaign: c.campaign_name, status: c.status });
  const file = `${data.name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "_") || "character"}_Grumbling_Gnoll.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
  res.send(Buffer.from(bytes));
});

// The DM can hand a character to a player (e.g. a pregenerated hero, or one the DM built for them)
characterRoutes.post("/characters/:id/owner", (req, res) => {
  const { c, isDM } = loadCharacter(num(req.params.id), req.user!.id);
  if (!c.campaign_id || !isDM) throw new HttpError(403, "Only the campaign's DM can change who plays a character");
  const userId = num(req.body?.userId);
  if (!one("SELECT id FROM users WHERE id = ?", userId)) throw new HttpError(404, "No such player");
  // Giving a character to someone who isn't in the campaign yet adds them as a player
  if (!campaignRole(c.campaign_id, userId)) run("INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, role) VALUES (?,?, 'player')", c.campaign_id, userId);
  run("UPDATE characters SET owner_id = ?, updated_at = datetime('now') WHERE id = ?", userId, c.id);
  // Map tokens for this character follow the new player
  run("UPDATE tokens SET controlled_by = ? WHERE character_id = ?", userId, c.id);
  broadcastMap(c.campaign_id);
  notify(c.campaign_id, "characters");
  notify(c.campaign_id, "campaign");
  res.json({ ok: true });
});

characterRoutes.delete("/characters/:id", (req, res) => {
  const { c } = loadCharacter(num(req.params.id), req.user!.id, true);
  run("DELETE FROM characters WHERE id = ?", c.id);
  if (c.campaign_id) notify(c.campaign_id, "characters");
  res.json({ ok: true });
});

// ---------- DM approvals ----------

characterRoutes.get("/campaigns/:id/approvals", (req, res) => {
  const { id } = campaignAccess(req, true);
  const rows = all(
    `SELECT cc.*, c.data AS current, c.status AS char_status, c.name AS char_name, u.display_name AS submitter
     FROM character_changes cc JOIN characters c ON c.id = cc.character_id JOIN users u ON u.id = cc.submitted_by
     WHERE c.campaign_id = ? AND cc.status = 'pending' ORDER BY cc.created_at`,
    id,
  );
  const rules = rulesOf(id);
  res.json(
    rows.map((r) => {
      const proposed = normalizeCharacter(parseJSON(r.proposed, {}), rules);
      const current = r.char_status === "approved" ? normalizeCharacter(parseJSON(r.current, {}), rules) : null;
      return {
        id: r.id,
        characterId: r.character_id,
        characterName: proposed.name || r.char_name,
        submitter: r.submitter,
        kind: r.kind,
        note: r.note,
        createdAt: r.created_at,
        changes: diffCharacter(current, proposed),
        proposed,
        aiReview: parseJSON(r.ai_review, null),
        aiFix: parseJSON(r.ai_fix, null),
      };
    }),
  );
});

function loadChange(req: { params: Record<string, string>; user?: Row }) {
  const ch = one("SELECT cc.*, c.campaign_id FROM character_changes cc JOIN characters c ON c.id = cc.character_id WHERE cc.id = ?", num(req.params.changeId));
  if (!ch || campaignRole(ch.campaign_id, req.user!.id) !== "dm") throw new HttpError(404, "Change not found");
  if (ch.status !== "pending") throw new HttpError(400, "That change was already reviewed");
  return ch;
}

characterRoutes.post("/changes/:changeId/approve", (req, res) => {
  const ch = loadChange(req);
  // The DM may approve with the AI's suggested fixes, or tweak the sheet before approving.
  const aiFix = parseJSON<any>(ch.ai_fix, null);
  const useAiFix = !!req.body?.useAiFix && aiFix?.status === "done";
  const data = useAiFix ? cleanData(aiFix.data, rulesOf(ch.campaign_id))
    : req.body?.data ? cleanData(req.body.data, rulesOf(ch.campaign_id)) : normalizeCharacter(parseJSON(ch.proposed, {}));
  // Keep in-play values (HP, slots used...) that changed during play while the change was waiting.
  const live = one("SELECT data, status FROM characters WHERE id = ?", ch.character_id)!;
  if (live.status === "approved") {
    const cur = normalizeCharacter(parseJSON(live.data, {}));
    data.hp.current = cur.hp.current;
    data.hp.temp = cur.hp.temp;
    data.deathSaves = cur.deathSaves;
    data.spellSlotsUsed = cur.spellSlotsUsed;
    data.pactSlotsUsed = cur.pactSlotsUsed;
    data.inspiration = cur.inspiration;
  }
  run("UPDATE characters SET data = ?, name = ?, status = 'approved', updated_at = datetime('now') WHERE id = ?", JSON.stringify(data), data.name, ch.character_id);
  run("UPDATE character_changes SET status = 'approved', dm_comment = ?, ai_fix_applied = ?, reviewed_at = datetime('now') WHERE id = ?", String(req.body?.comment ?? "").slice(0, 2000), useAiFix ? 1 : 0, ch.id);
  notify(ch.campaign_id, "characters");
  notify(ch.campaign_id, "approvals");
  res.json({ ok: true });
});

characterRoutes.post("/changes/:changeId/reject", (req, res) => {
  const ch = loadChange(req);
  run("UPDATE character_changes SET status = 'rejected', dm_comment = ?, reviewed_at = datetime('now') WHERE id = ?", String(req.body?.comment ?? "").slice(0, 2000), ch.id);
  notify(ch.campaign_id, "characters");
  notify(ch.campaign_id, "approvals");
  res.json({ ok: true });
});

// Ask the AI to prepare fixes for the problems its check found. Nothing changes until the DM approves.
characterRoutes.post("/changes/:changeId/ai-fix", (req, res) => {
  const ch = loadChange(req);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  const review = parseJSON<any>(ch.ai_review, null);
  if (review?.status !== "done" || !review.issues?.length) throw new HttpError(400, "Run the AI check first. It needs to find something to fix.");
  void runFix(ch.id, req.user!.id);
  res.json({ ok: true });
});

characterRoutes.post("/changes/:changeId/ai-fix/discard", (req, res) => {
  const ch = loadChange(req);
  run("UPDATE character_changes SET ai_fix = NULL WHERE id = ?", ch.id);
  notify(ch.campaign_id, "approvals");
  res.json({ ok: true });
});

async function runFix(changeId: number, userId: number) {
  const ch = one("SELECT cc.*, c.campaign_id FROM character_changes cc JOIN characters c ON c.id = cc.character_id WHERE cc.id = ?", changeId)!;
  run("UPDATE character_changes SET ai_fix = ? WHERE id = ?", JSON.stringify({ status: "running" }), changeId);
  notify(ch.campaign_id, "approvals");
  try {
    const rules = rulesOf(ch.campaign_id);
    const proposed = normalizeCharacter(parseJSON(ch.proposed, {}), rules);
    const review = parseJSON<any>(ch.ai_review, {});
    const issues = (review.issues ?? []).map((i: any) => `- [${i.severity}] ${i.area}: ${i.problem} (suggestion: ${i.suggestion})`).join("\n");
    const fix = await fixCharacter({ campaign: campaignContext(ch.campaign_id), userId, character: proposed, derived: derive(proposed), issues });
    // Apply each edit to a copy, skipping anything malformed
    const fixed: any = structuredClone(proposed);
    const applied = fix.changes.map((c) => {
      try {
        const value = JSON.parse(c.value_json);
        const [a, b] = c.field.split(".");
        if (b) fixed[a] = { ...(fixed[a] ?? {}), [b]: value };
        else fixed[a] = value;
        return { field: c.field, reason: c.reason, ok: true };
      } catch {
        return { field: c.field, reason: c.reason, ok: false };
      }
    });
    const data = cleanData(fixed, rules);
    run("UPDATE character_changes SET ai_fix = ? WHERE id = ?", JSON.stringify({ status: "done", summary: fix.summary, changes: applied, data }), changeId);
  } catch (e) {
    run("UPDATE character_changes SET ai_fix = ? WHERE id = ?", JSON.stringify({ status: "error", error: (e as Error).message }), changeId);
  }
  notify(ch.campaign_id, "approvals");
}

characterRoutes.post("/changes/:changeId/ai-review", (req, res) => {
  const ch = loadChange(req);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  void runReview(ch.id, req.user!.id);
  res.json({ ok: true });
});
