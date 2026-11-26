import { useEffect, useState } from "react";
import { api } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";

export function Converter({ campaign, changed }: { campaign: Campaign; changed: { what: string; at: number } }) {
  const { status } = useStatus();
  const editions = useLoad<string[]>("/editions");
  const jobs = useLoad<any[]>(`/campaigns/${campaign.id}/conversions`);
  const [f, setF] = useState({ edition: "AD&D 2nd Edition", pageFrom: "", pageTo: "", file: null as File | null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (changed.what === "conversions" || changed.what === "compendium") jobs.reload(); }, [changed]);
  // poll while something is running, in case a live update is missed
  useEffect(() => {
    if (!jobs.data?.some((j) => j.status === "processing" || j.status === "queued")) return;
    const t = setInterval(jobs.reload, 8000);
    return () => clearInterval(t);
  }, [jobs.data]);

  if (!status.aiEnabled) return <div className="card"><h2>Convert editions</h2><p>This needs the AI. Add your Anthropic API key to the server's <code>.env</code> file first.</p></div>;

  const pages = f.pageFrom && f.pageTo ? Math.max(0, Number(f.pageTo) - Number(f.pageFrom) + 1) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.file) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.append("pdf", f.file); fd.append("edition", f.edition);
      if (f.pageFrom) fd.append("pageFrom", f.pageFrom);
      if (f.pageTo) fd.append("pageTo", f.pageTo);
      await api.post(`/campaigns/${campaign.id}/conversions`, fd);
      setF({ ...f, file: null });
      (document.getElementById("pdf-input") as HTMLInputElement).value = "";
      jobs.reload();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <h1>🔄 Convert from other editions</h1>
      <p className="muted">
        Upload a scanned PDF (OCR is fine) from an older edition or another system. The AI finds the monsters and magic items on those pages and rebuilds them for 5e ({campaign.rulesVersion} rules). Everything lands in the <a href={`#/c/${campaign.id}/compendium`}>Compendium</a> as a draft for you to check and approve.
      </p>
      <form className="card" onSubmit={submit}>
        {error && <div className="error">{error}</div>}
        <div className="row top">
          <label className="grow">PDF file<input id="pdf-input" type="file" accept="application/pdf" onChange={(e) => setF({ ...f, file: e.target.files?.[0] ?? null })} required /></label>
          <label>Original edition<select value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })}>
            {editions.data?.map((e) => <option key={e}>{e}</option>)}
          </select></label>
        </div>
        <div className="row">
          <label>From page<input type="number" min={1} value={f.pageFrom} onChange={(e) => setF({ ...f, pageFrom: e.target.value })} style={{ width: 90 }} placeholder="1" /></label>
          <label>To page<input type="number" min={1} value={f.pageTo} onChange={(e) => setF({ ...f, pageTo: e.target.value })} style={{ width: 90 }} placeholder="last" /></label>
          <span className="muted" style={{ fontSize: 12 }}>
            Tip: pick just the pages you need (like the monster section) to save time and money.
            {pages ? ` About $${(pages * 0.03).toFixed(2)}–$${(pages * 0.06).toFixed(2)} for ${pages} pages.` : " Roughly 3–6¢ per page."}
          </span>
        </div>
        <button className="primary" disabled={busy || !f.file}>{busy ? "Uploading..." : "Convert"}</button>
      </form>

      <h2>Conversions</h2>
      <table className="list">
        <thead><tr><th>File</th><th>Pages</th><th>Status</th><th>Found</th><th></th></tr></thead>
        <tbody>
          {jobs.data?.map((j) => (
            <tr key={j.id}>
              <td>{j.filename}<div className="muted" style={{ fontSize: 12 }}>{j.edition}</div></td>
              <td>{j.pageFrom}–{j.pageTo}</td>
              <td>
                <span className={`pill ${j.status === "done" ? "ok" : j.status === "error" ? "bad" : "warn"}`}>{j.status}</span>
                {j.status === "processing" && <div className="muted" style={{ fontSize: 12 }}>{j.progress}</div>}
                {j.error && <div className="error" style={{ fontSize: 12, marginTop: 4 }}>{j.error}</div>}
              </td>
              <td>{j.entries} entries</td>
              <td style={{ textAlign: "right" }}>
                {j.entries > 0 && <button className="small" onClick={() => go(`c/${campaign.id}/compendium`)}>Review</button>}{" "}
                {j.status === "error" && <button className="small" onClick={() => api.post(`/conversions/${j.id}/retry`).then(jobs.reload)}>Retry (resumes)</button>}{" "}
                {j.status !== "processing" && <button className="small danger" onClick={async () => { if (confirm("Remove this upload and its unapproved drafts?")) { await api.del(`/conversions/${j.id}`); jobs.reload(); } }}>Remove</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {jobs.data?.length === 0 && <p className="muted">Nothing converted yet.</p>}
      <p className="muted" style={{ fontSize: 12 }}>Only upload books you own, for your group's private use.</p>
    </div>
  );
}
