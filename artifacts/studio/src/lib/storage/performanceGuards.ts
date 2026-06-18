const HUGE_SAMPLE_BYTES = 50 * 1024 * 1024;
const LARGE_SAMPLE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_IMPORT_BYTES = 150 * 1024 * 1024;

let criticalOperationDepth = 0;

const blobHashCache = new WeakMap<Blob, Promise<string>>();
let worker: Worker | null = null;
let workerSeq = 0;
const workerRequests = new Map<
  number,
  {
    resolve: (value: string) => void;
    reject: (reason?: unknown) => void;
    timeout: number;
  }
>();

export function beginStorageCriticalOperation(): () => void {
  criticalOperationDepth++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    criticalOperationDepth = Math.max(0, criticalOperationDepth - 1);
  };
}

export function isStorageCriticalOperationActive(): boolean {
  return criticalOperationDepth > 0;
}

export function isHugeSample(file: Blob): boolean {
  return file.size > HUGE_SAMPLE_BYTES;
}

export function isLargeSample(file: Blob): boolean {
  return file.size > LARGE_SAMPLE_BYTES;
}

export function assertSampleImportAllowed(file: Blob) {
  if (isHugeSample(file)) {
    throw new Error(
      `Sample is too large (${formatBytes(file.size)}). Keep imports under ${formatBytes(HUGE_SAMPLE_BYTES)} for browser stability.`,
    );
  }
}

export function assertJsonImportAllowed(file: Blob) {
  if (file.size > MAX_JSON_IMPORT_BYTES) {
    throw new Error(
      `Project file is too large (${formatBytes(file.size)}). Export/import without embedded samples or split the project first.`,
    );
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export async function blobContentFingerprint(blob: Blob): Promise<string> {
  let pending = blobHashCache.get(blob);
  if (!pending) {
    pending = workerFingerprint(blob).catch(() => mainThreadFingerprint(blob));
    blobHashCache.set(blob, pending);
  }
  return pending;
}

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../../workers/sampleImportWorker.ts", import.meta.url), {
      type: "module",
      name: "sample-import-worker",
    });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; fingerprint?: string; error?: string }>) => {
      const pending = workerRequests.get(event.data.id);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      workerRequests.delete(event.data.id);
      if (event.data.ok && event.data.fingerprint) {
        pending.resolve(event.data.fingerprint);
      } else {
        pending.reject(new Error(event.data.error || "Sample fingerprint worker failed"));
      }
    };
    worker.onerror = (event) => {
      for (const [id, pending] of workerRequests.entries()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error(event.message || "Sample fingerprint worker error"));
        workerRequests.delete(id);
      }
      disposeWorker();
    };
    return worker;
  } catch {
    disposeWorker();
    return null;
  }
}

function disposeWorker(): void {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  }
}

async function workerFingerprint(blob: Blob): Promise<string> {
  const activeWorker = getWorker();
  if (!activeWorker) throw new Error("Sample fingerprint worker unavailable");
  const id = ++workerSeq;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      workerRequests.delete(id);
      reject(new Error("Sample fingerprint worker timed out"));
    }, 30_000);
    workerRequests.set(id, { resolve, reject, timeout });
    activeWorker.postMessage({ id, type: "fingerprint", blob });
  });
}

async function mainThreadFingerprint(blob: Blob): Promise<string> {
  const arr = await blob.arrayBuffer();
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", arr);
    return `sha256:${hex(new Uint8Array(digest))}:${blob.size}:${blob.type}`;
  }
  return `fallback:${fallbackHash(new Uint8Array(arr))}:${blob.size}:${blob.type}`;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fallbackHash(bytes: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
