// Search-as-you-type for free SRD 5.1 content (spells, gear, magic items, monsters).
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useStatus } from "../hooks";
import { EntryView } from "./StatBlock";
import { api } from "../api";
import { Markdown } from "./Markdown";

export type SrdType = "spell" | "equipment" | "magic" | "monster";
export interface SrdEntry { name: string; type: SrdType; [k: string]: any }

/** A text box that suggests SRD entries while typing. Typing anything else (homebrew) still works. */
export function SrdInput({ value, onChange, onPick, types, filter, placeholder, className, style }: {
  value: string; onChange: (v: string) => void; onPick: (e: SrdEntry) => void; types: SrdType[]; filter?: string;
  placeholder?: string; className?: string; style?: React.CSSProperties;
}) {
  const [results, setResults] = useState<SrdEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<number>(0);

  useEffect(() => {
    if (!open || value.trim().length < 2) { setResults([]); return; }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.get<SrdEntry[]>(`/srd/search?type=${types.join(",")}&q=${encodeURIComponent(value)}&limit=8${filter ? `&filter=${filter}` : ""}`)
        .then((r) => { setResults(r); setActive(0); })
        .catch(() => setResults([]));
    }, 150);
  }, [value, open, types.join(","), filter]);

  const pick = (e: SrdEntry) => { onPick(e); setOpen(false); setResults([]); };
  return (
    <span className={className} style={{ position: "relative", display: "block", ...style }}>
      <input value={value} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === "Enter") { e.preventDefault(); pick(results[active]); }
          if (e.key === "Escape") setOpen(false);
        }} />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 30, background: "#120f0c", border: "1px solid var(--gold)", borderRadius: 6, maxHeight: 260, overflow: "auto", minWidth: 240 }}>
          {results.map((r, i) => (
            <div key={r.type + r.name} onMouseDown={() => pick(r)} onMouseEnter={() => setActive(i)}
              style={{ padding: "5px 8px", cursor: "pointer", background: i === active ? "var(--panel-2)" : undefined }}>
              <b>{r.name}</b> <span className="muted" style={{ fontSize: 12 }}>{describe(r)}</span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 10, padding: "3px 8px" }}>From the free 5e SRD 5.1 (CC-BY-4.0)</div>
        </div>
      )}
    </span>
  );
}

export function describe(r: SrdEntry): string {
  if (r.type === "spell") return `${r.level === 0 ? "cantrip" : `level ${r.level}`} ${String(r.school).toLowerCase()}`;
  if (r.type === "magic") return `${r.rarity} ${String(r.category).toLowerCase()}`;
  if (r.type === "monster") return `CR ${r.challenge_rating} · ${r.size}`;
  return [r.sub || r.category, r.damage, r.ac ? `AC ${r.ac.base}${r.ac.dex ? (r.ac.max ? " + Dex (max 2)" : " + Dex") : ""}` : "", r.cost].filter(Boolean).join(" · ");
}

/** Short one-line summary saved on the sheet (e.g. "1 action · 150 feet · DEX save · 8d6 fire"). */
export function spellSummary(s: SrdEntry) {
  return [s.castingTime, s.range, s.attack ? `${s.attack} spell attack` : s.save ? `${s.save} save` : "", s.damage ? `${s.damage} ${String(s.damageType).toLowerCase()}` : "", s.duration !== "Instantaneous" ? s.duration : ""].filter(Boolean).join(" · ");
}

/** Which campaign the sheet belongs to, so lookups can include the campaign's own Compendium. */
export const LookupCampaign = createContext<number | null>(null);

/** "ⓘ" button: shows the campaign's own entry, else the SRD text, else lets you add the details. */
export function SrdInfo({ type, name }: { type: SrdType; name: string }) {
  const campaignId = useContext(LookupCampaign);
  const [entry, setEntry] = useState<SrdEntry | null | "none">(null);
  const [custom, setCustom] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  if (!name.trim()) return null;
  const kind = type === "spell" ? "spell" : "item";
  const show = async () => {
    setOpen(true);
    setEntry(null);
    setCustom(null);
    // 1. this campaign's Compendium (homebrew and other books)
    if (campaignId) {
      try {
        const c = await api.get<any>(`/campaigns/${campaignId}/compendium/lookup?kind=${kind}&name=${encodeURIComponent(name.trim())}`);
        if (c) { setCustom(c); return; }
      } catch { /* fall through to the SRD */ }
    }
    // 2. the free SRD (gear and magic items share a box on the sheet, so try both)
    const order: SrdType[] = type === "equipment" ? ["equipment", "magic"] : type === "magic" ? ["magic", "equipment"] : [type];
    for (const t of order) {
      try { setEntry(await api.get<SrdEntry>(`/srd/${t}/${encodeURIComponent(name.trim())}`)); return; } catch { /* try the next kind */ }
    }
    setEntry("none");
  };
  return (
    <>
      <button type="button" className="small" title="Look it up" onClick={show}>ⓘ</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 160, display: "grid", placeItems: "center", padding: 16 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: "100%", maxHeight: "88vh", overflow: "auto", marginBottom: 0 }}>
            <div className="row"><h2 className="grow" style={{ margin: 0 }}>{custom?.name ?? (entry && entry !== "none" ? entry.name : name)}</h2><button className="small" onClick={() => setOpen(false)}>✕</button></div>
            {custom && (
              <>
                <p className="muted" style={{ fontSize: 12 }}>From your campaign's Compendium{custom.status === "draft" ? " · draft waiting for the DM" : ""} · {custom.source}</p>
                <EntryView e={custom} />
              </>
            )}
            {!custom && entry === null && <p className="muted">Looking it up...</p>}
            {!custom && entry && entry !== "none" && (
              <>
                <SrdDetails e={entry} />
                <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>Text from the System Reference Document 5.1 by Wizards of the Coast LLC, CC-BY-4.0.</p>
              </>
            )}
            {!custom && entry === "none" && (
              campaignId
                ? <AddDetails campaignId={campaignId} kind={kind} name={name.trim()} onSaved={(c) => setCustom(c)} />
                : <p className="muted">"{name}" isn't in the free SRD. Open this character inside a campaign to add its details to the campaign's Compendium.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Form for items/spells from other books or homebrew, with an optional AI first draft. */
function AddDetails({ campaignId, kind, name, onSaved }: { campaignId: number; kind: "item" | "spell"; name: string; onSaved: (entry: any) => void }) {
  const { status, toast } = useStatus();
  const isItem = kind === "item";
  const [f, setF] = useState<Record<string, any>>(isItem
    ? { name, item_type: "Wondrous item", rarity: "uncommon", requires_attunement: false, attunement_note: "", description: "", conversion_notes: "", source_page: "" }
    : { name, level: 1, school: "", casting_time: "1 action", range: "", components: "V, S", duration: "Instantaneous", description: "", higher_levels: "", conversion_notes: "", source_page: "" });
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });

  async function draft() {
    setBusy(true);
    try { setF({ ...f, ...(await api.post(`/campaigns/${campaignId}/compendium/ai-describe`, { kind, name: f.name, hint })) }); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save() {
    try {
      const r = await api.post(`/campaigns/${campaignId}/compendium/custom`, { kind, name: f.name, data: f });
      toast(r.status === "approved" ? "Saved to the Compendium" : "Saved. Your DM will review it, and you can already see it.");
      onSaved({ id: r.id, kind, name: f.name, data: f, status: r.status, source: "just added" });
    } catch (e) { toast((e as Error).message); }
  }

  return (
    <div>
      <p className="muted">"{name}" isn't in the free SRD. It may be from another book or homebrew. Add its details so everyone in the campaign can look it up.</p>
      {status.aiEnabled && (
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="grow" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Optional hint for the AI: book, what it does..." />
          <button disabled={busy} onClick={draft}>{busy ? "Writing..." : "✨ Draft it with AI"}</button>
        </div>
      )}
      <label>Name<input value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
      {isItem ? (
        <div className="row">
          <label className="grow">Type<input value={f.item_type} onChange={(e) => set("item_type", e.target.value)} placeholder="Wondrous item, weapon (longsword)..." /></label>
          <label>Rarity
            <select value={f.rarity} onChange={(e) => set("rarity", e.target.value)} style={{ width: "auto" }}>
              {["mundane", "common", "uncommon", "rare", "very rare", "legendary", "artifact", "varies"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="inline"><input type="checkbox" checked={f.requires_attunement} onChange={(e) => set("requires_attunement", e.target.checked)} /> Requires attunement</label>
        </div>
      ) : (
        <div className="row">
          <label>Level<select value={f.level} onChange={(e) => set("level", Number(e.target.value))} style={{ width: 90 }}>{Array.from({ length: 10 }, (_, l) => <option key={l} value={l}>{l === 0 ? "Cantrip" : l}</option>)}</select></label>
          <label className="grow">School<input value={f.school} onChange={(e) => set("school", e.target.value)} /></label>
          <label className="grow">Casting time<input value={f.casting_time} onChange={(e) => set("casting_time", e.target.value)} /></label>
          <label className="grow">Range<input value={f.range} onChange={(e) => set("range", e.target.value)} /></label>
          <label className="grow">Components<input value={f.components} onChange={(e) => set("components", e.target.value)} /></label>
          <label className="grow">Duration<input value={f.duration} onChange={(e) => set("duration", e.target.value)} /></label>
        </div>
      )}
      <label>What it does<textarea rows={7} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
      {!isItem && <label>At higher levels<input value={f.higher_levels} onChange={(e) => set("higher_levels", e.target.value)} /></label>}
      <label>Source (book and page, or "homebrew")<input value={f.source_page} onChange={(e) => set("source_page", e.target.value)} /></label>
      {f.conversion_notes && <div className="notice"><b>AI notes:</b> {f.conversion_notes}</div>}
      <button className="primary" disabled={!f.name.trim() || !f.description.trim()} onClick={save}>Save to the Compendium</button>
    </div>
  );
}

function SrdDetails({ e }: { e: SrdEntry }) {
  if (e.type === "spell") {
    return (
      <div>
        <p><i>{e.level === 0 ? `${e.school} cantrip` : `Level ${e.level} ${String(e.school).toLowerCase()}`}{e.ritual ? " (ritual)" : ""}</i></p>
        <p><b>Casting time:</b> {e.castingTime} · <b>Range:</b> {e.range}<br /><b>Components:</b> {e.components}<br /><b>Duration:</b> {e.duration}</p>
        <Markdown text={e.desc} />
        {e.higher && <p><b>At higher levels.</b> {e.higher}</p>}
        <p className="muted">Classes: {e.classes.join(", ")}</p>
      </div>
    );
  }
  if (e.type === "magic") return <div><p><i>{e.category}, {e.rarity}</i></p><Markdown text={e.desc} /></div>;
  return (
    <div>
      <p><i>{[e.category, e.sub].filter(Boolean).join(" · ")}</i></p>
      <p>{[e.cost && `Cost ${e.cost}`, e.weight && `Weight ${e.weight} lb`, e.damage && `Damage ${e.damage}`, e.twoHanded && `two-handed ${e.twoHanded}`, e.range && `Range ${e.range}`,
        e.ac && `AC ${e.ac.base}${e.ac.dex ? (e.ac.max ? " + Dex (max 2)" : " + Dex") : ""}`, e.strMin && `Str ${e.strMin}`, e.stealthDis && "Stealth disadvantage"].filter(Boolean).join(" · ")}</p>
      {e.properties?.length > 0 && <p>Properties: {e.properties.join(", ")}</p>}
      {e.desc && <Markdown text={e.desc} />}
    </div>
  );
}
