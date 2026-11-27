import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useLoad, useStatus } from "../hooks";
import type { Campaign } from "./Campaign";
import { EntryView } from "../components/StatBlock";

const KIND_LABEL: Record<string, string> = { monster: "Monsters", item: "Magic items", npc: "NPCs", note: "Notes & handouts" };

export function Compendium({ campaign, changed }: { campaign: Campaign; changed: { what: string; at: number } }) {
  const { toast } = useStatus();
  const list = useLoad<any[]>(`/campaigns/${campaign.id}/compendium`);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [onlyDrafts, setOnlyDrafts] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [newKind, setNewKind] = useState<string | null>(null);
  useEffect(() => { if (changed.what === "compendium") list.reload(); }, [changed]);

  const shown = useMemo(() => (list.data ?? []).filter((e) =>
    (!kind || e.kind === kind) && (!onlyDrafts || e.status === "draft") && e.name.toLowerCase().includes(q.toLowerCase())), [list.data, q, kind, onlyDrafts]);
  const drafts = (list.data ?? []).filter((e) => e.status === "draft").length;
  const open = list.data?.find((e) => e.id === openId);

  return (
    <div>
      <div className="row">
        <h1 className="grow">Compendium</h1>
        {campaign.isDM && <select style={{ width: "auto" }} value="" onChange={(e) => setNewKind(e.target.value || null)}>
          <option value="">+ Add entry...</option>
          <option value="monster">Monster</option><option value="item">Magic item</option><option value="npc">NPC</option><option value="note">Note / handout</option>
        </select>}
      </div>
      <p className="muted">{campaign.isDM ? "Monsters, items, NPCs and notes for this campaign. Players only see entries you mark \"Players can see\"." : "Things your DM has shared with the party."}</p>
      {campaign.isDM && drafts > 0 && <div className="notice">{drafts} converted entr{drafts === 1 ? "y is" : "ies are"} waiting for review. <button className="link" onClick={() => setOnlyDrafts(true)}>Show drafts</button>{" · "}<button className="link" onClick={() => confirm(`Approve all ${drafts} drafts without reviewing each one?`) && api.post(`/campaigns/${campaign.id}/compendium/approve-all`, {}).then(() => { list.reload(); toast("All drafts approved"); })}>Approve all</button></div>}
      {newKind && <EntryEditor campaign={campaign} entry={{ kind: newKind, name: "", data: blankData(newKind), status: "approved", playerVisible: false }} close={() => { setNewKind(null); list.reload(); }} />}
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="grow" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Everything</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {campaign.isDM && <label className="inline"><input type="checkbox" checked={onlyDrafts} onChange={(e) => setOnlyDrafts(e.target.checked)} /> Drafts only</label>}
      </div>
      <div className="row top">
        <div style={{ width: 320, maxHeight: "70vh", overflow: "auto" }}>
          <table className="list"><tbody>
            {shown.map((e) => (
              <tr key={e.id} onClick={() => setOpenId(e.id)} style={{ cursor: "pointer", background: e.id === openId ? "var(--panel-2)" : undefined }}>
                <td>
                  {e.name}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {KIND_LABEL[e.kind]}{e.kind === "monster" && e.data.challenge_rating ? ` · CR ${e.data.challenge_rating}` : ""}{e.kind === "item" ? ` · ${e.data.rarity}` : ""}
                    {e.status === "draft" && <span className="pill warn" style={{ marginLeft: 6 }}>draft</span>}
                    {campaign.isDM && e.playerVisible && <span className="pill ok" style={{ marginLeft: 6 }}>players</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table>
          {shown.length === 0 && <p className="muted">Nothing here yet.</p>}
        </div>
        <div className="grow">
          {open && (campaign.isDM
            ? <EntryEditor key={open.id} campaign={campaign} entry={open} close={() => { list.reload(); }} onDelete={() => { setOpenId(null); list.reload(); toast("Deleted"); }} />
            : <div className="card"><EntryView e={open} /></div>)}
        </div>
      </div>
    </div>
  );
}

function blankData(kind: string) {
  if (kind === "monster") return { name: "", size: "Medium", type: "humanoid", alignment: "", armor_class: 12, armor_note: "", hit_points: 11, hit_dice: "2d8+2", speed: "30 ft.", str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, saving_throws: "", skills: "", damage_vulnerabilities: "", damage_resistances: "", damage_immunities: "", condition_immunities: "", senses: "passive Perception 10", languages: "Common", challenge_rating: "1/2", proficiency_bonus: 2, traits: [], actions: [], bonus_actions: [], reactions: [], legendary_actions: [], lore: "", conversion_notes: "", source_page: "" };
  if (kind === "item") return { name: "", item_type: "Wondrous item", rarity: "uncommon", requires_attunement: false, attunement_note: "", description: "", conversion_notes: "", source_page: "" };
  return { markdown: "" };
}

function EntryEditor({ campaign, entry, close, onDelete }: { campaign: Campaign; entry: any; close: () => void; onDelete?: () => void }) {
  const { toast } = useStatus();
  const [data, setData] = useState(entry.data);
  const [json, setJson] = useState(JSON.stringify(entry.data, null, 2));
  const [mode, setMode] = useState<"view" | "edit">(entry.id ? "view" : "edit");
  const [name, setName] = useState(entry.name);
  const [visible, setVisible] = useState(entry.playerVisible);
  const isStruct = entry.kind === "monster" || entry.kind === "item";

  async function save(status = entry.status) {
    let d = data;
    if (isStruct && mode === "edit") {
      try { d = JSON.parse(json); } catch { return toast("The stat block text isn't valid. Check for a missing comma or quote."); }
    }
    const body = { kind: entry.kind, name: name || d.name, data: d, status, playerVisible: visible };
    if (entry.id) await api.patch(`/compendium/${entry.id}`, body);
    else await api.post(`/campaigns/${campaign.id}/compendium`, body);
    setData(d);
    setMode("view");
    toast(status === "approved" && entry.status === "draft" ? "Approved" : "Saved");
    close();
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        {entry.status === "draft" && <span className="pill warn">Draft: converted from {entry.sourceEdition}</span>}
        <span className="muted grow" style={{ fontSize: 12 }}>{entry.source}</span>
        {entry.id && <button className="small" onClick={() => setMode(mode === "view" ? "edit" : "view")}>{mode === "view" ? "Edit" : "Preview"}</button>}
      </div>
      {entry.status === "draft" && data.conversion_notes && <div className="notice"><b>Conversion notes:</b> {data.conversion_notes}</div>}
      {mode === "view" ? <EntryView e={{ ...entry, data }} /> : (
        <>
          {!isStruct && <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>}
          {isStruct
            ? <label>Stat block (edit the values between quotes)<textarea rows={22} style={{ fontFamily: "monospace", fontSize: 12 }} value={json} onChange={(e) => setJson(e.target.value)} /></label>
            : <label>Text (Markdown: # heading, **bold**, - list)<textarea rows={14} value={data.markdown ?? ""} onChange={(e) => setData({ ...data, markdown: e.target.value })} /></label>}
        </>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <label className="inline"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Players can see</label>
        {entry.status === "draft"
          ? <button className="primary" onClick={() => save("approved")}>Approve</button>
          : <button className="primary" onClick={() => save()}>Save</button>}
        {campaign.isDM && entry.id && (
          <button className="small" onClick={() => api.post(`/campaigns/${campaign.id}/share`, { title: entry.name, text: shareText(entry.kind, data) }).then(() => toast("Shared in chat"))}>Share in chat</button>
        )}
        {entry.id && onDelete && <button className="danger right" onClick={async () => { if (confirm(`Delete ${entry.name}?`)) { await api.del(`/compendium/${entry.id}`); onDelete(); } }}>Delete</button>}
      </div>
    </div>
  );
}

function shareText(kind: string, d: any) {
  if (kind === "item") return `*${d.item_type}, ${d.rarity}${d.requires_attunement ? " (requires attunement)" : ""}*\n\n${d.description}`;
  if (kind === "monster") return `*${d.size} ${d.type}*\n\n${d.lore || "A creature appears!"}`;
  return d.markdown ?? "";
}
