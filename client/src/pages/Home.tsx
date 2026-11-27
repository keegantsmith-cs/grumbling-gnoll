import { useState } from "react";
import { api } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import { classSummary, totalLevel } from "../../../shared/character";
import { fmtSession } from "./Settings";
import { ScanSheet } from "../components/ScanSheet";
import { CharacterWizard } from "./CharacterWizard";
import { AiCharacter } from "../components/AiCharacter";

export function Home() {
  const { status } = useStatus();
  const campaigns = useLoad<any[]>("/campaigns");
  const chars = useLoad<any[]>("/characters");
  const [form, setForm] = useState({ name: "", description: "", rulesVersion: "2014" });
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [aiMaker, setAiMaker] = useState(false);

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
        <button className="primary" onClick={() => setWizard(true)}>🧙 Create step by step</button>
        <button onClick={() => setAiMaker(true)}>✨ AI makes one</button>
        <button onClick={() => setScanning(true)}>📷 Import paper sheet</button>
        <button onClick={async () => { const r = await api.post("/characters", { data: { name: "New Adventurer" } }); go(`character/${r.id}`); }}>+ New character (no campaign)</button>
      </div>
      {scanning && <ScanSheet onCancel={() => setScanning(false)} onDone={(id) => go(`character/${id}`)} />}
      {aiMaker && <AiCharacter rules="2014" onCancel={() => setAiMaker(false)} onDone={(id) => go(`character/${id}`)} />}
      {wizard && <CharacterWizard rules="2014" onCancel={() => setWizard(false)} onDone={(id) => go(`character/${id}`)} />}
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
  const { status, toast } = useStatus();
  const invites = useLoad<any[]>("/invites");
  const campaigns = useLoad<any[]>("/campaigns");
  const [uses, setUses] = useState(1);
  const [emailing, setEmailing] = useState(false);
  const joinLink = (code: string) => `${location.origin}/#/join/${code}`;
  return (
    <>
      <hr />
      <div className="row">
        <h1 className="grow">Invite players</h1>
        <button className="primary" onClick={() => setEmailing(!emailing)}>✉️ Invite by email</button>
      </div>
      <p className="muted">Send each player an invite. The link opens the sign-up page with their code filled in. Invites made for a campaign add the player to it automatically.</p>
      {emailing && <EmailInvite campaigns={(campaigns.data ?? []).filter((c) => c.isDM)} dmName={status.user!.display_name} onDone={() => { invites.reload(); }} />}
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="inline">Uses <input type="number" min={1} max={20} value={uses} onChange={(e) => setUses(Number(e.target.value))} style={{ width: 70 }} /></label>
        <button onClick={() => api.post("/invites", { uses }).then(invites.reload)}>Create a plain invite code</button>
      </div>
      <table className="list">
        <tbody>
          {invites.data?.map((i) => (
            <tr key={i.code}>
              <td><code style={{ fontSize: 16 }}>{i.code}</code>{i.campaignName && <div className="muted" style={{ fontSize: 12 }}>joins {i.campaignName}</div>}{i.note && <div className="muted" style={{ fontSize: 12 }}>{i.note}</div>}</td>
              <td className="muted">{i.usesLeft} use{i.usesLeft === 1 ? "" : "s"} left</td>
              <td style={{ textAlign: "right" }}>
                <button className="small" onClick={() => navigator.clipboard?.writeText(joinLink(i.code)).then(() => toast("Invite link copied"))}>Copy link</button>{" "}
                <button className="small" onClick={() => navigator.clipboard?.writeText(i.code).then(() => toast("Code copied"))}>Copy code</button>{" "}
                <button className="small danger" onClick={() => api.del(`/invites/${i.code}`).then(invites.reload)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Writes an invite email and opens it in the DM's own email app (Gmail, Outlook, Apple Mail...). */
function EmailInvite({ campaigns, dmName, onDone }: { campaigns: any[]; dmName: string; onDone: () => void }) {
  const { toast } = useStatus();
  const [emails, setEmails] = useState("");
  const [campaignId, setCampaignId] = useState<string>(campaigns[0] ? String(campaigns[0].id) : "");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const camp = campaigns.find((c) => String(c.id) === campaignId);

  function draft(c: string) {
    const link = `${location.origin}/#/join/${c}`;
    const what = camp ? `our D&D campaign "${camp.name}"` : "our D&D group";
    const session = camp?.nextSessionAt && new Date(camp.nextSessionAt) > new Date() ? `\nOur next session is ${fmtWhen(camp.nextSessionAt)}.\n` : "";
    setSubject(camp ? `You're invited: ${camp.name} at The Grumbling Gnoll 🍺` : "You're invited to The Grumbling Gnoll 🍺");
    setBody(
`Hi!

${dmName} has invited you to join ${what} on The Grumbling Gnoll, the site we use for our games: maps, dice, character sheets and more.
${note ? `\n${note}\n` : ""}
To join:
1. Open this link: ${link}
2. Pick a username and password. Your invite code (${c}) is already filled in.
3. Go to the Characters tab and make your character. There's a step-by-step creator, or you can photograph a paper sheet.
${session}
We talk during games on Discord, so have that ready too.

See you at the table!
${dmName}`);
  }

  async function prepare() {
    try {
      const r = await api.post("/invites", { uses: Math.max(1, list.length), campaignId: campaignId ? Number(campaignId) : undefined, note: list.join(", ").slice(0, 200) });
      setCode(r.code);
      draft(r.code);
      onDone();
    } catch (e) { toast((e as Error).message); }
  }

  const mailto = `mailto:?bcc=${encodeURIComponent(list.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="card">
      <h3>✉️ Invite by email</h3>
      {!code ? (
        <>
          <label>Email addresses (separate with commas or new lines)<textarea rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="sam@example.com, jo@example.com" /></label>
          <div className="row top">
            <label>Add them to campaign
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ width: "auto" }}>
                <option value="">None (just the site)</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="grow">Personal note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="We start on Friday at 7pm. Bring snacks!" /></label>
          </div>
          <button className="primary" disabled={!list.length} onClick={prepare}>Write the email ({list.length} {list.length === 1 ? "person" : "people"})</button>
        </>
      ) : (
        <>
          <p className="muted">Invite code <code>{code}</code> created ({list.length} use{list.length === 1 ? "" : "s"}). Check the email, then open it in your email app and press Send. Addresses go in BCC, so people don't see each other's.</p>
          <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label>Message<textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="row">
            <a className="btn primary" href={mailto} style={{ textDecoration: "none", background: "var(--red-dark)", borderColor: "var(--red)", color: "#fff" }}>Open in my email app</a>
            <a className="btn" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}
              href={`https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(list.join(","))}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in Gmail</a>
            <button onClick={() => navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(() => toast("Message copied. Paste it into an email, text or Discord."))}>Copy message</button>
            <button onClick={() => { setCode(""); setEmails(""); setNote(""); }}>Invite someone else</button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Use Gmail in your browser? Click "Open in Gmail". If neither works, "Copy message" and paste it into any email, text or Discord message.</p>
        </>
      )}
    </div>
  );
}
