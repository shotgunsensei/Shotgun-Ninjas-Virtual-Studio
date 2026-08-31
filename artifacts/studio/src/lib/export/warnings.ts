/** Keep every material export caveat visible after a successful download.
 * The renderer orders broad approximation notes before missing-media notes, so
 * showing only the first entry could hide an incomplete mix from the user. */
export function formatExportWarnings(
  warnings: readonly string[] | undefined,
): string | null {
  const visible = (warnings ?? []).map((warning) => warning.trim()).filter(Boolean);
  return visible.length > 0 ? visible.join(" • ") : null;
}
