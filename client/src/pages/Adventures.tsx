import { useEffect, useState } from "react";
import { api } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { Markdown } from "../components/Markdown";
import { AdventureMaps } from "../components/AdventureMaps";

const EDITIONS = ["5e 2014", "5e 2024", "OD&D (1974) / Basic", "AD&D 1st Edition", "AD&D 2nd Edition", "D&D 3.0 / 3.5", "D&D 4th Edition", "Pathfinder 1e", "Pathfinder 2e", "Other / unknown"];

export function Adventures({ campaign, changed, openId }: { campaign: Campaign; changed: { what: string; at: number }; openId?: string }) {
  if (openId) return <AdventureView id={Number(openId)} campaign={campaign} changed={changed} />;
  return <AdventureList campaign={campaign} changed={changed} />;
}

function AdventureList({ campaign, changed }: { campaign: Campaign; changed: { what: string; at: number } }) {
  const { status } = useStatus();
  const list = useLoad<any[]>(`/campaigns/${campaign.id}/adventures`);
  const [f, setF] = useState({ title: "", edition: "5e 2014", pageFrom: "", pageTo: "", file: null as File | null });
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (changed.what === "adventures") list.reload(); }, [changed]);
  useEffect(() => {
    if (!list.data?.some((a) => a.status === "processing" || a.status === "queued")) return;
    const t = setInterval(list.reload, 8000);
    return () => clearInterval(t);
  }, [list.data]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!f.file) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.append("pdf", f.file); fd.append("title", f.title); fd.append("edition", f.edition);
      if (f.pageFrom) fd.append("pageFrom", f.pageFrom);
      if (f.pageTo) fd.append("pageTo", f.pageTo);
      await api.post(`/campaigns/${campaign.id}/adventures`, fd);
      setShowForm(false); setF({ ...f, title: "", file: null });
      list.reload();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const pages = f.pageFrom && f.pageTo ? Math.max(0, Number(f.pageTo) - Number(f.pageFrom) + 1) : null;
  return (
    <div>
      <div className="row">
        <h1 className="grow">📚 Adventures</h1>
        <button className="primary" disabled={!status.aiEnabled} onClick={() => setShowForm(!showForm)}>⬆ Upload an adventure</button>
      </div>
      <p className="muted">
        Upload an adventure module's PDF (published or homebrew, scanned is fine). The AI reads it and builds a chapter-by-chapter run guide, adds its NPCs, monsters and magic items to the Compendium (converted to 5e if it's from another edition), and from then on the AI assistant knows the story and where your party is.
      </p>
      {!status.aiEnabled && <div className="notice">This needs the AI. Add your Anthropic API key to the server first.</div>}
      {showForm && (
        <form className="card" onSubmit={upload}>
          {error && <div className="error">{error}</div>}
          <label>Adventure PDF<input type="file" accept="application/pdf" required onChange={(e) => setF({ ...f, file: e.target.files?.[0] ?? null })} /></label>
          <div className="row top">
            <label className="grow">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Uses the file name if blank" /></label>
            <label>Written for<select value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })}>{EDITIONS.map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
          <div className="row">
            <label>From page<input type="number" min={1} value={f.pageFrom} onChange={(e) => setF({ ...f, pageFrom: e.target.value })} style={{ width: 90 }} placeholder="1" /></label>
            <label>To page<input type="number" min={1} value={f.pageTo} onChange={(e) => setF({ ...f, pageTo: e.target.value })} style={{ width: 90 }} placeholder="last" /></label>
            <span className="muted" style={{ fontSize: 12 }}>
              Skip the cover, credits and appendices you don't need to save money.
              {pages ? ` About $${(pages * 0.03).toFixed(2)}–$${(pages * 0.07).toFixed(2)} for ${pages} pages.` : " Roughly 3–7¢ per page (a 64-page module ≈ $2–4)."}
            </span>
          </div>
          <button className="primary" disabled={busy || !f.file}>{busy ? "Uploading..." : "Read this adventure"}</button>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Only upload adventures you own, for your group's private use. Reading takes a few minutes; you'll get a Discord alert when it's done if that's set up.</p>
        </form>
      )}
      <table className="list">
        <thead><tr><th>Adventure</th><th>Pages</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.data?.map((a) => (
            <tr key={a.id}>
              <td>
                <button className="link" onClick={() => go(`c/${campaign.id}/adventures/${a.id}`)}>{a.title}</button>
                {a.active && <span className="pill ok" style={{ marginLeft: 6 }}>playing now</span>}
                <div className="muted" style={{ fontSize: 12 }}>{a.edition} · {a.sectionCount ?? 0} sections</div>
              </td>
              <td>{a.pageFrom}–{a.pageTo}</td>
              <td>
                <span className={`pill ${a.status === "done" ? "ok" : a.status === "error" ? "bad" : "warn"}`}>{a.status === "done" ? "ready" : a.status}</span>
                {a.status === "processing" && <div className="muted" style={{ fontSize: 12 }}>{a.progress}</div>}
                {a.error && <div className="error" style={{ fontSize: 12, marginTop: 4 }}>{a.error}</div>}
              </td>
              <td style={{ textAlign: "right" }}>
                {a.status === "error" && <button className="small" onClick={() => api.post(`/adventures/${a.id}/retry`).then(list.reload)}>Retry (resumes)</button>}{" "}
                {a.status !== "processing" && <button className="small danger" onClick={async () => { if (confirm(`Remove "${a.title}"? Its run guide and unapproved drafts are deleted; approved Compendium entries stay.`)) { await api.del(`/adventures/${a.id}`); list.reload(); } }}>Remove</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.length === 0 && <p className="muted">No adventures yet.</p>}
    </div>
  );
}

function AdventureView({ id, campaign, changed }: { id: number; campaign: Campaign; changed: { what: string; at: number } }) {
  const { toast } = useStatus();
  const { data: a, error, reload } = useLoad<any>(`/adventures/${id}`);
  const [editingSynopsis, setEditingSynopsis] = useState(false);
  const [synopsis, setSynopsis] = useState("");
  useEffect(() => { if (changed.what === "adventures" || changed.what === "compendium") reload(); }, [changed]);
  useEffect(() => { if (a) setSynopsis(a.synopsis); }, [a?.synopsis]);

  if (error) return <div className="error">{error}</div>;
  if (!a) return <p className="muted">Loading...</p>;
  const pdf = (page?: number) => `/api/adventures/${a.id}/pdf${page ? `#page=${page}` : ""}`;
  const patch = (body: object) => api.patch(`/adventures/${a.id}`, body).then(reload);
  const drafts = a.entries.filter((e: any) => e.status === "draft").length;

  return (
    <div>
      <button className="link" onClick={() => go(`c/${campaign.id}/adventures`)}>← All adventures</button>
      <div className="row" style={{ marginTop: 6 }}>
        <h1 className="grow" style={{ margin: 0 }}>{a.title}</h1>
        <a className="btn" href={pdf()} target="_blank" rel="noreferrer">📄 Open the PDF</a>
        <label className="inline"><input type="checkbox" checked={a.active} onChange={(e) => patch({ active: e.target.checked })} /> We're playing this (the AI assistant uses it)</label>
      </div>
      <p className="muted">{a.edition} · pages {a.pageFrom}–{a.pageTo}{a.status !== "done" ? ` · ${a.status}: ${a.progress}` : ""}</p>
      {a.error && <div className="error">{a.error}</div>}

      <div className="card">
        <div className="row"><h2 className="grow">About this adventure</h2>
          <button className="small" onClick={() => { if (editingSynopsis) api.patch(`/adventures/${a.id}`, { synopsis }).then(() => { toast("Saved"); reload(); }); setEditingSynopsis(!editingSynopsis); }}>{editingSynopsis ? "Save" : "Edit"}</button>
        </div>
        {editingSynopsis ? <textarea rows={14} value={synopsis} onChange={(e) => setSynopsis(e.target.value)} /> : a.synopsis ? <Markdown text={a.synopsis} /> : <p className="muted">The overview is written after all pages are read.</p>}
      </div>

      <div className="card">
        <h2>🗺️ Maps in this adventure</h2>
        <p className="muted" style={{ fontSize: 12 }}>Maps the AI spotted while reading. Add one to your Maps (you can crop it from the page), then show it to the players with fog of war.</p>
        <AdventureMaps campaignId={campaign.id} adventureId={a.id} maps={a.maps} reload={reload} />
      </div>

      <h2>Run guide</h2>
      <p className="muted">Click <b>We're here</b> on the section the party is in. Earlier sections get marked done, and the AI assistant knows what's happened and what's next.</p>
      {a.sections.map((s: any) => <SectionCard key={s.id} s={s} current={s.id === a.currentSectionId} pdf={pdf} onCurrent={() => patch({ currentSectionId: s.id })} reload={reload} />)}
      {a.sections.length === 0 && <p className="muted">Nothing read yet.</p>}

      <div className="card">
        <div className="row"><h2 className="grow">From this adventure in the Compendium</h2>
          {drafts > 0 && <button className="small primary" onClick={() => api.post(`/campaigns/${campaign.id}/compendium/approve-all`, { adventureId: a.id }).then((r) => { toast(`Approved ${r.approved}`); reload(); })}>Approve all {drafts} drafts</button>}
          <button className="small" onClick={() => go(`c/${campaign.id}/compendium`)}>Open Compendium</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>NPCs are added right away. Monsters and magic items arrive as drafts so you can check them first.</p>
        {(["npc", "monster", "item"] as const).map((k) => {
          const list = a.entries.filter((e: any) => e.kind === k);
          return list.length ? <p key={k}><b>{k === "npc" ? "NPCs" : k === "monster" ? "Monsters" : "Items"}:</b> {list.map((e: any) => e.name + (e.status === "draft" ? "*" : "")).join(", ")}</p> : null;
        })}
        {drafts > 0 && <p className="muted" style={{ fontSize: 12 }}>* draft</p>}
      </div>
    </div>
  );
}

function SectionCard({ s, current, pdf, onCurrent, reload }: { s: any; current: boolean; pdf: (p?: number) => string; onCurrent: () => void; reload: () => void }) {
  const { toast } = useStatus();
  const [open, setOpen] = useState(current);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ summary: s.summary, dmNotes: s.dmNotes, readAloud: s.readAloud });
  useEffect(() => { if (current) setOpen(true); }, [current]);
  const save = async () => { await api.patch(`/adventure-sections/${s.id}`, f); setEdit(false); toast("Saved"); reload(); };
  return (
    <div className="card" style={current ? { borderColor: "var(--gold)" } : undefined}>
      <div className="row">
        <b className="grow" style={{ cursor: "pointer", opacity: s.done && !current ? 0.6 : 1 }} onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} {s.done && !current ? "✓ " : ""}{s.title}
        </b>
        {current ? <span className="pill ok">party is here</span> : <button className="small" onClick={onCurrent}>We're here</button>}
        {s.pageStart && <a className="btn small" href={pdf(s.pageStart)} target="_blank" rel="noreferrer">p. {s.pageStart}{s.pageEnd && s.pageEnd !== s.pageStart ? `–${s.pageEnd}` : ""}</a>}
      </div>
      {open && (edit ? (
        <div style={{ marginTop: 8 }}>
          <label>Summary<textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
          <label>DM notes<textarea rows={8} value={f.dmNotes} onChange={(e) => setF({ ...f, dmNotes: e.target.value })} /></label>
          <label>Read-aloud<textarea rows={5} value={f.readAloud} onChange={(e) => setF({ ...f, readAloud: e.target.value })} /></label>
          <button className="primary" onClick={save}>Save</button> <button onClick={() => setEdit(false)}>Cancel</button>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <p>{s.summary}</p>
          {s.readAloud && <blockquote className="markdown" style={{ margin: "0 0 10px", padding: "6px 12px", borderLeft: "3px solid var(--gold)", background: "#2a2216", fontStyle: "italic", whiteSpace: "pre-wrap" }}>{s.readAloud}</blockquote>}
          {s.dmNotes && <Markdown text={s.dmNotes} />}
          <div className="row">
            {s.readAloud && <button className="small" onClick={() => api.post(`/adventure-sections/${s.id}/share`, {}).then(() => toast("Read-aloud shared in chat"))}>Share read-aloud in chat</button>}
            <button className="small" onClick={() => setEdit(true)}>Edit</button>
            <label className="inline right"><input type="checkbox" checked={s.done} onChange={(e) => api.patch(`/adventure-sections/${s.id}`, { done: e.target.checked }).then(reload)} /> Done</label>
          </div>
        </div>
      ))}
    </div>
  );
}
