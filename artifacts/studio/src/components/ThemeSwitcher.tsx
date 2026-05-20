import { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEMES, applyTheme, getStoredThemeId, type ThemeId } from "../lib/themes";

export function ThemeSwitcher() {
  const [active, setActive] = useState<ThemeId>(getStoredThemeId());
  useEffect(() => {
    applyTheme(active);
  }, [active]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-border bg-background/40 font-mono text-[11px] uppercase tracking-wider hover:bg-accent/40"
          aria-label="Theme switcher"
          title="Theme"
        >
          <Palette className="w-3.5 h-3.5" />
          <span className="hidden md:inline">
            {THEMES.find((t) => t.id === active)?.name ?? "Theme"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`flex flex-col items-start gap-0.5 cursor-pointer ${
              active === t.id ? "bg-primary/10 text-primary" : ""
            }`}
          >
            <span className="font-mono text-xs uppercase tracking-wider">
              {t.name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
