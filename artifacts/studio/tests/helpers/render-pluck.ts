import * as Tone from "tone";
import { PolyPluck } from "../../src/lib/audio/voices";

// Import Tone through Vite's normal resolver so the instrument and offline
// render share a single context owner (a bare /deps URL creates a second one).
export async function renderPluck(velocity: number, dampening: number) {
  let voice: PolyPluck | undefined;
  try {
    const buffer = await Tone.Offline(() => {
      voice = new PolyPluck({ dampening, release: 0.2, volume: -10 });
      voice.connect(Tone.getDestination());
      voice.triggerAttackRelease("A3", 0.25, 0.01, velocity);
    }, 0.9, 1, 44_100);
    const data = buffer.getChannelData(0);
    let energy = 0, difference = 0, tail = 0;
    for (let i = 1; i < data.length; i++) {
      energy += data[i] ** 2;
      difference += (data[i] - data[i - 1]) ** 2;
      if (i > data.length - 441) tail = Math.max(tail, Math.abs(data[i]));
    }
    return { energy, brightness: difference / energy, tail };
  } finally { voice?.dispose(); }
}
