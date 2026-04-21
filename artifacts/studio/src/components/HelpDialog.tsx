import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore, getStore } from "../store";
import { Logo } from "./Logo";

export function HelpDialog() {
  const showHelp = useStore((s) => s.showHelp);
  const showOnboarding = useStore((s) => s.showOnboarding);
  const open = showHelp || showOnboarding;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) =>
        getStore().set(showOnboarding ? { showOnboarding: o } : { showHelp: o })
      }
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Logo className="w-7 h-7" />
            <div>
              <div className="text-base">Welcome to Shotgun Ninjas Virtual Studio</div>
              <div className="font-mono text-[10px] tracking-widest text-primary uppercase mt-0.5">
                Strike fast. Track loud.
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Section title="1 · Enable audio">
            Browsers require a tap before sound. Hit{" "}
            <span className="font-mono text-primary">Tap to Enable Audio</span>{" "}
            in the transport bar — or just press{" "}
            <Kbd>Space</Kbd> to play.
          </Section>
          <Section title="2 · Play">
            Press <Kbd>Space</Kbd> to play/pause. The seeded demo loops a
            4-bar progression with piano, guitar, drums, and bass.
          </Section>
          <Section title="3 · Pick a track and play it">
            Click a channel strip (bottom). On the right you'll see the
            performance UI — keyboard, drum pads, or the vocal panel.
          </Section>
          <Section title="4 · Record">
            Arm a track with the <Kbd>R</Kbd> button on its strip, then hit
            the red record button. Count-in counts you in. New takes replace
            the old clip on that track.
          </Section>
          <Section title="5 · MIDI">
            Open the MIDI panel (right side) and click <em>Enable MIDI</em>.
            Pick your controller — notes will play the selected track. Use
            the brain icons anywhere to map a knob/key to that control.
          </Section>
          <Section title="6 · Save">
            Save and reload anytime — projects (and vocal takes) persist in
            your browser via IndexedDB.
          </Section>
        </div>
        <div className="flex justify-end pt-2">
          <button
            onClick={() =>
              getStore().set({ showHelp: false, showOnboarding: false })
            }
            className="px-4 h-9 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest glow-red"
          >
            Let's go
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
        {title}
      </div>
      <div className="text-foreground/85">{children}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">
      {children}
    </kbd>
  );
}
