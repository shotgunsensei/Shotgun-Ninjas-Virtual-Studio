import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GraduationCap, ChevronLeft, ChevronRight, X, CheckCircle2 } from "lucide-react";
import { setSettings } from "../lib/settings";

interface LessonStep {
  instruction: string;
  highlight?: string;
  highlightLabel?: string;
}

interface Lesson {
  title: string;
  summary: string;
  category: "beginner" | "intermediate" | "creative";
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
          "In Basic, open the beat maker. In Advanced, select a Drums track in Tracks and open Inspector on the right. Enable audio before trying the sounds.",
      },
      {
        instruction:
          "Find the step grid with rows for Kick, Snare, and Hat. A lit square is a scheduled hit. The larger drum pads in Advanced play sounds live; they do not add a step unless you record.",
      },
      {
        instruction:
          "For a one-bar pattern divided into 16 steps, turn on Kick steps 1 and 9 and Snare steps 5 and 13. These place kick on beats 1 and 3 and snare on beats 2 and 4. If a square is already lit, leave it on.",
      },
      {
        instruction:
          "Add some hi-hats by clicking every other square in the Hat row for a classic straight 8ths groove.",
      },
      {
        instruction:
          "Press Play to hear your beat. Pause keeps your place, Stop returns to the beginning, and Panic cuts all sound. Enable Loop if you want the same section to repeat.",
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
          "Basic has a sound-level control for each track. For this lesson's full mixer controls, switch to Advanced and open Mixer at the bottom. Each channel strip controls one track; Master controls the combined output.",
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
          "The Master strip at the far right controls overall loudness. Watch for the red CLIP warning and lower loud tracks if it appears. Keep your listening volume comfortable.",
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
          "Swing changes the spacing of alternating notes to create a shuffle feel. Switch to Advanced to find the Swing slider in the transport bar next to BPM.",
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
          "Switch to Advanced, select a track, and open Inspector on the right. Scroll down to Effects Rack. The mixer strip's FX button also selects that track; expand Inspector if it is collapsed.",
        highlight: "[data-testid^='fx-open']",
        highlightLabel: "FX button",
      },
      {
        instruction:
          "In Effects Rack, click the Reverb power button to turn it on. Play your track and listen for a room-like tail after each note.",
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
          "Toggle the effect off and on to compare. Stop when it adds the space you want without blurring the rhythm. The mixer also has shared effect sends, covered in the sends lesson.",
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
    title: "Shared Effect Sends",
    summary: "Route multiple tracks through a shared reverb or delay bus.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "A 'send' lets you blend a copy of a track's signal into a shared effects bus — great for giving all your drums the same room reverb without duplicating the plugin.",
      },
      {
        instruction:
          "Switch to Advanced and open Mixer. Below the EQ and HPF controls are four send sliders. Hover over a row to read its effect name. Raise one a little while your track plays.",
        highlight: "[data-testid^='send-']",
        highlightLabel: "Effect send slider",
      },
      {
        instruction:
          "This studio provides built-in shared effects, so you do not need to create a return track or add a plugin. Each send blends a copy of the track into that shared effect while keeping the original sound.",
      },
      {
        instruction:
          "Try the same send on a second track. Listen for the two tracks sharing a similar space. Start low and compare with the send at zero.",
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
          "Select the existing Bass track and write a short bass pattern in its piano roll in Advanced. In Basic, use the bass idea action to add an editable starting point. Try matching some bass notes to the kick rhythm.",
      },
      {
        instruction:
          "In Advanced, use the clip's menu on the timeline and choose Duplicate. Drag clips to place them in order. Repeat the idea in Basic with its song-building controls.",
        highlightLabel: "Timeline",
      },
      {
        instruction:
          "Add a chord or melody track. Use the piano roll to draw a chord every bar or two. Keep the chords high in the register so they don't clash with the bass.",
      },
      {
        instruction:
          "In Advanced, try moving the bass clip to bar 3 and the melody to bar 5, leaving drums at the start. Listen from the beginning and check that the project and loop range cover the full arrangement.",
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
          "Switch to Advanced, select a piano, guitar, or bass track, and open Inspector. Its piano roll edits that track's first note clip. Pitches run vertically, and time runs from left to right.",
        highlightLabel: "Piano roll",
      },
      {
        instruction:
          "Click on the grid to draw a note. A short click creates a short note; click and drag to the right to make it longer. Try drawing a simple C–E–G chord by stacking three notes on the same beat.",
      },
      {
        instruction:
          "Drag the body of a note to move it, or drag its right edge to change its length. The Div control sets the grid spacing used for snapping. Clicking a note selects it.",
      },
      {
        instruction:
          "Use the velocity lane at the bottom of the piano roll. Taller bars mean louder notes. Click a bar and drag up or down to accent or soften individual notes.",
        highlight: "[data-velocity-lane]",
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
          "Switch to Advanced and open Mixer. Each track has LO, MID, and HI controls for its low, middle, and high frequencies. Start with small changes and listen in the whole mix.",
        highlight: "[data-testid^='fx-open']",
        highlightLabel: "FX / EQ button",
      },
      {
        instruction:
          "If a track adds unwanted low rumble, try its HPF button and cutoff slider. Raise the cutoff slowly, then back off if the sound becomes too thin. Bass and kick often need their low frequencies.",
      },
      {
        instruction:
          "Try lowering MID slightly on a crowded track, or adjusting HI for brightness. These are broad tone controls, so judge the result by ear rather than looking for a detailed frequency graph.",
      },
      {
        instruction:
          "Solo tracks one by one and adjust, then listen to the full mix. A good mix sounds balanced on laptop speakers and headphones. If something sounds thin or boomy, use EQ to fix it before reaching for the volume fader.",
      },
    ],
  },
  {
    title: "Layering Drum Hits",
    summary: "Combine kick, snare, or clap hits and balance the result.",
    category: "intermediate",
    steps: [
      {
        instruction:
          "Layering means playing sounds together. Start with the drum step grid and try a snare and clap on the same beat. Listen to how their attacks and tails combine.",
      },
      {
        instruction:
          "In Advanced, select Drums, open Inspector, and choose Show Piece Mixer above the pads. The piece mixer lets you change the loudness and tone of each drum sound.",
      },
      {
        instruction:
          "Choose sounds with different jobs: the snare supplies the snap while the clap adds a wider tail. Remove a hit if the combined sound becomes cluttered.",
      },
      {
        instruction:
          "Lower the clap in the piece mixer until it supports the snare. Listen with the whole beat playing, because two loud sounds together can overload the mix.",
      },
      {
        instruction:
          "Mute the clap, then bring it back. Keep the layer only if you prefer the result. This is also a useful listening exercise with a kick and a quieter tom.",
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
          "Switch to Advanced and open Mixer. The Master strip is on the far right. Start with its volume at a comfortable level and listen to the complete song before changing anything.",
        highlightLabel: "Master channel strip",
      },
      {
        instruction:
          "The Master GLUE button enables its built-in compressor. Compare with GLUE off and on. If the drums lose their impact, leave it off or revisit the track balance.",
      },
      {
        instruction:
          "The LIMIT slider adjusts the built-in limiter threshold. Lowering it applies more peak control; it is not a target loudness meter. Watch the CLIP warning and avoid pushing levels just to make the song louder.",
      },
      {
        instruction:
          "Compare your song with another recording at a similar listening volume. If yours is unclear, return to the track volumes and EQ. Export WAV when ready, listen to the downloaded file, and keep a project JSON backup for future edits.",
      },
    ],
  },
  {
    title: "Motif Alchemy: Repeat, Vary, Answer",
    summary: "Turn three notes into a memorable phrase instead of chasing random notes.",
    category: "creative",
    steps: [
      {
        instruction:
          "Select a piano or guitar track and open its Preset Browser. Choose an HQ factory instrument, preview it, then open Learn. Its range and listening cue tell you where that sound naturally speaks.",
        highlight: "[data-testid='preset-browser']",
        highlightLabel: "Preset Browser",
      },
      {
        instruction:
          "Choose only three pitches for your motif. In C minor, try C, E-flat, and G. A small pitch vocabulary makes rhythm and contour easier to recognize.",
      },
      {
        instruction:
          "Write a one-bar phrase with those notes, including at least one rest. Repeat it in bar 2 exactly. Repetition teaches the listener what matters.",
      },
      {
        instruction:
          "In bar 3, change one dimension only: move the last note, lengthen the first note, or shift one accent. Keeping the other dimensions fixed makes the variation feel intentional.",
      },
      {
        instruction:
          "Use bar 4 as an answer: reverse part of the rhythm and end on C. You now have a four-bar idea with identity, development, and resolution—three foundations of musical form.",
      },
    ],
  },
  {
    title: "Compose With Timbre & Register",
    summary: "Give each instrument a role so the arrangement stays clear and expressive.",
    category: "creative",
    steps: [
      {
        instruction:
          "Preview the VCSL TX81Z Piano, Ocarina, and Tanzanian Kalimba. Do not ask only which is 'best.' Listen for attack, sustain, noise, and decay—those traits determine what musical job each sound can perform.",
        highlight: "[data-testid='preset-browser']",
        highlightLabel: "HQ instrument guides",
      },
      {
        instruction:
          "Assign roles before writing: one sound carries harmony, one carries the main phrase, and one supplies a repeating texture. Role separation prevents every track from competing for attention.",
      },
      {
        instruction:
          "Separate registers. Keep harmony around C3–C4, place the melody above it, and leave the bottom octave for bass. If two parts still blur together, move one an octave before reaching for EQ.",
      },
      {
        instruction:
          "Match rhythm to envelope: short kalimba or sax notes can define the groove; sustained ocarina notes should breathe across it; harp and vibraphone need rests so their natural tails stay intelligible.",
      },
      {
        instruction:
          "Mute each part in turn. If the song loses no clear function, simplify or remove that part. Good arranging is not maximum activity—it is every sound earning its space.",
      },
    ],
  },
  {
    title: "Harmony Without Wrong Notes",
    summary: "Use Scale Lock and Chord Mode as training wheels for expressive harmony.",
    category: "creative",
    steps: [
      {
        instruction:
          "In Advanced, open Performance Mode from the transport bar. Turn on Scale Lock, choose D as the root, and select Pentatonic Minor. Performance input notes will be mapped into that pitch collection.",
        highlight: "[aria-label*='Performance Mode']",
        highlightLabel: "Performance Mode",
      },
      {
        instruction:
          "Play one note at a time and listen for the scale's five-note color. Create a short rhythm first; let Scale Lock remove pitch anxiety while your ear learns which notes feel settled or tense.",
      },
      {
        instruction:
          "Turn on Chord Mode and choose Minor 7th. A single input now produces a four-note chord. Hold fewer chords for longer than you think—the extensions need time to register.",
      },
      {
        instruction:
          "Alternate between D and a note a fourth higher. Change the bass note while keeping the chord rhythm steady. You are hearing harmonic motion without needing to construct every voicing manually.",
      },
      {
        instruction:
          "Finally, turn Chord Mode off and rebuild one chord by ear in the piano roll. The tool has done its job when it helps you recognize and recreate the sound yourself.",
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
  creative: "Creative Practice",
};

export function LessonsPanel({ open, onOpenChange }: LessonsPanelProps) {
  const [lessonIdx, setLessonIdx] = useState<number | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(() => loadCompleted());
  const currentLesson = lessonIdx !== null ? LESSONS[lessonIdx] : null;
  const currentStep = currentLesson?.steps[stepIdx];

  useEffect(() => {
    if (!open) {
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
      setLessonIdx(null);
      setStepIdx(0);
    }
  }

  function goBack() {
    if (stepIdx > 0) {
      setStepIdx(stepIdx - 1);
    } else {
      setLessonIdx(null);
      setStepIdx(0);
    }
  }

  const beginnerLessons = LESSONS.filter((l) => l.category === "beginner");
  const intermediateLessons = LESSONS.filter((l) => l.category === "intermediate");
  const creativeLessons = LESSONS.filter((l) => l.category === "creative");
  const totalCompleted = LESSONS.filter((l) => completed.has(l.title)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[80vh] flex flex-col"
        aria-label="Practice lessons"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" />
            Lessons · practice reference
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>Read a short exercise, then close this reference to try it.</span>
            {totalCompleted > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {totalCompleted}/{LESSONS.length} read
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">Want to learn while you make music? The optional tutor stays alongside your workspace. Mixer and Inspector examples below use Advanced on a larger screen.</p>
          <Button
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              setSettings({ tutorEnabled: true });
              onOpenChange(false);
            }}
          >
            Open learning tutor
          </Button>
        </div>

        {lessonIdx === null ? (
          /* Lesson list */
          <div className="overflow-y-auto flex-1 space-y-4 pr-1">
            {(
              [
                { label: "Beginner", items: beginnerLessons },
                { label: "Intermediate", items: intermediateLessons },
                { label: CATEGORY_LABEL.creative, items: creativeLessons },
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
                              aria-label="Read"
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
                  Control to find: {currentStep.highlightLabel}
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
                    ? "Finish reading"
                    : "Next step"
                }
              >
                {stepIdx === currentLesson!.steps.length - 1 ? (
                  <>
                    Read <X className="w-3.5 h-3.5" />
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
