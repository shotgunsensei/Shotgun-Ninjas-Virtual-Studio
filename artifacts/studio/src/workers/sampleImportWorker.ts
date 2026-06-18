type WorkerRequest = {
  id: number;
  type: "fingerprint";
  blob: Blob;
};

type WorkerResponse =
  | { id: number; ok: true; fingerprint: string }
  | { id: number; ok: false; error: string };

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

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, blob } = event.data;
  if (type !== "fingerprint") return;
  try {
    const arr = await blob.arrayBuffer();
    let fingerprint: string;
    if (self.crypto?.subtle) {
      const digest = await self.crypto.subtle.digest("SHA-256", arr);
      fingerprint = `sha256:${hex(new Uint8Array(digest))}:${blob.size}:${blob.type}`;
    } else {
      fingerprint = `fallback:${fallbackHash(new Uint8Array(arr))}:${blob.size}:${blob.type}`;
    }
    self.postMessage({ id, ok: true, fingerprint } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};

export {};
