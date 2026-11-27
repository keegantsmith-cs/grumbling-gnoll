import { useState } from "react";
import { api } from "../api";
import { go, useStatus } from "../hooks";

/** Ask the AI for NPCs who belong on this map; they're saved to the Compendium and placed as tokens. */
export function NpcMaker({ campaignId, at, onDone }: { campaignId: number; at?: { x: number; y: number }; onDone?: () => void }) {
  const { status, toast } = useStatus();
  const [count, setCount] = useState(2);
  const [request, setRequest] = useState("");
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ name: string; entryId: number }[] | null>(null);
  if (!status.aiEnabled) return <p className="muted">This needs the AI, which isn't set up on the server yet.</p>;

  async function make() {
    setBusy(true);
    try {
      const r = await api.post(`/campaigns/${campaignId}/table/npcs`, { count, request, hidden, ...(at ?? {}) });
      setMade(r.npcs);
      toast(`Added ${r.npcs.length} NPC${r.npcs.length === 1 ? "" : "s"} to the map and the Compendium`);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  if (made) {
    return (
      <div>
        <p>Created: <b>{made.map((n) => n.name).join(", ")}</b></p>
        <p className="muted" style={{ fontSize: 12 }}>Their personality, voice, sample lines and stat block are in the Compendium (only you see them). Click a token for HP and rings.</p>
        <div className="row">
          <button className="small" onClick={() => go(`c/${campaignId}/compendium`)}>Open Compendium</button>
          <button className="small" onClick={() => setMade(null)}>Make more</button>
          <button className="small" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <label>Who should be here?
        <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. tavern regulars with gossip about the missing caravan · the town guard captain and two guards · a suspicious merchant" />
      </label>
      <div className="row">
        <label>How many<select value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 70 }}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></label>
        <label className="inline"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden from players</label>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>The AI uses this map's key and nearby markers, your campaign notes and the party. Leave it blank for people who'd naturally be here.</p>
      <button className="primary" disabled={busy} onClick={make}>{busy ? "Writing NPCs... (about a minute)" : "✨ Create NPCs"}</button>
    </div>
  );
}
