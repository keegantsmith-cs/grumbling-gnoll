// Printable character sheet PDF, branded for The Grumbling Gnoll.
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { UPLOAD_DIR } from "./db.ts";
import { ABILITIES, ABILITY_NAMES, SKILLS, classSummary, derive, fmtMod, type CharacterData } from "../shared/character.ts";

const W = 612, H = 792, M = 36;
const RED = rgb(0.48, 0.12, 0.07), GOLD = rgb(0.85, 0.65, 0.3), INK = rgb(0.13, 0.1, 0.08), MUTED = rgb(0.42, 0.36, 0.3);
const PARCH = rgb(0.97, 0.94, 0.86), LINE = rgb(0.72, 0.6, 0.45), DARK = rgb(0.16, 0.12, 0.09);

// Standard PDF fonts only know basic Western characters, so swap or drop anything else.
function clean(s: string): string {
  return String(s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[•●▪]/g, "*")
    .replace(/\t/g, "  ").replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= width) line = test;
      else {
        if (line) out.push(line);
        // break very long words
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

async function loadImage(pdf: PDFDocument, url: string): Promise<PDFImage | null> {
  const m = url?.match(/^\/uploads\/([\w.-]+)$/);
  if (!m) return null;
  try {
    const bytes = await fs.readFile(path.join(UPLOAD_DIR, m[1]));
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
  } catch { /* missing or unreadable image: just leave it out */ }
  return null;
}

export async function characterSheetPdf(d: CharacterData, info: { player: string; campaign: string | null; status: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${clean(d.name)} - The Grumbling Gnoll`);
  pdf.setAuthor(clean(info.player));
  pdf.setCreator("The Grumbling Gnoll");
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifB = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifI = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dv = derive(d);
  const portrait = await loadImage(pdf, d.portraitUrl);
  const fullBody = await loadImage(pdf, d.fullBodyUrl);

  let page!: PDFPage;
  let pageNo = 0;
  const text = (s: string, x: number, y: number, size: number, font = serif, color = INK) => page.drawText(clean(s), { x, y, size, font, color });
  const center = (s: string, cx: number, y: number, size: number, font = serif, color = INK) => text(s, cx - font.widthOfTextAtSize(clean(s), size) / 2, y, size, font, color);
  const box = (x: number, y: number, w: number, h: number, label?: string) => {
    page.drawRectangle({ x, y, width: w, height: h, color: PARCH, borderColor: LINE, borderWidth: 1 });
    if (label) center(label.toUpperCase(), x + w / 2, y + 4, 6.5, sansB, MUTED);
  };
  const sectionTitle = (s: string, x: number, y: number, w: number) => {
    text(s, x, y, 12, serifB, RED);
    page.drawLine({ start: { x, y: y - 3 }, end: { x: x + w, y: y - 3 }, thickness: 1.2, color: RED });
  };

  /** The tavern's sign: a d20 hexagon with a mug, the name, and a gold rule. */
  function header(subtitle: string) {
    page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: DARK });
    const cx = M + 22, cy = H - 32, r = 22;
    // SVG paths are drawn from an origin with y pointing down, so flip the sine
    const hex = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i + Math.PI / 6; return `${(r * Math.cos(a)).toFixed(2)},${(-r * Math.sin(a)).toFixed(2)}`; });
    page.drawSvgPath(`M ${hex.join(" L ")} Z`, { x: cx, y: cy, color: RED, borderColor: GOLD, borderWidth: 2 });
    // little tankard
    page.drawRectangle({ x: cx - 7, y: cy - 10, width: 12, height: 16, color: GOLD });
    page.drawRectangle({ x: cx - 7, y: cy + 4, width: 12, height: 4, color: rgb(1, 0.97, 0.9) });
    page.drawEllipse({ x: cx + 7, y: cy - 2, xScale: 4, yScale: 5, borderColor: GOLD, borderWidth: 2 });
    text("THE GRUMBLING GNOLL", M + 54, H - 32, 22, serifB, GOLD);
    text(subtitle, M + 56, H - 48, 10, serifI, rgb(0.93, 0.89, 0.81));
    const right = info.campaign ? clean(info.campaign) : "";
    if (right) text(right, W - M - serifI.widthOfTextAtSize(right, 10), H - 30, 10, serifI, rgb(0.93, 0.89, 0.81));
    page.drawLine({ start: { x: 0, y: H - 66 }, end: { x: W, y: H - 66 }, thickness: 2, color: GOLD });
  }
  function footer() {
    const s = `Character sheet from The Grumbling Gnoll  *  ${clean(d.name)}  *  page ${pageNo}`;
    page.drawLine({ start: { x: M, y: 30 }, end: { x: W - M, y: 30 }, thickness: 0.5, color: LINE });
    center(s, W / 2, 18, 7.5, serifI, MUTED);
  }
  function newPage(subtitle: string) {
    if (pageNo) footer();
    page = pdf.addPage([W, H]);
    pageNo++;
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.995, 0.985, 0.955) });
    header(subtitle);
  }

  // ---------------- page 1 ----------------
  newPage("Adventurer's Record");
  let y = H - 90;
  const nameX = portrait ? M + 92 : M;
  if (portrait) {
    page.drawRectangle({ x: M - 2, y: y - 84, width: 84, height: 84, color: GOLD });
    page.drawImage(portrait, { x: M, y: y - 82, width: 80, height: 80 });
  }
  text(d.name, nameX, y - 18, 24, serifB, RED);
  const line2 = `Level ${dv.level} ${d.species || ""} ${classSummary(d)}`.replace(/\s+/g, " ");
  text(line2, nameX, y - 36, 12, serif);
  const facts: [string, string][] = [["Background", d.background], ["Alignment", d.alignment], ["Player", info.player], ["XP", String(d.experience || 0)], ["Rules", `5e ${d.rulesVersion}`]];
  let fx = nameX;
  for (const [k, v] of facts) {
    const w = Math.max(60, sans.widthOfTextAtSize(clean(v || "-"), 9) + 14);
    text(k.toUpperCase(), fx, y - 54, 6.5, sansB, MUTED);
    text(v || "-", fx, y - 66, 9, sans);
    fx += w;
  }
  if (info.status !== "approved") text("DRAFT - not yet approved by the DM", nameX, y - 80, 8, sansB, RED);
  y -= 100;

  // Abilities column
  const colA = M, colB = M + 92, colC = M + 300;
  let ay = y;
  for (const a of ABILITIES) {
    box(colA, ay - 62, 80, 62, ABILITY_NAMES[a]);
    center(fmtMod(dv.mods[a]), colA + 40, ay - 32, 22, serifB, INK);
    page.drawEllipse({ x: colA + 40, y: ay - 46, xScale: 14, yScale: 7, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 1 });
    center(String(d.abilities[a]), colA + 40, ay - 49, 8, sansB, INK);
    ay -= 68;
  }

  // Combat stats row
  const stats: [string, string][] = [
    ["Armor Class", String(dv.ac)], ["Initiative", fmtMod(dv.initiative)], ["Speed", `${d.speed} ft`],
    ["Prof. Bonus", fmtMod(dv.proficiencyBonus)], ["Passive Perc.", String(dv.passivePerception)],
  ];
  const sw = (W - M - colB - 4 * 6) / 5;
  stats.forEach(([k, v], i) => {
    const x = colB + i * (sw + 6);
    box(x, y - 46, sw, 46, k);
    center(v, x + sw / 2, y - 30, 17, serifB);
  });
  let by = y - 54;
  // HP box
  box(colB, by - 54, 200, 54, "Hit Points");
  text(`Maximum ${dv.maxHp}`, colB + 8, by - 16, 9, sansB, MUTED);
  text(`Hit Dice ${dv.hitDice || "-"}`, colB + 110, by - 16, 9, sansB, MUTED);
  text(`Current ______    Temp ______`, colB + 8, by - 36, 10, serif, INK);
  // Death saves + inspiration
  box(colB + 206, by - 54, W - M - colB - 206, 54, "Death Saves / Inspiration");
  const ds = (label: string, n: number, x: number, yy: number) => {
    text(label, x, yy, 8, sans, MUTED);
    for (let i = 0; i < 3; i++) page.drawCircle({ x: x + 58 + i * 13, y: yy + 3, size: 4.5, borderColor: INK, borderWidth: 0.8, color: i < n ? INK : undefined });
  };
  ds("Successes", d.deathSaves.successes, colB + 214, by - 18);
  ds("Failures", d.deathSaves.failures, colB + 214, by - 32);
  page.drawCircle({ x: W - M - 16, y: by - 22, size: 7, borderColor: GOLD, borderWidth: 1.5, color: d.inspiration ? GOLD : undefined });
  by -= 62;

  // Saves & skills
  const listTop = by;
  sectionTitle("Saving Throws", colB, listTop - 12, 190);
  let ly = listTop - 28;
  const bullet = (on: boolean, x: number, yy: number, expert = false) => page.drawCircle({ x, y: yy + 3, size: 3.2, borderColor: INK, borderWidth: 0.7, color: on ? (expert ? GOLD : INK) : undefined });
  for (const a of ABILITIES) {
    bullet(d.saveProficiencies.includes(a), colB + 5, ly);
    text(fmtMod(dv.saves[a]), colB + 14, ly, 9.5, sansB);
    text(ABILITY_NAMES[a], colB + 40, ly, 9.5, serif);
    ly -= 13;
  }
  ly -= 8;
  sectionTitle("Skills", colB, ly, 190);
  ly -= 16;
  for (const s of SKILLS) {
    const ex = d.skillExpertise.includes(s.key);
    bullet(d.skillProficiencies.includes(s.key) || ex, colB + 5, ly, ex);
    text(fmtMod(dv.skills[s.key]), colB + 14, ly, 9.5, sansB);
    text(`${s.name}`, colB + 40, ly, 9.5, serif);
    text(s.ability.toUpperCase(), colB + 160, ly, 7, sans, MUTED);
    ly -= 12.4;
  }
  text("* filled = proficient, gold = expertise", colB, ly - 2, 7, serifI, MUTED);

  // Attacks + features on the right
  let ry = listTop - 12;
  const rw = W - M - colC;
  sectionTitle("Attacks", colC, ry, rw);
  ry -= 16;
  if (!d.attacks.length) { text("-", colC, ry, 9.5); ry -= 13; }
  for (const at of d.attacks.slice(0, 10)) {
    text(at.name || "-", colC, ry, 9.5, serifB);
    text(at.bonus || "", colC + 120, ry, 9.5, sansB);
    text(at.damage || "", colC + 152, ry, 9.5, sans);
    ry -= 13;
  }
  ry -= 8;
  sectionTitle("Features & Traits", colC, ry, rw);
  ry -= 15;
  const featLines = wrap(d.features || "-", serif, 9, rw);
  const maxLines = Math.floor((ry - 46) / 11);
  featLines.slice(0, maxLines).forEach((l) => { text(l, colC, ry, 9); ry -= 11; });
  const overflow = featLines.length > maxLines ? featLines.slice(maxLines) : [];

  // ---------------- page 2+: spells, gear, story ----------------
  newPage("Spells, Gear & Story");
  y = H - 92;
  const fullW = W - 2 * M;
  // flowing text helper that adds pages as needed
  const ensure = (need: number) => { if (y - need < 46) { newPage("continued"); y = H - 92; } };
  const flow = (title: string, body: string, size = 9.5, width = fullW, x = M) => {
    if (!body.trim()) return;
    ensure(40);
    sectionTitle(title, x, y, width);
    y -= 16;
    for (const l of wrap(body, serif, size, width)) { ensure(12); text(l, x, y, size); y -= size + 2.5; }
    y -= 10;
  };

  if (overflow.length) flow("Features & Traits (continued)", overflow.join("\n"));

  const hasSpells = d.spells.length > 0 || dv.spellSlots.some((n) => n > 0) || dv.pact.count > 0;
  if (hasSpells) {
    ensure(60);
    sectionTitle("Spellcasting", M, y, fullW);
    y -= 16;
    if (dv.spellAbility) {
      text(`Ability ${ABILITY_NAMES[dv.spellAbility]}   *   Save DC ${dv.spellSaveDC}   *   Spell Attack ${fmtMod(dv.spellAttack ?? 0)}`, M, y, 10, sansB);
      y -= 16;
    }
    const slotText = dv.spellSlots.map((n, i) => (n ? `L${i + 1}: ${n}` : "")).filter(Boolean).join("   ");
    if (slotText) { text(`Spell slots   ${slotText}`, M, y, 9.5, sans); y -= 13; }
    if (dv.pact.count) { text(`Pact slots   ${dv.pact.count} x level ${dv.pact.level}`, M, y, 9.5, sans); y -= 13; }
    y -= 4;
    const byLevel = new Map<number, string[]>();
    for (const sp of d.spells) if (sp.name) byLevel.set(sp.level, [...(byLevel.get(sp.level) ?? []), sp.name + (sp.prepared || sp.level === 0 ? "" : " (unprepared)")]);
    for (const [lvl, names] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const label = lvl === 0 ? "Cantrips: " : `Level ${lvl}: `;
      const lines = wrap(names.join(", "), serif, 9.5, fullW - 60);
      ensure(12 * lines.length + 4);
      text(label, M, y, 9.5, serifB);
      lines.forEach((l, i) => { text(l, M + 60, y - i * 12, 9.5); });
      y -= 12 * lines.length + 3;
    }
    y -= 10;
  }

  // Equipment (left) and money
  if (d.inventory.length || Object.values(d.currency).some(Boolean)) {
    ensure(50);
    sectionTitle("Equipment", M, y, fullW);
    y -= 16;
    const coins = (["pp", "gp", "ep", "sp", "cp"] as const).filter((k) => d.currency[k]).map((k) => `${d.currency[k]} ${k}`).join("   ");
    if (coins) { text(`Coins   ${coins}`, M, y, 9.5, sansB); y -= 14; }
    const items = d.inventory.filter((i) => i.name).map((i) => `${i.qty > 1 ? `${i.qty} x ` : ""}${i.name}${i.equipped ? " (equipped)" : ""}${i.attuned ? " (attuned)" : ""}`);
    // two columns
    const half = Math.ceil(items.length / 2);
    for (let i = 0; i < half; i++) {
      ensure(12);
      text(items[i], M, y, 9.5);
      if (items[i + half]) text(items[i + half], M + fullW / 2, y, 9.5);
      y -= 12;
    }
    y -= 10;
  }

  flow("Proficiencies & Languages", d.proficienciesText);
  flow("Personality, Ideals, Bonds & Flaws", d.personality);

  // Backstory beside the full-body picture, if there is one
  if (fullBody) {
    const imgW = 170, imgH = Math.min(300, (fullBody.height / fullBody.width) * imgW);
    ensure(Math.min(imgH, 200) + 20);
    const top = y;
    page.drawRectangle({ x: W - M - imgW - 2, y: top - imgH - 2, width: imgW + 4, height: imgH + 4, color: GOLD });
    page.drawImage(fullBody, { x: W - M - imgW, y: top - imgH, width: imgW, height: imgH });
    const textW = fullW - imgW - 16;
    if (d.backstory.trim()) {
      sectionTitle("Backstory", M, y, textW);
      y -= 16;
      for (const l of wrap(d.backstory, serif, 9.5, textW)) {
        if (y < 46) { newPage("continued"); y = H - 92; }
        text(l, M, y, 9.5);
        y -= 12;
      }
    }
    y = Math.min(y, top - imgH) - 14;
  } else {
    flow("Backstory", d.backstory);
  }
  flow("Notes", d.notes);
  footer();
  return pdf.save();
}
