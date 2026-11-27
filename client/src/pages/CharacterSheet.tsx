import { useEffect, useState } from "react";
import { api, downloadFile } from "../api";
import { go, useLoad, useStatus } from "../hooks";
import {
  ABILITIES, ABILITY_NAMES, CLASSES, SKILLS, classInfo, classSummary, derive, fieldLabel, fmtMod, mod, normalizeCharacter,
  type Ability, type CharacterData, type ClassLevel, type RulesVersion,
} from "../../../shared/character";
import { ALIGNMENTS, EXTRA_CLASSES, backgroundsFor, speciesFor, subclassesFor } from "../../../shared/options";
import { StatusPill } from "./Home";
import { FullBody, Portrait } from "../components/Portrait";
import { Markdown } from "../components/Markdown";

type Roll = (expr: string, label: string) => void;

export function CharacterPage({ id, roll, onDone }: { id: number; roll?: Roll; onDone?: () => void }) {
  const { status, toast } = useStatus();
  const { data: c, error, reload } = useLoad<any>(`/characters/${id}`);
  const campaigns = useLoad<any[]>("/campaigns");
  const [d, setD] = useState<CharacterData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const campaignInfo = useLoad<any>(c?.isDM && c.campaignId ? `/campaigns/${c.campaignId}` : null, [c?.isDM, c?.campaignId]);
  const allUsers = useLoad<any[]>(c?.isDM && c.campaignId ? "/users" : null, [c?.isDM, c?.campaignId]);

  useEffect(() => {
    if (c) {
      // If there's a pending submission, keep editing that version.
      setD(normalizeCharacter(c.pending?.data ?? c.data));
      setDirty(false);
    }
  }, [c]);

  if (error) return <div className="error">{error}</div>;
  if (!c || !d) return <p className="muted">Loading...</p>;

  const needsApproval = !!c.campaignId && !c.isDM;
  const canEdit = c.canEdit;
  const dv = derive(d);
  const upd = (patch: Partial<CharacterData>) => { setD({ ...d, ...patch }); setDirty(true); };
  // In-play values save instantly and never need approval
  const play = (patch: Record<string, unknown>, local: Partial<CharacterData>) => {
    setD({ ...d, ...local });
    api.patch(`/characters/${id}/play`, patch).catch((e) => toast(e.message));
  };
  const r: Roll = roll ?? ((expr, label) => toast(`Open this sheet from the campaign's table to roll ${label}`));
  const rollD20 = (bonus: number, label: string) => r(`1d20${bonus >= 0 ? "+" : ""}${bonus}`, `${d.name}: ${label}`);

  async function save() {
    try {
      const res = await api.put(`/characters/${id}`, { data: d, note });
      setMsg(res.applied ? "Saved." : "Sent to the DM for approval. You'll see it here once they review it.");
      setNote("");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const otherCampaigns = (campaigns.data ?? []).filter((x) => x.id !== c.campaignId);

  return (
    <div>
      <div className="row">
        <Portrait url={d.portraitUrl} canEdit={canEdit} characterId={id} name={d.name}
          onChange={(portraitUrl) => play({ portraitUrl }, { portraitUrl })} />
        <h1 className="grow" style={{ margin: 0 }}>{d.name}</h1>
        <StatusPill c={c} />
        <a className="btn" href={`/api/characters/${id}/pdf`} title="Download a printable PDF of this character sheet">📄 Download PDF</a>
        {onDone && <button onClick={onDone}>← Back</button>}
      </div>
      <p className="muted">
        Level {dv.level} {d.species} {classSummary(d)} · played by{" "}
        {c.isDM && campaignInfo.data ? (
          <OwnerPicker c={c} name={d.name} members={campaignInfo.data.members} users={allUsers.data ?? []}
            onDone={() => { reload(); campaignInfo.reload(); }} />
        ) : c.ownerName}
        {c.campaignName ? ` · ${c.campaignName}` : " · not in a campaign"} · {d.rulesVersion} rules
      </p>
      {c.pending && <div className="notice">Changes submitted {c.pending.createdAt} are waiting for the DM. You're editing that version; saving again replaces it.{c.pending.note && <div style={{ marginTop: 4 }}><i>{c.pending.note}</i></div>}</div>}
      {!c.pending && c.lastReview?.status === "rejected" && <div className="error">The DM sent back your last changes{c.lastReview.dmComment ? `: "${c.lastReview.dmComment}"` : "."}</div>}
      {c.lastReview?.status === "approved" && c.lastReview.dmComment && !c.pending && <div className="notice">DM's note on your last approval: "{c.lastReview.dmComment}"</div>}
      {msg && <div className="notice">{msg}</div>}
      {c.isDM && c.campaignId && <DmSecretNotes id={id} initial={c.dmNotes ?? ""} name={d.name} />}
      {(c.ownerId === status.user?.id || c.isDM) && <Suggestions id={id} name={d.name} isDM={c.isDM} isOwner={c.ownerId === status.user?.id} />}

      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="card">
          <div className="row top">
            <label className="grow">Name<input value={d.name} onChange={(e) => upd({ name: e.target.value })} /></label>
            <Choice className="grow" label={d.rulesVersion === "2024" ? "Species" : "Race"} value={d.species} options={speciesFor(d.rulesVersion)} onChange={(species) => upd({ species })} />
            <Choice className="grow" label="Background" value={d.background} options={backgroundsFor(d.rulesVersion)} onChange={(background) => upd({ background })} />
            <Choice label="Alignment" value={d.alignment} options={ALIGNMENTS} onChange={(alignment) => upd({ alignment })} />
            <label>XP<input type="number" value={d.experience} onChange={(e) => upd({ experience: Number(e.target.value) })} style={{ width: 90 }} /></label>
          </div>
          <ClassesEditor classes={d.classes} rules={d.rulesVersion} onChange={(classes) => {
            // Picking the first class sets its saving throw proficiencies (multiclassing doesn't add saves)
            const first = classInfo(classes[0]?.name ?? "");
            const changedFirst = classes[0]?.name !== d.classes[0]?.name;
            upd(first && changedFirst ? { classes, saveProficiencies: first.saves } : { classes });
          }} />
        </div>

        <div className="sheet">
          {/* Abilities */}
          <div>
            {ABILITIES.map((a) => (
              <div key={a} className="ability">
                <div className="muted" style={{ fontSize: 11 }}>{ABILITY_NAMES[a].toUpperCase()}</div>
                <div className="modv" title="Click to roll a check" onClick={() => rollD20(dv.mods[a], `${ABILITY_NAMES[a]} check`)}>{fmtMod(mod(d.abilities[a]))}</div>
                <input type="number" value={d.abilities[a]} onChange={(e) => upd({ abilities: { ...d.abilities, [a]: Number(e.target.value) } })} />
              </div>
            ))}
          </div>

          {/* Combat + skills */}
          <div>
            <div className="stat-boxes">
              <StatBox k="Armor Class" v={dv.ac} />
              <StatBox k="Initiative" v={fmtMod(dv.initiative)} onClick={() => rollD20(dv.initiative, "Initiative")} />
              <StatBox k="Speed" v={`${d.speed} ft`} />
              <StatBox k="Proficiency" v={fmtMod(dv.proficiencyBonus)} />
              <StatBox k="Passive Perc." v={dv.passivePerception} />
              <StatBox k="Hit Dice" v={dv.hitDice || "-"} />
            </div>
            <div className="card">
              <h3>Hit points</h3>
              <div className="row">
                <label>Current<input type="number" value={d.hp.current} style={{ width: 80 }} disabled={!canEdit}
                  onChange={(e) => play({ hp: { current: Number(e.target.value) } }, { hp: { ...d.hp, current: Number(e.target.value) } })} /></label>
                <label>Temp<input type="number" value={d.hp.temp} style={{ width: 70 }}
                  onChange={(e) => play({ hp: { temp: Number(e.target.value) } }, { hp: { ...d.hp, temp: Number(e.target.value) } })} /></label>
                <label>Max <span className="muted">(blank = auto {derive({ ...d, hp: { ...d.hp, max: null } }).maxHp})</span>
                  <input type="number" value={d.hp.max ?? ""} style={{ width: 90 }} onChange={(e) => upd({ hp: { ...d.hp, max: e.target.value === "" ? null : Number(e.target.value) } })} /></label>
              </div>
              <div className="row">
                <label>AC <span className="muted">(blank = 10 + Dex)</span><input type="number" value={d.ac ?? ""} style={{ width: 80 }} onChange={(e) => upd({ ac: e.target.value === "" ? null : Number(e.target.value) })} /></label>
                <label>Speed<input type="number" value={d.speed} style={{ width: 70 }} onChange={(e) => upd({ speed: Number(e.target.value) })} /></label>
                <label>Extra initiative<input type="number" value={d.initiativeBonus} style={{ width: 70 }} onChange={(e) => upd({ initiativeBonus: Number(e.target.value) })} /></label>
              </div>
              <div className="row">
                <span className="muted">Death saves</span>
                <Pips n={3} filled={d.deathSaves.successes} color="#6aa05a" onSet={(v) => play({ deathSaves: { ...d.deathSaves, successes: v } }, { deathSaves: { ...d.deathSaves, successes: v } })} />
                <Pips n={3} filled={d.deathSaves.failures} color="#b5432c" onSet={(v) => play({ deathSaves: { ...d.deathSaves, failures: v } }, { deathSaves: { ...d.deathSaves, failures: v } })} />
                <label className="inline right"><input type="checkbox" checked={d.inspiration} onChange={(e) => play({ inspiration: e.target.checked }, { inspiration: e.target.checked })} /> Inspiration</label>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>Current HP, temp HP, death saves, inspiration and spell slots save right away without DM approval.</p>
            </div>
            <div className="card">
              <h3>Saving throws</h3>
              {ABILITIES.map((a) => (
                <div key={a} className="skill-row">
                  <input type="checkbox" checked={d.saveProficiencies.includes(a)} onChange={(e) => upd({ saveProficiencies: toggle(d.saveProficiencies, a, e.target.checked) })} />
                  <span className="val" onClick={() => rollD20(dv.saves[a], `${ABILITY_NAMES[a]} save`)}>{fmtMod(dv.saves[a])}</span>
                  <span>{ABILITY_NAMES[a]}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <h3>Skills <span className="muted" style={{ fontSize: 11 }}>☐ proficient · ☆ expertise</span></h3>
              {SKILLS.map((s) => (
                <div key={s.key} className="skill-row">
                  <input type="checkbox" checked={d.skillProficiencies.includes(s.key)} onChange={(e) => upd({ skillProficiencies: toggle(d.skillProficiencies, s.key, e.target.checked) })} />
                  <input type="checkbox" title="Expertise" checked={d.skillExpertise.includes(s.key)} onChange={(e) => upd({ skillExpertise: toggle(d.skillExpertise, s.key, e.target.checked) })} style={{ accentColor: "#e3b866" }} />
                  <span className="val" onClick={() => rollD20(dv.skills[s.key], s.name)}>{fmtMod(dv.skills[s.key])}</span>
                  <span>{s.name} <span className="muted">({s.ability})</span></span>
                </div>
              ))}
            </div>
          </div>

          {/* Attacks, spells, gear, story */}
          <div>
            <FullBody url={d.fullBodyUrl} canEdit={canEdit} characterId={id} name={d.name} onChange={(fullBodyUrl) => play({ fullBodyUrl }, { fullBodyUrl })} />
            <AttacksEditor d={d} upd={upd} roll={r} />
            <SpellsEditor d={d} dv={dv} upd={upd} play={play} />
            <InventoryEditor d={d} upd={upd} />
            <div className="card">
              <h3>Features & traits</h3>
              <textarea rows={6} value={d.features} onChange={(e) => upd({ features: e.target.value })} placeholder="Class features, racial traits, feats..." />
              <label>Proficiencies & languages<textarea value={d.proficienciesText} onChange={(e) => upd({ proficienciesText: e.target.value })} placeholder="Armor, weapons, tools, languages" /></label>
              <label>Personality, ideals, bonds, flaws<textarea value={d.personality} onChange={(e) => upd({ personality: e.target.value })} /></label>
              <label>Backstory<textarea rows={5} value={d.backstory} onChange={(e) => upd({ backstory: e.target.value })} /></label>
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="card" style={{ position: "sticky", bottom: 0, zIndex: 3 }}>
            <div className="row">
              {needsApproval && <input className="grow" placeholder="Note for the DM (e.g. 'Level 5: took Fireball')" value={note} onChange={(e) => setNote(e.target.value)} />}
              <button className="primary" onClick={save} disabled={!dirty && !note}>{needsApproval ? "Submit to DM for approval" : "Save"}</button>
              {dirty && <span className="muted">Unsaved changes</span>}
            </div>
          </div>
        )}
      </fieldset>

      {(c.ownerId === status.user?.id || c.isDM) && c.campaignId && <ChangeHistory id={id} />}

      <div className="card">
        <h3>More</h3>
        <div className="row">
          <button onClick={() => downloadFile(`${d.name.replace(/\W+/g, "_")}.json`, JSON.stringify({ app: "grumbling-gnoll", data: c.data }, null, 2))}>Download data file (for importing)</button>
          {c.ownerId === status.user?.id && otherCampaigns.length > 0 && (
            <select value="" style={{ width: "auto" }} onChange={async (e) => {
              const target = Number(e.target.value);
              if (!target) return;
              const res = await api.post(`/characters/${id}/import`, { campaignId: target });
              toast("Copied. The DM will review it (the AI checks the rules automatically).");
              go(`character/${res.id}`);
            }}>
              <option value="">Bring a copy into another campaign...</option>
              {otherCampaigns.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.rulesVersion})</option>)}
            </select>
          )}
          <button className="danger right" onClick={async () => {
            if (!confirm(`Delete ${d.name}? This can't be undone.`)) return;
            await api.del(`/characters/${id}`);
            if (onDone) onDone(); else go("");
          }}>Delete character</button>
        </div>
      </div>
    </div>
  );
}

const toggle = <T,>(arr: T[], v: T, on: boolean) => (on ? [...new Set([...arr, v])] : arr.filter((x) => x !== v));

function StatBox({ k, v, onClick }: { k: string; v: React.ReactNode; onClick?: () => void }) {
  return <div className="stat-box" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined} title={onClick ? "Click to roll" : undefined}><div className="v">{v}</div><div className="k">{k}</div></div>;
}

function Pips({ n, filled, color, onSet }: { n: number; filled: number; color: string; onSet: (v: number) => void }) {
  return (
    <span className="slots">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="slot" style={{ borderColor: color, background: i < filled ? color : undefined }} onClick={() => onSet(i < filled ? i : i + 1)} />
      ))}
    </span>
  );
}

const OTHER = "__other__";

/** A dropdown with common choices, plus "Other" to type anything (homebrew, other books). */
function Choice({ label, value, options, onChange, className, placeholder }: { label: string; value: string; options: string[]; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  const known = value === "" || options.includes(value);
  const [custom, setCustom] = useState(!known);
  useEffect(() => { if (!options.includes(value) && value !== "") setCustom(true); }, [value, options]);
  return (
    <label className={className}>
      {label}
      {custom ? (
        <div className="row" style={{ gap: 4, flexWrap: "nowrap", marginTop: 3 }}>
          <input value={value} autoFocus={value === ""} placeholder={placeholder ?? "Type your own"} onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="small" title="Pick from the list" onClick={() => { setCustom(false); if (!options.includes(value)) onChange(""); }}>▾</button>
        </div>
      ) : (
        <select value={value} onChange={(e) => { if (e.target.value === OTHER) { setCustom(true); onChange(""); } else onChange(e.target.value); }}>
          <option value="">Choose...</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={OTHER}>Other (type your own)...</option>
        </select>
      )}
    </label>
  );
}

function ClassesEditor({ classes, rules, onChange }: { classes: ClassLevel[]; rules: RulesVersion; onChange: (c: ClassLevel[]) => void }) {
  const set = (i: number, patch: Partial<ClassLevel>) => onChange(classes.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div>
      {classes.map((c, i) => (
        <div key={i} className="row">
          <Choice className="grow" label="Class" value={c.name} options={[...CLASSES.map((x) => x.name), ...EXTRA_CLASSES]} onChange={(name) => set(i, { name, subclass: name === c.name ? c.subclass : "" })} />
          <Choice className="grow" label="Subclass" value={c.subclass} options={subclassesFor(rules, c.name)} onChange={(subclass) => set(i, { subclass })} placeholder="Subclass (from level 3)" />
          <label>Level<input type="number" min={1} max={20} value={c.level} onChange={(e) => set(i, { level: Number(e.target.value) })} style={{ width: 70 }} /></label>
          <label>Spellcasting
            <select value={c.casterOverride ?? ""} onChange={(e) => set(i, { casterOverride: e.target.value as ClassLevel["casterOverride"] })}>
              <option value="">Normal for class</option>
              <option value="full">Full caster</option>
              <option value="half">Half caster</option>
              <option value="third">Third caster (e.g. Eldritch Knight)</option>
              <option value="pact">Pact magic</option>
              <option value="none">None</option>
            </select>
          </label>
          {classes.length > 1 && <button type="button" className="small danger" onClick={() => onChange(classes.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button type="button" className="small" onClick={() => onChange([...classes, { name: "", subclass: "", level: 1 }])}>+ Multiclass</button>
    </div>
  );
}

function AttacksEditor({ d, upd, roll }: { d: CharacterData; upd: (p: Partial<CharacterData>) => void; roll: Roll }) {
  const set = (i: number, k: string, v: string) => upd({ attacks: d.attacks.map((a, j) => (j === i ? { ...a, [k]: v } : a)) });
  return (
    <div className="card">
      <h3>Attacks</h3>
      {d.attacks.map((a, i) => (
        <div key={i} className="row" style={{ marginBottom: 4 }}>
          <input className="grow" value={a.name} placeholder="Longsword" onChange={(e) => set(i, "name", e.target.value)} />
          <input value={a.bonus} placeholder="+5" style={{ width: 54 }} onChange={(e) => set(i, "bonus", e.target.value)} />
          <input value={a.damage} placeholder="1d8+3 slashing" style={{ width: 130 }} onChange={(e) => set(i, "damage", e.target.value)} />
          <button type="button" className="small" onClick={() => roll(`1d20${a.bonus && !a.bonus.startsWith("-") && !a.bonus.startsWith("+") ? "+" : ""}${a.bonus || "+0"}`, `${d.name}: ${a.name} attack`)}>🎲</button>
          <button type="button" className="small" onClick={() => roll(a.damage.split(" ")[0] || "1d4", `${d.name}: ${a.name} damage`)}>💥</button>
          <button type="button" className="small danger" onClick={() => upd({ attacks: d.attacks.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="small" onClick={() => upd({ attacks: [...d.attacks, { name: "", bonus: "", damage: "", notes: "" }] })}>+ Attack</button>
    </div>
  );
}

function SpellsEditor({ d, dv, upd, play }: { d: CharacterData; dv: ReturnType<typeof derive>; upd: (p: Partial<CharacterData>) => void; play: (p: Record<string, unknown>, l: Partial<CharacterData>) => void }) {
  const hasSlots = dv.spellSlots.some((n) => n > 0) || dv.pact.count > 0;
  if (!hasSlots && d.spells.length === 0 && !dv.spellAbility) {
    return <div className="card"><h3>Spells</h3><button type="button" className="small" onClick={() => upd({ spells: [{ name: "", level: 0, prepared: true, notes: "" }] })}>+ Add a spell</button></div>;
  }
  const useSlot = (lvl: number, used: number) => {
    const arr = [...d.spellSlotsUsed];
    arr[lvl] = used;
    play({ spellSlotsUsed: arr }, { spellSlotsUsed: arr });
  };
  const setSpell = (i: number, patch: object) => upd({ spells: d.spells.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="card">
      <h3>Spells</h3>
      {dv.spellAbility && <p className="muted">Spell save DC <b>{dv.spellSaveDC}</b> · Spell attack <b>{fmtMod(dv.spellAttack ?? 0)}</b> · {ABILITY_NAMES[dv.spellAbility as Ability]}</p>}
      {dv.spellSlots.map((n, lvl) => n > 0 && (
        <div key={lvl} className="row" style={{ marginBottom: 2 }}>
          <span style={{ width: 70 }}>Level {lvl + 1}</span>
          <Pips n={n} filled={d.spellSlotsUsed[lvl] ?? 0} color="#e3b866" onSet={(v) => useSlot(lvl, v)} />
        </div>
      ))}
      {dv.pact.count > 0 && (
        <div className="row"><span style={{ width: 70 }}>Pact (lvl {dv.pact.level})</span>
          <Pips n={dv.pact.count} filled={d.pactSlotsUsed} color="#a77ad6" onSet={(v) => play({ pactSlotsUsed: v }, { pactSlotsUsed: v })} />
        </div>
      )}
      {hasSlots && <button type="button" className="small" style={{ margin: "4px 0 8px" }} onClick={() => play({ spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactSlotsUsed: 0 }, { spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactSlotsUsed: 0 })}>Long rest (reset slots)</button>}
      {d.spells.map((s, i) => (
        <div key={i} className="row" style={{ marginBottom: 4 }}>
          <input type="checkbox" title="Prepared" checked={s.prepared} onChange={(e) => setSpell(i, { prepared: e.target.checked })} />
          <select value={s.level} onChange={(e) => setSpell(i, { level: Number(e.target.value) })} style={{ width: 70 }}>
            {Array.from({ length: 10 }, (_, l) => <option key={l} value={l}>{l === 0 ? "Cantrip" : `Lvl ${l}`}</option>)}
          </select>
          <input className="grow" value={s.name} placeholder="Spell name" onChange={(e) => setSpell(i, { name: e.target.value })} />
          <button type="button" className="small danger" onClick={() => upd({ spells: d.spells.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="small" onClick={() => upd({ spells: [...d.spells, { name: "", level: 1, prepared: true, notes: "" }] })}>+ Spell</button>
    </div>
  );
}

function InventoryEditor({ d, upd }: { d: CharacterData; upd: (p: Partial<CharacterData>) => void }) {
  const set = (i: number, patch: object) => upd({ inventory: d.inventory.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const attuned = d.inventory.filter((i) => i.attuned).length;
  return (
    <div className="card">
      <h3>Equipment</h3>
      <div className="row" style={{ marginBottom: 6 }}>
        {(["cp", "sp", "ep", "gp", "pp"] as const).map((k) => (
          <label key={k} style={{ width: 62 }}>{k.toUpperCase()}<input type="number" value={d.currency[k]} onChange={(e) => upd({ currency: { ...d.currency, [k]: Number(e.target.value) } })} /></label>
        ))}
      </div>
      {d.inventory.map((it, i) => (
        <div key={i} className="row" style={{ marginBottom: 4 }}>
          <input type="number" value={it.qty} style={{ width: 52 }} onChange={(e) => set(i, { qty: Number(e.target.value) })} />
          <input className="grow" value={it.name} placeholder="Item" onChange={(e) => set(i, { name: e.target.value })} />
          <label className="inline" title="Equipped"><input type="checkbox" checked={it.equipped} onChange={(e) => set(i, { equipped: e.target.checked })} />E</label>
          <label className="inline" title="Attuned"><input type="checkbox" checked={it.attuned} onChange={(e) => set(i, { attuned: e.target.checked })} />A</label>
          <button type="button" className="small danger" onClick={() => upd({ inventory: d.inventory.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      {attuned > 3 && <div className="error">More than 3 attuned items. 5e allows 3.</div>}
      <button type="button" className="small" onClick={() => upd({ inventory: [...d.inventory, { name: "", qty: 1, weight: 0, equipped: false, attuned: false, notes: "" }] })}>+ Item</button>
    </div>
  );
}

/** Notes only the campaign's DM (and the DM's AI assistant) can see. */
function DmSecretNotes({ id, initial, name }: { id: number; initial: string; name: string }) {
  const { toast } = useStatus();
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [open, setOpen] = useState(!!initial);
  useEffect(() => { setNotes(initial); setSaved(initial); }, [initial]);
  const save = async () => {
    if (notes === saved) return;
    try { await api.put(`/characters/${id}/dm-notes`, { notes }); setSaved(notes); toast("DM notes saved"); }
    catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card" style={{ border: "1px dashed #8a6fb0", background: "#221a2a" }}>
      <div className="row">
        <b className="grow" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} 🔒 DM-only notes</b>
        <span className="muted" style={{ fontSize: 12 }}>Only you and your AI assistant see this. {name}'s player never does.</span>
      </div>
      {open && (
        <>
          <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={save} style={{ marginTop: 8 }}
            placeholder={`Secrets and plans for ${name}: "Their missing sister is the cult leader." "Owes the thieves' guild 300 gp." "Cursed sword: reveal at level 5." Plot hooks, rulings, reminders...`} />
          <div className="row">
            <button className="small primary" disabled={notes === saved} onClick={save}>Save</button>
            <span className="muted" style={{ fontSize: 12 }}>The AI assistant uses these when you ask for hooks, NPCs or encounters, but they never appear in PDFs, exports or anything players see.</span>
          </div>
        </>
      )}
    </div>
  );
}

/** DM picks who plays this character: anyone with an account (people not in the campaign get added to it). */
function OwnerPicker({ c, name, members, users, onDone }: { c: any; name: string; members: any[]; users: any[]; onDone: () => void }) {
  const { toast } = useStatus();
  const memberIds = new Set(members.map((m) => m.id));
  const others = users.filter((u) => !memberIds.has(u.id));
  async function change(userId: number) {
    const who = members.find((m) => m.id === userId) ?? others.find((u) => u.id === userId);
    const adding = !memberIds.has(userId);
    if (!confirm(`Give ${name} to ${who?.displayName}?${adding ? ` They'll also be added to this campaign as a player.` : ""} They'll be able to edit it and move its token.`)) return;
    try {
      await api.post(`/characters/${c.id}/owner`, { userId });
      toast(`${name} now belongs to ${who?.displayName}`);
      onDone();
    } catch (err) { toast((err as Error).message); }
  }
  return (
    <>
      <select style={{ width: "auto", padding: "1px 6px" }} value={c.ownerId} title="Change who plays this character" onChange={(e) => change(Number(e.target.value))}>
        <optgroup label="In this campaign">
          {members.map((m) => <option key={m.id} value={m.id}>{m.displayName}{m.role === "dm" ? " (DM)" : ""}</option>)}
        </optgroup>
        {others.length > 0 && (
          <optgroup label="Not in this campaign yet (adds them)">
            {others.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </optgroup>
        )}
      </select>
      {members.length + others.length <= 1 && <span className="muted" style={{ fontSize: 12 }}> (no players yet: create invite codes on the home page)</span>}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { create: "New character", update: "Changes", import: "Brought in / imported" };

/** Everything the DM and the AI did to this character, newest first. */
function ChangeHistory({ id }: { id: number }) {
  const { data } = useLoad<any[]>(`/characters/${id}/history`, [id]);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const aiCount = data.filter((h) => h.aiFix).length;
  // "abilities.dex: 17 → 15" reads better as "Dexterity: 17 → 15"
  const pretty = (line: string) => {
    const i = line.indexOf(":");
    return i > 0 ? `${fieldLabel(line.slice(0, i))}${line.slice(i)}` : line;
  };
  return (
    <div className="card">
      <div className="row">
        <h3 className="grow" style={{ margin: 0, cursor: "pointer" }} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} 📜 Change history</h3>
        <span className="muted" style={{ fontSize: 12 }}>{data.length} review{data.length === 1 ? "" : "s"}{aiCount ? ` · ${aiCount} AI adjustment${aiCount === 1 ? "" : "s"}` : ""}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {data.length === 0 && <p className="muted">Nothing reviewed yet.</p>}
          {data.map((h) => (
            <div key={h.id} style={{ borderLeft: `3px solid ${h.aiFix ? "var(--gold)" : h.status === "approved" ? "var(--green)" : "var(--red)"}`, padding: "4px 0 8px 12px", marginBottom: 10 }}>
              <div className="row">
                <b>{KIND_LABEL[h.kind] ?? h.kind}</b>
                <span className={`pill ${h.status === "approved" ? "ok" : "bad"}`}>{h.status === "approved" ? "approved" : "sent back"}</span>
                {h.aiFix && <span className="pill warn">✨ adjusted by AI</span>}
                <span className="muted right" style={{ fontSize: 12 }}>{h.reviewedAt ?? h.submittedAt}</span>
              </div>
              {h.note && <div className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>Submitted by {h.submitter}: {h.note}</div>}
              {h.aiCheck && <div style={{ fontSize: 13 }}>🧙 AI check: {h.aiCheck.summary}</div>}
              {h.aiFix && (
                <div className="card" style={{ background: "var(--panel-2)", margin: "6px 0 0", padding: 10 }}>
                  <b>What the AI changed and why</b>
                  {h.aiFix.summary && <p style={{ margin: "4px 0" }}>{h.aiFix.summary}</p>}
                  <ul style={{ margin: "4px 0" }}>
                    {h.aiFix.reasons.map((r: any, i: number) => <li key={i}><b>{fieldLabel(r.field)}:</b> {r.reason}</li>)}
                  </ul>
                  {h.aiFix.changes.length > 0 && (
                    <details>
                      <summary style={{ fontSize: 13 }}>Exact before → after ({h.aiFix.changes.length})</summary>
                      <ul>{h.aiFix.changes.map((c: string, i: number) => <li key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>{pretty(c)}</li>)}</ul>
                    </details>
                  )}
                </div>
              )}
              {h.dmComment && <div style={{ fontSize: 13, marginTop: 4 }}>💬 DM: {h.dmComment}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Suggestions for this character: only its player, the DM and the AI can see them. */
function Suggestions({ id, name, isDM, isOwner }: { id: number; name: string; isDM: boolean; isOwner: boolean }) {
  const { status, toast } = useStatus();
  const { data, reload } = useLoad<any[]>(`/characters/${id}/suggestions`, [id]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const openCount = (data ?? []).filter((s) => !s.resolved).length;

  const add = async () => {
    try { await api.post(`/characters/${id}/suggestions`, { text }); setText(""); reload(); } catch (e) { toast((e as Error).message); }
  };
  const askAI = async () => {
    setBusy(true);
    try { await api.post(`/characters/${id}/suggestions/ai`, { focus }); setFocus(""); reload(); } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const who = (s: any) => (s.authorKind === "ai" ? "🧙 AI assistant" : s.authorKind === "dm" ? `🎲 ${s.authorName} (DM)` : `🧝 ${s.authorName}`);

  return (
    <div className="card" style={{ border: "1px dashed #4f8a6a", background: "#18241d" }}>
      <div className="row">
        <b className="grow" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} 💡 Suggestions {openCount > 0 && <span className="badge">{openCount}</span>}</b>
        <span className="muted" style={{ fontSize: 12 }}>Private: only {isOwner ? "you" : `${name}'s player`}, the DM and the AI assistant see this.</span>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            {isDM ? "Leave ideas for the player (\"Your patron would love it if you took Pact of the Tome\") or ask the AI. Unlike DM-only notes, the player can read these." : "Ideas for your character from the DM and the AI. You can add your own questions or ideas too."}
          </p>
          <div className="row" style={{ marginBottom: 8 }}>
            <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder={isDM ? "Write a suggestion for the player..." : "Write an idea or a question for your DM..."} onKeyDown={(e) => e.key === "Enter" && text.trim() && add()} />
            <button disabled={!text.trim()} onClick={add}>Add</button>
          </div>
          {status.aiEnabled && (
            <div className="row" style={{ marginBottom: 10 }}>
              <input className="grow" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Optional: what should the AI focus on? e.g. 'which spells at level 5', 'how to roleplay her'" />
              <button disabled={busy} onClick={askAI}>{busy ? "Thinking..." : "✨ Ask AI for suggestions"}</button>
            </div>
          )}
          {data?.length === 0 && <p className="muted">No suggestions yet.</p>}
          {data?.map((s) => (
            <div key={s.id} style={{ borderLeft: `3px solid ${s.authorKind === "ai" ? "var(--gold)" : s.authorKind === "dm" ? "var(--red)" : "var(--green)"}`, padding: "4px 0 6px 10px", marginBottom: 8, opacity: s.resolved ? 0.55 : 1 }}>
              <div className="row">
                <b style={{ fontSize: 13 }}>{who(s)}</b>
                <span className="muted" style={{ fontSize: 12 }}>{s.createdAt}</span>
                <label className="inline right" style={{ fontSize: 12 }}><input type="checkbox" checked={s.resolved} onChange={(e) => api.patch(`/character-suggestions/${s.id}`, { resolved: e.target.checked }).then(reload)} /> Done</label>
                {(isDM || s.authorId === status.user?.id) && <button className="small danger" onClick={() => api.del(`/character-suggestions/${s.id}`).then(reload)}>✕</button>}
              </div>
              {s.authorKind === "ai" ? <Markdown text={s.text} /> : <div style={{ whiteSpace: "pre-wrap" }}>{s.text}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
