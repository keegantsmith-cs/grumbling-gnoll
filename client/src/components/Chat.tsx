import { useEffect, useRef, useState } from "react";
import type { CampaignSocket, ChatMsg } from "../socket";
import type { Campaign } from "../pages/Campaign";
import { Markdown } from "./Markdown";
import { useStatus } from "../hooks";
import { diceSettings } from "./DiceTray";

const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

export function ChatPanel({ campaign, live }: { campaign: Campaign; live: CampaignSocket }) {
  const [text, setText] = useState("");
  const [secret, setSecret] = useState(false);
  const [anim, setAnim] = useState(diceSettings.animation);
  const [sound, setSound] = useState(diceSettings.sound);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live.chat.length]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    live.socket?.emit("chat", text);
    setText("");
  }
  const roll = (expr: string, label = "") => live.socket?.emit("roll", campaign.isDM ? { expr, label, public: secret } : { expr, label, secret });

  return (
    <>
      <div className="chat-log" ref={logRef}>
        {live.chat.length === 0 && <p className="muted">No messages yet. Click a die below to roll, or type <code>/r 1d20+3</code> in the message box.</p>}
        {live.chat.map((m) => <Message key={m.id} m={m} />)}
      </div>
      <div className="dice-bar" role="group" aria-label="Quick dice">
        {DICE.map((d) => <button key={d} onClick={() => roll(`1${d}`)} aria-label={`Roll ${d}`}>{d}</button>)}
        <button onClick={() => roll("2d20kh1", "advantage")} title="Roll a d20 with advantage">Adv</button>
        <button onClick={() => roll("2d20kl1", "disadvantage")} title="Roll a d20 with disadvantage">Dis</button>
        <span className="dice-opts">
          {campaign.isDM ? (
            <label className="inline" style={{ fontSize: 13, margin: 0 }} title="Your rolls are hidden from players unless you tick this">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Show players
            </label>
          ) : (
            <label className="inline" style={{ fontSize: 13, margin: 0 }} title="Only you and the DM see the roll">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Secret roll
            </label>
          )}
          <button title={anim ? "Turn off dice animation" : "Turn on dice animation"} aria-label="Dice animation" aria-pressed={anim} style={{ opacity: anim ? 1 : 0.5 }} onClick={() => { diceSettings.animation = !anim; setAnim(!anim); }}>✨</button>
          <button title={sound ? "Mute dice sound" : "Turn on dice sound"} aria-label="Dice sound" aria-pressed={sound} style={{ opacity: anim && sound ? 1 : 0.5 }} onClick={() => { diceSettings.sound = !sound; setSound(!sound); }}>{sound ? "🔊" : "🔇"}</button>
        </span>
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Message"
          title={campaign.isDM ? "/r 1d20 rolls hidden from players · /pr 1d20 shows them · /w name message whispers" : "/r 2d6+3 sword rolls dice · /w name message whispers"}
          placeholder={campaign.isDM ? "Say something, or /r 1d20" : "Say something, or /r 2d6+3"} />
        <button className="primary">Send</button>
      </form>
    </>
  );
}

function Message({ m }: { m: ChatMsg }) {
  const { status } = useStatus();
  const whisper = m.whisperTo != null;
  const cls = `chat-msg${whisper ? " whisper" : ""}${m.kind === "share" ? " share" : ""}`;
  const time = new Date(m.createdAt.replace(" ", "T") + "Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const header = (
    <div className="who">
      {m.name} {whisper && <span className="muted">{m.whisperTo === m.userId ? "🔒 hidden from players" : m.userId === status.user?.id || (m.body.toName && m.whisperTo !== status.user?.id) ? `→ ${m.body.toName ?? "DM"} (private)` : "(private)"}</span>} <span className="muted" style={{ float: "right", fontWeight: 400 }}>{time}</span>
    </div>
  );
  if (m.kind === "roll") {
    return (
      <div className={cls}>
        {header}
        <div className="row">
          <span className={`roll-total${m.body.crit === "success" ? " crit" : m.body.crit === "fail" ? " fumble" : ""}`}>{m.body.total}</span>
          <span className="grow">
            {m.body.label && <b>{m.body.label} </b>}
            <span className="muted">{m.body.expression}</span>
            <div className="muted" style={{ fontSize: 12 }}><Markdown text={m.body.detail} /></div>
          </span>
        </div>
        {m.body.crit === "success" && <div style={{ color: "#8fe07a", fontSize: 12 }}>Natural 20!</div>}
        {m.body.crit === "fail" && <div style={{ color: "#ff7a63", fontSize: 12 }}>Natural 1...</div>}
      </div>
    );
  }
  if (m.kind === "share") {
    return (
      <div className={cls}>
        {header}
        {m.body.title && <b>{m.body.title}</b>}
        <Markdown text={m.body.text} />
      </div>
    );
  }
  return <div className={cls}>{header}<div style={{ whiteSpace: "pre-wrap" }}>{m.body.text}</div></div>;
}
