import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Shield, WifiOff, Infinity, UserX } from "lucide-react";

/**
 * Trust statement modal showing two tabs: Privacy Statement and
 * Offline-First Statement. Opened by clicking any trust badge in the
 * footer or About dialog.
 */
export function TrustStatementModal({
  open,
  onOpenChange,
  defaultTab,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTab?: "privacy" | "offline";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Trust &amp; Privacy</DialogTitle>
          <DialogDescription>
            Shotgun Ninjas Virtual Studio is designed around one principle: your
            music is yours.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={defaultTab ?? "privacy"}>
          <TabsList className="grid grid-cols-2 w-full bg-graphite/60">
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
            <TabsTrigger value="offline">Offline-First</TabsTrigger>
          </TabsList>

          <TabsContent value="privacy" className="space-y-3 pt-3">
            <TrustSection icon={<Shield className="w-4 h-4 text-primary" />} title="Privacy Statement">
              <p>
                Shotgun Ninjas Virtual Studio collects <strong>no personal data</strong>.
                We run no analytics, no tracking scripts, and no telemetry of
                any kind. We do not use cookies for advertising or profiling.
              </p>
              <p>
                Your projects, samples, and recordings never leave your browser.
                There is no account system, no sign-up wall, and nothing to
                log in to. Your email address is never requested.
              </p>
              <p>
                The only network requests made by the studio are:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Loading the app code and instrument samples on first visit (cached after that)</li>
                <li>Fetching sound library packs you explicitly add (audio files only, no metadata)</li>
              </ul>
              <p>
                No data is ever sent to a server. If you use the studio offline,
                it works identically — the network is never required once loaded.
              </p>
            </TrustSection>
          </TabsContent>

          <TabsContent value="offline" className="space-y-3 pt-3">
            <TrustSection icon={<WifiOff className="w-4 h-4 text-primary" />} title="Offline-First Statement">
              <p>
                The studio is a Progressive Web App (PWA) built to work
                entirely offline. Once you have loaded it once, you can use it
                without any internet connection — on a plane, in a studio, or
                anywhere.
              </p>
              <p>
                All your data lives in your browser:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>Projects</strong> — saved to IndexedDB in your browser</li>
                <li><strong>Audio clips &amp; recordings</strong> — stored as binary blobs in IndexedDB</li>
                <li><strong>Imported samples</strong> — kept in IndexedDB alongside your project</li>
                <li><strong>Settings</strong> — saved to localStorage</li>
              </ul>
              <p>
                Nothing is uploaded to a cloud service. Your creative work stays
                on your device — always. Export a <code>.snproj.json</code> file
                regularly as an extra backup you control.
              </p>
            </TrustSection>
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
          <TrustBadge icon={<Infinity className="w-3 h-3" />} label="Free forever" />
          <TrustBadge icon={<UserX className="w-3 h-3" />} label="No account required" />
          <TrustBadge icon={<WifiOff className="w-3 h-3" />} label="Works offline" />
          <TrustBadge icon={<Shield className="w-3 h-3" />} label="Your files stay on your device" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrustSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
        {icon}
        {title}
      </div>
      <div className="text-sm text-foreground/85 space-y-2 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function TrustBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {label}
    </div>
  );
}

/**
 * Compact trust badge strip for the footer. Clicking any badge opens
 * the TrustStatementModal.
 */
export function TrustBadgeStrip({
  onOpen,
}: {
  onOpen: (tab: "privacy" | "offline") => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <FooterBadge
        icon={<Infinity className="w-2.5 h-2.5" />}
        label="Free forever"
        onClick={() => onOpen("privacy")}
      />
      <FooterBadge
        icon={<UserX className="w-2.5 h-2.5" />}
        label="No account"
        onClick={() => onOpen("privacy")}
      />
      <FooterBadge
        icon={<WifiOff className="w-2.5 h-2.5" />}
        label="Works offline"
        onClick={() => onOpen("offline")}
      />
      <FooterBadge
        icon={<Shield className="w-2.5 h-2.5" />}
        label="Your files, your device"
        onClick={() => onOpen("offline")}
      />
    </div>
  );
}

function FooterBadge({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
      title={`Learn more: ${label}`}
    >
      <span className="text-primary">{icon}</span>
      {label}
    </button>
  );
}
