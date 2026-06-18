# Performance Test Runner Profile

Date: 2026-06-18

## Problem

On Windows, Playwright printed four passing welcome-flow tests and then did not
return cleanly. That made the test gate inconclusive even when the tests had
actually finished.

## Fix

- `playwright.config.ts` starts Vite directly with the current Node runtime on
  `127.0.0.1:5174`.
- The web server command avoids POSIX-only environment syntax.
- `scripts/playwright-exit-reporter.cjs` counts completed tests and forces a
  clean Windows exit once every scheduled test has reported.
- `package.json` exposes `pnpm run test` and `pnpm run test:line`.

## Verification

| Command | Result | Notes |
| --- | --- | --- |
| `corepack pnpm --dir artifacts/studio run test` | Pass | 4/4 welcome-flow tests passed and exited cleanly. |
| `corepack pnpm --dir artifacts/studio run test:line` | Pass | 4/4 welcome-flow tests passed and exited cleanly when run independently. |

Run the two Playwright commands independently. Chaining both in one shell
segment produced one transient `Running 0 tests` artifact after the first
reporter-forced exit.

