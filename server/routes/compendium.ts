import { Router } from "express";
import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { all, one, parseJSON, run } from "../db.ts";
import { requireUser } from "../auth.ts";
import { campaignAccess, campaignAccessById, campaignContext, HttpError, num, pdfUpload } from "../helpers.ts";
import { notify } from "../realtime.ts";
import { aiEnabled, convertPdfChunk, describeThing, EDITIONS, npcStatBlock } from "../ai.ts";
import { discordAlertDM } from "../discord.ts";

export const compendiumRoutes = Router();
compendiumRoutes.use(requireUser);

const KINDS = ["monster", "item", "npc", "note", "spell"];

const entryOut = (e: any) => ({
  id: e.id,
  campaignId: e.campaign_id,
  kind: e.kind,
  name: e.name,
  data: parseJSON<Record<string, any>>(e.data, {}),
  source: e.source,
  sourceEdition: e.source_edition,
  status: e.status,
  playerVisible: !!e.player_visible,
  uploadId: e.upload_id,
  adventureId: e.adventure_id,
  createdAt: e.created_at,
});

compendiumRoutes.get("/campaigns/:id/compendium", (req, res) => {
  const { id, isDM } = campaignAccess(req);
  const rows = isDM
    ? all("SELECT * FROM compendium WHERE campaign_id = ? ORDER BY status = 'approved', kind, name", id)
    : all("SELECT * FROM compendium WHERE campaign_id = ? AND ((status = 'approved' AND player_visible = 1) OR created_by = ?) ORDER BY kind, name", id, req.user!.id);
  const out = rows.map(entryOut);
  if (!isDM) for (const e of out) if (e.kind === "npc") { delete e.data.statblock; delete e.data.statReference; } // NPC stats stay secret
  res.json(out);
});

compendiumRoutes.post("/campaigns/:id/compendium", (req, res) => {
  const { id } = campaignAccess(req, true);
  const b = req.body ?? {};
  if (!KINDS.includes(b.kind)) throw new HttpError(400, "Unknown entry type");
  const name = String(b.name || b.data?.name || "Untitled").slice(0, 120);
  const r = run(
    "INSERT INTO compendium (campaign_id, kind, name, data, source, source_edition, status, player_visible, created_by) VALUES (?,?,?,?,?,?,?,?,?)",
    id,
    b.kind,
    name,
    JSON.stringify(b.data ?? {}),
    String(b.source ?? "Homebrew").slice(0, 200),
    String(b.sourceEdition ?? "5e").slice(0, 60),
    b.status === "draft" ? "draft" : "approved",
    b.playerVisible ? 1 : 0,
    req.user!.id,
  );
  notify(id, "compendium");
  res.json({ id: Number(r.lastInsertRowid) });
});

function loadEntry(entryId: number, userId: number) {
  const e = one("SELECT * FROM compendium WHERE id = ?", entryId);
  if (!e) throw new HttpError(404, "Entry not found");
  campaignAccessById(e.campaign_id, userId, true);
  return e;
}

// Approve every draft at once (optionally only those from one adventure or PDF)
compendiumRoutes.post("/campaigns/:id/compendium/approve-all", (req, res) => {
  const { id } = campaignAccess(req, true);
  const adv = req.body?.adventureId ? Number(req.body.adventureId) : null;
  const up = req.body?.uploadId ? Number(req.body.uploadId) : null;
  const r = run(
    `UPDATE compendium SET status = 'approved' WHERE campaign_id = ? AND status = 'draft'${adv ? " AND adventure_id = ?" : ""}${up ? " AND upload_id = ?" : ""}`,
    ...[id, adv, up].filter((v) => v != null),
  );
  notify(id, "compendium");
  res.json({ approved: r.changes });
});

// ---- items and spells that aren't in the SRD ----

const lookupName = (n: string) => n.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9+ ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["of", "the", "a", "an"].includes(w));

/** Find a campaign entry by name (close matches too), respecting what this person may see. */
compendiumRoutes.get("/campaigns/:id/compendium/lookup", (req, res) => {
  const { id, isDM } = campaignAccess(req);
  const kinds = String(req.query.kind ?? "item").split(",").filter((k) => KINDS.includes(k));
  const words = lookupName(String(req.query.name ?? ""));
  if (!words.length || !kinds.length) return res.json(null);
  const rows = all(`SELECT * FROM compendium WHERE campaign_id = ? AND kind IN (${kinds.map(() => "?").join(",")})`, id, ...kinds)
    .filter((e) => isDM || (e.status === "approved" && e.player_visible) || e.created_by === req.user!.id);
  const exact = rows.find((e) => lookupName(e.name).join(" ") === words.join(" "));
  const close = rows.filter((e) => { const n = lookupName(e.name).join(" "); return words.every((w) => n.includes(w)); }).sort((a, b) => a.name.length - b.name.length)[0];
  const e = exact ?? close;
  res.json(e ? entryOut(e) : null);
});

/** Anyone in the campaign can add details for something. The DM's go straight in; players' wait as drafts. */
compendiumRoutes.post("/campaigns/:id/compendium/custom", (req, res) => {
  const { id, isDM } = campaignAccess(req);
  const b = req.body ?? {};
  const kind = b.kind === "spell" ? "spell" : "item";
  const name = String(b.name ?? b.data?.name ?? "").trim().slice(0, 120);
  if (!name) throw new HttpError(400, "Give it a name");
  const data = { ...(b.data ?? {}), name };
  if (JSON.stringify(data).length > 60000) throw new HttpError(400, "That's too long");
  const r = run(
    "INSERT INTO compendium (campaign_id, kind, name, data, source, source_edition, status, player_visible, created_by) VALUES (?,?,?,?,?,?,?,?,?)",
    id, kind, name, JSON.stringify(data), isDM ? "Added by the DM" : `Added by ${req.user!.display_name}`, "5e",
    isDM ? "approved" : "draft", isDM ? (b.playerVisible === false ? 0 : 1) : 1, req.user!.id,
  );
  if (!isDM) discordAlertDM(id, "📖 New item details to review", `**${req.user!.display_name}** added details for **${name}**. It's a draft in the Compendium until you approve it.`, `/#/c/${id}/compendium`);
  notify(id, "compendium");
  res.json({ id: Number(r.lastInsertRowid), status: isDM ? "approved" : "draft" });
});

/** Let the AI draft the details (the person reviews before saving). */
compendiumRoutes.post("/campaigns/:id/compendium/ai-describe", async (req, res) => {
  const { id } = campaignAccess(req);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  const name = String(req.body?.name ?? "").trim().slice(0, 120);
  if (!name) throw new HttpError(400, "Give it a name");
  const kind = req.body?.kind === "spell" ? "spell" : "item";
  res.json(await describeThing(campaignContext(id), req.user!.id, kind, name, String(req.body?.hint ?? "").slice(0, 500)));
});

// ---- duplicates ----
const filled = (d: Record<string, unknown>) => Object.values(d ?? {}).filter((v) => v !== "" && v != null && !(Array.isArray(v) && !v.length)).length;
const score = (e: { status: string; data: Record<string, any> }) => filled(e.data) + (e.status === "approved" ? 2 : 0) + (e.data?.statblock ? 5 : 0);
const normName = (n: string) => n.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, "");

compendiumRoutes.get("/campaigns/:id/compendium/duplicates", (req, res) => {
  const { id } = campaignAccess(req, true);
  const rows = all("SELECT * FROM compendium WHERE campaign_id = ?", id).map(entryOut);
  const groups = new Map<string, ReturnType<typeof entryOut>[]>();
  for (const e of rows) {
    const key = `${e.kind}:${normName(e.name)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out = [...groups.values()].filter((g) => g.length > 1).map((g) =>
    // Best one first: the most filled-in (approved entries get a head start), then the newest
    g.sort((a, b) => score(b) - score(a) || b.createdAt.localeCompare(a.createdAt)),
  );
  res.json(out.sort((a, b) => a[0].name.localeCompare(b[0].name)));
});

compendiumRoutes.post("/campaigns/:id/compendium/delete-many", (req, res) => {
  const { id } = campaignAccess(req, true);
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite).slice(0, 1000) : [];
  let deleted = 0;
  for (const eid of ids) deleted += run("DELETE FROM compendium WHERE id = ? AND campaign_id = ?", eid, id).changes;
  notify(id, "compendium");
  res.json({ deleted });
});

compendiumRoutes.patch("/compendium/:entryId", (req, res) => {
  const e = loadEntry(num(req.params.entryId), req.user!.id);
  const b = req.body ?? {};
  const set: Record<string, unknown> = {};
  if (b.data !== undefined) set.data = JSON.stringify(b.data);
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 120);
  else if (b.data?.name) set.name = String(b.data.name).slice(0, 120);
  if (b.status === "draft" || b.status === "approved") set.status = b.status;
  if (b.playerVisible !== undefined) set.player_visible = b.playerVisible ? 1 : 0;
  const keys = Object.keys(set);
  if (keys.length) run(`UPDATE compendium SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => set[k]), e.id);
  notify(e.campaign_id, "compendium");
  res.json({ ok: true });
});

// Give an NPC a 5e stat block (from the adventure's reference, or made to fit)
compendiumRoutes.post("/compendium/:entryId/npc-stats", async (req, res) => {
  const e = loadEntry(num(req.params.entryId), req.user!.id);
  if (e.kind !== "npc") throw new HttpError(400, "Stat blocks can only be made for NPCs here");
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet");
  const data = parseJSON<any>(e.data, {});
  const sb = await npcStatBlock(campaignContext(e.campaign_id), req.user!.id, `${e.name}\n${String(data.markdown ?? "").slice(0, 6000)}`, String(data.statReference ?? ""), String(req.body?.request ?? "").slice(0, 500));
  run("UPDATE compendium SET data = ? WHERE id = ?", JSON.stringify({ ...data, statblock: sb }), e.id);
  notify(e.campaign_id, "compendium");
  res.json({ statblock: sb });
});

compendiumRoutes.delete("/compendium/:entryId", (req, res) => {
  const e = loadEntry(num(req.params.entryId), req.user!.id);
  run("DELETE FROM compendium WHERE id = ?", e.id);
  notify(e.campaign_id, "compendium");
  res.json({ ok: true });
});

// ---------- Edition conversion from PDFs ----------

compendiumRoutes.get("/editions", (_req, res) => res.json(EDITIONS));

const uploadOut = (u: any) => ({
  id: u.id,
  filename: u.filename,
  edition: u.edition,
  pages: u.pages,
  pageFrom: u.page_from,
  pageTo: u.page_to,
  status: u.status,
  progress: u.progress,
  error: u.error,
  createdAt: u.created_at,
  entries: u.entries ?? 0,
});

compendiumRoutes.get("/campaigns/:id/conversions", (req, res) => {
  const { id } = campaignAccess(req, true);
  res.json(
    all("SELECT u.*, (SELECT COUNT(*) FROM compendium c WHERE c.upload_id = u.id) AS entries FROM uploads u WHERE u.campaign_id = ? ORDER BY u.created_at DESC", id).map(uploadOut),
  );
});

compendiumRoutes.post("/campaigns/:id/conversions", pdfUpload.single("pdf"), async (req, res) => {
  const { id } = campaignAccess(req, true);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet, so PDFs can't be converted");
  if (!req.file) throw new HttpError(400, "Please choose a PDF file");
  const edition = String(req.body.edition || "Other / unknown").slice(0, 60);
  let pages: number;
  try {
    const pdf = await PDFDocument.load(await fs.readFile(req.file.path), { ignoreEncryption: true });
    pages = pdf.getPageCount();
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    throw new HttpError(400, "Couldn't open that PDF. If it's password-protected, remove the password first.");
  }
  const from = Math.max(1, Math.min(pages, Number(req.body.pageFrom) || 1));
  const to = Math.max(from, Math.min(pages, Number(req.body.pageTo) || pages));
  const r = run(
    "INSERT INTO uploads (campaign_id, filename, path, edition, pages, page_from, page_to, created_by) VALUES (?,?,?,?,?,?,?,?)",
    id,
    req.file.originalname.slice(0, 200),
    req.file.path,
    edition,
    pages,
    from,
    to,
    req.user!.id,
  );
  res.json({ id: Number(r.lastInsertRowid), pages, from, to });
  void processQueue();
});

compendiumRoutes.post("/conversions/:uploadId/retry", (req, res) => {
  const u = one("SELECT * FROM uploads WHERE id = ?", num(req.params.uploadId));
  if (!u) throw new HttpError(404, "Upload not found");
  campaignAccessById(u.campaign_id, req.user!.id, true);
  run("UPDATE uploads SET status = 'queued', error = NULL, progress = '' WHERE id = ?", u.id);
  res.json({ ok: true });
  void processQueue();
});

compendiumRoutes.delete("/conversions/:uploadId", async (req, res) => {
  const u = one("SELECT * FROM uploads WHERE id = ?", num(req.params.uploadId));
  if (!u) throw new HttpError(404, "Upload not found");
  campaignAccessById(u.campaign_id, req.user!.id, true);
  if (u.status === "processing") throw new HttpError(400, "Wait for this conversion to finish first");
  // Remove unreviewed drafts from this upload; keep anything already approved.
  run("DELETE FROM compendium WHERE upload_id = ? AND status = 'draft'", u.id);
  run("DELETE FROM uploads WHERE id = ?", u.id);
  await fs.unlink(u.path).catch(() => {});
  notify(u.campaign_id, "compendium");
  res.json({ ok: true });
});

const PAGES_PER_CHUNK = 8;
const MAX_CHUNK_BYTES = 24 * 1024 * 1024;
let working = false;

/** Converts queued PDFs one at a time, a few pages per AI request. */
export async function processQueue() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const u = one("SELECT * FROM uploads WHERE status = 'queued' ORDER BY id LIMIT 1");
      if (!u) break;
      run("UPDATE uploads SET status = 'processing', progress = 'Starting' WHERE id = ?", u.id);
      notify(u.campaign_id, "conversions");
      try {
        await convertUpload(u);
        run("UPDATE uploads SET status = 'done', progress = 'Finished' WHERE id = ?", u.id);
        const n = one("SELECT COUNT(*) AS n FROM compendium WHERE upload_id = ?", u.id)!.n;
        discordAlertDM(u.campaign_id, "🔄 Conversion finished", `**${u.filename}** (pages ${u.page_from}-${u.page_to}): ${n} monsters and items are ready for review.`, `/#/c/${u.campaign_id}/compendium`);
      } catch (e) {
        console.error("conversion failed", e);
        run("UPDATE uploads SET status = 'error', error = ? WHERE id = ?", (e as Error).message, u.id);
        discordAlertDM(u.campaign_id, "⚠️ Conversion stopped", `**${u.filename}**: ${(e as Error).message}\nYou can retry it and it picks up where it left off.`, `/#/c/${u.campaign_id}/convert`);
      }
      notify(u.campaign_id, "conversions");
      notify(u.campaign_id, "compendium");
    }
  } finally {
    working = false;
  }
}

async function convertUpload(u: any) {
  const campaign = one("SELECT rules_version FROM campaigns WHERE id = ?", u.campaign_id);
  const targetRules = campaign?.rules_version ?? "2014";
  const src = await PDFDocument.load(await fs.readFile(u.path), { ignoreEncryption: true });
  // Resume where an earlier attempt stopped
  let start: number = u.next_page ?? u.page_from;
  let chunkSize = PAGES_PER_CHUNK;
  while (start <= u.page_to) {
    const end = Math.min(u.page_to, start + chunkSize - 1);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    if (bytes.length > MAX_CHUNK_BYTES && chunkSize > 1) {
      chunkSize = Math.max(1, Math.floor(chunkSize / 2));
      continue;
    }
    const label = start === end ? `page ${start}` : `pages ${start}-${end}`;
    run("UPDATE uploads SET progress = ? WHERE id = ?", `Converting ${label} of ${u.page_from}-${u.page_to}`, u.id);
    notify(u.campaign_id, "conversions");
    const { result } = await convertPdfChunk({
      campaignId: u.campaign_id,
      userId: u.created_by,
      pdfBase64: Buffer.from(bytes).toString("base64"),
      edition: u.edition,
      targetRules,
      pageLabel: label,
    });
    const source = `${u.filename}, ${label}`;
    for (const m of result.monsters)
      run("INSERT INTO compendium (campaign_id, kind, name, data, source, source_edition, status, upload_id, created_by) VALUES (?,?,?,?,?,?,'draft',?,?)", u.campaign_id, "monster", m.name, JSON.stringify(m), source, u.edition, u.id, u.created_by);
    for (const it of result.items)
      run("INSERT INTO compendium (campaign_id, kind, name, data, source, source_edition, status, upload_id, created_by) VALUES (?,?,?,?,?,?,'draft',?,?)", u.campaign_id, "item", it.name, JSON.stringify(it), source, u.edition, u.id, u.created_by);
    notify(u.campaign_id, "compendium");
    start = end + 1;
    run("UPDATE uploads SET next_page = ? WHERE id = ?", start, u.id);
    chunkSize = PAGES_PER_CHUNK;
  }
}

// Resume anything interrupted by a server restart
run("UPDATE uploads SET status = 'queued' WHERE status = 'processing'");
setTimeout(() => void processQueue(), 2000);
