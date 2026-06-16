import "./lib/performance/listenerTrace";
import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { Router } from "wouter";
import { AppRouter } from "./router";
import "./index.css";
import { disposePwaRuntime, initPwa } from "./lib/pwa";
import { perfMark } from "./utils/performanceDiagnostics";
import { installFirstPlayTrace, uninstallFirstPlayTrace } from "./lib/performance/firstPlayTrace";
import { uninstallListenerTrace } from "./lib/performance/listenerTrace";

perfMark("app-startup:main-entry");
installFirstPlayTrace();
initPwa();

function Loading() {
  return (
    <div className="h-full flex items-center justify-center bg-background text-foreground">
      <div className="font-mono text-xs uppercase tracking-[0.4em] text-primary animate-pulse">
        Loading Studio…
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <Router>
    <Suspense fallback={<Loading />}>
      <AppRouter />
    </Suspense>
  </Router>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposePwaRuntime();
    uninstallListenerTrace();
    uninstallFirstPlayTrace();
    void import("./lib/audio/engine").then(({ audio }) => audio.dispose());
  });
}
