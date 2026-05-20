import { useEffect, useState } from "react";
import { Download, Share, WifiOff, Check } from "lucide-react";
import { promptInstall, usePwa } from "../lib/pwa";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const IOS_HINT_DISMISS_KEY = "studio.pwa.iosHintDismissed";

/** Install button for the header. Renders nothing when the install
 * prompt isn't available and the user isn't on iOS Safari, or once the
 * app is already running standalone. */
export function PwaInstallControls() {
  const { installAvailable, iosInstallHint, installed } = usePwa();
  const [iosOpen, setIosOpen] = useState(false);
  const [iosDismissed, setIosDismissed] = useState(false);

  useEffect(() => {
    try {
      setIosDismissed(localStorage.getItem(IOS_HINT_DISMISS_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  if (installed) return null;

  if (installAvailable) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void promptInstall();
        }}
        className="h-8 gap-1.5 font-mono text-[11px] uppercase tracking-wider"
        title="Install Shotgun Ninjas Virtual Studio"
      >
        <Download className="w-3.5 h-3.5" />
        Install App
      </Button>
    );
  }

  if (iosInstallHint && !iosDismissed) {
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIosOpen(true)}
          className="h-8 gap-1.5 font-mono text-[11px] uppercase tracking-wider"
          title="Add Shotgun Ninjas Virtual Studio to your Home Screen"
        >
          <Share className="w-3.5 h-3.5" />
          Add to Home Screen
        </Button>
        <Dialog open={iosOpen} onOpenChange={setIosOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Install on iPhone or iPad</DialogTitle>
              <DialogDescription>
                Safari doesn't show a built-in install prompt. Add the
                studio to your Home Screen in two taps:
              </DialogDescription>
            </DialogHeader>
            <ol className="text-sm space-y-2 list-decimal pl-5 text-foreground">
              <li>
                Tap the <span className="font-semibold">Share</span> icon
                in the Safari toolbar.
              </li>
              <li>
                Choose{" "}
                <span className="font-semibold">Add to Home Screen</span>,
                then tap Add.
              </li>
            </ol>
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  try {
                    localStorage.setItem(IOS_HINT_DISMISS_KEY, "1");
                  } catch {
                    /* ignore */
                  }
                  setIosDismissed(true);
                  setIosOpen(false);
                }}
              >
                Don't show again
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return null;
}

/** Compact "Offline Ready" badge for the transport bar. Hidden until
 * the service worker is actually controlling the page. */
export function OfflineReadyIndicator() {
  const { offlineReady } = usePwa();
  if (!offlineReady) return null;
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded border border-emerald-700/60 bg-emerald-900/30 text-emerald-300 font-mono text-[10px] uppercase tracking-widest"
      title="App shell cached — the studio will load without a network connection."
    >
      <WifiOff className="w-3 h-3" />
      <span className="hidden sm:inline">Offline</span>
      <Check className="w-3 h-3" />
    </div>
  );
}
