#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Database changes require a separately reviewed target, backup, and approval.
# See docs/POST_MERGE_DATABASE_SAFETY.md; this hook performs dependency setup only.
