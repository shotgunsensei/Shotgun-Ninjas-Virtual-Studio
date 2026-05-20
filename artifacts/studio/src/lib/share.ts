/**
 * Sharing + native file-picker helpers.
 *
 * Wraps the optional Web Share API and File System Access API behind
 * feature detection so the rest of the app can call them freely. When
 * the browser doesn't support them we fall back to the legacy download
 * / hidden-file-input flow used elsewhere in the studio.
 */
import { APP_NAME, APP_URL, SHARE_TEXT } from "./version";

type NavigatorWithShare = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
};

type FsHandleKind = "save" | "open";

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface FileSystemWritableFileStreamLike {
  write: (data: Blob | BufferSource | string) => Promise<void>;
  close: () => Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
  getFile: () => Promise<File>;
  name?: string;
}

interface WindowWithFs extends Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions,
  ) => Promise<FileSystemFileHandleLike[]>;
}

const PROJECT_TYPE = {
  description: "Shotgun Ninjas Studio project",
  accept: { "application/json": [".json", ".snproj.json"] },
};
const WAV_TYPE = {
  description: "WAV audio",
  accept: { "audio/wav": [".wav"] },
};

export const canWebShare = (): boolean => {
  const nav = navigator as NavigatorWithShare;
  return typeof nav.share === "function";
};

export const canWebShareFiles = (): boolean => {
  const nav = navigator as NavigatorWithShare;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    return false;
  }
  try {
    const probe = new File(["x"], "probe.txt", { type: "text/plain" });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
};

export const canUseFileSystemAccess = (kind: FsHandleKind): boolean => {
  const w = window as WindowWithFs;
  if (kind === "save") return typeof w.showSaveFilePicker === "function";
  return typeof w.showOpenFilePicker === "function";
};

/** Pop the native Save dialog and write `blob` to the chosen file.
 *  Resolves to the chosen filename or `null` when the user cancelled. */
export async function saveBlobWithPicker(
  blob: Blob,
  suggestedName: string,
  kind: "project" | "wav",
): Promise<string | null> {
  const w = window as WindowWithFs;
  if (!w.showSaveFilePicker) return null;
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName,
      types: [kind === "project" ? PROJECT_TYPE : WAV_TYPE],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return handle.name ?? suggestedName;
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return null;
    throw err;
  }
}

/** Pop the native Open dialog and return the chosen file. */
export async function openProjectWithPicker(): Promise<File | null> {
  const w = window as WindowWithFs;
  if (!w.showOpenFilePicker) return null;
  try {
    const [handle] = await w.showOpenFilePicker({
      multiple: false,
      types: [PROJECT_TYPE],
    });
    if (!handle) return null;
    return await handle.getFile();
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return null;
    throw err;
  }
}

export interface ShareLinkOptions {
  /** Override the URL shared. Defaults to the live `window.location`
   *  origin + pathname so the dev preview shares the right link. */
  url?: string;
  /** Title for the share sheet. */
  title?: string;
  /** Text body for the share sheet. */
  text?: string;
}

/** Live URL — preview iframe gets the proxied origin; deployed app
 *  gets its own. Falls back to the canonical APP_URL during SSR/tests. */
export function liveAppUrl(): string {
  if (typeof window === "undefined") return APP_URL;
  return window.location.origin + window.location.pathname;
}

export function buildShareText(extra?: string): string {
  return extra ? `${SHARE_TEXT} ${extra} ${liveAppUrl()}` : `${SHARE_TEXT} ${liveAppUrl()}`;
}

/** Share an app link via the Web Share sheet, falling back to copying
 *  to the clipboard. Returns the path taken so the caller can show an
 *  appropriate toast. */
export async function shareAppLink(
  opts: ShareLinkOptions = {},
): Promise<"shared" | "copied" | "cancelled" | "unsupported"> {
  const url = opts.url ?? liveAppUrl();
  const data: ShareData = {
    title: opts.title ?? APP_NAME,
    text: opts.text ?? SHARE_TEXT,
    url,
  };
  if (canWebShare()) {
    try {
      await (navigator as NavigatorWithShare).share!(data);
      return "shared";
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return "cancelled";
      // fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(`${data.text ?? ""} ${url}`.trim());
    return "copied";
  } catch {
    return "unsupported";
  }
}

/** Share a generated file (WAV or project JSON) via the Web Share sheet
 *  when the platform allows it. Returns "unsupported" when the browser
 *  can't share files — callers should fall back to a download. */
export async function shareFile(
  blob: Blob,
  filename: string,
  opts: ShareLinkOptions = {},
): Promise<"shared" | "cancelled" | "unsupported"> {
  if (!canWebShareFiles()) return "unsupported";
  const file = new File([blob], filename, { type: blob.type });
  const data: ShareData = {
    title: opts.title ?? APP_NAME,
    text: opts.text ?? SHARE_TEXT,
    files: [file],
  };
  try {
    const nav = navigator as NavigatorWithShare;
    if (nav.canShare && !nav.canShare(data)) return "unsupported";
    await nav.share!(data);
    return "shared";
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}
