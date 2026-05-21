import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Share2, X } from "lucide-react";
import { downloadBlob } from "../lib/audio/export";
import { shareCardBlob } from "../lib/share";

export interface ShareCardData {
  projectName: string;
  bpm: number;
  genre?: string;
  exportDate: Date;
}

function renderShareCard(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
): void {
  const W = 1200;
  const H = 630;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#0c0c0c";
  ctx.fillRect(0, 0, W, H);

  // Subtle grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x < W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Left accent bar
  const barW = 6;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#7a0007");
  grad.addColorStop(0.5, "#cc0011");
  grad.addColorStop(1, "#7a0007");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, barW, H);

  // Neon glow blob top-right
  const glow = ctx.createRadialGradient(W, 0, 0, W, 0, 500);
  glow.addColorStop(0, "rgba(0,255,200,0.08)");
  glow.addColorStop(1, "rgba(0,255,200,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Top label
  ctx.font = "bold 13px 'Courier New', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.letterSpacing = "4px";
  ctx.fillText("MADE WITH", 60, 72);

  // Brand wordmark
  ctx.font = "bold 56px 'Arial', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("SHOTGUN NINJAS", 58, 140);

  ctx.font = "bold 20px 'Courier New', monospace";
  ctx.fillStyle = "#cc1a2a";
  ctx.fillText("VIRTUAL STUDIO", 62, 175);

  // Divider
  ctx.strokeStyle = "rgba(122,0,7,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 200);
  ctx.lineTo(W - 60, 200);
  ctx.stroke();

  // Project name
  const maxNameWidth = W - 120;
  let fontSize = 88;
  ctx.font = `bold ${fontSize}px 'Arial', sans-serif`;
  while (ctx.measureText(data.projectName).width > maxNameWidth && fontSize > 36) {
    fontSize -= 4;
    ctx.font = `bold ${fontSize}px 'Arial', sans-serif`;
  }
  ctx.fillStyle = "#f0f0f0";
  ctx.fillText(data.projectName, 60, 320);

  // BPM badge
  const bpmLabel = `${data.bpm} BPM`;
  ctx.font = "bold 22px 'Courier New', monospace";
  const bpmW = ctx.measureText(bpmLabel).width + 32;
  const bpmX = 60;
  const bpmY = 360;
  ctx.fillStyle = "rgba(122,0,7,0.7)";
  roundRect(ctx, bpmX, bpmY, bpmW, 40, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(204,0,17,0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, bpmX, bpmY, bpmW, 40, 6);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px 'Courier New', monospace";
  ctx.fillText(bpmLabel, bpmX + 16, bpmY + 26);

  // Genre badge
  if (data.genre) {
    const genreLabel = data.genre.toUpperCase();
    const gX = bpmX + bpmW + 12;
    ctx.font = "bold 18px 'Courier New', monospace";
    const gW = ctx.measureText(genreLabel).width + 32;
    ctx.fillStyle = "rgba(0,40,30,0.6)";
    roundRect(ctx, gX, bpmY, gW, 40, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,255,200,0.25)";
    ctx.lineWidth = 1;
    roundRect(ctx, gX, bpmY, gW, 40, 6);
    ctx.stroke();
    ctx.fillStyle = "#00ffe0";
    ctx.fillText(genreLabel, gX + 16, bpmY + 26);
  }

  // Date
  const dateStr = data.exportDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  ctx.font = "15px 'Courier New', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillText(dateStr, 60, 450);

  // Waveform decoration
  ctx.strokeStyle = "rgba(122,0,7,0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const waveY = 500;
  const waveW = W - 120;
  const bars = 80;
  for (let i = 0; i < bars; i++) {
    const x = 60 + (i / bars) * waveW;
    const h = 8 + Math.abs(Math.sin(i * 0.4) * Math.cos(i * 0.17) * 36);
    ctx.moveTo(x, waveY - h / 2);
    ctx.lineTo(x, waveY + h / 2);
  }
  ctx.stroke();

  // Bottom URL
  ctx.font = "13px 'Courier New', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText("shotgunninjas.com/studio", 60, H - 32);

  // Bottom-right logo text
  ctx.font = "bold 11px 'Courier New', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  const logoText = "SN STUDIO";
  const ltW = ctx.measureText(logoText).width;
  ctx.fillText(logoText, W - 60 - ltW, H - 32);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function ShareCardModal({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: ShareCardData | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !data || !canvasRef.current) return;
    renderShareCard(canvasRef.current, data);
  }, [open, data]);

  const getSafeFilename = () => {
    if (!data) return "sn-studio-beat.png";
    const safe = data.projectName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
    return `sn-studio-${safe}.png`;
  };

  const handleDownload = async () => {
    if (!canvasRef.current || !data) return;
    setDownloading(true);
    try {
      canvasRef.current.toBlob(
        (blob) => {
          if (!blob) return;
          downloadBlob(blob, getSafeFilename());
          setDownloading(false);
        },
        "image/png",
      );
    } catch {
      setDownloading(false);
    }
  };

  const handleShare = () => {
    if (!canvasRef.current || !data) return;
    setSharing(true);
    setShareResult(null);
    canvasRef.current.toBlob(
      async (blob) => {
        if (!blob) { setSharing(false); return; }
        try {
          const result = await shareCardBlob(blob, getSafeFilename(), data.projectName);
          if (result === "copied") {
            setShareResult("Link copied to clipboard!");
          } else if (result === "unsupported") {
            setShareResult("Sharing not supported — try Download.");
          }
        } finally {
          setSharing(false);
        }
      },
      "image/png",
    );
  };

  if (!data) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest text-xs text-primary">
            Your beat is ready — share it?
          </DialogTitle>
          <DialogDescription>
            Download this card and share it on social media to show off your track.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg overflow-hidden border border-border bg-black">
          <canvas
            ref={canvasRef}
            className="w-full h-auto"
            style={{ aspectRatio: "1200/630" }}
          />
        </div>
        <div className="flex items-center gap-3 justify-between pt-1">
          <div className="flex-1">
            {shareResult && (
              <p className="font-mono text-xs text-muted-foreground">{shareResult}</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="font-mono text-xs"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Skip
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              disabled={sharing || downloading}
              className="font-mono text-xs"
            >
              <Share2 className="w-3.5 h-3.5 mr-1" />
              {sharing ? "Sharing…" : "Share"}
            </Button>
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={downloading || sharing}
              className="font-mono text-xs"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {downloading ? "Saving…" : "Download Card"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
