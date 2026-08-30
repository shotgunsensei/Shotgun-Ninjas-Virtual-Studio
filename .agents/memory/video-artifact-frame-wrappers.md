---
name: Video artifact frame wrappers
description: Layout constraint for animated scene components rendered through a transition wrapper.
---

Animated video scenes that are absolutely positioned must be inside a transition wrapper that explicitly fills the viewport (`position: absolute; inset: 0`).

**Why:** A transition wrapper with no in-flow children collapses to zero height, so its clip-path can hide every scene even though the scene component and animation logic are mounted.

**How to apply:** When scenes use absolute positioning, give the AnimatePresence motion wrapper full-frame dimensions before debugging scene content or animation timing.