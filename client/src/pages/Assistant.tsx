import { useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { Markdown } from "../components/Markdown";
import { Recaps } from "../components/Recaps";

const KINDS: [string, string, string][] = [
  ["npc", "🧔 NPC", "A nervous halfling fence who owes the thieves' guild money"],
  ["dialogue", "💬 Dialogue", "The innkeeper reacts to the party asking about the missing caravan"],
  ["description", "🏰 Description", "The party enters a ruined dwarven forge, cold for a century"],
  ["encounter", "⚔️ Encounter", "Ambush on a forest road at night, medium difficulty"],
  ["loot", "💰 Loot", "Treasure in a young green dragon's lair"],
  ["names", "📜 Names", "Elven noble houses"],
  ["hooks", "🪝 Plot hooks", "Something to pull the party toward the northern mountains"],
  ["rules", "📏 Rules question", "How does grappling work, and can you grapple and attack?"],
  ["freeform", "✨ Anything", "Help me plan the villain's next move"],
];

export function Assistant({ campaign }: { campaign: Campaign }) {
  const { status, toast } = useStatus();
  const [kind, setKind] = useState("npc");
  const [request, setRequest] = useState("");
  const [result, setResult] = useState<{ kind: string; text: string; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = useLoad<any[]>(`/campaigns/${campaign.id}/ai/history`);
  const usage = useLoad<any>(`/campaigns/${campaign.id}/ai/usage`);

  if (!status.aiEnabled) {
    return <div className="card"><h2>AI assistant</h2><p>The AI isn't switched on yet. Add your Anthropic API key to the server's <code>.env</code> file as <code>ANTHROPIC_API_KEY</code> and restart it. See the README for the steps.</p></div>;
  }

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api.post(`/campaigns/${campaign.id}/ai/assist`, { kind, request });
      setResult({ kind, text: r.text, prompt: request });
      history.reload(); usage.reload();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const kindLabel = (k: string) => KINDS.find((x) => x[0] === k)?.[1].replace(/^\S+\s/, "") ?? k;
  const example = KINDS.find((k) => k[0] === kind)![2];
  return (
    <div>
      <h1>🧙 DM's AI assistant</h1>
      <p className="muted">Only you can see this until you choose to share something. The AI knows your campaign notes (Settings tab), the rules version ({campaign.rulesVersion}), and the party's approved characters.</p>
      <form className="card" onSubmit={ask}>
        <h2 id="ai-kind" style={{ marginTop: 0 }}>What do you need?</h2>
        <div className="row" role="group" aria-labelledby="ai-kind" style={{ marginBottom: 12 }}>
          {KINDS.map(([k, label]) => <button type="button" key={k} aria-pressed={kind === k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{label}</button>)}
        </div>
        <label htmlFor="ai-request" className="sr-only">Your request</label>
        <textarea id="ai-request" rows={3} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={`e.g. ${example}`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy}>{busy ? "Thinking..." : "Ask"}</button>
          <span className="muted" role="status">{busy ? "The AI is writing, this can take a few seconds." : "Ctrl+Enter to send. Leave it blank to be surprised."}</span>
        </div>
        {usage.data && <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>All AI this month: {usage.data.calls} requests, about ${usage.data.estimatedUSD.toFixed(2)}{usage.data.capUSD ? ` of your $${usage.data.capUSD} limit` : ""}. <a href="#/account">AI settings</a></p>}
      </form>
      {error && <div className="error" role="alert">{error}</div>}
      {result && <ResultCard r={result} campaign={campaign} toast={toast} />}
      <Recaps campaignId={campaign.id} isDM />
      {history.data && history.data.length > 0 && (
        <>
          <h2>Earlier answers</h2>
          {history.data.map((h) => (
            <details key={h.id} className="card">
              <summary><b>{kindLabel(h.kind)}</b> · {h.prompt || "(surprise)"} <span className="muted">· {h.createdAt}</span></summary>
              <ResultCard r={{ kind: h.kind, text: h.output, prompt: h.prompt }} campaign={campaign} toast={toast} plain />
            </details>
          ))}
        </>
      )}
    </div>
  );
}

function ResultCard({ r, campaign, toast, plain }: { r: { kind: string; text: string; prompt: string }; campaign: Campaign; toast: (s: string) => void; plain?: boolean }) {
  const [text, setText] = useState(r.text);
  const [editing, setEditing] = useState(false);
  const base = `/campaigns/${campaign.id}`;
  const act = (p: Promise<unknown>, ok: string) => p.then(() => toast(ok), (e: Error) => toast(e.message || "That didn't work. Please try again."));
  return (
    <div className={plain ? "" : "card"}>
      {editing ? <textarea aria-label="Edit the answer" rows={16} value={text} onChange={(e) => setText(e.target.value)} /> : <Markdown text={text} />}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="small" onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</button>
        <button className="small" onClick={() => act(api.post(`${base}/share`, { text }), "Shared with the players in chat")}>Share in chat</button>
        <button className="small" onClick={() => act(Promise.resolve(navigator.clipboard?.writeText(text)), "Copied")}>Copy</button>
        {r.kind === "npc" && <button className="small" onClick={() => act(api.post(`${base}/ai/save-npc`, { text }), "Saved to the Compendium")}>Save NPC</button>}
        <button className="small" onClick={() => act(api.post(`${base}/compendium`, { kind: "note", name: (r.prompt || r.kind).slice(0, 60), data: { markdown: text } }), "Saved to the Compendium as a note")}>Save as note</button>
      </div>
    </div>
  );
}
