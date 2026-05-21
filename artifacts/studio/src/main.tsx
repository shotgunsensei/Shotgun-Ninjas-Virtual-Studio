import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { Router } from "wouter";
import { AppRouter } from "./router";
import "./index.css";
import { initPwa } from "./lib/pwa";

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
