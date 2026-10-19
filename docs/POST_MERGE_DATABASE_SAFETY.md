# Post-merge dependency setup and database safety

The configured Replit post-merge source path is scripts/post-merge.sh. It now
runs only pnpm install --frozen-lockfile, retaining shell failure propagation.
Database changes are deliberately absent from this hook.

The previous source also ran pnpm --filter db push. That command can change
the schema selected by DATABASE_URL through lib/db/drizzle.config.ts. A code
merge is not sufficient authorization to apply that change to an ambient
database. This is a source-level hazard: this change does not establish that
the hook ran previously, that a GitHub merge automatically invokes it, or which
target any hosting environment would choose. No live target was inspected.

Database changes, if needed, belong in a separate reviewed operation:

1. Record the exact repository commit, database environment and target identity.
   Validate the target through the approved operator workflow without printing
   credentials. Do not reuse an unknown inherited DATABASE_URL.
2. Review the exact schema plan and compatibility with the deployed application.
   This repository currently exposes the manual @workspace/db push script; it
   does not provide a tracked versioned migration runner in this source slice.
   Use an approved versioned migration plan where possible. Do not use
   push-force to bypass review.
3. Take and verify a restorable backup or snapshot of the identified target.
   Record the restoration procedure, owner, recovery point and compatibility
   with the previous application revision.
4. Arrange a write pause or other explicitly reviewed concurrency control and
   maintenance window. Identify how writes resume and how failure is handled.
5. Obtain approval for the exact target and reviewed schema operation, including
   any destructive changes. Run it outside post-merge with the approved
   credentials, then verify schema and application behavior before resuming writes.
6. If verification fails, keep writes paused and use the approved restoration
   plan. Application rollback alone may not reverse an incompatible schema change.

Existing database scripts remain available for that separately approved work;
this document and dependency setup do not authorize their execution. The
controlled database workflow was documented, not executed, in this change.
Neither .replit nor provider settings are changed.

## Dependency-free regression

Run node --test scripts/tests/post-merge.test.mjs directly, or use the
discoverable pnpm run test:post-merge command in an already configured checkout.

The test executes the actual checked-in hook using an existing /bin/sh on
Unix or Git for Windows sh. It creates a temporary fake pnpm as the only PATH
entry. The fake logs arguments, accepts only the exact pair
install --frozen-lockfile, and exits 97 for every other pnpm invocation.
It simulates installation success and a failure with exit code 23.

Success must produce exactly one frozen-install call. Failure must propagate
23 and make no further call. No real package manager, dependency installation,
database, provider or network action runs in these fixtures. Temporary files
are removed only after verifying they are direct children of the test temp root.

POST_MERGE_TEST_HOOK may point this test at a preserved baseline hook, and
POST_MERGE_TEST_SH may select an existing Windows shell. These are test-only
process inputs, not application or provider settings. The prior source fails
the success assertion because the fake records the schema-push attempt and
returns 97. This validates hook control flow, not package installation,
database migrations, hosting invocation or complete application readiness.

## Studio scope and existing release gates

The free Studio client remains a static deployment in source metadata. This hook change does not add an account, paid tier, product limit, database dependency, audio behavior, stored-project migration or runtime UI change. A separate API artifact and workspace database package exist; their live deployment and target are unverified. Existing verify:release and .github/workflows/release-verification.yml gates remain intact. No audio performance result is implied by the hook fixture.
