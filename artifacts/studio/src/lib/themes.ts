export type ThemeId =
  | "dojo-dark"
  | "neon-control-room"
  | "lo-fi-smoke"
  | "classic-console";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  vars: Record<string, string>;
}

export const THEMES: ThemeDef[] = [
  {
    id: "dojo-dark",
    name: "Dojo Dark",
    description: "Default cyber-ninja control-room. Black, red, electric blue.",
    vars: {
      "--background": "0 0% 5%",
      "--foreground": "0 0% 96%",
      "--graphite": "0 0% 9%",
      "--graphite-2": "0 0% 13%",
      "--blood": "0 78% 48%",
      "--neon": "195 100% 55%",
      "--card": "0 0% 8%",
      "--card-foreground": "0 0% 96%",
      "--popover": "0 0% 7%",
      "--popover-foreground": "0 0% 96%",
      "--primary": "0 78% 48%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "0 0% 14%",
      "--secondary-foreground": "0 0% 96%",
      "--muted": "0 0% 12%",
      "--muted-foreground": "0 0% 62%",
      "--accent": "0 0% 16%",
      "--accent-foreground": "0 0% 96%",
      "--destructive": "0 78% 48%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "0 0% 16%",
      "--input": "0 0% 16%",
      "--ring": "0 78% 48%",
    },
  },
  {
    id: "neon-control-room",
    name: "Neon Control Room",
    description: "Cooler, bluer chrome with magenta accents.",
    vars: {
      "--background": "230 30% 6%",
      "--foreground": "200 20% 96%",
      "--graphite": "230 28% 10%",
      "--graphite-2": "230 28% 14%",
      "--blood": "320 90% 58%",
      "--neon": "180 100% 60%",
      "--card": "230 28% 9%",
      "--card-foreground": "200 20% 96%",
      "--popover": "230 28% 8%",
      "--popover-foreground": "200 20% 96%",
      "--primary": "320 90% 58%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "230 25% 15%",
      "--secondary-foreground": "200 20% 96%",
      "--muted": "230 25% 13%",
      "--muted-foreground": "210 15% 70%",
      "--accent": "230 25% 18%",
      "--accent-foreground": "200 20% 96%",
      "--destructive": "0 84% 60%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "230 25% 18%",
      "--input": "230 25% 18%",
      "--ring": "320 90% 58%",
    },
  },
  {
    id: "lo-fi-smoke",
    name: "Lo-Fi Smoke",
    description: "Warm sepia smoke, amber accents, calmer contrast.",
    vars: {
      "--background": "30 12% 8%",
      "--foreground": "30 20% 92%",
      "--graphite": "28 12% 12%",
      "--graphite-2": "28 12% 16%",
      "--blood": "20 90% 55%",
      "--neon": "40 90% 65%",
      "--card": "28 12% 11%",
      "--card-foreground": "30 20% 92%",
      "--popover": "28 12% 10%",
      "--popover-foreground": "30 20% 92%",
      "--primary": "20 90% 55%",
      "--primary-foreground": "30 10% 10%",
      "--secondary": "28 12% 18%",
      "--secondary-foreground": "30 20% 92%",
      "--muted": "28 12% 16%",
      "--muted-foreground": "30 15% 65%",
      "--accent": "28 12% 20%",
      "--accent-foreground": "30 20% 92%",
      "--destructive": "0 70% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "28 12% 22%",
      "--input": "28 12% 22%",
      "--ring": "20 90% 55%",
    },
  },
  {
    id: "classic-console",
    name: "Classic Console",
    description: "Slate-gray analog desk with green VU vibes.",
    vars: {
      "--background": "215 15% 12%",
      "--foreground": "210 20% 95%",
      "--graphite": "215 15% 16%",
      "--graphite-2": "215 15% 20%",
      "--blood": "0 70% 50%",
      "--neon": "140 70% 55%",
      "--card": "215 15% 14%",
      "--card-foreground": "210 20% 95%",
      "--popover": "215 15% 12%",
      "--popover-foreground": "210 20% 95%",
      "--primary": "140 70% 45%",
      "--primary-foreground": "0 0% 5%",
      "--secondary": "215 15% 22%",
      "--secondary-foreground": "210 20% 95%",
      "--muted": "215 15% 18%",
      "--muted-foreground": "215 12% 70%",
      "--accent": "215 15% 24%",
      "--accent-foreground": "210 20% 95%",
      "--destructive": "0 70% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "215 15% 26%",
      "--input": "215 15% 26%",
      "--ring": "140 70% 45%",
    },
  },
];

const STORAGE_KEY = "studio.theme";

export function getStoredThemeId(): ThemeId {
  if (typeof localStorage === "undefined") return "dojo-dark";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  return "dojo-dark";
}

export function applyTheme(id: ThemeId) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute("data-theme", theme.id);
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    /* quota */
  }
}
