import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { audio } from "../../lib/audio/engine";
import { useStore, getStore } from "../../store";
import type { Track } from "../../types";

export function VocalsPanel({ track }: { track: Track }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const deviceId = useStore((s) => s.vocalDeviceId) ?? "";
  const setDeviceId = (id: string) =>
    getStore().set({ vocalDeviceId: id || null });
  const [monitoring, setMonitoring] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const meterRef = useRef<Tone.Meter | null>(null);

  // populate devices once we have permissions
  const refreshDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch (err) {
      setPermError((err as Error).message);
    }
  };

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, []);

  // attach a meter to mic for level display when monitoring
  useEffect(() => {
    let raf = 0;
    if (monitoring) {
      const mic = audio.getMic(track.id);
      if (mic) {
        const meter = new Tone.Meter({ smoothing: 0.7 });
        mic.connect(meter);
        meterRef.current = meter;
        const tick = () => {
          const v = meter.getValue();
          const db = typeof v === "number" ? v : v[0];
          // map -60..0 -> 0..1
          const norm = Math.max(0, Math.min(1, (db + 60) / 60));
          setLevel(norm);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
    }
    return () => {
      cancelAnimationFrame(raf);
      if (meterRef.current) {
        meterRef.current.dispose();
        meterRef.current = null;
      }
      setLevel(0);
    };
  }, [monitoring, track.id]);

  const startMon = async () => {
    setPermError(null);
    try {
      await audio.unlock();
      getStore().set({ audioUnlocked: true });
      await audio.startVocalMonitor(track.id, deviceId || undefined);
      setMonitoring(true);
      // After permission, device labels become available
      refreshDevices();
    } catch (err) {
      setPermError((err as Error).message);
    }
  };
  const stopMon = () => {
    audio.stopVocalMonitor(track.id);
    setMonitoring(false);
  };

  return (
    <div className="p-3 panel">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {track.name} · Vocals
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          Arm + record to capture a take
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-widest">
            Input Device
          </label>
          <Select
            value={deviceId}
            onValueChange={(v) => {
              setDeviceId(v);
              if (monitoring) {
                stopMon();
                requestAnimationFrame(() => startMon());
              }
            }}
          >
            <SelectTrigger className="bg-background h-8 text-xs">
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              {devices.length === 0 && (
                <SelectItem value="__none" disabled>
                  Grant mic access to list devices
                </SelectItem>
              )}
              {devices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">
                  {d.label || `Mic (${d.deviceId.slice(0, 6)})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={monitoring ? stopMon : startMon}
            variant={monitoring ? "destructive" : "default"}
            className="w-full"
            size="sm"
          >
            {monitoring ? (
              <>
                <MicOff className="w-4 h-4 mr-2" />
                Stop Monitor
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Start Monitor
              </>
            )}
          </Button>

          {permError && (
            <div className="text-[11px] text-destructive font-mono border border-destructive/40 bg-destructive/10 rounded p-2">
              {permError}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-widest">
            Input Level
          </label>
          <div className="h-6 panel-inset rounded overflow-hidden relative">
            <div
              className="h-full transition-all"
              style={{
                width: `${level * 100}%`,
                background:
                  level > 0.85
                    ? "hsl(var(--blood))"
                    : level > 0.6
                      ? "hsl(var(--neon))"
                      : "hsl(var(--neon) / 0.5)",
              }}
            />
            <div className="absolute inset-0 grid grid-cols-12 pointer-events-none">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="border-r border-background/40" />
              ))}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">
            {monitoring
              ? "Monitoring your input — adjust the channel volume to mix."
              : "Click Start Monitor to hear your mic through the FX chain."}
          </p>
          {track.audioClips.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => getStore().clearTrackClips(track.id)}
            >
              Clear take
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
