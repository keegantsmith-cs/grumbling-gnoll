import { useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { Markdown } from "../components/Markdown";

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
    return <div className="card"><h2>AI assistant</h2><p>AI isn't set up yet. Add your Anthropic API key to the server's <code>.env</code> file as <code>ANTHROPIC_API_KEY</code> and restart it. See the README for the steps.</p></div>;
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

  const example = KINDS.find((k) => k[0] === kind)![2];
  return (
    <div>
      <h1>🧙 DM's AI assistant</h1>
      <p className="muted">Only you can see this. The AI knows your campaign notes (Settings tab), the rules version ({campaign.rulesVersion}), and the party's approved characters.</p>
      <form className="card" onSubmit={ask}>
        <div className="row" style={{ marginBottom: 10 }}>
          {KINDS.map(([k, label]) => <button type="button" key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>{label}</button>)}
        </div>
        <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={`e.g. ${example}`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy}>{busy ? "Thinking..." : "Ask"}</button>
          <span className="muted">Ctrl+Enter to send. Leave it blank to be surprised.</span>
          {usage.data && <span className="muted right" style={{ fontSize: 12 }}>This month: {usage.data.calls} requests ≈ ${usage.data.estimatedUSD.toFixed(2)} ({usage.data.model})</span>}
        </div>
      </form>
      {error && <div className="error">{error}</div>}
      {result && <ResultCard r={result} campaign={campaign} toast={toast} />}
      {history.data && history.data.length > 0 && (
        <>
          <h2>Earlier</h2>
          {history.data.map((h) => (
            <details key={h.id} className="card">
              <summary><b>{h.kind}</b> · {h.prompt || "(surprise)"} <span className="muted">· {h.createdAt}</span></summary>
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
  return (
    <div className={plain ? "" : "card"}>
      {editing ? <textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} /> : <Markdown text={text} />}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="small" onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</button>
        <button className="small" onClick={() => api.post(`/campaigns/${campaign.id}/share`, { text }).then(() => toast("Shared with the players in chat"))}>Share in chat</button>
        <button className="small" onClick={() => navigator.clipboard?.writeText(text).then(() => toast("Copied"))}>Copy</button>
        {r.kind === "npc" && <button className="small" onClick={() => api.post(`/campaigns/${campaign.id}/ai/save-npc`, { text }).then(() => toast("Saved to the Compendium"))}>Save NPC</button>}
        <button className="small" onClick={() => api.post(`/campaigns/${campaign.id}/compendium`, { kind: "note", name: (r.prompt || r.kind).slice(0, 60), data: { markdown: text } }).then(() => toast("Saved to the Compendium as a note"))}>Save as note</button>
      </div>
    </div>
  );
}
