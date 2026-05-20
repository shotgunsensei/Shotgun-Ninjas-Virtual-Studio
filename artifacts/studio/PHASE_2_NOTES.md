# Phase 2 — Performance Hardening Notes

This document captures the v2 hardening pass for the Shotgun Ninjas
Virtual Studio (Task #28) and the open items / known limits going into
Phase 3. Read it alongside `replit.md` and the engine source comments
in `src/lib/audio/engine.ts`.

The goal of this pass was **not** to add features. It was to:

1. Separate transport / audio-clock work from React render work so the
   UI stays smooth during playback.
2. Make sure Tone nodes we create are also nodes we dispose.
3. Prevent runaway scheduled events when a clip's pattern shrinks or a
   clip is removed.
4. Audit every `addEventListener` for a matching `removeEventListener`.
5. Wire the existing **Panic** facade everywhere it should be reachable
   (button, keyboard, error boundary).

---

## Transport ↔ render separation

The single biggest cost in v1 was that the timeline playhead and the
drum-pad step indicator used `setState` inside a `requestAnimationFrame`
loop. Every frame re-rendered:

- the whole `Timeline` tree (sections strip, ruler, every track row,
  every clip view), and
- the whole `DrumPads` grid (9 lanes × N steps, every cell rendered with
  inline tailwind class strings).

That made playback measurably janky on lower-end machines as soon as the
project had more than a few tracks.

The hardened pattern, used everywhere now:

```ts
useEffect(() => {
  if (!isPlaying || !ref.current) return;
  let raf = 0;
  const tick = () => {
    if (!document.hidden && ref.current) {
      const pos = audio.positionBeats() % totalBeats;
      ref.current.style.transform = `translateX(${pos * PX_PER_BEAT}px)`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [isPlaying, totalBeats]);
```

Changes that follow this rule now:

- `Timeline.tsx` — playhead is a `ref` + `style.transform`. Zero React
  work per frame during playback.
- `PianoRoll.tsx` — already a ref-based playhead; added the
  `document.hidden` guard.
- `DrumPads.tsx` (`usePlayheadStep`) — still uses `useState` because the
  lit cell needs a class change, but the `setStep` is **gated on the
  step actually changing** (it changes every Nth frame, not every
  frame), and skipped while the tab is hidden.
- `Meter.tsx` — throttled to ~30 Hz with `document.hidden` skip. Meters
  look fluid at 30 Hz and we avoid scheduling 60 `setState` calls per
  second per channel strip.
- `MasterStrip.tsx::useMasterClipped` — throttled to ~10 Hz with
  `document.hidden` skip. The latch is a binary indicator; we don't
  need animation-frame fidelity.
- `MasterScope.tsx` — canvas redraw skipped while hidden.

### Memoization

Adding the ref pattern only helps if the React tree above the playhead
doesn't have other reasons to re-render. Two hot components are now
wrapped in `React.memo`:

- `TimelineRow` — when one row's track changes (a clip resize, a mute
  toggle), the other rows now skip re-render because their `track`
  reference is preserved by `patchTrack`.
- `ChannelStrip` — same reasoning. Touching one strip's slider doesn't
  re-render the others.

`PianoRoll` and `DrumPads` are not wrapped: they re-read live store
state internally and only one is mounted at a time per selected track,
so the win wouldn't justify the prop-equality cost.

---

## Tone node lifecycle

The engine builds a `TrackVoice` per track. Every node attached to that
voice is now disposed in `voice.dispose()` (see `engine.ts` near the
end of `buildVoice`):

- `poly` (melodic instrument or sampler)
- `drums` (legacy drum kit, per-piece)
- `kit` (v2 drum kit — owns its own piece voices, channels, sends, FX)
- `mic` (vocals — also closes the underlying media stream)
- The v2 mixer chain: `filter → hpf → eq3 → drive → chorus → comp →
  delay → reverb → bitcrusher → widener → channel`
- Per-bus `Tone.Gain` sends and the post-fader `Tone.Meter`.

If you add a node to a voice in Phase 3, the rule is: **the same closure
that builds it owns its disposal**. Wire it into `voice.dispose()` in
the same edit. The v2 drum kit's own `dispose()` is wrapped in
`try/catch` because some kit voices ignore double-disposal — leave that
in place.

`flushMixToEngine` re-pushes EQ, sends, FX, and master bus to the
engine after a project load or mix-preset apply, so the audio graph
matches the data store on the next sound.

---

## Runaway events / clip shortening

The schedule lifecycle lives in `hooks/useTransport.ts`:

```ts
useEffect(() => {
  for (const t of project.tracks) audio.ensureTrack(t);
  audio.cancelScheduled([...noteIds, ...audioIds]); // previous batch
  audioPlayers.forEach((p) => p.dispose());
  // …reschedule current project.tracks…
  return () => {
    audio.cancelScheduled([...noteIds, ...audioIds]);
    audioPlayers.forEach((p) => p.dispose());
  };
}, [project.tracks, project.bpm]);
```

Because any clip edit goes through `patchTrack`, `project.tracks`
changes identity → the effect re-runs → the old scheduled callbacks
are cancelled before the new ones are registered. That covers:

- Pattern shortened (notes past the new `clip.length` are not
  rescheduled).
- Clip deleted (the whole clip's notes drop out).
- BPM change (rescheduled with new timing).

Belt-and-braces in `engine.scheduleClip`: events with `ev.time >=
clip.length` are skipped at schedule time, with a `console.warn` in dev
so we notice if a feature ever forgets to clamp on commit. This is the
"defensive" line of defense; the primary one is still the
`cancelScheduled` above.

`panicStopAll` intentionally does **not** call `Transport.cancel()` —
clip and metronome schedules are owned by `useTransport` /
`setMetronome` and must survive a panic so the next Play resumes
without forcing a full reschedule. Panic does stop in-flight audio
players and release every sustained note.

---

## Listener cleanup audit

Every `addEventListener` in the studio is paired with a
`removeEventListener` in the same `useEffect`'s cleanup. Verified
sites: `App.tsx` (keydown, `studio:*` custom events), `Header.tsx`
(fullscreenchange, `studio:open-*`), `Timeline.tsx` (keydown, drag
move/up), `DropZone.tsx` (drag events), `PianoRoll.tsx` (keydown, drag
move/up), `DrumPads.tsx` (keydown, mousedown, drag move/up),
`Keyboard.tsx` (keydown/up), `VocalsPanel.tsx` (devicechange).

Drag handlers register `mousemove` / `mouseup` on `window` inside
`onMouseDown` and remove them inside `onUp` — that's the
single-gesture pattern; no `useEffect` cleanup needed because the
listeners live only for the duration of the drag.

---

## Panic surface

`audio.panicStopAll()` is reachable from three places:

1. The red **Panic** button on the transport bar
   (`TransportBar.tsx` ~L95).
2. The Escape keybinding in `App.tsx` (~L192) — same handler that
   clears any pending count-in.
3. The error boundary in `App.tsx::StudioErrorBoundary` (~L110) — if a
   render throws during playback, the boundary panics the audio engine
   so we don't strand a stuck note.

---

## Phase 3 — open items / not done in this pass

Things considered and intentionally left alone, with the reasoning:

- **Narrowing `(s) => s.project` selectors.** Several components
  subscribe to the whole project object. Now that `TimelineRow` and
  `ChannelStrip` are memoized, the cost of those broad selectors is
  capped at the top-level parents. Splitting them into per-field
  selectors is a bigger refactor and belongs in Phase 3 alongside the
  Zustand / signal-store migration that's already on the board.
- **`useSyncExternalStore` selector identity.** `useStore` re-derives
  the selected slice each render. That's fine for primitives but causes
  unnecessary re-renders for callers that select an array literal.
  Tracked but out of scope here.
- **Sample-browser virtualization.** The samples list is a plain map.
  Today it's small; once projects start carrying tens of samples,
  switch to a virtualized list (`react-window` or equivalent).
- **MasterScope and per-strip `MeterBar` to canvas.** Useful only at
  4+ channel strips with the panel open. Defer.
- **Web-worker offload for non-realtime export.** The export path
  (`lib/audio/export.ts`) currently runs on the main thread. It's
  already off the audio render thread (Tone offline render), so user
  impact is bounded, but a worker would let the UI stay perfectly
  responsive during long bounces.
- **Track-voice rebuild on `presetId` / `kitId` change.** Done; verify
  by toggling preset rapidly and confirming the previous voice's
  `dispose()` is called (engine traces show one dispose per swap).
- **Recorder cleanup on hot-reload.** `noteRecorder` and
  `vocalRecorder` are module singletons. On Vite HMR they survive; if
  recording was active at edit time the next save may produce a stray
  clip. Acceptable in dev, no user impact in prod.

---

## How to verify

- `pnpm --filter studio run typecheck` — must pass cleanly.
- E2E: play / panic / kit-switch / save-and-reload round-trip via the
  testing skill.
- Manual smoke: open DevTools Performance, hit Play on the demo
  project, confirm there's no Timeline / DrumPads / ChannelStrip
  re-render per frame (only the playhead `ref` writes and the throttled
  meter updates).
- Hide the tab during playback; CPU should drop noticeably. Audio
  keeps playing because the transport is on the Tone clock, not the
  RAF loop.
