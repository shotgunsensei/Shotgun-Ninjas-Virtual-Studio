interface DecodeJob {
  blob: Blob;
  context: BaseAudioContext;
  consumers: Set<() => boolean>;
  promise: Promise<AudioBuffer | null>;
  resolve: (buffer: AudioBuffer | null) => void;
  reject: (error: unknown) => void;
}

const MAX_CONCURRENT_DECODES = 3;
const inFlight = new WeakMap<BaseAudioContext, WeakMap<Blob, DecodeJob>>();
const waiting: DecodeJob[] = [];
let active = 0;

/** Coalesce simultaneous copies of one sample, then release the cache entry.
 * PCM stays owned only by live instruments; project-library Blobs cannot keep
 * every previously auditioned decoded buffer alive indefinitely. */
export function decodeInstrumentSample(
  blob: Blob,
  context: BaseAudioContext,
  isCurrent: () => boolean,
): Promise<AudioBuffer | null> {
  let byBlob = inFlight.get(context);
  if (!byBlob) { byBlob = new WeakMap(); inFlight.set(context, byBlob); }
  let job = byBlob.get(blob);
  if (job) {
    job.consumers.add(isCurrent);
    return job.promise;
  }
  let resolve!: DecodeJob["resolve"];
  let reject!: DecodeJob["reject"];
  const promise = new Promise<AudioBuffer | null>((yes, no) => { resolve = yes; reject = no; });
  job = { blob, context, consumers: new Set([isCurrent]), promise, resolve, reject };
  byBlob.set(blob, job);
  waiting.push(job);
  drain();
  return promise;
}

function drain(): void {
  while (active < MAX_CONCURRENT_DECODES && waiting.length > 0) {
    const job = waiting.shift()!;
    active++;
    void run(job).then(job.resolve, job.reject).finally(() => {
      inFlight.get(job.context)?.delete(job.blob);
      job.consumers.clear();
      active--;
      drain();
    });
  }
}

async function run(job: DecodeJob): Promise<AudioBuffer | null> {
  const current = () => Array.from(job.consumers).some((isCurrent) => isCurrent());
  if (!current()) return null;
  const bytes = await job.blob.arrayBuffer();
  if (!current()) return null;
  return job.context.decodeAudioData(bytes);
}
