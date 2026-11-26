import { useEffect, useRef, useState } from "react";
import type { CampaignSocket, ChatMsg } from "../socket";
import type { Campaign } from "../pages/Campaign";
import { Markdown } from "./Markdown";
import { useStatus } from "../hooks";

const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

export function ChatPanel({ campaign, live }: { campaign: Campaign; live: CampaignSocket }) {
  const [text, setText] = useState("");
  const [secret, setSecret] = useState(false);
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
  const roll = (expr: string, label = "") => live.socket?.emit("roll", { expr, label, secret });

  return (
    <>
      <div className="chat-log" ref={logRef}>
        {live.chat.length === 0 && <p className="muted">No messages yet. Type <code>/r 1d20+3</code> to roll, or click a die below.</p>}
        {live.chat.map((m) => <Message key={m.id} m={m} />)}
      </div>
      <div className="dice-bar">
        {DICE.map((d) => <button key={d} onClick={() => roll(`1${d}`)}>{d}</button>)}
        <button onClick={() => roll("2d20kh1", "advantage")} title="Roll with advantage">adv</button>
        <button onClick={() => roll("2d20kl1", "disadvantage")} title="Roll with disadvantage">dis</button>
        <label className="inline" style={{ marginLeft: "auto", fontSize: 12 }} title={campaign.isDM ? "Only you see the roll" : "Only you and the DM see the roll"}>
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> secret
        </label>
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message, /r 2d6+3 sword, /w name hi" />
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
      {m.name} {whisper && <span className="muted">{m.userId === status.user?.id ? `→ ${m.body.toName ?? "DM"} (private)` : "(private)"}</span>} <span className="muted" style={{ float: "right", fontWeight: 400 }}>{time}</span>
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
