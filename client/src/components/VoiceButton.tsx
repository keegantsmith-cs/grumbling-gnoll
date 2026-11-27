import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Campaign } from "../pages/Campaign";

interface Voice { enabled: boolean; invite: string | null; server?: string; channels: { name: string; members: { name: string; avatar: string | null }[] }[]; error?: string }

/** "Join voice" in the campaign bar: opens Discord, and shows who's in voice if the server widget is on. */
export function VoiceButton({ campaign }: { campaign: Campaign }) {
  const [voice, setVoice] = useState<Voice | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const configured = !!campaign.discordVoice?.invite || campaign.discordVoice?.widget;

  useEffect(() => {
    if (!configured) return;
    const load = () => api.get<Voice>(`/campaigns/${campaign.id}/discord/voice`).then(setVoice).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [campaign.id, configured]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!configured) {
    return campaign.isDM ? <a className="muted" style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12, whiteSpace: "nowrap" }} href={`#/c/${campaign.id}/settings`}>🎧 Set up Join voice</a> : <span style={{ marginLeft: "auto" }} />;
  }
  const inVoice = (voice?.channels ?? []).flatMap((c) => c.members);
  const invite = voice?.invite ?? campaign.discordVoice.invite;
  return (
    <span ref={box} style={{ marginLeft: "auto", alignSelf: "center", position: "relative", display: "flex", gap: 4 }}>
      <a className="btn" href={invite ?? "#"} target="_blank" rel="noreferrer"
        onClick={(e) => { if (!invite) { e.preventDefault(); setOpen(true); } }}
        style={{ textDecoration: "none", background: "#5865F2", borderColor: "#4752c4", color: "#fff", padding: "4px 10px", whiteSpace: "nowrap" }}
        title="Opens your Discord server. Then click the voice channel to talk.">
        🎧 Join voice{inVoice.length ? ` · ${inVoice.length} in voice` : ""}
      </a>
      {voice?.enabled && <button className="small" onClick={() => setOpen(!open)} title="Who's in voice">▾</button>}
      {open && voice && (
        <div className="card" style={{ position: "absolute", right: 0, top: "110%", width: 260, zIndex: 40, boxShadow: "0 8px 30px #000a", marginBottom: 0 }}>
          {voice.server && <b>{voice.server}</b>}
          {voice.error && <p className="muted" style={{ fontSize: 13 }}>{voice.error}</p>}
          {voice.enabled && voice.channels.filter((c) => c.members.length).length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nobody's in voice yet.</p>}
          {voice.channels.filter((c) => c.members.length).map((c) => (
            <div key={c.name} style={{ marginTop: 6 }}>
              <div className="muted" style={{ fontSize: 12 }}>🔊 {c.name}</div>
              {c.members.map((m) => (
                <div key={m.name} className="row" style={{ gap: 6, marginLeft: 8 }}>
                  {m.avatar ? <img src={m.avatar} alt="" style={{ width: 20, height: 20, borderRadius: "50%" }} /> : <span>🟢</span>}
                  <span>{m.name}</span>
                </div>
              ))}
            </div>
          ))}
          {!invite && <p className="muted" style={{ fontSize: 12 }}>Ask your DM to add the server invite link in Settings.</p>}
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>First time? Install Discord or use it in your browser, then join the voice channel.</p>
        </div>
      )}
    </span>
  );
}
