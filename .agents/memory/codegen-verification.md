---
name: Codegen verification
description: Avoid false-positive success when checking dependency updates to Orval.
---

Check Orval's generated files and error output, not just its process exit status.

**Why:** A code-generation smoke test logged an unsupported runtime API error, returned exit status zero, and emitted no Zod schemas. The normal app build cannot catch this because it consumes already-generated schemas.

**How to apply:** After updating code-generation dependencies or the runtime, generate both client and schema outputs in a temporary directory and assert that the expected files exist. Keep normal generated source untouched during a dependency-only verification.
