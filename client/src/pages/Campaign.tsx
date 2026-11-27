import { useEffect } from "react";
import { go, useLoad, useStatus } from "../hooks";
import { useCampaignSocket } from "../socket";
import { TableView } from "./Table";
import { CharactersTab } from "./Characters";
import { Approvals } from "./Approvals";
import { MapsTab } from "./Maps";
import { Compendium } from "./Compendium";
import { Assistant } from "./Assistant";
import { Converter } from "./Converter";
import { Settings } from "./Settings";
import { Adventures } from "./Adventures";
import { DiceTray } from "../components/DiceTray";

export interface Campaign {
  id: number; name: string; description: string; rulesVersion: "2014" | "2024"; dmUserId: number; dmName: string;
  activeMapId: number | null; dmNotes?: string; isDM: boolean;
  nextSessionAt: string | null; sessionNote: string; sessionWeekly: boolean;
  discord?: { webhook: string; dmWebhook: string; options: Record<string, boolean> };
  members: { id: number; username: string; displayName: string; role: string }[];
}

export function CampaignPage({ id, tab, sub }: { id: number; tab: string; sub?: string }) {
  const { toast } = useStatus();
  const live = useCampaignSocket(id, toast);
  const { data: campaign, error, reload } = useLoad<Campaign>(`/campaigns/${id}`);
  const approvals = useLoad<any[]>(campaign?.isDM ? `/campaigns/${id}/approvals` : null, [campaign?.isDM]);

  useEffect(() => {
    if (live.changed.what === "campaign") reload();
    if (live.changed.what === "approvals" || live.changed.what === "characters") approvals.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.changed]);

  if (error) return <div className="page"><div className="error">{error}</div></div>;
  if (!campaign) return <div className="page muted">Loading...</div>;

  const dm = campaign.isDM;
  const tabs: [string, string, number?][] = [
    ["table", "🎲 Table"],
    ["characters", "🧝 Characters"],
    ...(dm ? ([["approvals", "✅ Approvals", approvals.data?.length ?? 0]] as [string, string, number][]) : []),
    ...(dm ? ([["maps", "🗺️ Maps"], ["adventures", "📚 Adventures"]] as [string, string][]) : []),
    ["compendium", "📖 Compendium"],
    ...(dm ? ([["assistant", "🧙 AI Assistant"], ["convert", "🔄 Convert editions"]] as [string, string][]) : []),
    ["settings", dm ? "⚙️ Settings" : "ℹ️ About"],
  ];

  return (
    <>
      <DiceTray />
      <div className="tabs">
        <span className="brand" style={{ alignSelf: "center", marginRight: 12, whiteSpace: "nowrap" }}>{campaign.name}</span>
        {tabs.map(([k, label, count]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => go(`c/${id}/${k}`)}>
            {label}
            {!!count && <span className="badge">{count}</span>}
          </button>
        ))}
        <span style={{ marginLeft: "auto", alignSelf: "center" }} className="muted" title={live.presence.map((p) => p.name).join(", ")}>
          {live.connected ? `🟢 ${live.presence.length} online` : "🔴 reconnecting..."}
        </span>
      </div>
      {tab === "table" ? (
        <TableView campaign={campaign} live={live} />
      ) : (
        <div className="page">
          {tab === "characters" && <CharactersTab campaign={campaign} changed={live.changed} openId={sub} roll={(expr, label) => live.socket?.emit("roll", { expr, label })} />}
          {tab === "approvals" && dm && <Approvals campaign={campaign} data={approvals.data} reload={approvals.reload} />}
          {tab === "maps" && dm && <MapsTab campaign={campaign} live={live} onChange={reload} />}
          {tab === "adventures" && dm && <Adventures campaign={campaign} changed={live.changed} openId={sub} />}
          {tab === "compendium" && <Compendium campaign={campaign} changed={live.changed} />}
          {tab === "assistant" && dm && <Assistant campaign={campaign} />}
          {tab === "convert" && dm && <Converter campaign={campaign} changed={live.changed} />}
          {tab === "settings" && <Settings campaign={campaign} reload={reload} />}
        </div>
      )}
    </>
  );
}
