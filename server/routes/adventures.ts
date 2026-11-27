import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { all, one, run, DATA_DIR } from "../db.ts";
import { requireUser } from "../auth.ts";
import { campaignAccess, campaignAccessById, campaignContext, HttpError, num, pdfUpload } from "../helpers.ts";
import { notify, postChat } from "../realtime.ts";
import { adventureSynopsis, aiEnabled, readAdventureChunk } from "../ai.ts";
import { discordAlertDM } from "../discord.ts";

export const adventureRoutes = Router();
adventureRoutes.use(requireUser);

const advOut = (a: any) => ({
  id: a.id,
  title: a.title,
  filename: a.filename,
  edition: a.edition,
  pages: a.pages,
  pageFrom: a.page_from,
  pageTo: a.page_to,
  status: a.status,
  progress: a.progress,
  error: a.error,
  synopsis: a.synopsis,
  active: !!a.active,
  currentSectionId: a.current_section_id,
  createdAt: a.created_at,
  sectionCount: a.section_count ?? undefined,
});

function loadAdventure(id: number, userId: number) {
  const a = one("SELECT * FROM adventures WHERE id = ?", id);
  if (!a) throw new HttpError(404, "Adventure not found");
  campaignAccessById(a.campaign_id, userId, true);
  return a;
}

adventureRoutes.get("/campaigns/:id/adventures", (req, res) => {
  const { id } = campaignAccess(req, true);
  res.json(all("SELECT a.*, (SELECT COUNT(*) FROM adventure_sections s WHERE s.adventure_id = a.id) AS section_count FROM adventures a WHERE campaign_id = ? ORDER BY created_at DESC", id).map(advOut));
});

adventureRoutes.post("/campaigns/:id/adventures", pdfUpload.single("pdf"), async (req, res) => {
  const { id } = campaignAccess(req, true);
  if (!aiEnabled()) throw new HttpError(400, "AI isn't set up on this server yet, so adventures can't be read");
  if (!req.file) throw new HttpError(400, "Please choose the adventure's PDF");
  let pages: number;
  try {
    pages = (await PDFDocument.load(await fs.readFile(req.file.path), { ignoreEncryption: true })).getPageCount();
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    throw new HttpError(400, "Couldn't open that PDF. If it's password-protected, remove the password first.");
  }
  const from = Math.max(1, Math.min(pages, Number(req.body.pageFrom) || 1));
  const to = Math.max(from, Math.min(pages, Number(req.body.pageTo) || pages));
  const title = String(req.body.title || req.file.originalname.replace(/\.pdf$/i, "")).slice(0, 120);
  const hasActive = one("SELECT id FROM adventures WHERE campaign_id = ? AND active = 1", id);
  const r = run(
    "INSERT INTO adventures (campaign_id, title, filename, path, edition, pages, page_from, page_to, active, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, title, req.file.originalname.slice(0, 200), req.file.path, String(req.body.edition || "5e 2014").slice(0, 60), pages, from, to, hasActive ? 0 : 1, req.user!.id,
  );
  res.json({ id: Number(r.lastInsertRowid), pages, from, to });
  void processAdventures();
});

adventureRoutes.get("/adventures/:advId", (req, res) => {
  const a = loadAdventure(num(req.params.advId), req.user!.id);
  const sections = all("SELECT * FROM adventure_sections WHERE adventure_id = ? ORDER BY position", a.id).map((s) => ({
    id: s.id, position: s.position, title: s.title, pageStart: s.page_start, pageEnd: s.page_end, summary: s.summary, dmNotes: s.dm_notes, readAloud: s.read_aloud, done: !!s.done,
  }));
  const entries = all("SELECT id, kind, name, status FROM compendium WHERE adventure_id = ? ORDER BY kind, name", a.id);
  const maps = all("SELECT * FROM adventure_maps WHERE adventure_id = ? ORDER BY page, id", a.id).map(mapOut);
  res.json({ ...advOut(a), sections, entries, maps });
});

adventureRoutes.patch("/adventures/:advId", (req, res) => {
  const a = loadAdventure(num(req.params.advId), req.user!.id);
  const b = req.body ?? {};
  if (typeof b.title === "string" && b.title.trim()) run("UPDATE adventures SET title = ? WHERE id = ?", b.title.trim().slice(0, 120), a.id);
  if (typeof b.synopsis === "string") run("UPDATE adventures SET synopsis = ? WHERE id = ?", b.synopsis.slice(0, 20000), a.id);
  if (b.active !== undefined) {
    if (b.active) run("UPDATE adventures SET active = 0 WHERE campaign_id = ?", a.campaign_id);
    run("UPDATE adventures SET active = ? WHERE id = ?", b.active ? 1 : 0, a.id);
  }
  if (b.currentSectionId !== undefined) {
    const sid = b.currentSectionId ? Number(b.currentSectionId) : null;
    if (sid && !one("SELECT id FROM adventure_sections WHERE id = ? AND adventure_id = ?", sid, a.id)) throw new HttpError(404, "Section not found");
    run("UPDATE adventures SET current_section_id = ? WHERE id = ?", sid, a.id);
    // Everything before the current section counts as done
    if (sid) {
      const pos = one("SELECT position FROM adventure_sections WHERE id = ?", sid)!.position;
      run("UPDATE adventure_sections SET done = (position < ?) WHERE adventure_id = ?", pos, a.id);
    }
  }
  res.json({ ok: true });
});

adventureRoutes.patch("/adventure-sections/:sectionId", (req, res) => {
  const s = one("SELECT * FROM adventure_sections WHERE id = ?", num(req.params.sectionId));
  if (!s) throw new HttpError(404, "Section not found");
  loadAdventure(s.adventure_id, req.user!.id);
  const b = req.body ?? {};
  const set: Record<string, unknown> = {};
  if (typeof b.title === "string" && b.title.trim()) set.title = b.title.trim().slice(0, 200);
  if (typeof b.summary === "string") set.summary = b.summary.slice(0, 5000);
  if (typeof b.dmNotes === "string") set.dm_notes = b.dmNotes.slice(0, 20000);
  if (typeof b.readAloud === "string") set.read_aloud = b.readAloud.slice(0, 10000);
  if (b.done !== undefined) set.done = b.done ? 1 : 0;
  const keys = Object.keys(set);
  if (keys.length) run(`UPDATE adventure_sections SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => set[k]), s.id);
  res.json({ ok: true });
});

// Read-aloud text straight into the table chat
adventureRoutes.post("/adventure-sections/:sectionId/share", (req, res) => {
  const s = one("SELECT s.*, a.campaign_id FROM adventure_sections s JOIN adventures a ON a.id = s.adventure_id WHERE s.id = ?", num(req.params.sectionId));
  if (!s) throw new HttpError(404, "Section not found");
  campaignAccessById(s.campaign_id, req.user!.id, true);
  const text = String(req.body?.text ?? s.read_aloud).trim();
  if (!text) throw new HttpError(400, "This section has no read-aloud text");
  postChat(s.campaign_id, req.user!.id, "share", { title: s.title, text: text.split("\n").map((l: string) => `> ${l}`).join("\n") });
  res.json({ ok: true });
});

const mapOut = (m: any) => ({ id: m.id, page: m.page, title: m.title, kind: m.kind, gridType: m.grid_type, cellsAcross: m.cells_across, description: m.description, mapId: m.map_id });

// All maps found in this campaign's adventures (for the Maps tab)
adventureRoutes.get("/campaigns/:id/adventure-maps", (req, res) => {
  const { id } = campaignAccess(req, true);
  res.json(all("SELECT am.*, a.title AS adventure FROM adventure_maps am JOIN adventures a ON a.id = am.adventure_id WHERE a.campaign_id = ? ORDER BY a.id, am.page", id)
    .map((m) => ({ ...mapOut(m), adventureId: m.adventure_id, adventure: m.adventure })));
});

// Add a map page by hand (for maps the AI missed)
adventureRoutes.post("/adventures/:advId/maps", (req, res) => {
  const a = loadAdventure(num(req.params.advId), req.user!.id);
  const page = Math.round(num(req.body?.page));
  if (page < 1 || page > a.pages) throw new HttpError(400, `Pick a page between 1 and ${a.pages}`);
  const r = run("INSERT INTO adventure_maps (adventure_id, page, title, grid_type) VALUES (?,?,?, 'none')", a.id, page, String(req.body?.title || `Map on page ${page}`).slice(0, 120));
  res.json({ id: Number(r.lastInsertRowid) });
});

adventureRoutes.patch("/adventure-maps/:amId", (req, res) => {
  const m = one("SELECT * FROM adventure_maps WHERE id = ?", num(req.params.amId));
  if (!m) throw new HttpError(404, "Map not found");
  const a = loadAdventure(m.adventure_id, req.user!.id);
  if (req.body?.mapId !== undefined) {
    const mapId = req.body.mapId ? Number(req.body.mapId) : null;
    if (mapId && !one("SELECT id FROM maps WHERE id = ? AND campaign_id = ?", mapId, a.campaign_id)) throw new HttpError(404, "Map not found");
    run("UPDATE adventure_maps SET map_id = ? WHERE id = ?", mapId, m.id);
  }
  res.json({ ok: true });
});

adventureRoutes.delete("/adventure-maps/:amId", (req, res) => {
  const m = one("SELECT * FROM adventure_maps WHERE id = ?", num(req.params.amId));
  if (!m) throw new HttpError(404, "Map not found");
  loadAdventure(m.adventure_id, req.user!.id);
  run("DELETE FROM adventure_maps WHERE id = ?", m.id);
  res.json({ ok: true });
});

// A page of the PDF as a picture (used to preview and import maps)
adventureRoutes.get("/adventures/:advId/page/:page", async (req, res) => {
  const a = loadAdventure(num(req.params.advId), req.user!.id);
  const page = Math.round(num(req.params.page));
  if (page < 1 || page > a.pages) throw new HttpError(404, "No such page");
  const dpi = req.query.size === "thumb" ? 40 : 200;
  const file = await renderPage(a.path, a.id, page, dpi);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(file);
});

// The original PDF, for "open page N"
adventureRoutes.get("/adventures/:advId/pdf", async (req, res) => {
  const a = loadAdventure(num(req.params.advId), req.user!.id);
  res.type("application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${a.filename.replace(/[^\w. -]/g, "_")}"`);
  res.sendFile(a.path);
});

adventureRoutes.post("/adventures/:advId/retry", (req, res) => {
  const a = loadAdventure(num(req.params.advId), req.user!.id);
  run("UPDATE adventures SET status = 'queued', error = NULL WHERE id = ?", a.id);
  res.json({ ok: true });
  void processAdventures();
});

adventureRoutes.delete("/adventures/:advId", async (req, res) => {
  const a = loadAdventure(num(req.params.advId), req.user!.id);
  if (a.status === "processing") throw new HttpError(400, "Wait for it to finish reading first");
  run("DELETE FROM compendium WHERE adventure_id = ? AND status = 'draft'", a.id);
  run("DELETE FROM adventures WHERE id = ?", a.id);
  await fs.unlink(a.path).catch(() => {});
  for (const f of await fs.readdir(CACHE_DIR).catch(() => [] as string[])) if (f.startsWith(`adv${a.id}-`)) await fs.unlink(path.join(CACHE_DIR, f)).catch(() => {});
  notify(a.campaign_id, "compendium");
  res.json({ ok: true });
});

// ---------- background reader ----------

const PAGES_PER_CHUNK = 10;
const MAX_CHUNK_BYTES = 24 * 1024 * 1024;
let working = false;

async function processAdventures() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const a = one("SELECT * FROM adventures WHERE status = 'queued' ORDER BY id LIMIT 1");
      if (!a) break;
      run("UPDATE adventures SET status = 'processing', progress = 'Starting' WHERE id = ?", a.id);
      notify(a.campaign_id, "adventures");
      try {
        await readAdventure(a);
        run("UPDATE adventures SET status = 'done', progress = 'Finished' WHERE id = ?", a.id);
        const n = one("SELECT COUNT(*) AS n FROM adventure_sections WHERE adventure_id = ?", a.id)!.n;
        discordAlertDM(a.campaign_id, "📚 Adventure ready", `**${a.title}** has been read: ${n} sections. NPCs, monsters and items are in the Compendium for review.`, `/#/c/${a.campaign_id}/adventures/${a.id}`);
      } catch (e) {
        console.error("adventure reading failed", e);
        run("UPDATE adventures SET status = 'error', error = ? WHERE id = ?", (e as Error).message, a.id);
        discordAlertDM(a.campaign_id, "⚠️ Adventure reading stopped", `**${a.title}**: ${(e as Error).message}\nRetry picks up where it stopped.`, `/#/c/${a.campaign_id}/adventures`);
      }
      notify(a.campaign_id, "adventures");
      notify(a.campaign_id, "compendium");
    }
  } finally {
    working = false;
  }
}

async function readAdventure(a: any) {
  const targetRules = one("SELECT rules_version FROM campaigns WHERE id = ?", a.campaign_id)?.rules_version ?? "2014";
  const src = await PDFDocument.load(await fs.readFile(a.path), { ignoreEncryption: true });
  let start: number = a.next_page ?? a.page_from;
  let chunkSize = PAGES_PER_CHUNK;
  while (start <= a.page_to) {
    const end = Math.min(a.page_to, start + chunkSize - 1);
    const out = await PDFDocument.create();
    (await out.copyPages(src, Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i))).forEach((p) => out.addPage(p));
    const bytes = await out.save();
    if (bytes.length > MAX_CHUNK_BYTES && chunkSize > 1) { chunkSize = Math.max(1, Math.floor(chunkSize / 2)); continue; }
    const label = `pages ${start}-${end}`;
    run("UPDATE adventures SET progress = ? WHERE id = ?", `Reading ${label} of ${a.page_from}-${a.page_to}`, a.id);
    notify(a.campaign_id, "adventures");

    const existing = all("SELECT id, title, summary, dm_notes, read_aloud, page_end, position FROM adventure_sections WHERE adventure_id = ? ORDER BY position", a.id);
    const chunk = await readAdventureChunk({
      campaignId: a.campaign_id, userId: a.created_by, pdfBase64: Buffer.from(bytes).toString("base64"),
      pageLabel: label, edition: a.edition, targetRules, title: a.title, previousTitles: existing.map((s) => s.title),
    });

    let position = existing.length ? existing[existing.length - 1].position + 1 : 0;
    chunk.sections.forEach((s, i) => {
      const last = existing[existing.length - 1];
      if (i === 0 && s.continues_previous && last) {
        run(
          "UPDATE adventure_sections SET summary = ?, dm_notes = ?, read_aloud = ?, page_end = ? WHERE id = ?",
          [last.summary, s.summary].filter(Boolean).join(" "), [last.dm_notes, s.dm_notes].filter(Boolean).join("\n"),
          [last.read_aloud, s.read_aloud].filter(Boolean).join("\n\n"), s.page_end || end, last.id,
        );
        return;
      }
      run(
        "INSERT INTO adventure_sections (adventure_id, position, title, page_start, page_end, summary, dm_notes, read_aloud) VALUES (?,?,?,?,?,?,?,?)",
        a.id, position++, s.title.slice(0, 200), s.page_start || start, s.page_end || end, s.summary, s.dm_notes, s.read_aloud,
      );
    });
    const source = `${a.title}, ${label}`;
    for (const n of chunk.npcs) {
      if (one("SELECT id FROM compendium WHERE adventure_id = ? AND kind = 'npc' AND name = ?", a.id, n.name)) continue;
      run(
        "INSERT INTO compendium (campaign_id, kind, name, data, source, source_edition, status, adventure_id, created_by) VALUES (?,?,?,?,?,?,'approved',?,?)",
        a.campaign_id, "npc", n.name,
        JSON.stringify({ markdown: `# ${n.name}\n*${n.role}*${n.where ? ` · ${n.where}` : ""}\n\n${n.description}`, statReference: n.stat_reference, statblock: n.stats ?? undefined }),
        source, a.edition, a.id, a.created_by,
      );
    }
    for (const m of chunk.maps) {
      const page = Math.round(m.page);
      if (page < start || page > end) continue; // ignore page numbers outside this chunk
      if (one("SELECT id FROM adventure_maps WHERE adventure_id = ? AND page = ? AND title = ?", a.id, page, m.title)) continue;
      run("INSERT INTO adventure_maps (adventure_id, page, title, kind, grid_type, cells_across, description) VALUES (?,?,?,?,?,?,?)",
        a.id, page, m.title.slice(0, 120) || `Map on page ${page}`, m.kind, m.has_grid, Math.max(0, Math.round(m.cells_across) || 0), m.description.slice(0, 500));
    }
    for (const m of chunk.monsters)
      run("INSERT INTO compendium (campaign_id, kind, name, data, source, source_edition, status, adventure_id, created_by) VALUES (?,?,?,?,?,?,'draft',?,?)", a.campaign_id, "monster", m.name, JSON.stringify(m), source, a.edition, a.id, a.created_by);
    for (const it of chunk.items)
      run("INSERT INTO compendium (campaign_id, kind, name, data, source, source_edition, status, adventure_id, created_by) VALUES (?,?,?,?,?,?,'draft',?,?)", a.campaign_id, "item", it.name, JSON.stringify(it), source, a.edition, a.id, a.created_by);

    start = end + 1;
    chunkSize = PAGES_PER_CHUNK;
    run("UPDATE adventures SET next_page = ? WHERE id = ?", start, a.id);
    notify(a.campaign_id, "adventures");
  }

  // Final pass: overview and hooks for this campaign
  run("UPDATE adventures SET progress = 'Writing the overview' WHERE id = ?", a.id);
  notify(a.campaign_id, "adventures");
  const outline = all("SELECT title, summary FROM adventure_sections WHERE adventure_id = ? ORDER BY position", a.id)
    .map((s) => `### ${s.title}\n${s.summary}`).join("\n\n").slice(0, 60000);
  const synopsis = await adventureSynopsis(campaignContext(a.campaign_id), a.created_by, a.title, outline);
  run("UPDATE adventures SET synopsis = ? WHERE id = ?", synopsis, a.id);
}

// Resume anything interrupted by a restart
run("UPDATE adventures SET status = 'queued' WHERE status = 'processing'");
setTimeout(() => void processAdventures(), 3000);

// ---------- rendering PDF pages to images (uses poppler's pdftoppm) ----------

const CACHE_DIR = path.join(DATA_DIR, "cache");
const exec = promisify(execFile);
const rendering = new Map<string, Promise<string>>();

function renderPage(pdfPath: string, advId: number, page: number, dpi: number): Promise<string> {
  const out = path.join(CACHE_DIR, `adv${advId}-p${page}-${dpi}`);
  const file = `${out}.png`;
  const key = file;
  if (!rendering.has(key)) {
    rendering.set(key, (async () => {
      try {
        await fs.access(file);
        return file;
      } catch { /* not cached yet */ }
      await fs.mkdir(CACHE_DIR, { recursive: true });
      try {
        await exec("pdftoppm", ["-png", "-r", String(dpi), "-f", String(page), "-l", String(page), "-singlefile", pdfPath, out], { timeout: 120000 });
      } catch (e: any) {
        if (e?.code === "ENOENT") throw new HttpError(500, "The server can't draw PDF pages yet. Run the update script on the server (it installs poppler-utils).");
        throw new HttpError(500, "Couldn't draw that page of the PDF");
      }
      return file;
    })().finally(() => setTimeout(() => rendering.delete(key), 1000)));
  }
  return rendering.get(key)!;
}
