# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 20
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm --filter @workspace/studio run dev` — run the browser studio locally (the Replit workflow supplies `PORT` and `BASE_PATH`)
- `pnpm --filter @workspace/studio run typecheck` — typecheck the studio app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Replit Workflow

Use the **Shotgun Ninjas Studio** workflow (or the Run button, which starts it).
It serves the Vite app at `/` with:

```sh
PORT=18425 BASE_PATH=/ pnpm --filter @workspace/studio run dev
```

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
