# Integration into alim — 2026-09-23

Sources selected after `git fetch origin --prune`:

- `origin/feature/platform-core`: `164afc0` (rating, matching, AI engine, data) and `9ad65f2` (AI API hardening and workflow stability).
- `origin/dev`: `4fe812e` (accounts, SQLite, sessions, mail outbox and account page).
- `origin/main` has no commits missing from the starting `alim` branch.

The original frontend commit `d5c4b17` is preserved at `backup/alim-before-integration-20260923`. Merges preserve upstream history; integration commits stay local unless explicitly pushed.

## Conflict decisions

- Keep the complete alim UI and its existing Task/Team/Proposal contracts.
- Keep live readiness scoring during editing and require explicit confirmation before publication. `potentialTotal` includes the available improvement gains. Do not replace it with the core branch's confirmed-fields-only score.
- Keep four milestones worth 5/10/15/20 points, independent selection of multiple teams, duplicate-response prevention and role guards.
- Keep the existing `ai-sana-demo` persisted data and seed identifiers; add compatible core helper exports where useful.
- Integrate strict request/response schemas, shared scope policy, trusted clarification questions, excerpt grounding, server card generation and inspector APIs. Preserve cancellation and the UI's last-response inspector. Deliberate 4xx/policy refusals never trigger a bypass fallback.
- Combine both frontend test suites, preserving security regressions and adapting conflicting domain assertions to the retained UI contract.
- Merge backend accounts without replacing the core request validation, host/origin checks or AI rate/auth controls. Account/session authentication and deployment-level AI bearer authentication remain distinct.

## Validation

Use `npm run check` at repository root for Python regressions, isolated live-server smoke, both frontend test suites, lint and production build. Tests must not send real mail or call paid AI providers.

Visual browser QA is separate from build/DOM checks; it was not performed as part of the initial frontend implementation.
