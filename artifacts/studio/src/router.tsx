import { Switch, Route, useLocation } from "wouter";
import { lazy, Suspense, useEffect } from "react";

const StudioApp = lazy(() => import("./App"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const ChangelogPage = lazy(() => import("./pages/ChangelogPage"));
const CreditsPage = lazy(() => import("./pages/CreditsPage"));
const PressPage = lazy(() => import("./pages/PressPage"));

function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="font-mono text-xs uppercase tracking-[0.4em] text-primary animate-pulse">
        Loading…
      </div>
    </div>
  );
}

function RedirectToHome() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}

export function AppRouter() {
  return (
    <Switch>
      <Route path="/">
        <Suspense fallback={<PageLoader />}>
          <LandingPage />
        </Suspense>
      </Route>
      <Route path="/studio">
        <Suspense fallback={<PageLoader />}>
          <StudioApp />
        </Suspense>
      </Route>
      <Route path="/changelog">
        <Suspense fallback={<PageLoader />}>
          <ChangelogPage />
        </Suspense>
      </Route>
      <Route path="/credits">
        <Suspense fallback={<PageLoader />}>
          <CreditsPage />
        </Suspense>
      </Route>
      <Route path="/press">
        <Suspense fallback={<PageLoader />}>
          <PressPage />
        </Suspense>
      </Route>
      <Route>
        <RedirectToHome />
      </Route>
    </Switch>
  );
}
