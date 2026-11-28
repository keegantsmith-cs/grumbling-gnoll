import { useState } from "react";
import { api } from "../api";
import { useStatus } from "../hooks";
import { CLASSES, type CharacterData, type RulesVersion } from "../../../shared/character";
import { ALIGNMENTS, EXTRA_CLASSES, backgroundsFor, speciesFor, subclassesFor } from "../../../shared/options";
import { Review } from "../pages/CharacterWizard";

const ANY = "";

/** AI makes a whole character from a few choices; everything left blank is the AI's pick. */
export function AiCharacter({ campaignId, rules, onDone, onCancel }: { campaignId?: number; rules: RulesVersion; onDone: (id: number) => void; onCancel: () => void }) {
  const { status, toast } = useStatus();
  const [o, setO] = useState({ name: "", species: ANY, className: ANY, subclass: ANY, background: ANY, alignment: ANY, level: 1, abilityMethod: "standard", concept: "" });
  const [roll, setRoll] = useState<{ rollId: number; values: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ data: CharacterData; summary: string; dmCheckNotes: string } | null>(null);
  const set = (k: keyof typeof o, v: string | number) => setO({ ...o, [k]: v, ...(k === "className" ? { subclass: ANY } : {}) });

  if (!status.aiEnabled) return <div className="card"><p>The AI character maker isn't switched on for this site yet. Ask the DM, or use the step-by-step creator instead.</p><button onClick={onCancel}>Close</button></div>;

  async function rollScores() {
    try {
      const r = await api.post("/characters/creator-roll", { kind: "abilities", campaignId });
      setRoll({ rollId: r.rollId, values: r.values });
    } catch (e) { toast((e as Error).message); }
  }
  async function generate() {
    setBusy(true);
    try { setResult(await api.post("/characters/ai-generate", { campaignId, rulesVersion: rules, options: { ...o, rollId: roll?.rollId } })); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  async function create() {
    if (!result) return;
    setBusy(true);
    try {
      const r = await api.post("/characters", {
        campaignId, data: result.data, rollIds: roll ? [roll.rollId] : [],
        note: `Made with the AI character maker${o.concept ? `: "${o.concept.slice(0, 200)}"` : ""}.${result.dmCheckNotes ? ` AI notes for the DM: ${result.dmCheckNotes}` : ""}`,
      });
      toast(campaignId ? "Character created and sent to the DM for approval!" : "Character created!");
      onDone(r.id);
    } catch (e) { toast((e as Error).message); setBusy(false); }
  }

  const pick = (label: string, k: keyof typeof o, options: string[]) => (
    <label className="grow" style={{ minWidth: 160 }}>{label}
      <select value={o[k] as string} onChange={(e) => set(k, e.target.value)}>
        <option value={ANY}>✨ AI chooses</option>
        {options.map((x) => <option key={x}>{x}</option>)}
      </select>
    </label>
  );

  return (
    <div className="card" style={{ border: "1px solid var(--gold)" }}>
      <div className="row"><h2 className="grow">✨ Let the AI make a character</h2><button className="small" onClick={onCancel}>Cancel</button></div>
      {!result ? (
        <>
          <p className="muted">Choose as much or as little as you like. Anything left on "AI chooses" is picked for you. It follows the 5e {rules} rules for scores, skills, HP, gear and spells.</p>
          <div className="row top">
            <label className="grow" style={{ minWidth: 160 }}>Name<input value={o.name} onChange={(e) => set("name", e.target.value)} placeholder="✨ AI chooses" /></label>
            {pick(rules === "2024" ? "Species" : "Race", "species", speciesFor(rules))}
            {pick("Class", "className", [...CLASSES.map((c) => c.name), ...EXTRA_CLASSES])}
            {o.className && pick("Subclass", "subclass", subclassesFor(rules, o.className))}
          </div>
          <div className="row top">
            {pick("Background", "background", backgroundsFor(rules))}
            {pick("Alignment", "alignment", ALIGNMENTS)}
            <label>Level (1-20)<input type="number" min={1} max={20} value={o.level} onChange={(e) => set("level", Math.max(1, Math.min(20, Number(e.target.value) || 1)))} style={{ width: 80 }} /></label>
            <label>Ability scores
              <select value={o.abilityMethod} onChange={(e) => set("abilityMethod", e.target.value)} style={{ width: "auto" }}>
                <option value="standard">Standard array (15, 14, 13, 12, 10, 8)</option>
                <option value="pointbuy">Point buy (27 points)</option>
                <option value="rolled">Roll 4d6 drop lowest</option>
              </select>
            </label>
          </div>
          {o.abilityMethod === "rolled" && (
            <div className="row" style={{ marginBottom: 8 }}>
              <button onClick={rollScores}>{roll ? "Roll again" : "🎲 Roll my scores"}</button>
              {roll && <span>Rolled <b>{roll.values.join(", ")}</b>. The AI will place them where they fit best.</span>}
            </div>
          )}
          <label>Your idea (optional)
            <textarea rows={3} value={o.concept} onChange={(e) => set("concept", e.target.value)}
              placeholder="e.g. A grumpy dwarf priest who brews holy ale and hates goblins. Good at healing, terrible at sneaking." />
          </label>
          <button className="primary" disabled={busy || (o.abilityMethod === "rolled" && !roll)} onClick={generate}>{busy ? "Creating your character... (about a minute)" : "✨ Make my character"}</button>
          {o.abilityMethod === "rolled" && !roll && <p className="muted" style={{ marginTop: 8 }}>Roll your scores first, then the AI can build around them.</p>}
          {busy && <p className="muted" role="status" style={{ marginTop: 8 }}>Hang tight, the AI is writing up your sheet. Please don't close this page.</p>}
        </>
      ) : (
        <>
          <p><i>{result.summary}</i></p>
          <Review d={result.data} complete />
          {result.data.spells.length > 0 && <p><b>Spells:</b> {result.data.spells.map((s) => s.name).join(", ")}</p>}
          {result.data.features && <details><summary>Features</summary><div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{result.data.features}</div></details>}
          {result.data.backstory && <details><summary>Backstory</summary><div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{result.data.backstory}</div></details>}
          {result.dmCheckNotes && <div className="notice" style={{ marginTop: 8 }}>For the DM to check: {result.dmCheckNotes}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy} onClick={create}>{campaignId ? "Create & send to DM" : "Create character"}</button>
            <button disabled={busy} onClick={generate}>{busy ? "Making another..." : "Try again"}</button>
            <button disabled={busy} onClick={() => setResult(null)}>Change my choices</button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>You can edit anything on the sheet afterwards. {campaignId ? "The DM approves it like any new character." : ""}</p>
        </>
      )}
    </div>
  );
}
