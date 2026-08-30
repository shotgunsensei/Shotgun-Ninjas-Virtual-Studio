export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "song";
}

export function studioExportFilename(
  projectName: string,
  bpm: number,
  extension: string,
): string {
  return `shotgun-ninjas-studio_${safeFilename(projectName)}_${Math.round(bpm)}_${dateStamp()}.${extension}`;
}

export function studioProjectFilename(projectName: string): string {
  return `shotgun-ninjas-studio_${safeFilename(projectName)}_${dateStamp()}.snproj.json`;
}

function dateStamp(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
