import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { announceRoll } from "./components/DiceTray";

export interface Token {
  id: number; name: string; x: number; y: number; size: number; color: string; imageUrl: string | null;
  characterId: number | null; controlledBy: number | null; hidden: boolean; hp: number | null; maxHp: number | null; conditions: string;
}
export interface FogShape { mode: "reveal" | "hide"; kind: "circle" | "rect" | "poly" | "all"; x: number; y: number; r: number; w: number; h: number; points?: number[] }
export interface MapState {
  id: number; name: string; imageUrl: string | null; generated: any; width: number; height: number;
  gridType: "square" | "hex" | "none"; gridSize: number; gridOffsetX: number; gridOffsetY: number; feetPerCell: number;
  fogEnabled: boolean; fog: FogShape[]; dmKey?: string; tokens: Token[];
}
export interface ChatMsg { id: number; userId: number | null; name: string; kind: string; body: any; whisperTo: number | null; createdAt: string }
export interface InitEntry { id: number; name: string; init: number | null; dex?: number; hidden?: boolean; ownerId: number; tokenId?: number | null }
export interface Initiative { round: number; turn: number; entries: InitEntry[] }
export interface Ping { x: number; y: number; name: string; at: number }

/** One live connection per open campaign. Keeps map, chat, initiative and who's online up to date. */
export function useCampaignSocket(campaignId: number, onToast: (m: string) => void) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [map, setMap] = useState<MapState | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [initiative, setInitiative] = useState<Initiative>({ round: 1, turn: 0, entries: [] });
  const [presence, setPresence] = useState<{ id: number; name: string }[]>([]);
  const [pings, setPings] = useState<Ping[]>([]);
  const [connected, setConnected] = useState(false);
  const [changed, setChanged] = useState<{ what: string; at: number }>({ what: "", at: 0 });
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  useEffect(() => {
    const s = io({ transports: ["websocket", "polling"] });
    setSocket(s);
    s.on("connect", () => { setConnected(true); s.emit("join", campaignId); });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (e) => toastRef.current(e.message));
    s.on("map", setMap);
    s.on("token:moved", (p: { id: number; x: number; y: number }) =>
      setMap((m) => (m ? { ...m, tokens: m.tokens.map((t) => (t.id === p.id ? { ...t, x: p.x, y: p.y } : t)) } : m)));
    s.on("fog", (fog: FogShape[]) => setMap((m) => (m ? { ...m, fog } : m)));
    s.on("chatHistory", setChat);
    s.on("chat", (msg: ChatMsg) => {
      setChat((c) => [...c.slice(-300), msg]);
      if (msg.kind === "roll") announceRoll({ name: msg.name, body: msg.body });
    });
    s.on("initiative", setInitiative);
    s.on("presence", setPresence);
    s.on("toast", (m: string) => toastRef.current(m));
    s.on("changed", (what: string) => setChanged({ what, at: Date.now() }));
    s.on("ping", (p: Omit<Ping, "at">) => {
      const ping = { ...p, at: Date.now() };
      setPings((ps) => [...ps, ping]);
      setTimeout(() => setPings((ps) => ps.filter((x) => x !== ping)), 2500);
    });
    return () => { s.disconnect(); };
  }, [campaignId]);

  return { socket, map, chat, initiative, presence, pings, connected, changed };
}

export type CampaignSocket = ReturnType<typeof useCampaignSocket>;
