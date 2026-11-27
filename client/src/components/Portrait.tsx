import { useState } from "react";
import { api } from "../api";
import { useStatus } from "../hooks";
import { squarePortrait } from "./ScanSheet";

/** Character picture on the sheet: upload one, or get an AI-written prompt for an image generator. */
export function Portrait({ url, canEdit, characterId, name, onChange }: { url: string; canEdit: boolean; characterId: number; name: string; onChange: (url: string) => void }) {
  const { status, toast } = useStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("painterly fantasy illustration");

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", await squarePortrait(file), "portrait.jpg");
      const r = await api.post("/images", fd);
      onChange(r.url);
      toast("Portrait updated. It's also used for your map token.");
      setOpen(false);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  async function makePrompt() {
    setBusy(true);
    try { setPrompt((await api.post(`/characters/${characterId}/art-prompt`, { style, framing: "portrait" })).prompt); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  const img = url
    ? <img src={url} alt={name} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "50%", border: "3px solid var(--gold)" }} />
    : <div style={{ width: 96, height: 96, borderRadius: "50%", border: "2px dashed var(--line)", display: "grid", placeItems: "center", fontSize: 34 }}>🧝</div>;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ cursor: canEdit ? "pointer" : undefined }} onClick={() => canEdit && setOpen(!open)} title={canEdit ? "Change portrait" : undefined}>{img}</div>
      {open && (
        <div className="card" style={{ position: "absolute", top: 104, left: 0, width: 380, zIndex: 20, boxShadow: "0 8px 30px #000a" }}>
          <div className="row"><h3 className="grow" style={{ margin: 0 }}>Character portrait</h3><button className="small" onClick={() => setOpen(false)}>✕</button></div>
          <p className="muted" style={{ fontSize: 12 }}>Doesn't need DM approval. It's cropped to a square and also used for your map token.</p>
          <label className="btn" style={{ display: "inline-block", color: "var(--text)", margin: "0 6px 8px 0" }}>
            {busy ? "Working..." : "⬆ Upload a picture"}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {url && <button className="danger" onClick={() => { onChange(""); setOpen(false); }}>Remove</button>}
          {status.aiEnabled && (
            <>
              <hr />
              <b>✨ Make one with AI</b>
              <p className="muted" style={{ fontSize: 12 }}>The AI writes a picture description from your sheet. Paste it into a free image maker such as Microsoft Designer / Bing Image Creator or ChatGPT, save the picture, then upload it here.</p>
              <div className="row">
                <select value={style} onChange={(e) => setStyle(e.target.value)} style={{ width: "auto" }}>
                  <option>painterly fantasy illustration</option>
                  <option>classic pen-and-ink with watercolor wash</option>
                  <option>detailed digital fantasy art</option>
                  <option>storybook illustration</option>
                  <option>anime style</option>
                  <option>oil painting portrait</option>
                </select>
                <button disabled={busy} onClick={makePrompt}>{busy ? "Writing..." : prompt ? "Write another" : "Write prompt"}</button>
              </div>
              {prompt && (
                <>
                  <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ marginTop: 8 }} />
                  <div className="row">
                    <button className="small" onClick={() => navigator.clipboard?.writeText(prompt).then(() => toast("Copied"))}>Copy</button>
                    <a className="btn small" href="https://designer.microsoft.com/image-creator" target="_blank" rel="noreferrer">Open Microsoft image creator ↗</a>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Shrink a tall picture without cropping. */
async function shrinkTall(file: File, maxSide = 1800): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image"))), "image/jpeg", 0.9));
}

/** Full-body picture card on the sheet: upload, view large, or get an AI prompt for one. */
export function FullBody({ url, canEdit, characterId, name, onChange }: { url: string; canEdit: boolean; characterId: number; name: string; onChange: (url: string) => void }) {
  const { status, toast } = useStatus();
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("painterly fantasy illustration");
  const [zoom, setZoom] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", await shrinkTall(file), "fullbody.jpg");
      const r = await api.post("/images", fd);
      onChange(r.url);
      toast("Full-body picture updated");
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  async function makePrompt() {
    setBusy(true);
    try { setPrompt((await api.post(`/characters/${characterId}/art-prompt`, { style, framing: "fullbody" })).prompt); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!url && !canEdit) return null;
  return (
    <div className="card">
      <h3>Full-body picture</h3>
      {url
        ? <img src={url} alt={`${name}, full body`} onClick={() => setZoom(true)} style={{ width: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 8, cursor: "zoom-in", background: "#0006" }} />
        : <p className="muted">No picture yet.</p>}
      {canEdit && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="btn" style={{ margin: 0, color: "var(--text)" }}>
              {busy ? "Working..." : url ? "Replace picture" : "⬆ Upload a picture"}
              <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            {url && <button className="danger" onClick={() => onChange("")}>Remove</button>}
          </div>
          {status.aiEnabled && (
            <details style={{ marginTop: 8 }}>
              <summary>✨ Make one with AI</summary>
              <p className="muted" style={{ fontSize: 12 }}>The AI writes a full-body description from your sheet. Paste it into a free image maker (Microsoft Designer / Bing Image Creator or ChatGPT), save the picture, and upload it here.</p>
              <div className="row">
                <select value={style} onChange={(e) => setStyle(e.target.value)} style={{ width: "auto" }}>
                  <option>painterly fantasy illustration</option>
                  <option>classic pen-and-ink with watercolor wash</option>
                  <option>detailed digital fantasy art</option>
                  <option>storybook illustration</option>
                  <option>anime style</option>
                  <option>oil painting</option>
                </select>
                <button disabled={busy} onClick={makePrompt}>{busy ? "Writing..." : prompt ? "Write another" : "Write prompt"}</button>
              </div>
              {prompt && (
                <>
                  <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ marginTop: 8 }} />
                  <div className="row">
                    <button className="small" onClick={() => navigator.clipboard?.writeText(prompt).then(() => toast("Copied"))}>Copy</button>
                    <a className="btn small" href="https://designer.microsoft.com/image-creator" target="_blank" rel="noreferrer">Open Microsoft image creator ↗</a>
                  </div>
                </>
              )}
            </details>
          )}
        </>
      )}
      {zoom && url && (
        <div onClick={() => setZoom(false)} style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 200, display: "grid", placeItems: "center", cursor: "zoom-out" }}>
          <img src={url} alt="" style={{ maxWidth: "95vw", maxHeight: "95vh", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}
