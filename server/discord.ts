// Discord integration through webhooks: table activity, DM alerts and session reminders.
import { all, one, parseJSON, run } from "./db.ts";

export interface DiscordOptions { rolls: boolean; initiative: boolean; shares: boolean; maps: boolean; chat: boolean }
const DEFAULTS: DiscordOptions = { rolls: true, initiative: true, shares: true, maps: true, chat: false };

const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const validWebhook = (url: string) => url === "" || WEBHOOK_RE.test(url.trim());

const BOT = { username: "The Grumbling Gnoll" };
const GOLD = 0xe3b866, RED = 0xb5432c, GREEN = 0x6aa05a;

interface Embed { title?: string; description?: string; color?: number; footer?: { text: string }; fields?: { name: string; value: string; inline?: boolean }[] }
interface Payload { content?: string; embeds?: Embed[]; pingEveryone?: boolean }

// One queue per webhook so messages arrive in order and respect Discord's rate limits.
const queues = new Map<string, Promise<void>>();

export function sendWebhook(url: string, payload: Payload): Promise<void> {
  if (!url) return Promise.resolve();
  const prev = queues.get(url) ?? Promise.resolve();
  const next = prev.then(() => deliver(url, payload)).catch((e) => console.error("Discord webhook failed:", e.message));
  queues.set(url, next);
  return next;
}

async function deliver(url: string, payload: Payload, attempt = 0): Promise<void> {
  // Only the "starting now" reminder may ping @everyone; nothing players type can.
  const body = JSON.stringify({ ...BOT, allowed_mentions: { parse: payload.pingEveryone ? ["everyone"] : [] }, ...truncate(payload) });
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (res.status === 429 && attempt < 3) {
    const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise((r) => setTimeout(r, Math.ceil((data.retry_after ?? 1) * 1000)));
    return deliver(url, payload, attempt + 1);
  }
  if (!res.ok) throw new Error(`Discord said ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function truncate(p: Payload): Payload {
  return {
    content: p.content?.slice(0, 1900),
    embeds: p.embeds?.map((e) => ({ ...e, title: e.title?.slice(0, 250), description: e.description?.slice(0, 3900) })),
  };
}

function campaignDiscord(campaignId: number) {
  const c = one("SELECT name, discord_webhook, discord_dm_webhook, discord_options FROM campaigns WHERE id = ?", campaignId);
  if (!c) return null;
  return { name: c.name as string, table: c.discord_webhook as string, dm: c.discord_dm_webhook as string, opts: { ...DEFAULTS, ...parseJSON<Partial<DiscordOptions>>(c.discord_options, {}) } };
}

// ---------- table activity ----------

export function discordChat(campaignId: number, who: string, kind: string, body: any, whisper: boolean) {
  if (whisper) return; // private messages and secret rolls never leave the site
  const d = campaignDiscord(campaignId);
  if (!d?.table) return;
  if (kind === "roll" && d.opts.rolls) {
    const crit = body.crit === "success" ? " 🎉 **Natural 20!**" : body.crit === "fail" ? " 💀 **Natural 1**" : "";
    void sendWebhook(d.table, {
      embeds: [{
        color: body.crit === "success" ? GREEN : body.crit === "fail" ? RED : GOLD,
        description: `🎲 **${who}** rolled ${body.label ? `**${body.label}**` : `\`${body.expression}\``}: **${body.total}**${crit}\n*${String(body.detail)}*`,
      }],
    });
  } else if (kind === "share" && d.opts.shares) {
    void sendWebhook(d.table, { embeds: [{ color: GOLD, title: body.title || `📜 From the DM`, description: body.text }] });
  } else if (kind === "text" && d.opts.chat) {
    void sendWebhook(d.table, { content: `**${who}:** ${body.text}` });
  }
}

export function discordTurn(campaignId: number, round: number, name: string | null, newRound: boolean) {
  const d = campaignDiscord(campaignId);
  if (!d?.table || !d.opts.initiative) return;
  const who = name ? `It's **${name}**'s turn!` : "The DM's creatures are acting...";
  void sendWebhook(d.table, { content: `${newRound ? `⚔️ **Round ${round}**\n` : ""}➡️ ${who}` });
}

export function discordCombatEnd(campaignId: number) {
  const d = campaignDiscord(campaignId);
  if (d?.table && d.opts.initiative) void sendWebhook(d.table, { content: "🏳️ Combat is over." });
}

export function discordMap(campaignId: number, mapName: string) {
  const d = campaignDiscord(campaignId);
  if (d?.table && d.opts.maps) void sendWebhook(d.table, { content: `🗺️ The DM put a new map on the table: **${mapName}**` });
}

// ---------- DM alerts ----------

let seenOrigin = "";
/** If PUBLIC_URL isn't set, remember the address people use to reach the site. */
export function rememberOrigin(origin: string) {
  if (!seenOrigin && /^https?:\/\/[\w.-]+(:\d+)?$/.test(origin)) seenOrigin = origin;
}
const siteUrl = () => (process.env.PUBLIC_URL || seenOrigin).replace(/\/$/, "");

export function discordAlertDM(campaignId: number, title: string, description: string, link?: string) {
  const d = campaignDiscord(campaignId);
  if (!d?.dm) return;
  const url = link && siteUrl() ? `\n[Open on the site](${siteUrl()}${link})` : "";
  void sendWebhook(d.dm, { embeds: [{ color: GOLD, title, description: description + url, footer: { text: d.name } }] });
}

// ---------- session reminders ----------

const ts = (iso: string, style = "F") => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;

export function discordSessionAnnounce(campaignId: number) {
  const c = one("SELECT name, discord_webhook, next_session_at, session_note, session_weekly FROM campaigns WHERE id = ?", campaignId);
  if (!c?.discord_webhook || !c.next_session_at) return;
  void sendWebhook(c.discord_webhook, {
    embeds: [{
      color: GOLD,
      title: `📅 Next session of ${c.name}`,
      description: `${ts(c.next_session_at)} (${ts(c.next_session_at, "R")})${c.session_weekly ? "\nRepeats every week." : ""}${c.session_note ? `\n\n${c.session_note}` : ""}`,
    }],
  });
}

/** Called every minute: sends 1-day, 1-hour and "starting now" reminders. */
export function checkSessionReminders() {
  const now = Date.now();
  for (const c of all("SELECT id, name, discord_webhook, next_session_at, session_note, session_weekly, reminders_sent FROM campaigns WHERE next_session_at IS NOT NULL")) {
    const start = new Date(c.next_session_at).getTime();
    if (!Number.isFinite(start)) continue;
    const sent = new Set(parseJSON<string[]>(c.reminders_sent, []));
    const key = (k: string) => `${c.next_session_at}|${k}`;
    const steps: [string, number, string][] = [
      ["day", 24 * 3600e3, `⏰ Reminder: **${c.name}** is tomorrow, ${ts(c.next_session_at, "t")} your time.`],
      ["hour", 3600e3, `⏰ **${c.name}** starts ${ts(c.next_session_at, "R")}! Grab your dice and snacks.`],
      ["now", 0, `🍺 **${c.name}** is starting now! @everyone, hop into voice and open the table.`],
    ];
    let changed = false;
    for (const [k, before, text] of steps) {
      // Send each reminder once, only within 30 minutes of when it was due (so a late server start doesn't spam).
      if (!sent.has(key(k)) && now >= start - before && now < start - before + 30 * 60e3) {
        if (c.discord_webhook) void sendWebhook(c.discord_webhook, { content: text + (k === "day" && c.session_note ? `\n> ${c.session_note}` : ""), pingEveryone: k === "now" });
        sent.add(key(k));
        changed = true;
      }
    }
    // Weekly games roll forward to next week once the session has started.
    if (c.session_weekly && now > start + 60 * 60e3) {
      const next = new Date(start + 7 * 24 * 3600e3).toISOString();
      run("UPDATE campaigns SET next_session_at = ?, reminders_sent = '[]' WHERE id = ?", next, c.id);
      continue;
    }
    if (changed) run("UPDATE campaigns SET reminders_sent = ? WHERE id = ?", JSON.stringify([...sent].slice(-20)), c.id);
  }
}

export function startDiscordScheduler() {
  setInterval(() => {
    try { checkSessionReminders(); } catch (e) { console.error("reminder check failed", e); }
  }, 60e3);
}
