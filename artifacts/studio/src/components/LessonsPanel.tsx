import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GraduationCap, ChevronLeft, ChevronRight, X } from "lucide-react";

interface LessonStep {
  instruction: string;
  /** CSS selector or data-testid of the element to highlight */
  highlight?: string;
  /** Human-readable label for the highlight target */
  highlightLabel?: string;
}

interface Lesson {
  title: string;
  summary: string;
  steps: LessonStep[];
}

const LESSONS: Lesson[] = [
  {
    title: "Your First Beat",
    summary: "Place your first kick, snare, and hi-hat to build a beat.",
    steps: [
      {
        instruction:
          "Welcome! First, make sure you have a Drums track. Look at the left sidebar for a track labeled 'Drums'. Click it to select it.",
      },
      {
        instruction:
          "With the Drums track selected, look for the drum pads grid in the main area. You'll see rows for Kick, Snare, Hi-hat and more.",
      },
      {
        instruction:
          "Click the first square in the Kick row to place a kick on beat 1. Then click squares 5 and 13 in the Snare row (beats 2 and 4). You have a basic pattern!",
      },
      {
        instruction:
          "Add some hi-hats by clicking every other square in the Hat row for a classic straight 8ths groove.",
      },
      {
        instruction:
          "Press the Play button in the transport bar (or press Space) to hear your beat loop. Press Space again to stop. Congratulations — you made a beat!",
        highlight: "[aria-label='Play'], [aria-label='Pause']",
        highlightLabel: "Play/Pause button",
      },
    ],
  },
  {
    title: "Using the Mixer",
    summary: "Adjust volume and pan to balance your tracks in the mix.",
    steps: [
      {
        instruction:
          "The mixer lives at the bottom of the screen — a row of channel strips, one per track plus a Master strip on the right.",
      },
      {
        instruction:
          "Each strip has a Volume slider (labeled 'VOL' with a speaker icon). Drag it left to lower the track's volume or right to raise it.",
      },
      {
        instruction:
          "Below the volume slider is the PAN control. Drag it left to push the sound toward the left speaker, right to push it right. Center is balanced.",
      },
      {
        instruction:
          "Try muting a track by pressing the M button on its strip — the track goes silent. Press S on another track to solo it so only that track plays.",
      },
      {
        instruction:
          "The Master strip (far right) controls the overall output level. Keep it below 0 dBFS on the meter — if the meter turns red you're clipping.",
        highlight: "[data-testid='master-strip']",
        highlightLabel: "Master strip",
      },
    ],
  },
  {
    title: "BPM & Swing Explained",
    summary: "Change the tempo and add groove with swing.",
    steps: [
      {
        instruction:
          "BPM (Beats Per Minute) sets how fast your track plays. Find the BPM input in the transport bar at the top — it's the number next to 'BPM'.",
        highlight: "input[aria-label='BPM'], input[type='number']",
        highlightLabel: "BPM input",
      },
      {
        instruction:
          "Try typing 90 for a slow hip-hop feel, or 128 for a dance-floor house tempo. Press Enter or click Play to hear the difference.",
      },
      {
        instruction:
          "Swing adds a shuffle feel — every other 16th note is delayed slightly. Find the Swing slider in the transport bar next to the BPM field.",
        highlight: "[aria-label*='Swing'], .swing-slider",
        highlightLabel: "Swing slider",
      },
      {
        instruction:
          "Drag the Swing slider to about 60–70% while the track plays. You'll hear the beat lean back and groove instead of feeling stiff.",
      },
      {
        instruction:
          "Set Swing back to 0% for a tight, mechanical sound, or leave it at 50–70% for that classic hip-hop or jazz feel. Your call!",
      },
    ],
  },
  {
    title: "Effects Basics",
    summary: "Add reverb and delay to make your tracks sound bigger.",
    steps: [
      {
        instruction:
          "Select a track by clicking its channel strip. Then look for the FX button at the bottom of that strip — click it to open the effects rack.",
        highlight: "[data-testid^='fx-open']",
        highlightLabel: "FX button",
      },
      {
        instruction:
          "In the right-hand inspector panel, find 'Reverb'. Toggle the switch next to it to turn reverb on. You'll hear the track sound more spacious.",
      },
      {
        instruction:
          "The 'Amount' or 'Wet' knob controls how much reverb is applied. A little reverb adds depth; too much makes things muddy.",
      },
      {
        instruction:
          "Try adding Delay next. Delay echoes the sound at a tempo-synced rate. Keep the mix low (under 30%) so it doesn't overpower the dry signal.",
      },
      {
        instruction:
          "Remember: less is more with effects on individual tracks. Save the heavy reverb for a send bus so multiple tracks share the same space.",
      },
    ],
  },
  {
    title: "Exporting Your Track",
    summary: "Bounce your finished track to a WAV or MP3 file.",
    steps: [
      {
        instruction:
          "When your track is ready, click the Export button in the header bar (or press B). The Export dialog will open.",
        highlight: "[aria-label*='Export'], button:has([data-icon='download'])",
        highlightLabel: "Export button",
      },
      {
        instruction:
          "At the top of the Export dialog you'll see the export range — this defaults to the full project. You can also enable Loop in the transport to set a custom range.",
      },
      {
        instruction:
          "Choose your format: WAV for full quality (best for sending to other DAWs), MP3 for sharing online, or MIDI to export just the note data.",
      },
      {
        instruction:
          "The dialog shows the estimated file size and duration before you start. Make sure the range covers all your music.",
      },
      {
        instruction:
          "Click 'Export' or 'Download' and the file will be saved to your computer. You're done — share your track with the world!",
      },
    ],
  },
];

interface LessonsPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function LessonsPanel({ open, onOpenChange }: LessonsPanelProps) {
  const [lessonIdx, setLessonIdx] = useState<number | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const highlightCleanupRef = useRef<(() => void) | null>(null);

  function clearHighlight() {
    if (highlightCleanupRef.current) {
      highlightCleanupRef.current();
      highlightCleanupRef.current = null;
    }
  }

  function applyHighlight(selector?: string) {
    clearHighlight();
    if (!selector) return;
    try {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return;
      el.classList.add("lesson-highlight");
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      highlightCleanupRef.current = () => {
        el.classList.remove("lesson-highlight");
      };
    } catch {
      /* bad selector — ignore */
    }
  }

  const currentLesson = lessonIdx !== null ? LESSONS[lessonIdx] : null;
  const currentStep = currentLesson?.steps[stepIdx];

  useEffect(() => {
    if (currentStep?.highlight) {
      applyHighlight(currentStep.highlight);
    } else {
      clearHighlight();
    }
    return () => clearHighlight();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonIdx, stepIdx]);

  useEffect(() => {
    if (!open) {
      clearHighlight();
      setLessonIdx(null);
      setStepIdx(0);
    }
  }, [open]);

  function startLesson(idx: number) {
    setLessonIdx(idx);
    setStepIdx(0);
  }

  function goNext() {
    if (!currentLesson) return;
    if (stepIdx < currentLesson.steps.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      // Lesson complete — go back to lesson list
      clearHighlight();
      setLessonIdx(null);
      setStepIdx(0);
    }
  }

  function goBack() {
    if (stepIdx > 0) {
      setStepIdx(stepIdx - 1);
    } else {
      clearHighlight();
      setLessonIdx(null);
      setStepIdx(0);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        aria-label="Interactive lessons"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" />
            Lessons
          </DialogTitle>
          <DialogDescription>
            Short interactive guides to get you up and running.
          </DialogDescription>
        </DialogHeader>

        {lessonIdx === null ? (
          /* Lesson list */
          <div className="space-y-2" role="list" aria-label="Available lessons">
            {LESSONS.map((lesson, i) => (
              <button
                key={lesson.title}
                type="button"
                role="listitem"
                onClick={() => startLesson(i)}
                className="w-full text-left border border-border rounded-md p-3 hover:bg-accent/40 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-[10px] text-muted-foreground w-4 shrink-0">
                    {i + 1}
                  </span>
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {lesson.title}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug ml-6">
                  {lesson.summary}
                </p>
              </button>
            ))}
          </div>
        ) : (
          /* Lesson step view */
          <div className="space-y-4">
            {/* Lesson title + progress */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {currentLesson!.title}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {stepIdx + 1} / {currentLesson!.steps.length}
                </span>
              </div>
              {/* Progress bar */}
              <div
                className="h-1 bg-border rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={stepIdx + 1}
                aria-valuemin={1}
                aria-valuemax={currentLesson!.steps.length}
                aria-label={`Step ${stepIdx + 1} of ${currentLesson!.steps.length}`}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${((stepIdx + 1) / currentLesson!.steps.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Step instruction */}
            <div
              className="border border-border rounded-md p-4 bg-background/60 min-h-[100px]"
              aria-live="polite"
              aria-atomic="true"
            >
              <p className="text-sm leading-relaxed">
                {currentStep?.instruction}
              </p>
              {currentStep?.highlightLabel && (
                <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                  ↑ Highlighted: {currentStep.highlightLabel}
                </p>
              )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="outline"
                onClick={goBack}
                className="font-mono text-xs gap-1"
                aria-label={stepIdx === 0 ? "Back to lesson list" : "Previous step"}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                {stepIdx === 0 ? "Lessons" : "Back"}
              </Button>

              <Button
                size="sm"
                variant={stepIdx === currentLesson!.steps.length - 1 ? "default" : "outline"}
                onClick={goNext}
                className="font-mono text-xs gap-1"
                aria-label={
                  stepIdx === currentLesson!.steps.length - 1
                    ? "Finish lesson"
                    : "Next step"
                }
              >
                {stepIdx === currentLesson!.steps.length - 1 ? (
                  <>
                    Done <X className="w-3.5 h-3.5" />
                  </>
                ) : (
                  <>
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
