---
name: Imported artifact registration
description: How to handle an imported artifact manifest that is absent from Replit's live artifact and workflow registries.
---

Treat the live artifact and workflow registries as authoritative after a GitHub import; a checked-in artifact manifest alone does not guarantee managed services were registered.

**Why:** An imported workspace had valid artifact metadata on disk, but both artifact and workflow registry queries were empty, so its managed workflow could not be restarted or screenshotted as an artifact.

**How to apply:** Check the live registries before restarting an imported artifact. If both are empty, use one descriptive fallback web workflow that preserves the manifest's existing port and base path, and avoid creating a duplicate artifact directory.