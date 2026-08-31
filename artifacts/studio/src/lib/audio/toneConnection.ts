import * as Tone from "tone";

/**
 * Connect a raw-context or Tone output through Tone's compatibility layer.
 *
 * Tone 15 may run on standardized-audio-context wrappers. Those nodes satisfy
 * Tone's AudioNode types but are not necessarily instances of the browser's
 * global `AudioNode`, so native `instanceof` checks are not a safe boundary.
 */
export function connectToneCompatible(
  source: Tone.OutputNode,
  destination: Tone.InputNode,
): void {
  if (typeof AudioNode !== "undefined" && destination instanceof AudioNode) {
    resolveToneContextOutput(source).connect(destination);
    return;
  }
  if (typeof AudioNode !== "undefined" && source instanceof AudioNode) {
    source.connect(resolveToneContextInput(destination));
    return;
  }
  Tone.connect(source, destination);
}

/** Disconnect the matching compatibility-layer connection. */
export function disconnectToneCompatible(
  source: Tone.OutputNode,
  destination?: Tone.InputNode,
): void {
  if (typeof AudioNode !== "undefined" && destination instanceof AudioNode) {
    resolveToneContextOutput(source).disconnect(destination);
    return;
  }
  if (typeof AudioNode !== "undefined" && source instanceof AudioNode) {
    if (destination) source.disconnect(resolveToneContextInput(destination));
    else source.disconnect();
    return;
  }
  Tone.disconnect(source, destination);
}

/**
 * Resolve the context-level input hidden behind a Tone node.
 *
 * Raw sources created from `Tone.getContext().rawContext` must connect to the
 * leaf node owned by that same context. Tone nodes can contain several nested
 * `input` wrappers (for example Gain -> Solo -> Gain -> context GainNode), so
 * this deliberately follows the wrapper chain without relying on a native
 * `AudioNode` `instanceof` check.
 */
export function resolveToneContextInput(destination: Tone.InputNode): AudioNode {
  return resolveToneContextNode(destination, "input");
}

/** Resolve the native output leaf behind a Tone/standardized wrapper. */
export function resolveToneContextOutput(source: Tone.OutputNode): AudioNode {
  return resolveToneContextNode(source, "output");
}

/**
 * Return the browser-owned real-time AudioContext underneath Tone and
 * standardized-audio-context.
 *
 * `Tone.getContext().rawContext` is not necessarily the browser context: in
 * Tone 15 it can still be a standardized-audio-context proxy. Creating every
 * short drum source on that proxy makes each `connect()` recursively inspect
 * the complete downstream graph for cycles. Dense patterns then spend more
 * time walking the graph than scheduling audio. Long-lived Tone nodes can use
 * the proxy, but transient native sources must use the actual context and
 * cross into Tone at one resolved native leaf.
 */
export function resolveNativeAudioContext(context: unknown = Tone.getContext()): AudioContext {
  const queue: unknown[] = [context];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const wrapper = current as {
      rawContext?: unknown;
      _context?: unknown;
      _nativeContext?: unknown;
      _nativeAudioContext?: unknown;
    };
    const wrappedNativeContexts = [
      wrapper._nativeAudioContext,
      wrapper._nativeContext,
    ].filter((candidate) => candidate && candidate !== current);

    if (wrappedNativeContexts.length > 0) {
      // standardized-audio-context's wrapper can satisfy the browser's
      // BaseAudioContext instanceof check. Prefer its explicit native owner;
      // otherwise every transient source uses the wrapper's recursive graph
      // cycle scan and dense playback eventually monopolizes the main thread.
      queue.unshift(...wrappedNativeContexts);
      queue.push(wrapper.rawContext, wrapper._context);
      continue;
    }

    if (
      typeof BaseAudioContext !== "undefined" &&
      current instanceof BaseAudioContext &&
      "resume" in current
    ) {
      return current as AudioContext;
    }

    queue.push(
      wrapper.rawContext,
      wrapper._context,
    );
  }

  throw new Error("Unable to resolve Tone's native real-time AudioContext.");
}

function resolveToneContextNode(
  node: Tone.InputNode | Tone.OutputNode,
  direction: "input" | "output",
): AudioNode {
  let current: unknown = node;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const wrapper = current as {
      input?: unknown;
      output?: unknown;
      _nativeAudioNode?: unknown;
    };
    // standardized-audio-context proxies expose their underlying node here.
    // A raw AudioWorkletNode must connect to that native leaf; passing the
    // proxy directly to native `connect()` throws InvalidAccessError.
    if (
      wrapper._nativeAudioNode &&
      typeof (wrapper._nativeAudioNode as { connect?: unknown }).connect === "function"
    ) {
      return wrapper._nativeAudioNode as AudioNode;
    }
    const next = direction === "input"
      ? (wrapper.input ?? wrapper.output)
      : (wrapper.output ?? wrapper.input);
    if (next && next !== current) {
      current = next;
      continue;
    }

    if (typeof (current as { connect?: unknown }).connect === "function") {
      return current as AudioNode;
    }
    break;
  }

  throw new Error(`Unable to resolve the Tone context ${direction}.`);
}
