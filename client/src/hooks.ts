import { createContext, useCallback, useContext, useEffect, useState, type KeyboardEvent } from "react";
import { api } from "./api";

export interface User { id: number; username: string; display_name: string; is_admin: number; dice_style?: string }
export interface Status { needsSetup: boolean; aiEnabled: boolean; aiModel: string; user: User | null }

export const StatusContext = createContext<{ status: Status; refresh: () => void; toast: (m: string) => void }>(null!);
export const useStatus = () => useContext(StatusContext);

/** Load data from the server, with loading/error state and a reload function. */
export function useLoad<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    if (!url) return;
    setLoading(true);
    api
      .get<T>(url)
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

/** Simple hash-based routing: #/c/3/table -> ["c","3","table"] */
export function useRoute() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}
export const go = (path: string) => { location.hash = "#/" + path; };

/** Props that make a clickable card or table row work with the keyboard too (Tab, then Enter or Space). */
export function activate(fn: () => void) {
  return {
    tabIndex: 0,
    role: "link" as const,
    onClick: fn,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fn(); }
    },
  };
}
