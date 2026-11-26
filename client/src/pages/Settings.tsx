import { useState } from "react";
import { api } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";

export function Settings({ campaign, reload }: { campaign: Campaign; reload: () => void }) {
  const { toast } = useStatus();
  const users = useLoad<any[]>(campaign.isDM ? "/users" : null);
  const [f, setF] = useState({ name: campaign.name, description: campaign.description, rulesVersion: campaign.rulesVersion, dmNotes: campaign.dmNotes ?? "" });

  if (!campaign.isDM) {
    return (
      <div className="card">
        <h1>{campaign.name}</h1>
        <p>{campaign.description || "No description yet."}</p>
        <p className="muted">DM: {campaign.dmName} · 5e {campaign.rulesVersion} rules</p>
        <h3>Players</h3>
        <ul>{campaign.members.map((m) => <li key={m.id}>{m.displayName}{m.role === "dm" ? " (DM)" : ""}</li>)}</ul>
        <h3>Chat commands</h3>
        <ul>
          <li><code>/r 1d20+5 Stealth</code> roll dice with a label</li>
          <li><code>/r adv+3</code> roll with advantage (<code>dis</code> for disadvantage)</li>
          <li><code>/r 4d6dl1</code> roll 4d6 and drop the lowest</li>
          <li><code>/gmr 1d20</code> secret roll only the DM sees</li>
          <li><code>/w Name message</code> private message</li>
        </ul>
        <a href={`/api/campaigns/${campaign.id}/chat/export`} target="_blank">Download the chat log</a>
      </div>
    );
  }

  const save = async () => { await api.patch(`/campaigns/${campaign.id}`, f); toast("Saved"); reload(); };
  const nonMembers = (users.data ?? []).filter((u) => !campaign.members.some((m) => m.id === u.id));

  return (
    <div>
      <h1>Campaign settings</h1>
      <div className="card">
        <div className="row top">
          <label className="grow">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Rules<select value={f.rulesVersion} onChange={(e) => setF({ ...f, rulesVersion: e.target.value as "2014" | "2024" })}>
            <option value="2014">5e (2014 rules)</option><option value="2024">5e (2024 rules)</option>
          </select></label>
        </div>
        <label>Description (players see this)<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label>
          Private DM notes: your world, factions, NPCs the party has met, what happened last session. The AI assistant reads these so its suggestions fit your campaign. Players never see them.
          <textarea rows={12} value={f.dmNotes} onChange={(e) => setF({ ...f, dmNotes: e.target.value })} placeholder={"Setting: The Free City of Oakhaven, on the edge of the Mirewood.\nMain villain: Lady Vess, a vampire posing as a noble.\nSession 3: the party rescued the blacksmith's daughter and angered the Thieves' Guild..."} />
        </label>
        <button className="primary" onClick={save}>Save</button>
      </div>

      <div className="card">
        <h2>Players</h2>
        <table className="list"><tbody>
          {campaign.members.map((m) => (
            <tr key={m.id}><td>{m.displayName} <span className="muted">@{m.username}</span></td><td>{m.role === "dm" ? "DM" : "Player"}</td>
              <td style={{ textAlign: "right" }}>{m.role !== "dm" && <button className="small danger" onClick={() => api.del(`/campaigns/${campaign.id}/members/${m.id}`).then(reload)}>Remove</button>}</td></tr>
          ))}
        </tbody></table>
        <div className="row" style={{ marginTop: 8 }}>
          <select style={{ width: "auto" }} value="" onChange={(e) => e.target.value && api.post(`/campaigns/${campaign.id}/members`, { userId: Number(e.target.value) }).then(reload)}>
            <option value="">Add a player...</option>
            {nonMembers.map((u) => <option key={u.id} value={u.id}>{u.displayName} (@{u.username})</option>)}
          </select>
          <span className="muted">Don't see someone? Make them an invite code on the home page.</span>
        </div>
      </div>

      <div className="card">
        <h2>Other</h2>
        <div className="row">
          <a className="btn" href={`/api/campaigns/${campaign.id}/chat/export`} target="_blank">Download chat log</a>
          <button className="danger right" onClick={async () => {
            const name = prompt(`This deletes the campaign, its maps, chat and compendium. Characters are kept but leave the campaign.\n\nType the campaign name to confirm: ${campaign.name}`);
            if (name !== campaign.name) return;
            await api.del(`/campaigns/${campaign.id}`, { confirm: name });
            go("");
          }}>Delete campaign</button>
        </div>
      </div>
    </div>
  );
}
