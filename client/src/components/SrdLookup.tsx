// Search-as-you-type for free SRD 5.1 content (spells, gear, magic items, monsters).
import { useEffect, useRef, useState } from "react";
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

/** "ⓘ" button that shows the full SRD text for a name, if it's in the SRD. */
export function SrdInfo({ type, name }: { type: SrdType; name: string }) {
  const [entry, setEntry] = useState<SrdEntry | null | "none">(null);
  const [open, setOpen] = useState(false);
  if (!name.trim()) return null;
  const show = async () => {
    setOpen(true);
    if (entry && entry !== "none" && entry.name.toLowerCase() === name.toLowerCase()) return;
    // Gear and magic items share a box on the sheet, so try both
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
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: "85vh", overflow: "auto", marginBottom: 0 }}>
            <div className="row"><h2 className="grow" style={{ margin: 0 }}>{name}</h2><button className="small" onClick={() => setOpen(false)}>✕</button></div>
            {entry === null && <p className="muted">Looking it up...</p>}
            {entry === "none" && <p className="muted">"{name}" isn't in the free SRD. It may be from another book or homebrew.</p>}
            {entry && entry !== "none" && <SrdDetails e={entry} />}
            <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>Text from the System Reference Document 5.1 by Wizards of the Coast LLC, CC-BY-4.0.</p>
          </div>
        </div>
      )}
    </>
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
