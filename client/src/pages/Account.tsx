import { useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";
import { AISettings } from "../components/AISettings";
import { DICE_STYLES, DiePreview, announceRoll, DiceTray } from "../components/DiceTray";

export function Account() {
  const { status, toast } = useStatus();
  const [pw, setPw] = useState({ current: "", next: "" });
  const [error, setError] = useState("");
  const users = useLoad<any[]>(status.user?.is_admin ? "/users" : null);
  return (
    <div className="page">
      <h1>Account</h1>
      <form className="card narrow" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.post("/me/password", pw); setPw({ current: "", next: "" }); setError(""); toast("Password changed"); }
        catch (err) { setError((err as Error).message); }
      }}>
        <h2>Change password</h2>
        {error && <div className="error" role="alert">{error}</div>}
        <label>Current password<input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
        <label>New password<input type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} /><span className="muted field-hint">At least 8 characters.</span></label>
        <button className="primary">Change password</button>
      </form>
      <DiceBag />
      {!!status.user?.is_admin && status.aiEnabled && <AISettings />}
      {!!status.user?.is_admin && (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 className="grow" style={{ margin: 0 }}>Backups</h2>
            <a className="btn primary" href="/api/admin/backup">⬇ Download a full backup now</a>
          </div>
          <p className="muted">One file with everything: the database (accounts, campaigns, characters, chat, compendium) and all uploaded maps, pictures and PDFs. The server also makes one every night. Keep a copy on your own computer now and then.</p>
          <hr />
          <h2>Players</h2>
          <p className="muted">If someone forgets their password, set a temporary one here and tell them.</p>
          <table className="list responsive"><tbody>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName} <span className="muted">@{u.username}</span></td>
                <td><button className="small" onClick={async () => {
                  const p = prompt(`New temporary password for ${u.displayName} (8+ characters):`);
                  if (!p) return;
                  try { await api.post(`/users/${u.id}/reset-password`, { password: p }); toast("Password reset"); } catch (e) { toast((e as Error).message); }
                }}>Reset password</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

function DiceBag() {
  const { status, refresh, toast } = useStatus();
  const [style, setStyle] = useState(status.user?.dice_style ?? "ruby");
  const pick = async (k: string) => {
    setStyle(k);
    try { await api.post("/me/dice", { style: k }); refresh(); } catch (e) { toast((e as Error).message); }
    announceRoll({ name: status.user!.display_name, body: { expression: "test", label: `${DICE_STYLES[k].label} dice`, total: "✓", style: k,
      dice: [4, 6, 8, 10, 12, 20].map((s) => ({ sides: s, value: s, kept: true })) } });
  };
  return (
    <div className="card">
      <DiceTray />
      <h2>🎲 Your dice</h2>
      <p className="muted">Pick the dice you roll with. Everyone at the table sees your rolls in this style.</p>
      <div className="row" role="group" aria-label="Dice styles">
        {Object.entries(DICE_STYLES).map(([k, s]) => (
          <button key={k} type="button" aria-pressed={style === k} className={style === k ? "active" : ""} onClick={() => pick(k)} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 6, minWidth: 92 }}>
            <DiePreview style={k} />
            <span style={{ fontSize: 12 }}>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
