import { useEffect, useState } from "react";
import { api } from "../api";
import { useStatus } from "../hooks";

export function Login() {
  const { status, refresh } = useStatus();
  // Invite links look like #/join/ABCD-1234
  const joinCode = location.hash.match(/^#\/join\/([A-Z0-9-]+)/i)?.[1]?.toUpperCase() ?? "";
  const [mode, setMode] = useState<"login" | "register">(status.needsSetup || joinCode ? "register" : "login");
  const [f, setF] = useState({ username: "", displayName: "", password: "", inviteCode: joinCode });
  const [inviteInfo, setInviteInfo] = useState<{ campaign: string | null } | null>(null);
  useEffect(() => {
    if (joinCode) api.get(`/invites/${joinCode}/info`).then(setInviteInfo).catch((e) => setError(e.message));
  }, [joinCode]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(mode === "login" ? "/login" : "/register", f);
      if (joinCode) location.hash = "#/";
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card narrow" onSubmit={submit}>
        <h1 style={{ textAlign: "center" }}>🍺 The Grumbling Gnoll</h1>
        <p className="muted" style={{ textAlign: "center" }}>
          {status.needsSetup ? "Welcome! Create the first account. It becomes the admin (that's you, DM)." : mode === "login" ? "Pull up a chair, adventurer." : "Join the table with the invite code from your DM."}
        </p>
        {inviteInfo && <div className="notice">🍺 You've been invited{inviteInfo.campaign ? <> to <b>{inviteInfo.campaign}</b></> : ""}! Pick a username and password to join.</div>}
        {error && <div className="error">{error}</div>}
        <label>Username<input value={f.username} onChange={set("username")} autoComplete="username" required /></label>
        {mode === "register" && <label>Display name (what others see)<input value={f.displayName} onChange={set("displayName")} /></label>}
        <label>Password<input type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : undefined} /></label>
        {mode === "register" && !status.needsSetup && <label>Invite code<input value={f.inviteCode} onChange={set("inviteCode")} placeholder="ABCD-1234" required /></label>}
        <button className="primary" style={{ width: "100%" }} disabled={busy}>{mode === "login" ? "Log in" : "Create account"}</button>
        {!status.needsSetup && (
          <p style={{ textAlign: "center", marginTop: 12 }}>
            <button type="button" className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "I have an invite code" : "I already have an account"}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
