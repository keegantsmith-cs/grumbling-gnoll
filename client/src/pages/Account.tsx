import { useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";
import { AISettings } from "../components/AISettings";

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
        {error && <div className="error">{error}</div>}
        <label>Current password<input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
        <label>New password<input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} /></label>
        <button className="primary">Save</button>
      </form>
      {!!status.user?.is_admin && status.aiEnabled && <AISettings />}
      {!!status.user?.is_admin && (
        <div className="card">
          <h2>Players (admin)</h2>
          <p className="muted">If someone forgets their password, set a temporary one here and tell them.</p>
          <table className="list"><tbody>
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
