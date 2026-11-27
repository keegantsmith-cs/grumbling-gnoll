import { useState } from "react";
import { api } from "../api";
import { go, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { classSummary, derive, diffCharacter, fieldLabel } from "../../../shared/character";

export function Approvals({ campaign, data, reload }: { campaign: Campaign; data: any[] | null; reload: () => void }) {
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <div>
      <h1>Waiting for your approval</h1>
      <p className="muted">New characters, level-ups and edits from players land here. Characters brought in from other campaigns get an automatic AI rules check. You can run one on anything else too.</p>
      {data.length === 0 && <p>Nothing to review. 🍺</p>}
      {data.map((a) => <ApprovalCard key={a.id} a={a} campaign={campaign} reload={reload} />)}
    </div>
  );
}

const KIND = { create: "New character", update: "Changes", import: "Brought from another campaign" } as Record<string, string>;

function ApprovalCard({ a, campaign, reload }: { a: any; campaign: Campaign; reload: () => void }) {
  const { status, toast } = useStatus();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const dv = derive(a.proposed);
  const review = a.aiReview;

  async function act(path: string, body: object = {}) {
    setBusy(true);
    try {
      await api.post(`/changes/${a.id}/${path}`, body);
      if ((body as any).useAiFix) toast(`${a.characterName} approved with the AI's fixes. They're logged in the sheet's Change history.`);
      reload();
    }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>{a.characterName}</h2>
        <span className="pill warn">{KIND[a.kind] ?? a.kind}</span>
      </div>
      <p className="muted">From {a.submitter} · {a.createdAt} · Level {dv.level} {a.proposed.species} {classSummary(a.proposed)} · AC {dv.ac} · HP {dv.maxHp}</p>
      {a.note && <p style={{ whiteSpace: "pre-wrap" }}>“{a.note}”</p>}
      <details open={a.changes.length <= 12}>
        <summary>{a.changes.length === 1 && a.changes[0] === "New character" ? "New character" : `${a.changes.length} change${a.changes.length === 1 ? "" : "s"}`}</summary>
        <ul>{a.changes.map((c: string, i: number) => <li key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>{c}</li>)}</ul>
      </details>

      <div className="card" style={{ background: "var(--panel-2)" }}>
        <div className="row"><b className="grow">🧙 AI rules check</b>
          {status.aiEnabled && review?.status !== "running" && <button className="small" disabled={busy} onClick={() => act("ai-review")}>{review ? "Check again" : "Run AI check"}</button>}
        </div>
        {!status.aiEnabled && <p className="muted">AI isn't set up on the server yet.</p>}
        {review?.status === "running" && <p className="muted">Checking the rules... (usually under a minute)</p>}
        {review?.status === "error" && <div className="error">{review.error}</div>}
        {review?.status === "done" && (
          <>
            <p><span className={`pill ${review.verdict === "looks_good" ? "ok" : review.verdict === "minor_issues" ? "warn" : "bad"}`}>{review.verdict.replace("_", " ")}</span> {review.summary}</p>
            {review.issues.length > 0 && (
              <table className="list"><tbody>
                {review.issues.map((i: any, k: number) => (
                  <tr key={k}>
                    <td><span className={`pill ${i.severity === "error" ? "bad" : i.severity === "warning" ? "warn" : ""}`}>{i.severity}</span></td>
                    <td><b>{i.area}</b>: {i.problem}<div className="muted">Suggestion: {i.suggestion}</div></td>
                  </tr>
                ))}
              </tbody></table>
            )}
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>The AI can be wrong. You make the final call.</p>
            {review.issues.length > 0 && !a.aiFix && (
              <button className="small" style={{ marginTop: 8 }} disabled={busy} onClick={() => act("ai-fix")}>✨ Let AI fix these</button>
            )}
          </>
        )}
        {a.aiFix?.status === "running" && <p className="muted">Preparing fixes...</p>}
        {a.aiFix?.status === "error" && <div className="error">{a.aiFix.error} <button className="small" onClick={() => act("ai-fix")}>Try again</button></div>}
        {a.aiFix?.status === "done" && <AiFixPanel a={a} busy={busy} act={act} />}
        {!review && status.aiEnabled && <p className="muted">Not checked yet.</p>}
      </div>

      <label>Note to the player (optional)<input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Swap that feat for something from the PHB" /></label>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => act("approve", { comment })}>Approve</button>
        <button className="danger" disabled={busy} onClick={() => act("reject", { comment })}>Send back</button>
        <button className="right" onClick={() => go(`c/${campaign.id}/characters/${a.characterId}`)}>Open sheet</button>
      </div>
    </div>
  );
}

function AiFixPanel({ a, busy, act }: { a: any; busy: boolean; act: (path: string, body?: object) => Promise<void> }) {
  const fix = a.aiFix;
  const diffs = diffCharacter(a.proposed, fix.data);
  const fixedDv = derive(fix.data);
  return (
    <div className="card" style={{ marginTop: 10, marginBottom: 0, border: "1px solid var(--gold)" }}>
      <b>✨ Fixes the AI suggests</b>
      <p style={{ margin: "4px 0" }}>{fix.summary}</p>
      {fix.changes.length === 0 ? <p className="muted">The AI didn't think anything needed changing.</p> : (
        <ul style={{ margin: "4px 0 8px" }}>
          {fix.changes.map((c: any, i: number) => <li key={i}><b>{fieldLabel(c.field)}</b>: {c.reason}{!c.ok && <span className="pill bad" style={{ marginLeft: 6 }}>couldn't apply</span>}</li>)}
        </ul>
      )}
      {diffs.length > 0 && (
        <details>
          <summary>Exactly what would change ({diffs.length})</summary>
          <ul>{diffs.map((d, i) => <li key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>{d}</li>)}</ul>
        </details>
      )}
      <p className="muted" style={{ fontSize: 12 }}>After fixes: AC {fixedDv.ac} · HP {fixedDv.maxHp} · {classSummary(fix.data)}</p>
      <p className="muted" style={{ fontSize: 12 }}>If you approve with these fixes, the changes and reasons are saved in the character's Change history, where you and the player can look them up later.</p>
      <div className="row">
        {diffs.length > 0 && <button className="primary" disabled={busy} onClick={() => act("approve", { useAiFix: true, comment: "Approved with the AI's suggested fixes. See Change history on the sheet for what changed and why." })}>Approve with these fixes</button>}
        <button disabled={busy} onClick={() => act("ai-fix/discard")}>Discard fixes</button>
      </div>
    </div>
  );
}

