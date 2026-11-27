// Makes a safe copy of the database (even while the site is running) and packs it with the uploaded files.
// Usage: node scripts/backup.mjs <output.tar.gz>
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
const out = path.resolve(process.argv[2] ?? `backup-${new Date().toISOString().slice(0, 10)}.tar.gz`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gnoll-backup-"));
try {
  const db = new Database(path.join(dataDir, "grumbling-gnoll.db"), { readonly: true });
  await db.backup(path.join(tmp, "grumbling-gnoll.db"));
  db.close();
  const args = ["-czf", out, "-C", tmp, "grumbling-gnoll.db"];
  if (fs.existsSync(path.join(dataDir, "uploads"))) args.push("-C", dataDir, "uploads");
  execFileSync("tar", args);
  console.log(`Backup written to ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
