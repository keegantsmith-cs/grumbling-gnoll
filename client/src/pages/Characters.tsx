import { useEffect, useState } from "react";
import { api } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { CharacterPage } from "./CharacterSheet";
import { StatusPill } from "./Home";
import { ScanSheet } from "../components/ScanSheet";
import { blankCharacter, classSummary, derive } from "../../../shared/character";

export function CharactersTab({ campaign, changed, openId, roll }: { campaign: Campaign; changed: { what: string; at: number }; openId?: string; roll: (e: string, l: string) => void }) {
  const { status, toast } = useStatus();
  const list = useLoad<any[]>(`/characters?campaignId=${campaign.id}`);
  const mine = useLoad<any[]>("/characters");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  useEffect(() => { if (changed.what === "characters" || changed.what === "approvals") list.reload(); }, [changed]);

  if (openId) return <CharacterPage id={Number(openId)} roll={roll} onDone={() => { list.reload(); go(`c/${campaign.id}/characters`); }} />;

  const elsewhere = (mine.data ?? []).filter((c) => c.campaignId !== campaign.id);

  async function create() {
    const r = await api.post("/characters", { campaignId: campaign.id, data: { ...blankCharacter(campaign.rulesVersion), name: "New Adventurer" } });
    go(`c/${campaign.id}/characters/${r.id}`);
  }
  async function bring(id: number) {
    const r = await api.post(`/characters/${id}/import`, { campaignId: campaign.id });
    toast("Copied in. The AI is checking it against this campaign's rules for the DM.");
    go(`c/${campaign.id}/characters/${r.id}`);
  }
  async function uploadFile(file: File) {
    try {
      const data = JSON.parse(await file.text());
      const r = await api.post("/characters/upload", { campaignId: campaign.id, data });
      go(`c/${campaign.id}/characters/${r.id}`);
    } catch (e) {
      setError(e instanceof SyntaxError ? "That file isn't a character file from this site." : (e as Error).message);
    }
  }

  return (
    <div>
      <div className="row">
        <h1 className="grow">Characters</h1>
        <button onClick={() => setScanning(true)}>📷 Import paper sheet</button>
        <button className="primary" onClick={create}>+ New character</button>
      </div>
      {scanning && <ScanSheet campaignId={campaign.id} onCancel={() => setScanning(false)} onDone={(id) => go(`c/${campaign.id}/characters/${id}`)} />}
      {error && <div className="error">{error}</div>}
      <p className="muted">
        This campaign uses the <b>{campaign.rulesVersion}</b> 5e rules. {campaign.isDM ? "Characters you make or edit here apply right away." : "New characters and changes go to the DM for approval. HP and spell slots during play don't need approval."}
      </p>
      <div className="grid">
        {list.data?.map((c) => {
          const dv = derive(c.data);
          return (
            <div key={c.id} className="card" style={{ cursor: "pointer" }} onClick={() => go(`c/${campaign.id}/characters/${c.id}`)}>
              <div className="row"><h2 className="grow" style={{ margin: 0 }}>{c.name}</h2><StatusPill c={c} /></div>
              <p className="muted" style={{ margin: "4px 0" }}>Level {dv.level} {c.data.species} {classSummary(c.data)}</p>
              <p className="muted" style={{ margin: 0 }}>Played by {c.ownerName}{c.ownerId === status.user?.id ? " (you)" : ""}</p>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="pill">AC {dv.ac}</span><span className="pill">HP {c.data.hp.current}/{dv.maxHp}</span><span className="pill">PP {dv.passivePerception}</span>
              </div>
            </div>
          );
        })}
      </div>
      {list.data?.length === 0 && <p className="muted">No characters yet.</p>}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Bring a character from elsewhere</h3>
        <p className="muted">A copy comes into this campaign, then the AI checks it against the {campaign.rulesVersion} rules and the DM approves it.</p>
        <div className="row">
          {elsewhere.length > 0 && (
            <select style={{ width: "auto" }} value="" onChange={(e) => e.target.value && bring(Number(e.target.value))}>
              <option value="">Pick one of your characters...</option>
              {elsewhere.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.campaignName ?? "no campaign"})</option>)}
            </select>
          )}
          <label className="btn" style={{ margin: 0, color: "var(--text)" }}>
            Upload a character file
            <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}
