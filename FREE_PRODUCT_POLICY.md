# Free Product Policy — Shotgun Ninjas Virtual Studio

**Authoritative policy. This document governs every Phase 3+ task.**

Shotgun Ninjas Virtual Studio is, and will remain, **free forever** for end
users. This is a product principle, not a marketing slogan. Tasks, PRs, and
features that contradict this policy must be rejected.

## What "free forever" means

1. **No paywalls.** No feature, instrument, preset, effect, export format,
   project slot, or sample is ever locked behind a payment.
2. **No Stripe / no payment SDKs.** Do not introduce Stripe, Paddle, Lemon
   Squeezy, RevenueCat, Apple/Google IAP, or any other billing or
   subscription system into the studio artifact.
3. **No account walls.** Users must be able to open the app, create a beat,
   save it locally, and export a WAV without ever signing in or creating an
   account. Optional sign-in for sync (if ever added) must never gate core
   functionality.
4. **No locked exports.** WAV export, MIDI export, project JSON export, and
   any future export format are always available at full quality with no
   watermark, no length cap, and no usage cap.
5. **No credit / token system.** No "render credits", "AI tokens", "daily
   limits", or metered usage of any kind.
6. **No upsell prompts.** No "upgrade to Pro" CTAs, no "this feature is
   premium" modals, no "trial ending" banners, no nag screens.
7. **No telemetry-gated features.** Analytics, if added, must be opt-in and
   must not unlock anything when enabled.
8. **Optional brand links only.** A discreet link to the Shotgun Ninjas
   brand site or social channels is allowed (in About / footer). It must
   not be a modal, not be required to dismiss, and must not block the UI.

## What is allowed

- Optional integrations the user explicitly chooses to connect (e.g. a
  future "share to SoundCloud" button) — provided the core flow works
  without them.
- External "buy our merch / follow the brand" links in About or a footer,
  as long as they are unobtrusive.
- Donation / "support the project" links, as long as nothing is locked
  behind donating.

## Enforcement

Every Phase 3+ task description must be read with this policy in mind. If
a future task spec contradicts this document — for example, "add a Pro
tier" or "lock 4-track export to signed-in users" — flag it and refuse to
implement until the policy is explicitly amended by the project owner.

This file lives at the repo root so it shows up next to `README.md` for
anyone browsing the project, and so every agent and contributor sees it
before touching the codebase.
