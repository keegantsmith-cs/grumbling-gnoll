import { useState } from "react";
import { api } from "../api";
import { useStatus } from "../hooks";

/** Shrink phone photos before upload: faster, cheaper for the AI, and under its 5 MB limit. */
export async function shrinkImage(file: File, maxSide = 2000): Promise<Blob> {
  if (file.type === "application/pdf") return file;
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image"))), "image/jpeg", 0.88));
}

/** Center-crop a picture to a square (so it fits round map tokens) and resize it. */
export async function squarePortrait(file: File, side = 640): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(side, s);
  // keep a little more of the top, where faces usually are
  const sx = (bmp.width - s) / 2, sy = Math.max(0, (bmp.height - s) * 0.3);
  canvas.getContext("2d")!.drawImage(bmp, sx, sy, s, s, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image"))), "image/jpeg", 0.9));
}

export function ScanSheet({ campaignId, onDone, onCancel }: { campaignId?: number; onDone: (id: number) => void; onCancel: () => void }) {
  const { status, toast } = useStatus();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!status.aiEnabled) return <div className="card"><p>Reading paper sheets needs the AI, which isn't set up on this server yet.</p><button onClick={onCancel}>Close</button></div>;

  async function submit() {
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      if (campaignId) fd.append("campaignId", String(campaignId));
      for (const f of files) {
        const blob = await shrinkImage(f);
        fd.append("files", blob, f.type === "application/pdf" ? f.name : f.name.replace(/\.\w+$/, "") + ".jpg");
      }
      const r = await api.post("/characters/scan", fd);
      if (r.readingProblems) toast("Done! Double-check these: " + r.readingProblems);
      onDone(r.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>📷 Import a paper or PDF character sheet</h2>
      <p className="muted">Take a photo of each page (or upload the PDF) and the AI copies everything onto a sheet here. {campaignId ? "It then goes to the DM for approval, with an automatic rules check." : ""}</p>
      <ul className="muted" style={{ marginTop: 0 }}>
        <li>Lay the sheet flat in good light and fill the frame. One photo per page; include the spells page.</li>
        <li>Fillable PDF sheets work great.</li>
        <li>Check the result afterwards. Handwriting can fool it.</li>
      </ul>
      {error && <div className="error">{error}</div>}
      <label>Photos or PDF (up to 8)
        <input type="file" multiple accept="image/*,application/pdf" capture={undefined} disabled={busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 8))} />
      </label>
      {files.length > 0 && (
        <div className="row" style={{ marginBottom: 10 }}>
          {files.map((f, i) => f.type.startsWith("image/")
            ? <img key={i} src={URL.createObjectURL(f)} alt="" style={{ height: 90, borderRadius: 6, border: "1px solid var(--line)" }} />
            : <span key={i} className="pill">📄 {f.name}</span>)}
        </div>
      )}
      <div className="row">
        <button className="primary" disabled={!files.length || busy} onClick={submit}>{busy ? "Reading the sheet... (about a minute)" : "Import"}</button>
        <button disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
