import { useEffect, useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";

const PRESETS: Record<string, { label: string; desc: string; pick: Record<string, string> }> = {
  budget: { label: "💰 Cheapest", desc: "Haiku for everything. Pennies a month; answers are simpler.", pick: { assistant: "claude-haiku-5-5", review: "claude-haiku-5-5", reading: "claude-haiku-5-5", maps: "claude-haiku-5-5" } },
  balanced: { label: "⚖️ Balanced (recommended)", desc: "Haiku reads PDFs and photos (the expensive part); Sonnet writes and checks.", pick: { assistant: "claude-sonnet-5-5", review: "claude-sonnet-5-5", reading: "claude-haiku-5-5", maps: "claude-sonnet-5-5" } },
  best: { label: "✨ Best quality", desc: "Opus for everything. Most expensive.", pick: { assistant: "claude-opus-5-5", review: "claude-opus-5-5", reading: "claude-opus-5-5", maps: "claude-opus-5-5" } },
};

const KIND_LABEL: Record<string, string> = {
  "character-review": "Character check", "npc-stats": "NPC stats", convert: "PDF conversion", adventure: "Adventure reading", "adventure-synopsis": "Adventure overview",
  "sheet-scan": "Paper sheet import", "map-design": "AI map", "art-prompt": "Portrait prompt",
};

export function AISettings() {
  const { toast } = useStatus();
  const { data, reload } = useLoad<any>("/ai/settings");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [cap, setCap] = useState("");
  useEffect(() => {
    if (data) { setSelected(data.selected); setCap(data.capUSD ? String(data.capUSD) : ""); }
  }, [data]);
  if (!data) return null;

  const save = async () => { await api.put("/ai/settings", { selected, capUSD: Number(cap) || 0 }); toast("AI settings saved"); reload(); };
  const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

  return (
    <div className="card">
      <h2>🧙 AI settings & costs</h2>
      <p>
        This month so far: <b>{usd(data.monthSpend)}</b>{data.capUSD ? <> of your <b>${data.capUSD.toFixed(2)}</b> limit</> : ""}.{" "}
        <span className="muted">(Estimated from token counts; the Claude Console shows the exact bill.)</span>
      </p>

      <h3>Quick choices</h3>
      <div className="row top" style={{ marginBottom: 10 }}>
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} style={{ whiteSpace: "normal", textAlign: "left", maxWidth: 260 }} onClick={() => setSelected(p.pick)}>
            <b>{p.label}</b>
            <div className="muted" style={{ fontSize: 12 }}>{p.desc}</div>
          </button>
        ))}
      </div>

      <h3>Model for each job</h3>
      <table className="list"><tbody>
        {Object.entries(data.features as Record<string, string>).map(([f, desc]) => (
          <tr key={f}>
            <td>
              {desc}
              {data.byFeature[f] && <div className="muted" style={{ fontSize: 12 }}>This month: {data.byFeature[f].requests} requests, {usd(data.byFeature[f].cost)}</div>}
            </td>
            <td style={{ width: 230 }}>
              <select value={selected[f] ?? data.defaultModel} onChange={(e) => setSelected({ ...selected, [f]: e.target.value })}>
                {Object.entries(data.models as Record<string, any>).map(([id, m]) => (
                  <option key={id} value={id}>{m.label.replace("Claude ", "")} (${m.price[0]} / ${m.price[1]})</option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody></table>
      <p className="muted" style={{ fontSize: 12 }}>
        Opus: best quality, most expensive. Sonnet: about half the price of Opus and still very good. Haiku: about 40× cheaper than Opus, great for reading and copying text from PDFs and photos.
      </p>

      <div className="row">
        <label>Monthly limit in dollars (blank = none)
          <input type="number" min={0} step={1} value={cap} onChange={(e) => setCap(e.target.value)} style={{ width: 120 }} placeholder="e.g. 5" />
        </label>
        <span className="muted" style={{ fontSize: 12 }}>When the month's estimated spend reaches this, AI features pause until next month (or until you raise it).</span>
      </div>
      <button className="primary" onClick={save}>Save AI settings</button>

      <details style={{ marginTop: 14 }}>
        <summary>Recent AI requests and what they cost</summary>
        <table className="list">
          <thead><tr><th>When</th><th>What</th><th>Model</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
          <tbody>
            {data.recent.map((r: any, i: number) => (
              <tr key={i}>
                <td className="muted">{r.createdAt}</td>
                <td>{KIND_LABEL[r.kind] ?? (r.kind.startsWith("assist:") ? `Assistant: ${r.kind.slice(7)}` : r.kind)}</td>
                <td>{data.models[r.model]?.label.replace("Claude ", "") ?? r.model}</td>
                <td>{(r.inputTokens ?? 0).toLocaleString()} / {(r.outputTokens ?? 0).toLocaleString()}</td>
                <td>{usd(r.cost ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
