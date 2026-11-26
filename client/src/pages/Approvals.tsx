import { useState } from "react";
import { api } from "../api";
import { go, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { classSummary, derive } from "../../../shared/character";

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
    try { await api.post(`/changes/${a.id}/${path}`, body); reload(); }
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
      {a.note && <p>“{a.note}”</p>}
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
          </>
        )}
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
