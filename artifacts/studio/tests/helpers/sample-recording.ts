/** DC exposes envelope edges; an optional carrier survives the export HPF. */
export function sampleRecording(
  rate: number,
  seconds: number,
  toneHz = 0,
): Blob {
  const frames = Math.round(rate * seconds);
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const wave = toneHz ? Math.sin((2 * Math.PI * toneHz * i) / rate) : 1;
    view.setInt16(44 + i * 2, Math.round(12000 * wave), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}
