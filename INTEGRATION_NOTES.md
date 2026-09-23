# Integration history

## dev + alim into integration/dev-alim — 2026-09-23

Inputs: `dev` at `ce9fec8`, saved account/profile/email polish at `26ae51c`, and `origin/alim` at `a8cef36`. The integration branch preserves both histories. `alim` already contains the platform-core merge, so that branch is not merged a second time.

Integration decisions:

- Preserve the complete builder/catalog/proposal/milestone workflows and existing domain contracts from `alim`.
- Preserve the current local/Supabase account client, glass login/profile, confirmation/reset handling and styled mail from `dev`.
- Connect the account/profile entry screen to the platform workspace, with a separate guest demo and a route back to the account screen.
- Keep platform role switching and task/proposal data explicitly browser-local. Account authentication does not migrate this state to Supabase or provide server-side authorization for it.
- Combine backend AI request controls with account sessions, Supabase verification and mail routes. Use the repository-root `.env` as the canonical server configuration; never commit real `.env` files.
- Keep Vitest account tests, Node frontend/DOM tests and core regression suites as separate groups under the common `npm run check` entry point.
- Update setup and team branch instructions in the root/frontend READMEs and `docs/TEAM_WORKFLOW.md`.

Current integration validation on 2026-09-23:

- `npm run check`: passed — 429 Python tests, 34 Vitest account/integration tests, 35 Node frontend/DOM tests, six core regression suites, live loopback smoke, lint, TypeScript and production build.
- `pip check`: passed. npm dependency installation reported zero vulnerabilities. No separate SQL migration check was run; migrations were not changed by this merge.
- The contract exporter and smoke server use temporary account databases with mail workers disabled. No real mail or external AI calls were made by the checks.
- Browser visual QA was not performed because browser automation is unavailable in this environment. Account-to-workspace transitions and the end-to-end demo were checked in DOM tests.
- Non-blocking warnings: upstream Starlette/httpx TestClient deprecation; Vite reports a 706 kB JavaScript chunk (200 kB gzip). Code splitting can be a later performance improvement.

The registration queue-failure regression now expects the shared middleware's safe HTTP 500 response and still verifies token/queue transaction rollback. Startup smoke retries temporary transport failures while the local server starts.

The integration is prepared on its own branch. Publishing it and merging its PR into `dev`, then `main`, are separate team actions. The result statements below refer to the earlier `alim` integration, not to the current merge.

## Earlier integration into alim — 2026-09-23

Sources selected after `git fetch origin --prune`:

- `origin/feature/platform-core`: `164afc0` (rating, matching, AI engine, data) and `9ad65f2` (AI API hardening and workflow stability).
- `origin/dev`: `4fe812e` (accounts, SQLite, sessions, mail outbox and account page).
- `origin/main` has no commits missing from the starting `alim` branch.

The original frontend commit `d5c4b17` is preserved at `backup/alim-before-integration-20260923`. Merges preserve upstream history; integration commits stay local unless explicitly pushed.

### Conflict decisions

- Keep the complete alim UI and its existing Task/Team/Proposal contracts.
- Keep live readiness scoring during editing and require explicit confirmation before publication. `potentialTotal` includes the available improvement gains. Do not replace it with the core branch's confirmed-fields-only score.
- Keep four milestones worth 5/10/15/20 points, independent selection of multiple teams, duplicate-response prevention and role guards.
- Keep the existing `ai-sana-demo` persisted data and seed identifiers; add compatible core helper exports where useful.
- Integrate strict request/response schemas, shared scope policy, trusted clarification questions, excerpt grounding, server card generation and inspector APIs. Preserve cancellation and the UI's last-response inspector. Deliberate 4xx/policy refusals never trigger a bypass fallback.
- Combine both frontend test suites, preserving security regressions and adapting conflicting domain assertions to the retained UI contract.
- Merge backend accounts without replacing the core request validation, host/origin checks or AI rate/auth controls. Account/session authentication and deployment-level AI bearer authentication remain distinct.

### Validation

Use `npm run check` at repository root for Python regressions, isolated live-server smoke, both frontend test suites, lint and production build. Tests must not send real mail or call paid AI providers.

Visual browser QA is separate from build/DOM checks; it was not performed as part of the initial frontend implementation.

Final integration validation on 2026-09-23: `npm run check` passed with 378 Python tests, 35 frontend unit/DOM tests, six frontend regression suites (including 59 shared scope cases), live loopback smoke, lint, TypeScript and production build. `pip check` and the requirements dry-run also passed. One upstream Starlette/httpx test-client deprecation warning remains.

The shared scope vocabulary now recognizes the existing clinic/registration-desk examples while preserving injection and off-topic refusals. Account dependencies are pinned. Account forms remain at `/account`; they do not turn the frontend demo role switch or local task storage into server-authorized accounts.

No real mail or paid AI provider calls were made during validation. Browser visual QA and live-provider testing were not performed during this integration.
