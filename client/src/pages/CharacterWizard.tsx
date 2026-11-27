import { useMemo, useState } from "react";
import { api } from "../api";
import { useStatus } from "../hooks";
import {
  ABILITIES, ABILITY_NAMES, CLASSES, SKILLS, blankCharacter, classInfo, derive, fmtMod, mod,
  type Ability, type CharacterData, type RulesVersion,
} from "../../../shared/character";
import { ALIGNMENTS, backgroundsFor, speciesFor, subclassesFor } from "../../../shared/options";
import {
  BACKGROUND_ABILITIES_2024, BACKGROUND_SKILLS, CLASS_CREATION, POINT_BUY_BUDGET, POINT_BUY_COST, SPECIES_2014, STANDARD_ARRAY, asiLevels, classSkillChoices, speciesSpeed, subclassLevel,
} from "../../../shared/creation";

type Method = "roll" | "array" | "pointbuy";
const STEPS = ["Basics", "Species", "Class", "Background", "Ability scores", "Skills", "Hit points", "Equipment", "Personality", "Review"];
const skillName = (k: string) => SKILLS.find((s) => s.key === k)?.name ?? k;
const empty = (): Record<Ability, number | null> => ({ str: null, dex: null, con: null, int: null, wis: null, cha: null });

export function CharacterWizard({ campaignId, rules, onDone, onCancel }: { campaignId?: number; rules: RulesVersion; onDone: (id: number) => void; onCancel: () => void }) {
  const { toast } = useStatus();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [species, setSpecies] = useState("");
  const [cls, setCls] = useState("");
  const [subclass, setSubclass] = useState("");
  const [background, setBackground] = useState("");
  const [method, setMethod] = useState<Method>("roll");
  const [rolled, setRolled] = useState<{ values: number[]; detail: string; rollId: number; rollCount: number } | null>(null);
  const [assign, setAssign] = useState<Record<Ability, number | null>>(empty()); // index into the pool (roll/array) or a score (point buy)
  const [points, setPoints] = useState<Record<Ability, number>>({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  const [chosenBonus, setChosenBonus] = useState<Partial<Record<Ability, number>>>({});
  const [skills, setSkills] = useState<string[]>([]);
  const [hpMode, setHpMode] = useState<"average" | "roll">("average");
  const [hpRoll, setHpRoll] = useState<{ values: number[]; rollId: number } | null>(null);
  const [goldMode, setGoldMode] = useState<"equipment" | "roll">("equipment");
  const [goldRoll, setGoldRoll] = useState<{ value: number; rollId: number } | null>(null);
  const [equipment, setEquipment] = useState("");
  const [gold, setGold] = useState(rules === "2024" ? 0 : 10);
  const [alignment, setAlignment] = useState("");
  const [personality, setPersonality] = useState("");
  const [backstory, setBackstory] = useState("");
  const [busy, setBusy] = useState(false);

  const info = classInfo(cls);
  const cc = CLASS_CREATION[cls];
  const sp2014 = rules === "2014" ? SPECIES_2014[species] : undefined;
  const bgSkills = BACKGROUND_SKILLS[rules][background] ?? [];

  // ---- ability scores ----
  const pool = method === "roll" ? rolled?.values ?? [] : method === "array" ? STANDARD_ARRAY : [];
  const base: Record<Ability, number | null> = useMemo(() => {
    if (method === "pointbuy") return { ...points };
    const out = empty();
    for (const a of ABILITIES) out[a] = assign[a] != null ? pool[assign[a]!] ?? null : null;
    return out;
  }, [method, points, assign, pool]);
  const pointsSpent = ABILITIES.reduce((s, a) => s + POINT_BUY_COST[points[a]], 0);

  // Ability bonuses: 2014 from species (fixed + chosen), 2024 from background (chosen)
  const bonusRule = rules === "2024"
    ? { fixed: {} as Partial<Record<Ability, number>>, choices: BACKGROUND_ABILITIES_2024[background] ?? ABILITIES, mode: "2024" as const }
    : sp2014
      ? { fixed: sp2014.bonuses, choices: ABILITIES.filter((a) => !sp2014.choose?.exclude?.includes(a)), mode: sp2014.choose ? ("choose" as const) : ("fixed" as const), count: sp2014.choose?.count ?? 0 }
      : { fixed: {} as Partial<Record<Ability, number>>, choices: ABILITIES, mode: "flex" as const };
  const bonus = (a: Ability) => (bonusRule.fixed[a] ?? 0) + (chosenBonus[a] ?? 0);
  const finalScore = (a: Ability) => (base[a] ?? 0) + bonus(a);
  const bonusValid = (() => {
    const vals = Object.values(chosenBonus).filter(Boolean) as number[];
    const sum = vals.reduce((s, v) => s + v, 0);
    if (bonusRule.mode === "fixed") return true;
    if (bonusRule.mode === "choose") return vals.length === (bonusRule as any).count && vals.every((v) => v === 1);
    // 2024 background or flexible: +2/+1 or +1/+1/+1
    return sum === 3 && (vals.length === 2 ? vals.includes(2) : vals.length === 3);
  })();
  const abilitiesDone = ABILITIES.every((a) => base[a] != null) && (method !== "pointbuy" || pointsSpent <= POINT_BUY_BUDGET) && bonusValid;

  // ---- hit points ----
  const conMod = mod(finalScore("con") || 10);
  const hd = info?.hitDie ?? 8;
  const extraLevels = level - 1;
  const hpTotal = hd + conMod + (extraLevels > 0
    ? hpMode === "roll" && hpRoll ? hpRoll.values.reduce((s, v) => s + v, 0) + conMod * extraLevels : (hd / 2 + 1 + conMod) * extraLevels
    : 0);

  // ---- server rolls ----
  async function roll(kind: string, body: object) {
    return api.post("/characters/creator-roll", { kind, campaignId, ...body });
  }
  async function rollAbilities() {
    if (rolled && !confirm("Roll again? Your DM can see how many times you rolled.")) return;
    try {
      const r = await roll("abilities", {});
      setRolled(r);
      setAssign(empty());
    } catch (e) { toast((e as Error).message); }
  }

  const skillChoicesNeeded = cc?.skillCount ?? 2;
  const classSkills = classSkillChoices(cls, rules);
  const classSkillList = !classSkills || classSkills === "any" ? SKILLS.map((s) => s.key) : classSkills;
  const chosenClassSkills = skills.filter((s) => !bgSkills.includes(s));

  const canNext = [
    name.trim().length > 0,
    species.trim().length > 0,
    !!cls && (level < subclassLevel(cls, rules) || !!subclass || true),
    background.trim().length > 0,
    abilitiesDone,
    chosenClassSkills.length === skillChoicesNeeded,
    extraLevels === 0 || hpMode === "average" || !!hpRoll,
    true,
    true,
    true,
  ][step];

  function buildCharacter(): CharacterData {
    const d = blankCharacter(rules);
    const abilities = Object.fromEntries(ABILITIES.map((a) => [a, finalScore(a)])) as Record<Ability, number>;
    const speed = speciesSpeed(species, rules);
    const rolledHp = extraLevels > 0 && hpMode === "roll";
    const items = equipment.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    return {
      ...d,
      name: name.trim(),
      species, background, alignment,
      classes: [{ name: cls, subclass, level }],
      abilities,
      saveProficiencies: info?.saves ?? [],
      skillProficiencies: [...new Set([...bgSkills, ...chosenClassSkills])],
      hp: { max: rolledHp ? hpTotal : null, current: hpTotal, temp: 0 },
      speed,
      inventory: items.map((n) => ({ name: n, qty: 1, weight: 0, equipped: false, attuned: false, notes: "" })),
      currency: { ...d.currency, gp: goldMode === "roll" && goldRoll ? goldRoll.value : gold },
      personality, backstory,
      features: [
        sp2014?.note ?? "",
        level >= 4 ? `Ability score improvements / feats from level ${asiLevels(cls, rules).filter((l) => l <= level).join(", ")}: add these to your ability scores.` : "",
        rules === "2024" && level >= 19 ? "Level 19: choose an Epic Boon feat." : "",
        "Add your class and species features here (see the rulebook).",
      ].filter(Boolean).join("\n"),
    };
  }

  async function create() {
    setBusy(true);
    try {
      const rollIds = [rolled?.rollId, hpMode === "roll" ? hpRoll?.rollId : undefined, goldMode === "roll" ? goldRoll?.rollId : undefined].filter(Boolean);
      const r = await api.post("/characters", { campaignId, data: buildCharacter(), rollIds, note: `Made with the step-by-step creator (${method === "roll" ? "rolled" : method === "array" ? "standard array" : "point buy"} ability scores).` });
      toast(campaignId ? "Character created and sent to the DM for approval!" : "Character created!");
      onDone(r.id);
    } catch (e) { toast((e as Error).message); setBusy(false); }
  }

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="card">
      <div className="row"><h2 className="grow" style={{ margin: 0 }}>🧙 Create a character</h2><button className="small" onClick={onCancel}>Cancel</button></div>
      <p className="muted">5th Edition ({rules} rules), step by step. Dice are rolled by the site and shown to the table.</p>
      <div className="row" style={{ gap: 4, marginBottom: 14 }}>
        {STEPS.map((s, i) => (
          <button key={s} className={`small ${i === step ? "active" : ""}`} disabled={i > step} onClick={() => setStep(i)} style={{ opacity: i < step ? 0.8 : 1 }}>
            {i < step ? "✓ " : `${i + 1}. `}{s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div>
          <h3>Who are you?</h3>
          <div className="row top">
            <label className="grow">Character name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mirabel Thistlewood" autoFocus /></label>
            <label>Starting level<input type="number" min={1} max={20} value={level} onChange={(e) => setLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} style={{ width: 90 }} /></label>
          </div>
          <p className="muted">Most new characters start at level 1. Ask your DM if the campaign starts higher.</p>
        </div>
      )}

      {step === 1 && (
        <div>
          <h3>Choose your {rules === "2024" ? "species" : "race"}</h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
            {speciesFor(rules).map((s) => (
              <button key={s} className={species === s ? "active" : ""} onClick={() => { setSpecies(s); setChosenBonus({}); }} style={{ whiteSpace: "normal" }}>{s}</button>
            ))}
          </div>
          <label style={{ marginTop: 10 }}>Or type another (from another book or homebrew)<input value={speciesFor(rules).includes(species) ? "" : species} onChange={(e) => { setSpecies(e.target.value); setChosenBonus({}); }} /></label>
          {sp2014 && (
            <p className="notice">
              {Object.entries(sp2014.bonuses).map(([a, v]) => `${ABILITY_NAMES[a as Ability]} +${v}`).join(", ") || "No fixed ability bonuses"}
              {sp2014.choose ? `, plus +1 to ${sp2014.choose.count} abilities of your choice` : ""} · Speed {sp2014.speed} ft.{sp2014.note ? ` · ${sp2014.note}` : ""}
            </p>
          )}
          {rules === "2024" && species && <p className="notice">In the 2024 rules your ability bonuses come from your background, chosen in step 4.</p>}
          {rules === "2014" && species && !sp2014 && <p className="notice">For this race you'll pick +2 and +1 (or +1/+1/+1) yourself, using the flexible rule. Check with your DM.</p>}
        </div>
      )}

      {step === 2 && (
        <div>
          <h3>Choose your class</h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
            {CLASSES.map((c) => {
              const x = CLASS_CREATION[c.name];
              return (
                <button key={c.name} className={cls === c.name ? "active" : ""} onClick={() => { setCls(c.name); setSubclass(""); setSkills([]); }} style={{ whiteSpace: "normal", textAlign: "left" }}>
                  <b>{c.name}</b> <span className="muted" style={{ fontSize: 12 }}>d{c.hitDie} · {x.primary}</span>
                  <div className="muted" style={{ fontSize: 12 }}>{x.blurb}</div>
                </button>
              );
            })}
          </div>
          {cls && level >= subclassLevel(cls, rules) && (
            <label style={{ marginTop: 10 }}>Subclass (you get it at level {subclassLevel(cls, rules)})
              <select value={subclass} onChange={(e) => setSubclass(e.target.value)}>
                <option value="">Choose later</option>
                {subclassesFor(rules, cls).map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          )}
          {info && <p className="notice">Saving throws: {info.saves.map((a) => ABILITY_NAMES[a]).join(" and ")} · Hit die d{info.hitDie}{info.spellAbility ? ` · Casts spells with ${ABILITY_NAMES[info.spellAbility]}` : ""}</p>}
        </div>
      )}

      {step === 3 && (
        <div>
          <h3>Choose your background</h3>
          <p className="muted">Your life before adventuring. It gives you skills{rules === "2024" ? ", ability score increases, and a feat" : " and a feature"}.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
            {backgroundsFor(rules).map((b) => (
              <button key={b} className={background === b ? "active" : ""} onClick={() => { setBackground(b); setSkills([]); setChosenBonus({}); }} style={{ whiteSpace: "normal" }}>{b}</button>
            ))}
          </div>
          <label style={{ marginTop: 10 }}>Or type another<input value={backgroundsFor(rules).includes(background) ? "" : background} onChange={(e) => setBackground(e.target.value)} /></label>
          {bgSkills.length > 0 && <p className="notice">Skills: {bgSkills.map(skillName).join(", ")}{rules === "2024" && BACKGROUND_ABILITIES_2024[background] ? ` · Raises ${BACKGROUND_ABILITIES_2024[background].map((a) => ABILITY_NAMES[a]).join(", ")}` : ""}</p>}
        </div>
      )}

      {step === 4 && (
        <div>
          <h3>Ability scores</h3>
          <div className="row" style={{ marginBottom: 10 }}>
            {(["roll", "array", "pointbuy"] as Method[]).map((m) => (
              <button key={m} className={method === m ? "active" : ""} onClick={() => { setMethod(m); setAssign(empty()); }}>
                {m === "roll" ? "🎲 Roll 4d6, drop lowest" : m === "array" ? "Standard array" : "Point buy"}
              </button>
            ))}
          </div>
          {method === "roll" && (
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="primary" onClick={rollAbilities}>{rolled ? "Roll again" : "Roll my scores"}</button>
              {rolled && <span><b style={{ fontSize: 18 }}>{rolled.values.join(", ")}</b> <span className="muted" style={{ fontSize: 12 }}>{rolled.detail.replace(/~~/g, "")}</span></span>}
              {rolled && rolled.rollCount > 1 && <span className="pill warn">rolled {rolled.rollCount} times today</span>}
            </div>
          )}
          {method === "array" && <p className="muted">Assign 15, 14, 13, 12, 10 and 8, one to each ability.</p>}
          {method === "pointbuy" && <p className="muted">Every score starts at 8. Spend up to {POINT_BUY_BUDGET} points (scores 8-15). Spent: <b style={{ color: pointsSpent > POINT_BUY_BUDGET ? "#ff9b85" : undefined }}>{pointsSpent}</b> / {POINT_BUY_BUDGET}</p>}

          <table className="list" style={{ maxWidth: 620 }}>
            <thead><tr><th>Ability</th><th>Base</th><th>Bonus</th><th>Final</th><th>Modifier</th></tr></thead>
            <tbody>
              {ABILITIES.map((a) => (
                <tr key={a}>
                  <td>{ABILITY_NAMES[a]}{cc?.primary.includes(ABILITY_NAMES[a]) && <span className="pill ok" style={{ marginLeft: 6 }}>key for {cls}</span>}</td>
                  <td>
                    {method === "pointbuy" ? (
                      <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                        <button className="small" disabled={points[a] <= 8} onClick={() => setPoints({ ...points, [a]: points[a] - 1 })}>−</button>
                        <b style={{ width: 22, textAlign: "center" }}>{points[a]}</b>
                        <button className="small" disabled={points[a] >= 15} onClick={() => setPoints({ ...points, [a]: points[a] + 1 })}>+</button>
                      </span>
                    ) : (
                      <select value={assign[a] ?? ""} style={{ width: 80 }} disabled={!pool.length}
                        onChange={(e) => {
                          const idx = e.target.value === "" ? null : Number(e.target.value);
                          const nextA = { ...assign };
                          for (const b of ABILITIES) if (nextA[b] === idx) nextA[b] = null; // each value used once
                          nextA[a] = idx;
                          setAssign(nextA);
                        }}>
                        <option value="">-</option>
                        {pool.map((v, i) => <option key={i} value={i}>{v}{Object.values(assign).includes(i) && assign[a] !== i ? " (used)" : ""}</option>)}
                      </select>
                    )}
                  </td>
                  <td>
                    {bonusRule.mode === "fixed" ? (bonus(a) ? `+${bonus(a)}` : "") : (
                      <span>
                        {bonusRule.fixed[a] ? `+${bonusRule.fixed[a]} ` : ""}
                        {bonusRule.choices.includes(a) && (
                          <select value={chosenBonus[a] ?? 0} style={{ width: 64 }} onChange={(e) => setChosenBonus({ ...chosenBonus, [a]: Number(e.target.value) })}>
                            <option value={0}>+0</option><option value={1}>+1</option>{bonusRule.mode !== "choose" && <option value={2}>+2</option>}
                          </select>
                        )}
                      </span>
                    )}
                  </td>
                  <td><b>{base[a] != null ? finalScore(a) : "-"}</b></td>
                  <td>{base[a] != null ? fmtMod(mod(finalScore(a))) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bonusRule.mode !== "fixed" && !bonusValid && (
            <p className="notice">
              {bonusRule.mode === "choose" ? `Pick +1 for ${(bonusRule as any).count} different abilities.` : `Add either +2 to one ability and +1 to another, or +1 to three abilities${rules === "2024" && BACKGROUND_ABILITIES_2024[background] ? ` (from ${BACKGROUND_ABILITIES_2024[background].map((x) => ABILITY_NAMES[x]).join(", ")})` : ""}.`}
            </p>
          )}
          {level >= 4 && <p className="muted" style={{ fontSize: 12 }}>Ability score improvements from levels 4, 8, and so on can be added on the sheet afterwards.</p>}
        </div>
      )}

      {step === 5 && (
        <div>
          <h3>Skills</h3>
          {bgSkills.length > 0 && <p>From your background: <b>{bgSkills.map(skillName).join(", ")}</b></p>}
          <p>Choose <b>{skillChoicesNeeded}</b> from the {cls || "class"} list ({chosenClassSkills.length} chosen):</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 6 }}>
            {classSkillList.filter((k) => !bgSkills.includes(k)).map((k) => {
              const on = skills.includes(k);
              const full = chosenClassSkills.length >= skillChoicesNeeded;
              return (
                <button key={k} className={on ? "active" : ""} disabled={!on && full} onClick={() => setSkills(on ? skills.filter((s) => s !== k) : [...skills, k])}>
                  {on ? "✓ " : ""}{skillName(k)}
                </button>
              );
            })}
          </div>
          {cls === "Rogue" && <p className="muted" style={{ fontSize: 12 }}>Rogues also get Expertise in two skills: tick the star boxes on the sheet afterwards.</p>}
        </div>
      )}

      {step === 6 && (
        <div>
          <h3>Hit points</h3>
          <p>Level 1: your hit die maximum (<b>{hd}</b>) + Constitution modifier (<b>{fmtMod(conMod)}</b>) = <b>{hd + conMod}</b></p>
          {extraLevels > 0 && (
            <>
              <p>For your other {extraLevels} level{extraLevels > 1 ? "s" : ""}, take the average or roll:</p>
              <div className="row">
                <button className={hpMode === "average" ? "active" : ""} onClick={() => setHpMode("average")}>Take the average ({hd / 2 + 1} per level)</button>
                <button className={hpMode === "roll" ? "active" : ""} onClick={async () => {
                  setHpMode("roll");
                  if (!hpRoll) {
                    try { const r = await roll("hp", { hitDie: hd, levels: extraLevels }); setHpRoll(r); } catch (e) { toast((e as Error).message); }
                  }
                }}>🎲 Roll d{hd} × {extraLevels}</button>
                {hpMode === "roll" && hpRoll && <span>Rolled <b>{hpRoll.values.join(", ")}</b></span>}
              </div>
              {hpMode === "roll" && hpRoll && <p className="muted" style={{ fontSize: 12 }}>One roll per character. It's recorded for your DM.</p>}
            </>
          )}
          <p style={{ fontSize: 18 }}>Maximum hit points: <b>{Math.max(1, hpTotal)}</b></p>
        </div>
      )}

      {step === 7 && (
        <div>
          <h3>Equipment & money</h3>
          {rules === "2014" && cc && (
            <div className="row" style={{ marginBottom: 8 }}>
              <button className={goldMode === "equipment" ? "active" : ""} onClick={() => setGoldMode("equipment")}>Take the class's starting equipment</button>
              <button className={goldMode === "roll" ? "active" : ""} onClick={async () => {
                setGoldMode("roll");
                if (!goldRoll) {
                  try { const r = await roll("gold", { dice: cc.gold2014, multiplier: cc.goldMultiplier }); setGoldRoll({ value: r.values[0], rollId: r.rollId }); } catch (e) { toast((e as Error).message); }
                }
              }}>🎲 Roll starting gold instead ({cc.gold2014}{cc.goldMultiplier === 10 ? " × 10" : ""} gp)</button>
              {goldMode === "roll" && goldRoll && <b>{goldRoll.value} gp to buy your own gear</b>}
            </div>
          )}
          <label>{goldMode === "roll" ? "What you buy (one item per line)" : "Starting equipment from your class and background (one item per line)"}
            <textarea rows={6} value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder={"Chain mail\nLongsword\nShield\nExplorer's pack"} />
          </label>
          {goldMode === "equipment" && <label>Gold pieces<input type="number" min={0} value={gold} onChange={(e) => setGold(Number(e.target.value))} style={{ width: 100 }} /></label>}
          <p className="muted" style={{ fontSize: 12 }}>Your class and background list the exact starting gear in the rulebook. You can fill in armor class on the sheet once you've picked your armor.</p>
        </div>
      )}

      {step === 8 && (
        <div>
          <h3>Personality & story</h3>
          <label>Alignment
            <select value={alignment} onChange={(e) => setAlignment(e.target.value)} style={{ width: 220 }}>
              <option value="">Choose...</option>{ALIGNMENTS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label>Personality traits, ideals, bonds and flaws<textarea rows={4} value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="I quote old proverbs for every occasion. Ideal: knowledge should be shared. Bond: I owe the innkeeper my life. Flaw: I can't resist a locked book." /></label>
          <label>Backstory (optional)<textarea rows={5} value={backstory} onChange={(e) => setBackstory(e.target.value)} /></label>
        </div>
      )}

      {step === 9 && <Review d={buildCharacter()} />}

      <hr />
      <div className="row">
        <button disabled={step === 0} onClick={back}>← Back</button>
        {step < STEPS.length - 1
          ? <button className="primary" disabled={!canNext} onClick={next}>Next: {STEPS[step + 1]} →</button>
          : <button className="primary" disabled={busy} onClick={create}>{busy ? "Creating..." : campaignId ? "Create & send to DM" : "Create character"}</button>}
      </div>
    </div>
  );
}

export function Review({ d, complete }: { d: CharacterData; complete?: boolean }) {
  const dv = derive(d);
  return (
    <div>
      <h3>{d.name}</h3>
      <p>Level {dv.level} {d.species} {d.classes[0].name}{d.classes[0].subclass ? ` (${d.classes[0].subclass})` : ""} · {d.background} · {d.alignment || "no alignment"}</p>
      <div className="row" style={{ marginBottom: 8 }}>
        {ABILITIES.map((a) => <span key={a} className="pill">{a.toUpperCase()} {d.abilities[a]} ({fmtMod(dv.mods[a])})</span>)}
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="pill">HP {dv.maxHp}</span><span className="pill">AC {dv.ac}{complete ? "" : " (no armor yet)"}</span><span className="pill">Speed {d.speed} ft</span>
        <span className="pill">Initiative {fmtMod(dv.initiative)}</span><span className="pill">Proficiency {fmtMod(dv.proficiencyBonus)}</span>
        {dv.spellSaveDC && <span className="pill">Spell DC {dv.spellSaveDC}</span>}
      </div>
      <p><b>Saving throws:</b> {d.saveProficiencies.map((a) => `${ABILITY_NAMES[a]} ${fmtMod(dv.saves[a])}`).join(", ")}</p>
      <p><b>Skills:</b> {d.skillProficiencies.map((k) => `${skillName(k)} ${fmtMod(dv.skills[k])}`).join(", ")}</p>
      {d.inventory.length > 0 && <p><b>Gear:</b> {d.inventory.map((i) => i.name).join(", ")}</p>}
      <p><b>Money:</b> {d.currency.gp} gp</p>
      {!complete && <p className="muted">After creating, open the sheet to add spells, attacks, features, armor class and a portrait.</p>}
    </div>
  );
}
