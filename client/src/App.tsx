import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { go, StatusContext, useRoute, type Status } from "./hooks";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { CampaignPage } from "./pages/Campaign";
import { CharacterPage } from "./pages/CharacterSheet";
import { Account } from "./pages/Account";

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const route = useRoute();

  const refresh = useCallback(() => {
    api.get<Status>("/status").then(setStatus).catch(() => setStatus({ needsSetup: false, aiEnabled: false, aiModel: "", user: null }));
  }, []);
  useEffect(refresh, [refresh]);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg((cur) => (cur === m ? "" : cur)), 3500);
  }, []);

  if (!status) return <div className="center-page muted">Opening the tavern doors...</div>;

  let page;
  if (!status.user) page = <Login />;
  else if (route[0] === "c" && route[1]) page = <CampaignPage key={route[1]} id={Number(route[1])} tab={route[2] ?? "table"} sub={route[3]} />;
  else if (route[0] === "character" && route[1]) page = <div className="page"><CharacterPage id={Number(route[1])} /></div>;
  else if (route[0] === "account") page = <Account />;
  else page = <Home />;

  return (
    <StatusContext.Provider value={{ status, refresh, toast }}>
      <div className="app">
        {status.user && (
          <div className="topbar">
            <span className="brand" onClick={() => go("")}>🍺 The Grumbling Gnoll</span>
            <span className="spacer" />
            <button className="link" onClick={() => go("account")}>{status.user.display_name}</button>
            <button className="small" onClick={() => api.post("/logout").then(() => { location.hash = ""; refresh(); })}>Log out</button>
          </div>
        )}
        <div className="fill">{page}</div>
      </div>
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </StatusContext.Provider>
  );
}
