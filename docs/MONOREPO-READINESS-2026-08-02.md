# Monorepo readiness — evidence run 2026-08-02 (goal g-c8da7452)

**The monorepo move is LOCKED.** This document records the unlock
preconditions (operator-locked decision, docs/ARCHITECTURE-DECISIONS-2026-08-01.md
§5) and the current repo's measured gaps against them. Nothing was moved.

## Unlock preconditions (shadcn monorepo requirements, recorded verbatim intent)

Per https://ui.shadcn.com/docs/monorepo, a shadcn-based monorepo requires:

1. **Workspace-level `components.json`** — every workspace package that uses
   shadcn needs a `components.json`, and the CLI must be run from the app
   workspace so components install into the right package.
2. **Matching aliases and style across workspaces** — the `components.json`
   files must agree on `style`, `baseColor`, css variables, and the import
   aliases (`@workspace/ui` etc.) so generated components resolve identically
   from app and ui packages.
3. **An exported `packages/ui` contract** — the shared ui package exports its
   components/utilities (package.json `exports` map) and the app consumes
   them via the workspace alias, with Tailwind configured to scan the ui
   package's sources.

All three must exist and be demonstrated BEFORE any move; then the move still
requires an attended operator approval window.

## Current repo, measured 2026-08-02

| Precondition | Current state | Gap |
|---|---|---|
| Workspace tooling | Single-package repo: **no `workspaces` field** in package.json, **no `packages/` directory** | Full workspace scaffolding absent (expected — no move is planned yet). |
| `components.json` | **Absent entirely** — shadcn is not in use in this repo today (bespoke Tailwind 3.4 components) | Adopting shadcn at all is a prior product/design decision, not assumed. If shadcn is never adopted, precondition 1–2 reduce to "shared ui package with agreed aliases". |
| `packages/ui` contract | Absent | Would be created as part of the (locked) move. |
| Tailwind config | Single `tailwind.config` scanning `src/**` | Would need `content` widened to the ui package on move. |

## Standing conclusion

The repo is a healthy single-package Next.js app; none of the three unlock
preconditions exist yet, and creating them is meaningful work that only makes
sense once the operator decides (a) to adopt shadcn (or an equivalent shared
ui contract) and (b) that a second workspace consumer actually exists
(e.g. the Capacitor shell from the TestFlight track). Until both are true,
the move stays locked and this document is the checklist to unlock it.
