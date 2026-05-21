import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GraduationCap, ChevronLeft, ChevronRight, X, CheckCircle2 } from "lucide-react";

interface LessonStep {
  instruction: string;
  highlight?: string;
  highlightLabel?: string;
}

interface Lesson {
  title: string;
  summary: string;
  category: "beginner" | "intermediate";
  steps: LessonStep[];
}

const LESSONS: Lesson[] = [
  {
    title: "Your First Beat",
    summary: "Place your first kick, snare, and hi-hat to build a beat.",
    category: "beginner",
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
    category: "beginner",
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
    category: "beginner",
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
    category: "beginner",
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
    category: "beginner",
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

  /* ── Intermediate lessons ── */
  {
    title: "Sends & Return Tracks",
    summary: "Route multiple tracks through a shared reverb or delay bus.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "A 'send' lets you blend a copy of a track's signal into a shared effects bus — great for giving all your drums the same room reverb without duplicating the plugin.",
      },
      {
        instruction:
          "In the mixer, each channel strip has a SEND knob (often labeled 'SND' or shown as a row of small knobs). Turn it up to route some of that channel's signal to the return bus.",
        highlight: "[data-testid^='send-knob']",
        highlightLabel: "Send knob",
      },
      {
        instruction:
          "The return track (also called an Aux or FX bus) receives all those sends and applies one effect — for example, a single Reverb. Add Reverb to the return track and set its wet mix to 100%.",
      },
      {
        instruction:
          "Now raise the send amount on your Drums channel. You'll hear reverb on the drums but the original dry signal stays clean. Try adding the Snare's send too.",
      },
      {
        instruction:
          "Use different send amounts per track to control how much each sits in the reverb space. Kick usually gets little or none; pads and snare get more. This keeps the mix cohesive.",
      },
    ],
  },
  {
    title: "Building a Full Beat",
    summary: "Go from empty project to a complete 8-bar arrangement.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "Start with the drums. Lay down a 2-bar kick/snare/hat pattern in the drum grid. Aim for something simple — a steady kick on 1 and 3, snare on 2 and 4.",
      },
      {
        instruction:
          "Add a bass line. Create a new track (or use an existing synth track) and program a 2-bar bass pattern in the piano roll that follows your kick hits for a tight low-end.",
        highlight: "[data-testid='add-track'], [aria-label*='Add track']",
        highlightLabel: "Add Track button",
      },
      {
        instruction:
          "Duplicate the drum pattern to fill 8 bars — right-click the clip in the timeline and choose 'Duplicate', or drag while holding Alt/Option.",
        highlight: "[data-testid='timeline']",
        highlightLabel: "Timeline",
      },
      {
        instruction:
          "Add a chord or melody track. Use the piano roll to draw a chord every bar or two. Keep the chords high in the register so they don't clash with the bass.",
      },
      {
        instruction:
          "Review the arrangement: drums first, then bass enters on bar 3, chords on bar 5. Automate the master volume to fade in and you have a full intro-verse structure!",
      },
    ],
  },
  {
    title: "Piano Roll Patterns",
    summary: "Draw and edit melodic MIDI patterns in the piano roll.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "Double-click any clip in the timeline to open the piano roll editor. You'll see a grid — horizontal lines are pitches, the vertical axis is time.",
        highlight: "[data-testid='piano-roll'], [aria-label*='Piano roll']",
        highlightLabel: "Piano roll",
      },
      {
        instruction:
          "Click on the grid to draw a note. A short click creates a short note; click and drag to the right to make it longer. Try drawing a simple C–E–G chord by stacking three notes on the same beat.",
      },
      {
        instruction:
          "Right-click a note to delete it, or click and drag it to move it to a different pitch or time position. Hold Shift while dragging to snap to the grid.",
      },
      {
        instruction:
          "Use the velocity lane at the bottom of the piano roll. Taller bars mean louder notes. Click a bar and drag up or down to accent or soften individual notes.",
        highlight: "[data-testid='velocity-lane']",
        highlightLabel: "Velocity lane",
      },
      {
        instruction:
          "Try drawing a simple 4-note melody: C4 on beat 1, E4 on beat 2, G4 on beat 3, A4 on beat 4. Press Play to hear it loop. Now experiment — move notes up or down to find a melody you like!",
      },
    ],
  },
  {
    title: "EQ & Mixing Techniques",
    summary: "Use EQ to carve space and clarity in a busy mix.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "Every instrument occupies frequency space. When too many share the same range the mix gets muddy. EQ lets you cut unwanted frequencies from each track so they sit together cleanly.",
      },
      {
        instruction:
          "Select your bass track and open its FX rack. Add an EQ plugin. You'll see a frequency graph — the left side is bass, the right is treble.",
        highlight: "[data-testid^='fx-open']",
        highlightLabel: "FX / EQ button",
      },
      {
        instruction:
          "Apply a High-Pass Filter (HPF) to every non-bass track. Cut everything below 80–120 Hz — this removes rumble and gives the bass room to breathe.",
      },
      {
        instruction:
          "On the snare, try boosting around 2–5 kHz for snap and presence. Cut a narrow band around 400 Hz if it sounds boxy. Trust your ears more than your eyes.",
      },
      {
        instruction:
          "Solo tracks one by one and adjust, then listen to the full mix. A good mix sounds balanced on laptop speakers and headphones. If something sounds thin or boomy, use EQ to fix it before reaching for the volume fader.",
      },
    ],
  },
  {
    title: "Layering Drums for Punch",
    summary: "Stack samples on the same pad to create a thicker, punchier sound.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "Great drum sounds often come from layering two or three samples on the same hit — for example a punchy 808 sub kick layered under a snappy acoustic kick.",
      },
      {
        instruction:
          "In the drum grid, click the pad name (e.g. 'Kick') to open its sample settings. Look for a 'Layer' or '+' button to add a second sample to the same pad.",
        highlight: "[data-testid^='pad-settings'], [aria-label*='Pad settings']",
        highlightLabel: "Pad settings",
      },
      {
        instruction:
          "Choose a complementary sample — if your first kick is low and boomy, pick a second that's bright and clicky. Together they cover the full frequency range.",
      },
      {
        instruction:
          "Adjust the volume balance between layers. A common ratio is 70% sub / 30% click. You want the sub to feel like weight and the click to cut through headphones.",
      },
      {
        instruction:
          "Apply a short Attack and fast Release on a compressor over the layered kick to glue the two samples together. You should now feel the kick as one unified punch rather than two separate sounds.",
      },
    ],
  },
  {
    title: "Mastering Basics",
    summary: "Apply final polish to make your track loud and release-ready.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "Mastering is the final step before sharing or distributing your track. It ensures loudness, tonal balance, and compatibility across speakers and streaming platforms.",
      },
      {
        instruction:
          "Open the Master channel strip and add an EQ first. Apply a gentle high-shelf boost (+1–2 dB at 10 kHz) for air, and a low-shelf boost (+1 dB at 80 Hz) for weight.",
        highlight: "[data-testid='master-strip']",
        highlightLabel: "Master channel strip",
      },
      {
        instruction:
          "Add a Compressor after the EQ on the master bus. Use a gentle ratio (2:1 or 4:1), slow attack (30–50 ms), and fast release. This glues the full mix together — aim for 2–3 dB of gain reduction on peaks.",
      },
      {
        instruction:
          "Add a Limiter as the last plugin on the master bus. Set the ceiling to −0.3 dBFS (leaving headroom for streaming codec distortion). Raise the input gain until the loudness meter reads around −14 LUFS for streaming.",
      },
      {
        instruction:
          "A/B your master against a reference track you admire. Match its loudness with the limiter, then compare the tone. If your mix sounds dull or harsh by comparison, go back and tweak the master EQ. When you're happy, export as 24-bit WAV.",
      },
    ],
  },
];

const STORAGE_KEY = "lessons-completed-v1";

function loadCompleted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveCompleted(completed: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    /* storage unavailable */
  }
}

interface LessonsPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const CATEGORY_LABEL: Record<Lesson["category"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
};

export function LessonsPanel({ open, onOpenChange }: LessonsPanelProps) {
  const [lessonIdx, setLessonIdx] = useState<number | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(() => loadCompleted());
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

  function markComplete(title: string) {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(title);
      saveCompleted(next);
      return next;
    });
  }

  function startLesson(idx: number) {
    setLessonIdx(idx);
    setStepIdx(0);
  }

  function goNext() {
    if (!currentLesson) return;
    if (stepIdx < currentLesson.steps.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      markComplete(currentLesson.title);
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

  const beginnerLessons = LESSONS.filter((l) => l.category === "beginner");
  const intermediateLessons = LESSONS.filter((l) => l.category === "intermediate");
  const totalCompleted = LESSONS.filter((l) => completed.has(l.title)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[80vh] flex flex-col"
        aria-label="Interactive lessons"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" />
            Lessons
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>Short interactive guides to get you up and running.</span>
            {totalCompleted > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {totalCompleted}/{LESSONS.length} done
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {lessonIdx === null ? (
          /* Lesson list */
          <div className="overflow-y-auto flex-1 space-y-4 pr-1">
            {(
              [
                { label: "Beginner", items: beginnerLessons },
                { label: "Intermediate", items: intermediateLessons },
              ] as const
            ).map(({ label, items }) => (
              <div key={label}>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  {label}
                </p>
                <div className="space-y-1.5" role="list" aria-label={`${label} lessons`}>
                  {items.map((lesson) => {
                    const globalIdx = LESSONS.indexOf(lesson);
                    const isDone = completed.has(lesson.title);
                    return (
                      <button
                        key={lesson.title}
                        type="button"
                        role="listitem"
                        onClick={() => startLesson(globalIdx)}
                        className="w-full text-left border border-border rounded-md p-3 hover:bg-accent/40 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-[10px] text-muted-foreground w-4 shrink-0">
                            {globalIdx + 1}
                          </span>
                          <span className="font-mono text-xs font-semibold text-foreground flex-1">
                            {lesson.title}
                          </span>
                          {isDone && (
                            <CheckCircle2
                              className="w-3.5 h-3.5 text-primary shrink-0"
                              aria-label="Completed"
                            />
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug ml-6">
                          {lesson.summary}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Lesson step view */
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {currentLesson!.title}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {stepIdx + 1} / {currentLesson!.steps.length}
                </span>
              </div>
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
