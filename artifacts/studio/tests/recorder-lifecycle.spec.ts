import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });
});

test("concurrent vocal Stop calls share one MediaRecorder finalization", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { vocalRecorder } = await import("/src/lib/audio/recorder.ts");
    let stoppedTracks = 0;
    let recorderStops = 0;
    const fakeTrack = { stop: () => { stoppedTracks += 1; } };
    const fakeStream = { getTracks: () => [fakeTrack] } as unknown as MediaStream;

    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      state: RecordingState = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}
      start() { this.state = "recording"; }
      stop() {
        recorderStops += 1;
        if (this.state !== "recording") throw new DOMException("inactive", "InvalidStateError");
        this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(["take"]) } as BlobEvent);
          this.onstop?.();
        });
      }
    }

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    const OriginalMediaRecorder = window.MediaRecorder;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => fakeStream,
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });

    try {
      await vocalRecorder.start("vocal-owner", undefined, 12);
      const [first, second] = await Promise.all([
        vocalRecorder.stop(),
        vocalRecorder.stop(),
      ]);
      return {
        recorderStops,
        stoppedTracks,
        firstStart: first?.startBeat,
        secondStart: second?.startBeat,
        firstSize: first?.blob.size,
        secondSize: second?.blob.size,
        busy: vocalRecorder.isBusy(),
        owner: vocalRecorder.getTrackId(),
      };
    } finally {
      vocalRecorder.cancel();
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: originalGetUserMedia,
      });
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: OriginalMediaRecorder,
      });
    }
  });

  expect(result).toEqual({
    recorderStops: 1,
    stoppedTracks: 1,
    firstStart: 12,
    secondStart: 12,
    firstSize: 4,
    secondSize: 4,
    busy: false,
    owner: null,
  });
});

test("Panic cancellation invalidates pending microphone permission", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { vocalRecorder, cancelAllRecorders } = await import("/src/lib/audio/recorder.ts");
    let releasePermission!: (stream: MediaStream) => void;
    let stoppedTracks = 0;
    const fakeStream = {
      getTracks: () => [{ stop: () => { stoppedTracks += 1; } }],
    } as unknown as MediaStream;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => new Promise<MediaStream>((resolve) => { releasePermission = resolve; }),
    });

    try {
      const starting = vocalRecorder.start("pending-owner", undefined, 4);
      await Promise.resolve();
      cancelAllRecorders();
      releasePermission(fakeStream);
      let errorName = "";
      try {
        await starting;
      } catch (error) {
        errorName = error instanceof DOMException ? error.name : "unknown";
      }
      return {
        errorName,
        stoppedTracks,
        busy: vocalRecorder.isBusy(),
        owner: vocalRecorder.getTrackId(),
      };
    } finally {
      vocalRecorder.cancel();
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: originalGetUserMedia,
      });
    }
  });

  expect(result).toEqual({
    errorName: "AbortError",
    stoppedTracks: 1,
    busy: false,
    owner: null,
  });
});
