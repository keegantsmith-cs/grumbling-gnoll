import { useState } from "react";
import type { CampaignSocket } from "../socket";
import type { Campaign } from "../pages/Campaign";
import { useStatus } from "../hooks";

export function InitiativePanel({ campaign, live }: { campaign: Campaign; live: CampaignSocket }) {
  const { status } = useStatus();
  const { round, turn, entries } = live.initiative;
  const [f, setF] = useState({ name: "", init: "", bonus: "" , hidden: false });
  const emit = (p: object) => live.socket?.emit("initiative", p);
  const dm = campaign.isDM;
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>Round {round}</h3>
        {dm && <>
          <button className="small" onClick={() => emit({ op: "prev" })}>◀</button>
          <button className="small primary" onClick={() => emit({ op: "next" })}>Next turn ▶</button>
        </>}
      </div>
      <ul className="init-list">
        {entries.map((e, i) => (
          <li key={e.id} className={i === turn ? "current" : ""}>
            {dm ? (
              <input className="score" type="number" defaultValue={e.init ?? 0} onBlur={(ev) => emit({ op: "set", id: e.id, init: ev.target.value })} style={{ width: 52, padding: 2 }} />
            ) : <span className="score">{e.init ?? "?"}</span>}
            <span className="grow">{e.name} {e.hidden && dm && <span className="muted">(hidden)</span>}</span>
            {dm && <button className="small" title={e.hidden ? "Show to players" : "Hide from players"} onClick={() => emit({ op: "set", id: e.id, hidden: !e.hidden })}>{e.hidden ? "🙈" : "👁"}</button>}
            {(dm || e.ownerId === status.user?.id) && dm && <button className="small danger" onClick={() => emit({ op: "remove", id: e.id })}>✕</button>}
          </li>
        ))}
      </ul>
      {entries.length === 0 && <p className="muted">No one in the turn order yet.</p>}
      <hr />
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) return;
        if (f.init !== "") emit({ op: "add", name: f.name, init: Number(f.init), hidden: f.hidden });
        else emit({ op: "roll", name: f.name, bonus: Number(f.bonus) || 0, hidden: f.hidden });
        setF({ ...f, name: "", init: "", bonus: "" });
      }}>
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={dm ? "Goblin 1" : "Your character"} /></label>
        <div className="row">
          <label className="grow">Roll with bonus<input type="number" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} placeholder="+2" /></label>
          <label className="grow">or enter result<input type="number" value={f.init} onChange={(e) => setF({ ...f, init: e.target.value })} /></label>
        </div>
        {dm && <label className="inline"><input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} /> Hidden</label>}
        <div className="row" style={{ marginTop: 6 }}>
          <button className="primary">{f.init !== "" ? "Add" : "Roll & add"}</button>
          {dm && <button type="button" className="danger right" onClick={() => confirm("End combat and clear the turn order?") && emit({ op: "clear" })}>End combat</button>}
        </div>
      </form>
    </div>
  );
}
