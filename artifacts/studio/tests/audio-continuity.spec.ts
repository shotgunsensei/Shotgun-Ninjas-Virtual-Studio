import { expect, test, type Locator, type Page } from "@playwright/test";

async function openRealAudioStudio(page: Page, search = ""): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto(`/studio${search}`, { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });

  const enableAudio = page
    .getByRole("button", { name: /Tap to Enable Audio/i })
    .first();
  if (await enableAudio.isVisible().catch(() => false)) {
    await enableAudio.click();
  }
}

async function realizeDrumTrack(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ audio }, { getStore }] = await Promise.all([
      import("/src/lib/audio/engine.ts"),
      import("/src/store.ts"),
    ]);
    const drumTrack = getStore().state.project.tracks.find(
      (track) => track.kind === "drums",
    );
    if (!drumTrack) throw new Error("Default project has no drum track.");
    audio.ensureTrack(drumTrack, {
      mode: "tone",
      reason: "audio-continuity-regression",
      allowHeavy: true,
    });
  });
}

async function measurePeak(
  page: Page,
  source: "live-drum" | "preset-preview",
): Promise<number | null> {
  return page.evaluate(async (requestedSource) => {
    const [{ audio }, { getStore }] = await Promise.all([
      import("/src/lib/audio/engine.ts"),
      import("/src/store.ts"),
    ]);

    if (requestedSource === "live-drum") {
      const drumTrack = getStore().state.project.tracks.find(
        (track) => track.kind === "drums",
      );
      if (!drumTrack) throw new Error("Default project has no drum track.");
      audio.triggerDrum(drumTrack.id, "kick", 0.95);
    } else {
      await audio.previewPresetNote("keys.electric", "C4", 0.65);
    }

    let peak = -Infinity;
    for (let index = 0; index < 60; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
      const sample = Math.max(...audio.getMasterLevels().peakDb);
      if (Number.isFinite(sample)) peak = Math.max(peak, sample);
    }
    return Number.isFinite(peak) ? peak : null;
  }, source);
}

async function captureOutput(page: Page, durationMs = 1_200) {
  return page.evaluate(async (duration) => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    let peakDb = -Infinity;
    let rmsDb = -Infinity;
    let longestSilentMs = 0;
    let silentStartedAt: number | null = null;
    const deadline = performance.now() + duration;
    while (performance.now() < deadline) {
      const now = performance.now();
      const levels = audio.getMasterLevels();
      const peak = Math.max(...levels.peakDb);
      const rms = Math.max(...levels.rmsDb);
      peakDb = Math.max(peakDb, peak);
      rmsDb = Math.max(rmsDb, rms);
      if (!Number.isFinite(peak) || peak < -70) {
        silentStartedAt ??= now;
        longestSilentMs = Math.max(longestSilentMs, now - silentStartedAt);
      } else {
        silentStartedAt = null;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    return {
      peakDb,
      rmsDb,
      longestSilentMs,
      playbackState: audio.getPlaybackState(),
    };
  }, durationMs);
}

test.describe("real-audio continuity", () => {
  test("opt-in AudioWorklet metronome remains audible through the master chain", async ({
    page,
  }) => {
    test.skip(
      process.env.VITE_STUDIO_ENABLE_AUDIO_WORKLETS !== "1",
      "AudioWorklet path is an explicit profiling opt-in.",
    );
    test.slow();
    await openRealAudioStudio(page);
    await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      const tracks = getStore().state.project.tracks.map((track) => ({
        ...track,
        muted: true,
        solo: false,
      }));
      getStore().patchProject({ tracks });
      audio.refreshAllMutes(tracks);
      audio.setMetronomeVolume(1);
      audio.setMetronome(true);
    });

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { audio } = await import("/src/lib/audio/engine.ts");
          return audio.getWorkletStatus();
        }),
      )
      .toEqual({ ready: true, fallback: false, reason: null });

    await page.getByRole("button", { name: "Play" }).first().click();
    const output = await captureOutput(page, 1_500);
    expect(output.playbackState).toBe("playing");
    expect(output.peakDb).toBeGreaterThan(-60);
    await page.evaluate(async () => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      audio.setMetronome(false);
      audio.panicStopAll();
    });
  });

  test("Panic does not strand live pads or preset previews behind the master hold", async ({
    page,
  }) => {
    test.slow();
    await openRealAudioStudio(page);
    await realizeDrumTrack(page);

    const baselinePeak = await measurePeak(page, "live-drum");
    expect(baselinePeak).not.toBeNull();
    expect(baselinePeak!).toBeGreaterThan(-55);

    await page.getByRole("button", { name: /Panic/i }).first().click();
    await page.waitForTimeout(150);

    const livePadPeak = await measurePeak(page, "live-drum");
    const presetPreviewPeak = await measurePeak(page, "preset-preview");

    expect.soft(livePadPeak, "live pad output after Panic").not.toBeNull();
    expect
      .soft(livePadPeak!, "live pad output after Panic")
      .toBeGreaterThan(-55);
    expect
      .soft(presetPreviewPeak, "preset preview output after Panic")
      .not.toBeNull();
    expect
      .soft(presetPreviewPeak!, "preset preview output after Panic")
      .toBeGreaterThan(-55);
  });

  test("Panic remains authoritative over late Transport drum callbacks", async ({ page }) => {
    test.slow();
    await openRealAudioStudio(page);
    await realizeDrumTrack(page);

    await page.evaluate(async () => {
      const [{ audio }, { getStore }, Tone] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
        import("/node_modules/.vite/deps/tone.js"),
      ]);
      const drums = getStore().state.project.tracks.find(
        (track) => track.kind === "drums",
      );
      if (!drums) throw new Error("Default project has no drum track.");
      audio.panicStopAll();
      audio.triggerDrumAt(drums.id, "kick", 1, Tone.now() + 0.05);
    });

    const heldOutput = await captureOutput(page, 500);
    expect(heldOutput.peakDb).toBeLessThan(-70);

    // A new direct pad gesture intentionally releases the hold.
    const directPeak = await measurePeak(page, "live-drum");
    expect(directPeak).not.toBeNull();
    expect(directPeak!).toBeGreaterThan(-55);
  });

  test("Sound Library preview stays bounded, audible, and Panic-owned", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openRealAudioStudio(page, "?snAudioNodeTrace=1");
    await page.getByRole("tab", { name: "Library" }).click();
    const preview = page.getByTestId("preview-sound-pack-demon-truck");
    await expect(preview).toBeVisible();
    const before = await page.evaluate(
      () => window.__SN_AUDIO_NODE_TRACE__?.snapshot().leanOneShotSourcesCreated ?? 0,
    );

    await preview.click();
    await expect(preview).toHaveText(/Stop/);
    const output = await captureOutput(page, 1_500);
    expect(output.peakDb).toBeGreaterThan(-60);
    const during = await page.evaluate(
      () => window.__SN_AUDIO_NODE_TRACE__?.snapshot() ?? null,
    );
    expect(during).not.toBeNull();
    expect(during!.leanOneShotSourcesCreated).toBeGreaterThan(before);
    expect(during!.leanOneShotSourcesActive).toBeLessThanOrEqual(64);

    await page.getByRole("button", { name: /^Panic/ }).first().click();
    await expect(preview).toHaveText(/Preview/);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__SN_AUDIO_NODE_TRACE__?.snapshot().leanOneShotSourcesActive ?? -1,
        ),
      )
      .toBe(0);
    expect(errors).toEqual([]);
  });

  test("live faders and lazily realized saved mixer settings reach the audio graph", async ({
    page,
  }) => {
    test.slow();
    await openRealAudioStudio(page);
    const ids = await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      const store = getStore();
      const piano = store.state.project.tracks.find(
        (track) => track.kind === "piano",
      );
      const guitar = store.state.project.tracks.find(
        (track) => track.kind === "guitar",
      );
      if (!piano || !guitar)
        throw new Error("Default melodic tracks are missing.");

      audio.ensureTrack(piano, {
        mode: "tone",
        reason: "mixer-regression",
        allowHeavy: true,
      });
      store.setTrackVolume(piano.id, 0.25);
      store.setTrackPan(piano.id, 0.6);

      // Persist these while the guitar has no voice. First realization must
      // hydrate the complete saved mixer, not only volume/pan.
      store.setTrackEq(guitar.id, { low: 3, mid: -2, hpfOn: true, hpfHz: 140 });
      store.setTrackSend(guitar.id, "neonHall", 0.4);
      store.setFxModule(guitar.id, "compressor", {
        enabled: true,
        amount: 0.7,
      });
      const savedGuitar = store.state.project.tracks.find(
        (track) => track.id === guitar.id,
      );
      if (!savedGuitar) throw new Error("Saved guitar disappeared.");
      audio.ensureTrack(savedGuitar, {
        mode: "tone",
        reason: "saved-mixer-regression",
        allowHeavy: true,
      });
      return { pianoId: piano.id, guitarId: guitar.id };
    });

    await page.waitForTimeout(120);
    const mix = await page.evaluate(async () => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      return audio.getVoiceMixSnapshot();
    });
    const piano = mix.find((voice) => voice.trackId === ids.pianoId);
    const guitar = mix.find((voice) => voice.trackId === ids.guitarId);
    expect(piano).toBeDefined();
    expect(piano!.volumeDb).toBeCloseTo(20 * Math.log10(0.25), 1);
    expect(piano!.pan).toBeCloseTo(0.6, 1);
    expect(guitar).toMatchObject({ hasEq: true, hasCompressor: true });
    expect(guitar!.sends.neonHall).toBeCloseTo(0.4, 1);
  });

  test("a restored kit id converges from immediate lean audio to its saved kit", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openRealAudioStudio(page);
    const drumId = await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      const drums = getStore().state.project.tracks.find(
        (track) => track.kind === "drums",
      );
      if (!drums?.kitId)
        throw new Error("Default project has no saved drum kit.");
      audio.ensureTrack(drums, {
        mode: "lean",
        reason: "restored-kit-regression",
        allowHeavy: false,
      });
      audio.triggerDrum(drums.id, "kick", 0.9);
      return drums.id;
    });

    await expect
      .poll(
        () =>
          page.evaluate((trackId) => {
            const selector = window.__SN_AUDIO_ENGINE_STATUS__
              ?.soundSelectors()
              .find((entry) => entry.trackId === trackId);
            return selector?.kitId ?? null;
          }, drumId),
        { timeout: 20_000 },
      )
      .toBe("boombap");
  });

  test("native drum controls, fixed mixer, choke ownership, and Panic stay bounded", async ({
    page,
  }) => {
    await openRealAudioStudio(page, "?snAudioNodeTrace=1");
    const result = await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      const drums = getStore().state.project.tracks.find(
        (track) => track.kind === "drums",
      );
      if (!drums) throw new Error("Default project has no drum track.");
      audio.ensureTrack(drums, {
        mode: "tone",
        reason: "native-drum-control-regression",
        allowHeavy: true,
      });
      getStore().setTrackEq(drums.id, {
        low: 2,
        mid: -1,
        high: 1,
        hpfOn: true,
        hpfHz: 55,
      });
      getStore().setFxModule(drums.id, "compressor", {
        enabled: true,
        amount: 0.55,
      });
      getStore().setTrackSend(drums.id, "neonHall", 0.3);

      const trace = () => window.__SN_AUDIO_NODE_TRACE__?.snapshot();
      const before = trace()?.leanOneShotSourcesCreated ?? 0;
      audio.setPieceSetting(
        drums.id,
        "kick",
        { muted: true },
        { kick: { muted: true } },
      );
      audio.triggerDrum(drums.id, "kick", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      const afterMutedKick = trace()?.leanOneShotSourcesCreated ?? 0;

      const kickSettings = {
        muted: false,
        volume: 0.72,
        pan: -0.25,
        pitch: 3,
        decay: 0.65,
        cutoff: 0.8,
        reverbSend: 0.2,
        delaySend: 0.15,
      };
      audio.setPieceSetting(drums.id, "kick", kickSettings, { kick: kickSettings });
      audio.triggerDrum(drums.id, "kick", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      const afterAudibleKick = trace()?.leanOneShotSourcesCreated ?? 0;

      const allSettings = {
        kick: kickSettings,
        snare: { solo: true, muted: false },
      };
      audio.setPieceSetting(drums.id, "snare", allSettings.snare, allSettings);
      audio.triggerDrum(drums.id, "kick", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      const afterSoloBlockedKick = trace()?.leanOneShotSourcesCreated ?? 0;
      audio.triggerDrum(drums.id, "snare", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 10));
      const afterSoloSnare = trace()?.leanOneShotSourcesCreated ?? 0;
      let nativeMeterDb = -Infinity;
      const meterDeadline = performance.now() + 120;
      while (performance.now() < meterDeadline) {
        const rawNativeMeter = audio.getTrackMeter(drums.id)?.getValue();
        const reading = typeof rawNativeMeter === "number"
          ? rawNativeMeter
          : rawNativeMeter
            ? Math.max(...Array.from(rawNativeMeter))
            : -Infinity;
        nativeMeterDb = Math.max(nativeMeterDb, reading);
        await new Promise((resolve) => window.setTimeout(resolve, 8));
      }
      const beforeHatChoke = trace()?.leanOneShotSourcesDisconnected ?? 0;
      audio.setPieceSetting(drums.id, "snare", { solo: false }, {});
      audio.triggerDrum(drums.id, "ohat", 0.8);
      await new Promise((resolve) => window.setTimeout(resolve, 10));
      audio.triggerDrum(drums.id, "hat", 0.8);
      // Native cleanup honors future audio scheduling instead of disconnecting
      // a choked source on an unrelated wall-clock deadline.
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      const afterHatChoke = trace()?.leanOneShotSourcesDisconnected ?? 0;

      // A channel edit must not escape project-wide solo ownership. This was
      // easy to regress when native applyTrack briefly owned audibility.
      const otherTrack = getStore().state.project.tracks.find(
        (candidate) => candidate.id !== drums.id,
      );
      if (!otherTrack) throw new Error("Default project needs a second track.");
      getStore().patchTrack(otherTrack.id, { solo: true });
      audio.refreshAllMutes(getStore().state.project.tracks);
      const beforeTrackSoloBlock = trace()?.leanOneShotSourcesCreated ?? 0;
      getStore().setTrackPan(drums.id, 0.35);
      getStore().applyDrumKit(drums.id, "boombap");
      audio.triggerDrum(drums.id, "kick", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      const afterTrackSoloBlock = trace()?.leanOneShotSourcesCreated ?? 0;
      getStore().patchTrack(otherTrack.id, { solo: false });
      audio.refreshAllMutes(getStore().state.project.tracks);

      const automationLane = (value: number) => [{
        id: `native-volume-${value}`,
        param: "volume" as const,
        breakpoints: [{ beat: 0, value }],
        interpolation: "linear" as const,
      }];
      audio.setTrackAutomation(drums.id, automationLane(0));
      if (!audio.play()) throw new Error("Native automation transport did not start.");
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      audio.triggerDrum(drums.id, "snare", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 35));
      const automatedSilentMeter = audio.getTrackMeter(drums.id)?.getValue() ?? -Infinity;
      audio.setTrackAutomation(drums.id, automationLane(1));
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      audio.triggerDrum(drums.id, "snare", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 35));
      const automatedAudibleMeter = audio.getTrackMeter(drums.id)?.getValue() ?? -Infinity;
      audio.setTrackAutomation(drums.id, automationLane(0));
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      audio.setTrackAutomation(drums.id, []);
      audio.stop();
      audio.triggerDrum(drums.id, "snare", 0.9);
      await new Promise((resolve) => window.setTimeout(resolve, 35));
      const clearedAutomationMeter = audio.getTrackMeter(drums.id)?.getValue() ?? -Infinity;

      const selector = audio
        .getVoiceSoundSelectorSnapshot()
        .find((entry) => entry.trackId === drums.id);
      const mix = audio
        .getVoiceMixSnapshot()
        .find((entry) => entry.trackId === drums.id);
      const modes = audio.getVoiceModeSnapshot();
      audio.panicStopAll();
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      return {
        drumId: drums.id,
        before,
        afterMutedKick,
        afterAudibleKick,
        afterSoloBlockedKick,
        afterSoloSnare,
        nativeMeterDb,
        beforeHatChoke,
        afterHatChoke,
        beforeTrackSoloBlock,
        afterTrackSoloBlock,
        automatedSilentMeter,
        automatedAudibleMeter,
        clearedAutomationMeter,
        activeAfterPanic: trace()?.leanOneShotSourcesActive ?? -1,
        selector,
        mix,
        modes,
      };
    });

    expect(result.afterMutedKick).toBe(result.before);
    expect(result.afterAudibleKick).toBe(result.before + 1);
    expect(result.afterSoloBlockedKick).toBe(result.afterAudibleKick);
    expect(result.afterSoloSnare).toBe(result.afterSoloBlockedKick + 2);
    expect(result.nativeMeterDb).toBeGreaterThan(-80);
    expect(result.afterHatChoke).toBeGreaterThan(result.beforeHatChoke);
    expect(result.afterTrackSoloBlock).toBe(result.beforeTrackSoloBlock);
    expect(result.automatedSilentMeter).toBe(-Infinity);
    expect(result.automatedAudibleMeter).toBeGreaterThan(-80);
    expect(result.clearedAutomationMeter).toBeGreaterThan(-80);
    expect(result.activeAfterPanic).toBe(0);
    expect(result.selector).toMatchObject({
      hasKit: true,
      hasNativeKit: true,
      hasToneKit: false,
      runtime: "native",
    });
    expect(result.mix).toMatchObject({ hasEq: true, hasCompressor: true });
    expect(result.mix!.sends.neonHall).toBeCloseTo(0.3, 1);
    expect(result.modes.activeLeanTrackIds).toContain(result.drumId);
    expect(result.modes.activeMixerShellTrackIds).not.toContain(result.drumId);
    expect(result.modes.activeToneTrackIds).not.toContain(result.drumId);
  });

  test("user-paced named kit switches keep one isolated native drum voice audible", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openRealAudioStudio(page, "?snAudioNodeTrace=1");

    const drumId = await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      const current = getStore().state.project.tracks;
      const existing = current.find((track) => track.kind === "drums");
      if (!existing) throw new Error("Default project has no drum track.");

      // Remove every possible masking source. A finite meter reading below can
      // only come from this drum track, never a melodic or audio-clip tail.
      for (const track of current) {
        if (track.id !== existing.id) audio.removeTrack(track.id);
      }
      const drums = {
        ...existing,
        volume: 1,
        pan: 0,
        muted: false,
        solo: false,
        pieceSettings: {},
      };
      getStore().patchProject({ tracks: [drums] });
      getStore().set({ selectedTrackId: drums.id, selectedClipId: null });
      audio.ensureTrack(drums, {
        mode: "tone",
        reason: "named-kit-audibility-regression",
        allowHeavy: true,
      });
      audio.refreshAllMutes([drums]);
      return drums.id;
    });

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__SN_AUDIO_NODE_TRACE__?.snapshot().leanDrumVoicesActive ?? -1,
        ),
      )
      .toBe(1);

    type TestedPiece =
      | "kick"
      | "snare"
      | "hat"
      | "ohat"
      | "clap"
      | "tomLow"
      | "tomHigh"
      | "crash"
      | "fx";

    const verifySwitch = async (
      button: Locator,
      expectedKitId: string,
      piece: TestedPiece,
    ) => {
      const beforeSelection = await page.evaluate(() => {
        const trace = window.__SN_AUDIO_NODE_TRACE__?.snapshot();
        if (!trace) throw new Error("Audio-node trace is unavailable.");
        return {
          nodeCreates: trace.nodeCreates,
          leanDrumVoicesActive: trace.leanDrumVoicesActive,
        };
      });
      expect(beforeSelection.leanDrumVoicesActive).toBe(1);

      // This must remain a real, user-paced Playwright gesture. Two browser
      // frames give React/store reconciliation time without batching multiple
      // sound-set changes into one JavaScript task.
      await button.click();
      await expect
        .poll(() =>
          page.evaluate(
            ({ trackId, kitId }) => {
              const selector = window.__SN_AUDIO_ENGINE_STATUS__
                ?.soundSelectors()
                .find((entry) => entry.trackId === trackId);
              return selector?.kitId === kitId
                ? {
                    kitId: selector.kitId,
                    hasNativeKit: selector.hasNativeKit,
                    hasToneKit: selector.hasToneKit,
                    runtime: selector.runtime,
                  }
                : null;
            },
            { trackId: drumId, kitId: expectedKitId },
          ),
        )
        .toEqual({
          kitId: expectedKitId,
          hasNativeKit: true,
          hasToneKit: false,
          runtime: "native",
        });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );

      const afterSelection = await page.evaluate(() => {
        const trace = window.__SN_AUDIO_NODE_TRACE__?.snapshot();
        if (!trace) throw new Error("Audio-node trace is unavailable.");
        return {
          nodeCreates: trace.nodeCreates,
          leanDrumVoicesActive: trace.leanDrumVoicesActive,
          activeToneTrackVoices: trace.activeTrackVoices,
        };
      });
      expect(afterSelection.leanDrumVoicesActive).toBe(1);
      expect(afterSelection.activeToneTrackVoices).toBe(0);
      expect(
        afterSelection.nodeCreates,
        `${expectedKitId} must reuse the persistent native drum graph`,
      ).toEqual(beforeSelection.nodeCreates);

      const hit = await page.evaluate(
        async ({ trackId, selectedPiece }) => {
          const { audio } = await import("/src/lib/audio/engine.ts");
          const traceBefore = window.__SN_AUDIO_NODE_TRACE__?.snapshot();
          if (!traceBefore) throw new Error("Audio-node trace is unavailable.");
          audio.triggerDrum(trackId, selectedPiece, 1);

          let peakDb = -Infinity;
          const deadline = performance.now() + 500;
          while (performance.now() < deadline) {
            const raw = audio.getTrackMeter(trackId)?.getValue();
            const value =
              typeof raw === "number"
                ? raw
                : raw
                  ? Math.max(...Array.from(raw))
                  : -Infinity;
            if (Number.isFinite(value)) peakDb = Math.max(peakDb, value);
            await new Promise((resolve) => window.setTimeout(resolve, 8));
          }

          const traceAfter = window.__SN_AUDIO_NODE_TRACE__?.snapshot();
          if (!traceAfter) throw new Error("Audio-node trace is unavailable.");
          return {
            peakDb,
            sourcesBefore: traceBefore.leanOneShotSourcesCreated,
            sourcesAfter: traceAfter.leanOneShotSourcesCreated,
            hitsBefore: traceBefore.leanDrumHitsTriggered,
            hitsAfter: traceAfter.leanDrumHitsTriggered,
            leanDrumVoicesActive: traceAfter.leanDrumVoicesActive,
          };
        },
        { trackId: drumId, selectedPiece: piece },
      );
      expect(hit.sourcesAfter, `${expectedKitId}/${piece} source activity`).toBeGreaterThan(
        hit.sourcesBefore,
      );
      expect(hit.hitsAfter, `${expectedKitId}/${piece} hit activity`).toBeGreaterThan(
        hit.hitsBefore,
      );
      expect(hit.peakDb, `${expectedKitId}/${piece} isolated track meter`).toBeGreaterThan(
        -80,
      );
      expect(hit.leanDrumVoicesActive).toBe(1);
    };

    // The Sound Library exposes nine unique kit families. Pair each one with a
    // different drum piece so this regression covers every public piece without
    // multiplying slow, timing-sensitive audio assertions.
    const packSwitches = [
      { packId: "demon-truck", kitId: "demontruck", piece: "kick" },
      { packId: "lofi-smoke-room", kitId: "lofi", piece: "snare" },
      { packId: "neon-dojo", kitId: "neondojo", piece: "hat" },
      { packId: "trailer-impact", kitId: "cinematic", piece: "ohat" },
      { packId: "garage-chaos", kitId: "garageband", piece: "clap" },
      { packId: "southern-dirt", kitId: "southerndirt", piece: "tomLow" },
      { packId: "cyber-trap", kitId: "cybertrap", piece: "tomHigh" },
      { packId: "arcade-ghosts", kitId: "arcadeghosts", piece: "crash" },
      { packId: "core-kit", kitId: "trap", piece: "fx" },
    ] as const satisfies ReadonlyArray<{
      packId: string;
      kitId: string;
      piece: TestedPiece;
    }>;

    await page.getByRole("tab", { name: "Library" }).click();
    for (const selection of packSwitches) {
      const button = page.getByTestId(`load-sound-pack-${selection.packId}`);
      await expect(button).toBeVisible();
      await verifySwitch(button, selection.kitId, selection.piece);
      await expect(button).toHaveText("Loaded");
    }

    // Boom Bap and Cyberpunk are named kit choices without dedicated Sound
    // Library pack cards. Exercise their ordinary browser buttons as well so
    // every native recipe crosses the same graph-stability boundary.
    await page.getByRole("tab", { name: "Kits" }).click();
    const kitPanel = page.locator("#studio-browser-panel-kits");
    await verifySwitch(
      kitPanel.getByRole("button", { name: "Boom Bap Dojo Kit", exact: true }),
      "boombap",
      "kick",
    );
    await verifySwitch(
      kitPanel.getByRole("button", { name: "Cyberpunk Studio Kit", exact: true }),
      "cyberpunk",
      "snare",
    );

    await page.evaluate(async () => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      audio.panicStopAll();
    });
    expect(errors).toEqual([]);
  });

  test("one Play click resumes a suspended AudioContext and starts transport", async ({
    page,
  }) => {
    test.slow();
    await openRealAudioStudio(page);

    const before = await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      const toneContext = audio.getMasterContextInput().context as unknown as {
        rawContext?: AudioContext;
      };
      const context =
        toneContext.rawContext ?? (toneContext as unknown as AudioContext);
      await context.suspend();
      return {
        contextState: context.state,
        audioUnlocked: getStore().state.audioUnlocked,
      };
    });
    expect(before).toEqual({ contextState: "suspended", audioUnlocked: true });

    await page.getByRole("button", { name: "Play" }).first().click();

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const [{ audio }, { getStore }] = await Promise.all([
              import("/src/lib/audio/engine.ts"),
              import("/src/store.ts"),
            ]);
            const toneContext = audio.getMasterContextInput()
              .context as unknown as {
              rawContext?: AudioContext;
            };
            const context =
              toneContext.rawContext ??
              (toneContext as unknown as AudioContext);
            return {
              contextState: context.state,
              isPlaying: getStore().state.isPlaying,
              playbackState: audio.getPlaybackState(),
            };
          }),
        { timeout: 5_000 },
      )
      .toEqual({
        contextState: "running",
        isPlaying: true,
        playbackState: "playing",
      });
    await expect(
      page.getByRole("button", { name: "Pause" }).first(),
    ).toBeVisible();
  });

  test("a sound pack selected during Play preparation remains authoritative", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openRealAudioStudio(page);
    await page.getByRole("tab", { name: "Library" }).click();
    await expect(
      page.getByTestId("load-sound-pack-vcsl-tenor-alley"),
    ).toBeVisible();

    // Inject the real pack button click from getActiveTrackIds(). Preparation
    // has already captured its track list at that point, but has not realized
    // the first voice. This deterministically reproduces the stale-snapshot
    // race without depending on network or machine timing.
    await page.evaluate(async () => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      const originalGetActiveTrackIds = audio.getActiveTrackIds.bind(audio);
      const probe = { injected: false };
      (
        window as typeof window & {
          __snPackPreparationProbe?: typeof probe;
        }
      ).__snPackPreparationProbe = probe;
      audio.getActiveTrackIds = () => {
        const ids = originalGetActiveTrackIds();
        if (!probe.injected) {
          const button = document.querySelector<HTMLButtonElement>(
            '[data-testid="load-sound-pack-vcsl-tenor-alley"]',
          );
          if (!button)
            throw new Error("VCSL Tenor Alley load button is missing.");
          probe.injected = true;
          button.click();
        }
        return ids;
      };
    });

    await page.getByRole("button", { name: "Play" }).first().click();

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const [{ audio }, { getStore }] = await Promise.all([
              import("/src/lib/audio/engine.ts"),
              import("/src/store.ts"),
            ]);
            const project = getStore().state.project;
            const drums = project.tracks.find(
              (track) => track.kind === "drums",
            );
            const melodic = project.tracks.find(
              (track) => track.presetId === "brass.vcsl-tenor-sax-stabs",
            );
            const selectors = audio.getVoiceSoundSelectorSnapshot();
            return {
              injected:
                (
                  window as typeof window & {
                    __snPackPreparationProbe?: { injected: boolean };
                  }
                ).__snPackPreparationProbe?.injected ?? false,
              soundPackId: project.soundPackId,
              savedKitId: drums?.kitId ?? null,
              savedPresetId: melodic?.presetId ?? null,
              engineKitId:
                selectors.find((entry) => entry.trackId === drums?.id)?.kitId ??
                null,
              enginePresetId:
                selectors.find((entry) => entry.trackId === melodic?.id)
                  ?.presetId ?? null,
              playbackState: audio.getPlaybackState(),
            };
          }),
        { timeout: 30_000 },
      )
      .toEqual({
        injected: true,
        soundPackId: "vcsl-tenor-alley",
        savedKitId: "garageband",
        savedPresetId: "brass.vcsl-tenor-sax-stabs",
        engineKitId: "garageband",
        enginePresetId: "brass.vcsl-tenor-sax-stabs",
        playbackState: "playing",
      });
  });

  test("Stop revokes Play and Record while AudioContext unlock is pending", async ({
    page,
  }) => {
    await openRealAudioStudio(page, "?snDisableProjectSchedules=1");

    await page.evaluate(async () => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      const originalUnlock = audio.unlock.bind(audio);
      const originalPlay = audio.play.bind(audio);
      const race = {
        enteredUnlocks: 0,
        completedUnlocks: 0,
        playCalls: 0,
        releases: [] as Array<() => void>,
      };
      (
        window as typeof window & {
          __snTransportIntentRace?: typeof race;
        }
      ).__snTransportIntentRace = race;
      audio.unlock = async () => {
        race.enteredUnlocks += 1;
        await new Promise<void>((resolve) => race.releases.push(resolve));
        await originalUnlock();
        race.completedUnlocks += 1;
      };
      audio.play = () => {
        race.playCalls += 1;
        return originalPlay();
      };
    });

    const releaseUnlock = async (completedUnlocks: number) => {
      await page.evaluate(() => {
        const race = (
          window as typeof window & {
            __snTransportIntentRace?: { releases: Array<() => void> };
          }
        ).__snTransportIntentRace;
        const release = race?.releases.shift();
        if (!release)
          throw new Error("Pending transport unlock gate is missing.");
        release();
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as typeof window & {
                  __snTransportIntentRace?: { completedUnlocks: number };
                }
              ).__snTransportIntentRace?.completedUnlocks ?? 0,
          ),
        )
        .toBe(completedUnlocks);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    };

    await page.getByRole("button", { name: "Play" }).first().click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __snTransportIntentRace?: { enteredUnlocks: number };
              }
            ).__snTransportIntentRace?.enteredUnlocks ?? 0,
        ),
      )
      .toBe(1);
    await page.getByRole("button", { name: "Stop" }).first().click();
    await releaseUnlock(1);

    let state = await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      return {
        playCalls:
          (
            window as typeof window & {
              __snTransportIntentRace?: { playCalls: number };
            }
          ).__snTransportIntentRace?.playCalls ?? -1,
        isPlaying: getStore().state.isPlaying,
        isRecording: getStore().state.isRecording,
        playbackState: audio.getPlaybackState(),
      };
    });
    expect(state).toEqual({
      playCalls: 0,
      isPlaying: false,
      isRecording: false,
      playbackState: "stopped",
    });

    await page.getByRole("button", { name: "Record" }).first().click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __snTransportIntentRace?: { enteredUnlocks: number };
              }
            ).__snTransportIntentRace?.enteredUnlocks ?? 0,
        ),
      )
      .toBe(2);
    await page.getByRole("button", { name: "Stop" }).first().click();
    await releaseUnlock(2);

    state = await page.evaluate(async () => {
      const [{ audio }, { getStore }, { noteRecorder, vocalRecorder }] =
        await Promise.all([
          import("/src/lib/audio/engine.ts"),
          import("/src/store.ts"),
          import("/src/lib/audio/recorder.ts"),
        ]);
      return {
        playCalls:
          (
            window as typeof window & {
              __snTransportIntentRace?: { playCalls: number };
            }
          ).__snTransportIntentRace?.playCalls ?? -1,
        isPlaying: getStore().state.isPlaying,
        isRecording: getStore().state.isRecording,
        countingIn: getStore().state.countingIn,
        noteRecorderActive: noteRecorder.isActive(),
        vocalRecorderBusy: vocalRecorder.isBusy(),
        playbackState: audio.getPlaybackState(),
      };
    });
    expect(state).toEqual({
      playCalls: 0,
      isPlaying: false,
      isRecording: false,
      countingIn: false,
      noteRecorderActive: false,
      vocalRecorderBusy: false,
      playbackState: "stopped",
    });
  });

  test("dense demo playback keeps native drum connects responsive through repeated pack switches", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openRealAudioStudio(page);
    const nativeRouting = await page.evaluate(async () => {
      const [{ resolveNativeAudioContext }, { audio }] = await Promise.all([
        import("/src/lib/audio/toneConnection.ts"),
        import("/src/lib/audio/engine.ts"),
      ]);
      const context = resolveNativeAudioContext();
      const source = context.createBufferSource();
      const toneContext = audio.getPlaybackDiagnosticSnapshot().audioContext;
      const result = {
        toneUsesBootstrapContext: toneContext.browserNative,
        toneHasStandardizedProxyOwner:
          toneContext.standardizedProxyOwnerPresent,
        contextHasWrapperOwner:
          "_nativeAudioContext" in context || "_nativeContext" in context,
        sourceIsBrowserNative: source instanceof AudioBufferSourceNode,
        connectIsBrowserNative: Function.prototype.toString
          .call(source.connect)
          .includes("[native code]"),
      };
      source.disconnect();
      return result;
    });
    expect(nativeRouting).toEqual({
      toneUsesBootstrapContext: true,
      toneHasStandardizedProxyOwner: false,
      contextHasWrapperOwner: false,
      sourceIsBrowserNative: true,
      connectIsBrowserNative: true,
    });

    await page.getByTestId("open-load-dialog").click();
    await page.getByTestId("demo-list").waitFor();
    await page.getByTestId("demo-load-trap-starter").click();
    await page.getByTestId("demo-list").waitFor({ state: "hidden" });

    await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      getStore().patchProject({
        loopEnabled: true,
        loopStartBeat: 0,
        loopEndBeat: 16,
      });
      audio.setLoop(true, 0, 16);
    });

    await page.evaluate(() => {
      const probe = { ticks: 0, last: performance.now(), maxGapMs: 0, timer: 0 };
      probe.timer = window.setInterval(() => {
        const now = performance.now();
        probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.last);
        probe.last = now;
        probe.ticks += 1;
      }, 50);
      (window as typeof window & { __snDenseDemoProbe?: typeof probe }).__snDenseDemoProbe = probe;
    });
    await page.getByRole("button", { name: "Play" }).first().click();
    await expect(page.getByRole("button", { name: "Pause" }).first()).toBeVisible();
    await page.getByRole("tab", { name: "Library" }).click();
    for (const id of ["vcsl-neon-keys", "demon-truck", "vcsl-tenor-alley"]) {
      await page.getByTestId(`load-sound-pack-${id}`).click();
      await page.waitForTimeout(250);
    }
    await expect(page.getByTestId("load-sound-pack-vcsl-tenor-alley")).toHaveText("Loaded");

    // The former standardized-audio-context path became exponentially slower
    // as hits accumulated. Run past the runtime profile's failing six-second
    // checkpoint so this test covers the delayed event-loop starvation.
    const output = await captureOutput(page, 6_500);
    const state = await page.evaluate(async () => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      const probe = (window as typeof window & {
        __snDenseDemoProbe?: { ticks: number; last: number; maxGapMs: number; timer: number };
      }).__snDenseDemoProbe;
      if (!probe) throw new Error("Dense-demo heartbeat is missing.");
      window.clearInterval(probe.timer);
      probe.maxGapMs = Math.max(probe.maxGapMs, performance.now() - probe.last);
      const selector = audio
        .getVoiceSoundSelectorSnapshot()
        .find((entry) => entry.kitId === "garageband");
      return {
        ticks: probe.ticks,
        maxGapMs: probe.maxGapMs,
        selector,
        playback: audio.getPlaybackDiagnosticSnapshot(),
      };
    });

    expect(output.playbackState).toBe("playing");
    expect(output.peakDb).toBeGreaterThan(-60);
    expect(state.ticks).toBeGreaterThan(40);
    expect(state.maxGapMs).toBeLessThan(750);
    expect(state.selector).toMatchObject({ hasNativeKit: true, hasToneKit: false });
    expect(state.playback.requestedKits).toEqual([]);
    expect(state.playback.activeKitBuilds).toEqual([]);
    await page.getByRole("button", { name: "Stop" }).first().click();
    await page.getByRole("button", { name: /^Panic/ }).first().click();
  });

  test("rapid direct pack changes preserve output and converge on the final set", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openRealAudioStudio(page);

    await page.getByRole("button", { name: "Play" }).first().click();
    await expect(
      page.getByRole("button", { name: "Pause" }).first(),
    ).toBeVisible();
    const before = await captureOutput(page);
    expect(before.playbackState).toBe("playing");
    expect(before.peakDb).toBeGreaterThan(-60);

    await page.getByRole("tab", { name: "Library" }).click();
    await expect(
      page.getByTestId("load-sound-pack-vcsl-neon-keys"),
    ).toBeVisible();
    const switchProbe = await page.evaluate(async () => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      const probe = {
        lastTickAt: performance.now(),
        maxGapMs: 0,
        ticks: 0,
        peakDb: -Infinity,
        longestSilentMs: 0,
        silentStartedAt: null as number | null,
        timer: 0,
      };
      probe.timer = window.setInterval(() => {
        const now = performance.now();
        probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.lastTickAt);
        probe.lastTickAt = now;
        probe.ticks += 1;
        const peak = Math.max(...audio.getMasterLevels().peakDb);
        if (Number.isFinite(peak)) probe.peakDb = Math.max(probe.peakDb, peak);
        if (!Number.isFinite(peak) || peak < -70) {
          probe.silentStartedAt ??= now;
          probe.longestSilentMs = Math.max(
            probe.longestSilentMs,
            now - probe.silentStartedAt,
          );
        } else {
          probe.silentStartedAt = null;
        }
      }, 25);
      (
        window as typeof window & {
          __snKitSwitchProbe?: typeof probe;
        }
      ).__snKitSwitchProbe = probe;

      const ids = ["vcsl-neon-keys", "demon-truck", "vcsl-tenor-alley"];
      const durations = ids.map((id) => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-testid="load-sound-pack-${id}"]`,
        );
        if (!button) throw new Error(`Missing sound pack ${id}`);
        const started = performance.now();
        button.click();
        return performance.now() - started;
      });
      const drums = getStore().state.project.tracks.find(
        (track) => track.kind === "drums",
      );
      if (!drums) throw new Error("Sound-pack project has no drum track.");
      // Exercise the former synchronous bypass while the final kit candidate
      // is still building. The setting must persist and apply at commit
      // without silencing the lean voice or starting a second kit builder.
      getStore().setFxModule(drums.id, "compressor", {
        enabled: true,
        amount: 0.65,
      });
      return { durations, drumId: drums.id };
    });

    // A switch publishes both project state and the bounded native kit
    // immediately; no replacement graph is constructed beside playback.
    expect(Math.max(...switchProbe.durations)).toBeLessThan(350);
    await expect(
      page.getByTestId("load-sound-pack-vcsl-tenor-alley"),
    ).toHaveText("Loaded");

    const during = await captureOutput(page, 2_500);
    expect(during.playbackState).toBe("playing");
    expect(during.peakDb).toBeGreaterThan(-60);
    expect(during.longestSilentMs).toBeLessThan(700);

    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const { getStore } = await import("/src/store.ts");
          const project = getStore().state.project;
          const melodic = project.tracks.find(
            (track) => track.presetId === "brass.vcsl-tenor-sax-stabs",
          );
          const drums = project.tracks.find((track) => track.kind === "drums");
          const selectors =
            window.__SN_AUDIO_ENGINE_STATUS__?.soundSelectors() ?? [];
          const playback = window.__SN_AUDIO_ENGINE_STATUS__?.playback();
          const drumSelector = selectors.find((entry) => entry.trackId === drums?.id);
          return {
            soundPackId: project.soundPackId,
            presetId:
              selectors.find((entry) => entry.trackId === melodic?.id)
                ?.presetId ?? null,
            kitId: drumSelector?.kitId ?? null,
            hasNativeKit: drumSelector?.hasNativeKit ?? false,
            requestedKits: playback?.requestedKits.length ?? -1,
            activeKitBuilds: playback?.activeKitBuilds.length ?? -1,
            sampleDecodeActive:
              (playback?.samplerPromotions.cache.activeDecodes ?? -1) > 0,
          };
        }),
      )
      .toEqual({
        soundPackId: "vcsl-tenor-alley",
        presetId: "brass.vcsl-tenor-sax-stabs",
        kitId: "garageband",
        hasNativeKit: true,
        requestedKits: 0,
        activeKitBuilds: 0,
        sampleDecodeActive: false,
      });
    const continuity = await page.evaluate(async (drumId) => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      const probe = (
        window as typeof window & {
          __snKitSwitchProbe?: {
            lastTickAt: number;
            maxGapMs: number;
            ticks: number;
            peakDb: number;
            longestSilentMs: number;
            silentStartedAt: number | null;
            timer: number;
          };
        }
      ).__snKitSwitchProbe;
      if (!probe) throw new Error("Kit-switch continuity probe is missing.");
      window.clearInterval(probe.timer);
      const now = performance.now();
      probe.maxGapMs = Math.max(probe.maxGapMs, now - probe.lastTickAt);
      if (probe.silentStartedAt !== null) {
        probe.longestSilentMs = Math.max(
          probe.longestSilentMs,
          now - probe.silentStartedAt,
        );
      }
      const voice = audio
        .getVoiceMixSnapshot()
        .find((entry) => entry.trackId === drumId);
      return {
        maxGapMs: probe.maxGapMs,
        ticks: probe.ticks,
        peakDb: probe.peakDb,
        longestSilentMs: probe.longestSilentMs,
        playbackState: audio.getPlaybackState(),
        hasCompressor: voice?.hasCompressor ?? false,
      };
    }, switchProbe.drumId);
    expect(continuity.playbackState).toBe("playing");
    expect(continuity.ticks).toBeGreaterThan(20);
    expect(continuity.maxGapMs).toBeLessThan(750);
    expect(continuity.peakDb).toBeGreaterThan(-60);
    expect(continuity.longestSilentMs).toBeLessThan(900);
    expect(continuity.hasCompressor).toBe(true);

    // Stop remains the safe boundary for optional melodic sample enrichment;
    // the drum kit and mixer graph must already be final and request-free.
    await page.getByRole("button", { name: "Stop" }).first().click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const [{ audio }, { getStore }] = await Promise.all([
            import("/src/lib/audio/engine.ts"),
            import("/src/store.ts"),
          ]);
          const project = getStore().state.project;
          const drums = project.tracks.find((track) => track.kind === "drums");
          const selector = audio
            .getVoiceSoundSelectorSnapshot()
            .find((entry) => entry.trackId === drums?.id);
          const playback = audio.getPlaybackDiagnosticSnapshot();
          return {
            kitId: selector?.kitId ?? null,
            requestedKits: playback.requestedKits.length,
            activeKitBuilds: playback.activeKitBuilds.length,
            hasCompressor:
              audio.getVoiceMixSnapshot().find((entry) => entry.trackId === drums?.id)
                ?.hasCompressor ?? false,
          };
        }),
        { timeout: 30_000 },
      )
      .toEqual({
        kitId: "garageband",
        requestedKits: 0,
        activeKitBuilds: 0,
        hasCompressor: true,
      });
    await page.evaluate(async () => {
      const { audio } = await import("/src/lib/audio/engine.ts");
      await audio.whenSampleWorkSettled(30_000);
    });

    await page.getByRole("button", { name: "Play" }).first().click();
    const afterUpgrade = await captureOutput(page, 1_000);
    expect(afterUpgrade.playbackState).toBe("playing");
    expect(afterUpgrade.peakDb).toBeGreaterThan(-60);
    await page.getByRole("button", { name: "Stop" }).first().click();
    await page.getByRole("button", { name: /^Panic/ }).first().click();
    expect(errors).toEqual([]);
  });
});
