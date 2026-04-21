import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import App from "./App";
import "./index.css";

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
  <Suspense fallback={<Loading />}>
    <App />
  </Suspense>,
);
