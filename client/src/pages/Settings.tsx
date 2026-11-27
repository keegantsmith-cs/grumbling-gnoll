import { useState } from "react";
import { api } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { Recaps } from "../components/Recaps";

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
        {campaign.nextSessionAt && <div className="notice">📅 Next session: <b>{fmtSession(campaign.nextSessionAt)}</b>{campaign.sessionWeekly ? " (every week)" : ""}{campaign.sessionNote ? ` · ${campaign.sessionNote}` : ""}</div>}
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
        <hr />
        <Recaps campaignId={campaign.id} isDM={false} />
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
        <div className="row">
          <button className="primary" onClick={save}>Save</button>
          <NotesTools campaign={campaign} notes={f.dmNotes} onReplaced={(text) => { setF({ ...f, dmNotes: text }); reload(); }} />
        </div>
      </div>

      <SessionCard campaign={campaign} reload={reload} />
      <DiscordCard campaign={campaign} reload={reload} />

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

export function fmtSession(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// datetime-local wants "YYYY-MM-DDTHH:MM" in the viewer's own time zone
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function SessionCard({ campaign, reload }: { campaign: Campaign; reload: () => void }) {
  const { toast } = useStatus();
  const [at, setAt] = useState(toLocalInput(campaign.nextSessionAt));
  const [note, setNote] = useState(campaign.sessionNote);
  const [weekly, setWeekly] = useState(campaign.sessionWeekly);
  const save = async (clear = false) => {
    try {
      await api.post(`/campaigns/${campaign.id}/session`, clear ? { at: null } : { at: at ? new Date(at).toISOString() : null, note, weekly });
      if (clear) { setAt(""); setNote(""); setWeekly(false); }
      toast(clear ? "Next session cleared" : campaign.discord?.webhook ? "Saved and announced in Discord" : "Saved");
      reload();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card">
      <h2>📅 Next session</h2>
      <p className="muted">Players see this on the site. If Discord is connected below, it's announced there, with reminders the day before, an hour before, and when it starts. Discord shows the time in each player's own time zone.</p>
      <div className="row top">
        <label>Date and time (your time)<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
        <label className="grow">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="We pick up in the Sunken Temple. Bring snacks!" /></label>
      </div>
      <label className="inline"><input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /> Same time every week</label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" disabled={!at} onClick={() => save()}>Save{campaign.discord?.webhook ? " & announce" : ""}</button>
        {campaign.nextSessionAt && <button onClick={() => save(true)}>Clear</button>}
      </div>
    </div>
  );
}

function DiscordCard({ campaign, reload }: { campaign: Campaign; reload: () => void }) {
  const { toast } = useStatus();
  const dc = campaign.discord ?? { webhook: "", dmWebhook: "", options: {}, invite: "", serverId: "" };
  const [webhook, setWebhook] = useState(dc.webhook);
  const [dmWebhook, setDmWebhook] = useState(dc.dmWebhook);
  const [opts, setOpts] = useState({ rolls: true, initiative: true, shares: true, maps: true, chat: false, ...dc.options });
  const [help, setHelp] = useState(!dc.webhook);
  const [invite, setInvite] = useState(dc.invite ?? "");
  const [serverId, setServerId] = useState(dc.serverId ?? "");
  const save = async () => {
    try { await api.patch(`/campaigns/${campaign.id}`, { discord: { webhook, dmWebhook, options: opts, invite, serverId } }); toast("Discord settings saved"); reload(); }
    catch (e) { toast((e as Error).message); }
  };
  const test = (which: string) => api.post(`/campaigns/${campaign.id}/discord/test`, { which }).then(() => toast("Test message sent. Check Discord!")).catch((e) => toast(e.message));
  const opt = (k: keyof typeof opts, label: string) => (
    <label className="inline"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <div className="card">
      <div className="row"><h2 className="grow">💬 Discord</h2><button className="small" onClick={() => setHelp(!help)}>{help ? "Hide" : "Show"} setup steps</button></div>
      {help && (
        <div className="notice">
          <b>One-time setup in Discord (about 5 minutes):</b>
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>Make a server for your group if you don't have one: click the <b>+</b> at the bottom of the server list on the left, then <b>Create My Own</b> → <b>For me and my friends</b>.</li>
            <li>Make a text channel for the game, like <b>#the-table</b>: click <b>+</b> next to "Text Channels".</li>
            <li>Hover over that channel and click the ⚙️ gear → <b>Integrations</b> → <b>Webhooks</b> → <b>New Webhook</b> → <b>Copy Webhook URL</b>. Paste it in the first box below.</li>
            <li>For private DM alerts, make a second channel like <b>#dm-alerts</b>. While creating it, turn on <b>Private Channel</b> and don't add anyone, so only you can see it. Make a webhook for it the same way and paste it in the second box.</li>
            <li>Click <b>Save</b>, then <b>Send test</b>.</li>
          </ol>
          <p style={{ margin: "6px 0 0" }}>Keep these links private. Anyone who has one can post in that channel.</p>
        </div>
      )}
      <label>Game channel webhook (rolls, turns, shared handouts, session reminders)
        <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/..." type="password" autoComplete="off" />
      </label>
      <div className="row" style={{ marginBottom: 10 }}>
        {opt("rolls", "Dice rolls")}{opt("initiative", "Whose turn it is")}{opt("shares", "Things I share")}{opt("maps", "New maps")}{opt("chat", "All chat messages")}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>Secret rolls and whispers never go to Discord. Hidden monsters' turns show as "The DM's creatures are acting".</p>
      <label>DM alerts webhook (private: approvals waiting, AI checks done, conversions done)
        <input value={dmWebhook} onChange={(e) => setDmWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/..." type="password" autoComplete="off" />
      </label>
      <h3 style={{ marginTop: 16 }}>🎧 Join voice button</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Adds a <b>Join voice</b> button to the top of the campaign for everyone, and (with the widget) shows who's in voice right now.</p>
      <ol className="muted" style={{ fontSize: 13, paddingLeft: 20 }}>
        <li><b>Invite link:</b> in Discord, right-click your server icon → <b>Invite People</b> → <b>Edit invite link</b> → set <b>Expire After: Never</b> → copy the link.</li>
        <li><b>Who's in voice (optional):</b> <b>Server Settings → Widget</b> → turn on <b>Enable Server Widget</b> → copy the <b>Server ID</b>.</li>
      </ol>
      <div className="row top">
        <label className="grow">Server invite link<input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://discord.gg/abc123" /></label>
        <label className="grow">Server ID (for the widget)<input value={serverId} onChange={(e) => setServerId(e.target.value)} placeholder="123456789012345678" /></label>
      </div>
      <div className="row">
        <button className="primary" onClick={save}>Save</button>
        <button disabled={!dc.webhook} onClick={() => test("table")}>Send test to game channel</button>
        <button disabled={!dc.dmWebhook} onClick={() => test("dm")}>Send test DM alert</button>
      </div>
    </div>
  );
}

/** Shows how big the notes are (they go with every AI request) and condenses them with AI. */
function NotesTools({ campaign, notes, onReplaced }: { campaign: Campaign; notes: string; onReplaced: (text: string) => void }) {
  const { status, toast } = useStatus();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tokens = Math.round(notes.length / 4);
  const big = tokens > 6000;
  async function condense() {
    setBusy(true);
    try { setPreview((await api.post(`/campaigns/${campaign.id}/notes/condense`)).text); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <>
      <span className="muted" style={{ fontSize: 12, color: big ? "#f0c674" : undefined }}>
        About {tokens.toLocaleString()} tokens{big ? ". Long notes make every AI request cost more." : "."}
      </span>
      {status.aiEnabled && <button className="small" disabled={busy || notes.length < 800} onClick={condense} title="Rewrites the notes about a third as long, keeping names, secrets and house rules">{busy ? "Condensing..." : "✨ Condense my notes"}</button>}
      {campaign.hasNotesBackup && <button className="small" onClick={async () => { if (!confirm("Put back the notes from before the last condense?")) return; await api.post(`/campaigns/${campaign.id}/notes/undo`); toast("Previous notes restored"); location.reload(); }}>Undo last condense</button>}
      {preview !== null && (
        <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 150, display: "grid", placeItems: "center", padding: 16 }}>
          <div className="card" style={{ maxWidth: 900, width: "100%", maxHeight: "92vh", overflow: "auto", marginBottom: 0 }}>
            <h2>Condensed notes</h2>
            <p className="muted">{notes.length.toLocaleString()} → {preview.length.toLocaleString()} characters. Check nothing important is missing, edit if you like, then use it. Your old notes are kept so you can undo.</p>
            <textarea rows={22} value={preview} onChange={(e) => setPreview(e.target.value)} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={async () => { await api.post(`/campaigns/${campaign.id}/notes/apply`, { text: preview }); toast("Notes condensed"); onReplaced(preview); setPreview(null); }}>Use these notes</button>
              <button onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
