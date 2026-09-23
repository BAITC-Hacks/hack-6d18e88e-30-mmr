# Integration history

## Current: updated platform-core into integration/dev-alim — 2026-09-23

Inputs: the previous integration at `8ebac1a` and `origin/feature/platform-core` at `5bcd587`. The user explicitly selected the updated platform-core implementation. Earlier `alim` integration included an older core revision; it did not include these new commits.

Current conflict decisions:

- Take the incoming core store, persistence, rating, matching, AI and shared type contracts as a coherent set. Actual readiness points come only from filled, confirmed fields. `potentialTotal` reflects the current text after confirmation. Editing removes approval for changed fields and unpublishes the card; unchanged approved fields retain their points.
- Take TeamMatch weights 35/25/20/20 and the combined seeds: 15 tasks, 10 teams, 11 proposals. Persist under `ai-sana-taskrank-v1`, version 2, with migration from earlier core state and `ai-sana-demo`.
- Preserve multiple proposals per team/task, manual selection of one or more teams, and one-time milestone points. Reject duplicate proposal identifiers, not additional distinct proposals from the same team.
- Retain the latest glass authentication/profile, email-delivery fixes and styled templates. `/` and `/auth` show authentication/profile; profile-to-workspace navigation rechecks the session. `/workspace` also supports guest demo. These connections do not create server-owned task records.
- Integrate the incoming Signal, Atelier and Index design previews at `/design`, locally bundled fonts and the production-preview launcher `npm start`.
- Keep the root `.env` as the canonical backend configuration, with `backend/.env` as fallback. Local cookie accounts use the Vite development server; production builds (including `npm start`) require public Supabase configuration for sign-in. Guest demo remains available separately.
- Adopt the incoming gateway contract: when `API_ACCESS_TOKEN` is configured, all `/api/*` require it. The server-only `X-API-Access-Token` header preserves the separate Supabase user Bearer. Production requires this deployment token; it never belongs in client variables.
- Keep regression coverage for accounts, mail, workspace navigation and core behavior under the common checks. Tests must use isolated databases and must not send real mail or invoke external AI.
- Preserve the previously tested jsdom 30 dependency and separate test scripts. Keep account styling scoped while applying the incoming platform themes.
- Clear cached workspace identity when opening the account screen, so logout followed by browser navigation cannot display an old profile name. Align proposal dialogs with the new store contract: an existing proposal no longer blocks another distinct idea from the same team.

Current validation on 2026-09-23:

- `npm run check`: passed on the final code — 473 Python tests, 53 Vitest tests, 42 Node frontend/DOM tests, six core regression suites, isolated HTTP smoke, repeatable SQL migrations/assertions, lint, TypeScript and production build.
- `npm run test:start`: passed — occupied IPv4/IPv6 ports, cancellation, production assets/SPA/proxy, protected API refusal, configuration failure and process cleanup. The test used temporary storage with SMTP and AI providers disabled.
- `pip check`: passed. Existing local backend configuration validates without modification; credentials were not printed. Python dependency versions and the previously validated frontend dependency set are unchanged.
- Browser visual QA: not performed; no browser automation is available. DOM tests and builds do not verify appearance.
- Real SMTP delivery, real Supabase Auth and external AI: not claimed by this merge.
- Non-blocking warnings: upstream Starlette/httpx TestClient deprecation and a 726 kB main JavaScript chunk (206 kB gzip). The design preview is a separate lazy-loaded chunk.

The earlier results below belong to their respective historical integrations and do not establish success of this new merge. The current work remains in `integration/dev-alim`; publishing and PR merges into `dev`/`main` are separate actions.

## Previous: dev + alim into integration/dev-alim — 2026-09-23

Inputs: `dev` at `ce9fec8`, saved account/profile/email polish at `26ae51c`, and `origin/alim` at `a8cef36`. The integration branch preserves both histories. `alim` already contains the platform-core merge, so that branch is not merged a second time.

Integration decisions:

- Preserve the complete builder/catalog/proposal/milestone workflows and existing domain contracts from `alim`.
- Preserve the current local/Supabase account client, glass login/profile, confirmation/reset handling and styled mail from `dev`.
- Connect the account/profile entry screen to the platform workspace, with a separate guest demo and a route back to the account screen.
- Keep platform role switching and task/proposal data explicitly browser-local. Account authentication does not migrate this state to Supabase or provide server-side authorization for it.
- Combine backend AI request controls with account sessions, Supabase verification and mail routes. Use the repository-root `.env` as the canonical server configuration; never commit real `.env` files.
- Keep Vitest account tests, Node frontend/DOM tests and core regression suites as separate groups under the common `npm run check` entry point.
- Update setup and team branch instructions in the root/frontend READMEs and `docs/TEAM_WORKFLOW.md`.

Validation of the previous integration at `8ebac1a` on 2026-09-23:

- `npm run check`: passed — 429 Python tests, 34 Vitest account/integration tests, 35 Node frontend/DOM tests, six core regression suites, live loopback smoke, lint, TypeScript and production build.
- `pip check`: passed. npm dependency installation reported zero vulnerabilities. No separate SQL migration check was run; migrations were not changed by this merge.
- The contract exporter and smoke server use temporary account databases with mail workers disabled. No real mail or external AI calls were made by the checks.
- Browser visual QA was not performed because browser automation is unavailable in this environment. Account-to-workspace transitions and the end-to-end demo were checked in DOM tests.
- Non-blocking warnings: upstream Starlette/httpx TestClient deprecation; Vite reports a 706 kB JavaScript chunk (200 kB gzip). Code splitting can be a later performance improvement.

The registration queue-failure regression now expects the shared middleware's safe HTTP 500 response and still verifies token/queue transaction rollback. Startup smoke retries temporary transport failures while the local server starts.

This integration was prepared on its own branch. Publishing it and merging its PR into `dev`, then `main`, remain separate team actions. The result statements below refer to the still earlier `alim` integration.

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
