import { useEffect, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSettings, setSettings } from "../lib/settings";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import { useTransport } from "../hooks/useTransport";

const LESSONS = [
  { title: "Meet your studio", concept: "A DAW is a music studio on your screen. Tracks are layers of sound, like drums, bass, and a tune.", task: "Start with your volume low. Enable audio so the browser can make sound.", action: "Enable audio", target: "audio" },
  { title: "Make a beat", concept: "A beat is a repeating rhythm. The kick is the low thump, the snare is the snap, and the hi-hat is the tick.", task: "Try a starter beat, or tap a few squares in the beat grid. A lit square means a drum will play. Tap it again to remove it.", action: "Show beat maker", target: "beat" },
  { title: "Listen and change", concept: "Tempo is the speed of your music, measured in beats per minute (BPM). A loop repeats part of your music.", task: "Press Play, then change the speed or one drum square. Listen for the difference. Stop returns to the beginning; Panic cuts all sound.", action: "Play my music", target: "listen" },
  { title: "Add a tune", concept: "A melody is a line of notes you can hum. Bass notes are low sounds that support the beat.", task: "Add a bass or melody idea, then change a note. Leave some empty space so each sound can be heard.", action: "Show notes", target: "melody" },
  { title: "Build a song", concept: "A bar is a small group of beats. A clip is a block of music. An arrangement is the order of those blocks.", task: "Repeat a clip to make your idea longer. Try a quiet opening, then bring the drums in. Switch to Advanced to move and trim clips on the timeline.", action: "Show song builder", target: "arrange" },
  { title: "Balance your sounds", concept: "Mixing means helping your sounds work together. Volume changes loudness; mute lets you listen without one layer.", task: "Play your music. Lower a loud track, then mute and unmute it. Aim to hear both the beat and your tune clearly.", action: "Show sound levels", target: "mix" },
  { title: "Keep and share your music", concept: "Save keeps an editable project in this browser. Export downloads a file: WAV or MP3 to listen, or project JSON to edit again.", task: "Give your song a name, click Save, and wait for “Project saved”. Then Export a WAV or MP3. Download a project JSON backup too: clearing browser data can erase local saves.", action: "Open export", target: "save" },
] as const;

/** Self-paced and nonmodal: no polling, audio nodes, or project mutations. */
export function GuidedTutor({ phone = false }: { phone?: boolean }) {
  const step = useSettings((s) => s.tutorStep);
  const basic = useSettings((s) => s.uiMode === "beginner");
  const audioUnlocked = useStore((s) => s.audioUnlocked);
  const { play } = useTransport();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const lesson = LESSONS[step];
  const phoneAdvanced = phone && !basic;
  const practiceInBasic = phoneAdvanced && (lesson?.target === "beat" || lesson?.target === "melody" || lesson?.target === "arrange");
  const phoneTasks: Partial<Record<(typeof LESSONS)[number]["target"], string>> = {
    beat: "Choose Basic above to edit a repeating beat in the step grid. In Advanced on a phone, select a drum track to play its pads. The full Inspector is available on a larger screen.",
    listen: "Press Play, then change BPM to hear your music at a different speed. Stop returns to the beginning; Panic cuts all sound.",
    melody: "Choose Basic above to add a bass or melody idea and edit its notes. In Advanced on a phone, select an instrument track to play it. The piano roll is available on a larger screen.",
    arrange: "Choose Basic above and use Repeat song to make your idea longer. The full Advanced timeline for moving and trimming clips is available on a larger screen.",
    mix: "Play your music, then tap Mixer at the bottom of the screen. Lower a loud track, then mute and unmute it. Aim to hear both the beat and your tune clearly.",
    save: "Name your song at the top, then open Menu → Save and wait for “Project saved”. Tap Export at the bottom to download WAV or MP3 and a project JSON backup. Clearing browser data can erase local saves.",
  };
  const task = lesson && (phoneAdvanced && phoneTasks[lesson.target]
    || (!basic && step === 1 ? "Select a drum track and open Inspector. In the step grid, tap a square to add a hit; tap again to remove it."
      : !basic && step === 3 ? "Select a piano or bass track and open Inspector. Add notes in its piano roll, or use Learn → The Dojo for an editable idea."
        : lesson.task));

  useEffect(() => {
    setFeedback("");
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === lesson?.target) setFeedback("Change made. Listen to it, then continue when you’re ready.");
    };
    window.addEventListener("studio:learning-action", onAction);
    return () => window.removeEventListener("studio:learning-action", onAction);
  }, [lesson]);

  const showTask = async () => {
    if (!lesson || busy) return;
    setBusy(true);
    try {
      if (lesson.target === "audio") {
        await audio.unlock();
        getStore().set({ audioUnlocked: true });
      } else if (lesson.target === "listen") {
        await play();
      } else if (lesson.target === "save") {
        window.dispatchEvent(new CustomEvent("studio:open-export"));
      } else if (practiceInBasic) {
        setSettings({ uiMode: "beginner" });
      } else if (phoneAdvanced) {
        setFeedback("Tap Mixer at the bottom of the screen to adjust your tracks' levels and mute controls.");
      } else if (basic) {
        window.dispatchEvent(new CustomEvent("studio:show-basic-task", { detail: { task: lesson.target } }));
        document.querySelector<HTMLElement>(`[data-learning-target="${lesson.target}"]`)?.scrollIntoView({ block: "nearest" });
      } else {
        setFeedback(lesson.target === "arrange" ? "Use the timeline: select a clip, then duplicate or drag it to a new position." : "Select a track in Tracks. Open Inspector to edit its notes, or Mixer to adjust its level. For more practice, open Learn → Lessons.");
      }
    } catch (err) {
      setFeedback(`Could not start: ${(err as Error).message}. You can try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside aria-label="Studio tutor" data-testid="guided-tutor" className="shrink-0 border-b border-primary/25 bg-primary/5 px-4 py-3">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4 text-primary-readable" />
            {lesson ? `Tutor · ${step + 1} of ${LESSONS.length}: ${lesson.title}` : "Your first studio tour is complete"}
          </div>
          <button type="button" onClick={() => setSettings({ tutorEnabled: false })} className="flex min-h-9 shrink-0 items-center gap-1 rounded px-2 text-xs hover:bg-accent" aria-label="Turn tutor off"><X className="h-4 w-4" /> Tutor off</button>
        </div>
        {lesson ? <>
          <p className="mt-1 text-sm text-foreground/90">{lesson.concept}</p>
          <p className="mt-1 text-sm text-muted-foreground">{task}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => void showTask()} disabled={busy || (step === 0 && audioUnlocked)} className="min-h-9 rounded-md border border-primary/40 px-3 text-sm hover:bg-primary/10 disabled:opacity-60">{step === 0 && audioUnlocked ? "Audio is ready" : practiceInBasic ? "Practice in Basic" : lesson.action}</button>
            <div className="flex items-center gap-1">
              <button type="button" disabled={step === 0} onClick={() => setSettings({ tutorStep: step - 1 })} className="flex min-h-9 items-center rounded px-2 text-sm hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Back</button>
              <button type="button" onClick={() => setSettings({ tutorStep: step + 1 })} className="flex min-h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground">{step === LESSONS.length - 1 ? "Finish tutor" : "Next lesson"}<ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          {feedback && <p role="status" className="mt-2 text-sm text-primary-readable">{feedback}</p>}
        </> : <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Keep experimenting. {phoneAdvanced ? "Menu" : "Learn"} has more lessons and The Dojo offers ideas when you ask.</p>
          <button type="button" className="min-h-9 rounded-md border border-border px-3 text-sm" onClick={() => setSettings({ tutorStep: 0 })}>Restart tutor</button>
        </div>}
      </div>
    </aside>
  );
}
