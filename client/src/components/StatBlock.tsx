import { mod, fmtMod } from "../../../shared/character";
import { Markdown } from "./Markdown";

export function StatBlock({ m }: { m: any }) {
  const line = (label: string, v: string) => (v ? <div><b>{label}</b> {v}</div> : null);
  const section = (title: string, list: { name: string; description: string }[]) =>
    list?.length ? (
      <>
        <div className="section">{title}</div>
        {list.map((a, i) => <p key={i}><b><i>{a.name}.</i></b> {a.description}</p>)}
      </>
    ) : null;
  return (
    <div className="statblock">
      <h3>{m.name}</h3>
      <div><i>{[m.size, m.type].filter(Boolean).join(" ")}{m.alignment ? `, ${m.alignment}` : ""}</i></div>
      <div className="rule" />
      <div><b>Armor Class</b> {m.armor_class}{m.armor_note ? ` (${m.armor_note})` : ""}</div>
      <div><b>Hit Points</b> {m.hit_points}{m.hit_dice ? ` (${m.hit_dice})` : ""}</div>
      {line("Speed", m.speed)}
      <div className="rule" />
      <div className="abil">
        {(["str", "dex", "con", "int", "wis", "cha"] as const).map((a) => (
          <div key={a}><b>{a.toUpperCase()}</b><div>{m[a]} ({fmtMod(mod(Number(m[a]) || 10))})</div></div>
        ))}
      </div>
      <div className="rule" />
      {line("Saving Throws", m.saving_throws)}
      {line("Skills", m.skills)}
      {line("Damage Vulnerabilities", m.damage_vulnerabilities)}
      {line("Damage Resistances", m.damage_resistances)}
      {line("Damage Immunities", m.damage_immunities)}
      {line("Condition Immunities", m.condition_immunities)}
      {line("Senses", m.senses)}
      {line("Languages", m.languages)}
      <div><b>Challenge</b> {m.challenge_rating}{m.proficiency_bonus ? ` · Proficiency Bonus +${m.proficiency_bonus}` : ""}</div>
      <div className="rule" />
      {m.traits?.map((a: any, i: number) => <p key={i}><b><i>{a.name}.</i></b> {a.description}</p>)}
      {section("Actions", m.actions)}
      {section("Bonus Actions", m.bonus_actions)}
      {section("Reactions", m.reactions)}
      {section("Legendary Actions", m.legendary_actions)}
      {m.lore && <><div className="section">Lore</div><p>{m.lore}</p></>}
    </div>
  );
}

export function ItemCard({ it }: { it: any }) {
  return (
    <div className="statblock">
      <h3>{it.name}</h3>
      <div><i>{it.item_type}, {it.rarity}{it.requires_attunement ? ` (requires attunement${it.attunement_note ? " " + it.attunement_note : ""})` : ""}</i></div>
      <div className="rule" />
      <div style={{ whiteSpace: "pre-wrap" }}>{it.description}</div>
      {it.source_page && <p style={{ fontSize: 12 }}><i>{it.source_page}</i></p>}
    </div>
  );
}

export function EntryView({ e }: { e: any }) {
  if (e.kind === "monster") return <StatBlock m={e.data} />;
  if (e.kind === "item") return <ItemCard it={e.data} />;
  if (e.kind === "spell") return <SpellCard s={e.data} />;
  return (
    <>
      <Markdown text={e.data.markdown ?? e.data.text ?? ""} />
      {e.data.statblock && <div style={{ marginTop: 10 }}><StatBlock m={e.data.statblock} /></div>}
    </>
  );
}

export function SpellCard({ s }: { s: any }) {
  return (
    <div className="statblock">
      <h3>{s.name}</h3>
      <div><i>{Number(s.level) === 0 ? `${s.school || ""} cantrip` : `Level ${s.level} ${String(s.school || "").toLowerCase()}`}</i></div>
      <div className="rule" />
      <div><b>Casting time</b> {s.casting_time} · <b>Range</b> {s.range}</div>
      <div><b>Components</b> {s.components} · <b>Duration</b> {s.duration}</div>
      <div className="rule" />
      <div style={{ whiteSpace: "pre-wrap" }}>{s.description}</div>
      {s.higher_levels && <p><b>At higher levels.</b> {s.higher_levels}</p>}
      {s.source_page && <p style={{ fontSize: 12 }}><i>{s.source_page}</i></p>}
    </div>
  );
}
