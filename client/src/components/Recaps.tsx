import { useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";
import { Markdown } from "./Markdown";

/** DM: write, edit and share AI session recaps. Players: read the shared ones. */
export function Recaps({ campaignId, isDM }: { campaignId: number; isDM: boolean }) {
  const { status, toast } = useStatus();
  const list = useLoad<any[]>(`/campaigns/${campaignId}/recaps`);
  const [range, setRange] = useState("since-last");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);

  async function write() {
    setBusy(true);
    try { await api.post(`/campaigns/${campaignId}/recaps`, { range, extra }); setExtra(""); list.reload(); toast("Recap written. Check it over, then share it."); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <h2>📜 Session recaps</h2>
      {isDM && status.aiEnabled && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>After a session, the AI reads the table chat, rolls and handouts and writes a "previously on..." recap for the players, plus private notes for you (loose threads, NPC moods, ideas). Whispers and secret rolls never appear in the players' version.</p>
          <div className="row top">
            <label>Recap
              <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: "auto" }}>
                <option value="since-last">Everything since the last recap</option>
                <option value="6h">The last 6 hours</option>
                <option value="24h">The last 24 hours</option>
                <option value="7d">The last week</option>
              </select>
            </label>
            <label className="grow">Anything to add? (things said out loud on Discord that aren't in chat)
              <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. They spared the goblin chief and promised to find his lost son." />
            </label>
          </div>
          <button className="primary" disabled={busy} onClick={write}>{busy ? "Writing the recap..." : "✨ Write a recap"}</button>
        </div>
      )}
      {list.data?.length === 0 && <p className="muted">{isDM ? "No recaps yet." : "Your DM hasn't shared any recaps yet."}</p>}
      {list.data?.map((r) => <RecapCard key={r.id} r={r} isDM={isDM} reload={list.reload} />)}
    </div>
  );
}

function RecapCard({ r, isDM, reload }: { r: any; isDM: boolean; reload: () => void }) {
  const { toast } = useStatus();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: r.title, playerRecap: r.playerRecap, dmNotes: r.dmNotes ?? "" });
  const save = async () => { await api.patch(`/recaps/${r.id}`, f); setEdit(false); reload(); toast("Saved"); };
  return (
    <details className="card" open={!r.shared || !isDM}>
      <summary>
        <b>{r.title}</b> <span className="muted">· {r.createdAt.slice(0, 10)}</span>
        {isDM && (r.shared ? <span className="pill ok" style={{ marginLeft: 6 }}>shared</span> : <span className="pill warn" style={{ marginLeft: 6 }}>not shared yet</span>)}
        {isDM && r.addedToNotes && <span className="pill" style={{ marginLeft: 6 }}>in campaign notes</span>}
      </summary>
      {edit ? (
        <div style={{ marginTop: 8 }}>
          <label>Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label>For the players<textarea rows={10} value={f.playerRecap} onChange={(e) => setF({ ...f, playerRecap: e.target.value })} /></label>
          <label>DM-only notes<textarea rows={6} value={f.dmNotes} onChange={(e) => setF({ ...f, dmNotes: e.target.value })} /></label>
          <button className="primary" onClick={save}>Save</button> <button onClick={() => setEdit(false)}>Cancel</button>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <Markdown text={r.playerRecap} />
          {isDM && r.dmNotes && (
            <div className="card" style={{ border: "1px dashed #8a6fb0", background: "#221a2a", marginBottom: 8 }}>
              <b>🔒 Notes for you</b>
              <Markdown text={r.dmNotes} />
            </div>
          )}
          {isDM && (
            <div className="row">
              <button className="small primary" onClick={() => api.post(`/recaps/${r.id}/share`).then(() => { reload(); toast("Shared with the players in chat (and Discord, if connected)"); })}>{r.shared ? "Share again" : "Share with players"}</button>
              <button className="small" disabled={r.addedToNotes} onClick={() => api.post(`/recaps/${r.id}/add-to-notes`).then(() => { reload(); toast("Added to your campaign notes. The AI will remember it."); })}>{r.addedToNotes ? "In campaign notes ✓" : "Add to campaign notes"}</button>
              <button className="small" onClick={() => setEdit(true)}>Edit</button>
              <button className="small danger right" onClick={async () => { if (confirm("Delete this recap?")) { await api.del(`/recaps/${r.id}`); reload(); } }}>Delete</button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
