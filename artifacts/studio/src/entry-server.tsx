import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import LandingPage from "./pages/LandingPage";

export function render(url: string): string {
  // Provide a no-op static location hook so wouter has a current path
  // without needing a browser environment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useStaticLocation = () => [url, () => {}] as any;
  return renderToStaticMarkup(
    <Router hook={useStaticLocation}>
      <LandingPage />
    </Router>
  );
}
