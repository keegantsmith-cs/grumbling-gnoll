import { useState } from "react";
import { api } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import { classSummary, totalLevel } from "../../../shared/character";
import { fmtSession } from "./Settings";

export function Home() {
  const { status } = useStatus();
  const campaigns = useLoad<any[]>("/campaigns");
  const chars = useLoad<any[]>("/characters");
  const [form, setForm] = useState({ name: "", description: "", rulesVersion: "2014" });
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api.post("/campaigns", form);
      go(`c/${r.id}/settings`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <div className="row">
        <h1 className="grow">Your campaigns</h1>
        <button className="primary" onClick={() => setCreating(!creating)}>+ New campaign</button>
      </div>
      {creating && (
        <form className="card" onSubmit={create}>
          {error && <div className="error">{error}</div>}
          <div className="row top">
            <label className="grow">Campaign name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Rules
              <select value={form.rulesVersion} onChange={(e) => setForm({ ...form, rulesVersion: e.target.value })}>
                <option value="2014">5e (2014 rules)</option>
                <option value="2024">5e (2024 rules)</option>
              </select>
            </label>
          </div>
          <label>Short description (players see this)<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <button className="primary">Create — I'll be the DM</button>
        </form>
      )}
      {campaigns.error && <div className="error">{campaigns.error}</div>}
      <div className="grid">
        {campaigns.data?.map((c) => (
          <div key={c.id} className="card" style={{ cursor: "pointer" }} onClick={() => go(`c/${c.id}/table`)}>
            <h2>{c.name}</h2>
            <p className="muted">{c.description || "No description yet."}</p>
            <div className="row">
              <span className="pill">{c.rulesVersion} rules</span>
              <span className="pill">{c.isDM ? "You're the DM" : `DM: ${c.dmName}`}</span>
            </div>
            {c.nextSessionAt && new Date(c.nextSessionAt) > new Date(Date.now() - 3 * 3600e3) && <p style={{ margin: "8px 0 0" }}>📅 Next session: <b>{fmtSession(c.nextSessionAt)}</b></p>}
          </div>
        ))}
        {campaigns.data?.length === 0 && <p className="muted">You're not in any campaigns yet. Create one, or ask your DM to add you.</p>}
      </div>

      <hr />
      <div className="row">
        <h1 className="grow">Your characters</h1>
        <button onClick={async () => { const r = await api.post("/characters", { data: { name: "New Adventurer" } }); go(`character/${r.id}`); }}>+ New character (no campaign)</button>
      </div>
      <p className="muted">Characters you build inside a campaign need the DM's approval. You can also keep characters here and bring them into a campaign later.</p>
      <table className="list">
        <thead><tr><th>Name</th><th>Class</th><th>Campaign</th><th>Status</th></tr></thead>
        <tbody>
          {chars.data?.map((c) => (
            <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => go(`character/${c.id}`)}>
              <td>{c.name}</td>
              <td>Level {totalLevel(c.data)} {classSummary(c.data)}</td>
              <td>{c.campaignName ?? <span className="muted">none</span>}</td>
              <td><StatusPill c={c} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {!!status.user?.is_admin && <Invites />}
    </div>
  );
}

export function StatusPill({ c }: { c: any }) {
  if (c.pending) return <span className="pill warn">Waiting for DM</span>;
  if (c.status === "approved") return <span className="pill ok">Approved</span>;
  return <span className="pill bad">Not approved</span>;
}

function Invites() {
  const invites = useLoad<any[]>("/invites");
  const [uses, setUses] = useState(1);
  return (
    <>
      <hr />
      <h1>Invite players</h1>
      <p className="muted">Send a code to each player. They pick "I have an invite code" on the login page. Then add them to your campaign from the campaign's Settings tab.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="inline">Uses <input type="number" min={1} max={20} value={uses} onChange={(e) => setUses(Number(e.target.value))} style={{ width: 70 }} /></label>
        <button className="primary" onClick={() => api.post("/invites", { uses }).then(invites.reload)}>Create invite code</button>
      </div>
      <table className="list">
        <tbody>
          {invites.data?.map((i) => (
            <tr key={i.code}>
              <td><code style={{ fontSize: 16 }}>{i.code}</code></td>
              <td className="muted">{i.usesLeft} use{i.usesLeft === 1 ? "" : "s"} left</td>
              <td><button className="small" onClick={() => navigator.clipboard?.writeText(i.code)}>Copy</button> <button className="small danger" onClick={() => api.del(`/invites/${i.code}`).then(invites.reload)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
