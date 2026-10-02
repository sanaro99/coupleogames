# Private multi-room implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development only if the user selects that method. Steps use checkbox syntax for tracking. Do not start before approval of both artifacts.

**Goal:** Allow concurrent invitation-only two-player sessions on one website without cross-room access, mutations, or broadcasts.

**Architecture:** Authentication supplies an immutable room/seat/session identity. An asynchronous room repository owns scoped persistence; a room manager serializes independent room runtimes and projects seat-specific state. Operator provisioning remains a private CLI, with an explicit backed-up legacy import.

**Tech stack:** Existing Node.js 24+, TypeScript, Fastify, Socket.IO, node:sqlite, React/Vite, Vitest, Playwright, Docker, and GitHub Actions. No PostgreSQL/Redis installation or new service in this phase.

**Spec:** [Private multi-room design](../specs/2026-10-01-private-multi-room-design.md).

**Status:** Approved by the user for thorough native execution in this chat. Tasks 1–7 and the fresh final review/fix pass are complete. Final verification: 90/90 unit/server tests, 11/11 browser tests and production builds pass. Docker runtime verification remains unavailable because the local daemon is not running. That execution checkpoint preceded the later PR authorization recorded below.

## Original implementation constraints

- Exactly two partner identities per room, seats `0` and `1`; multiple devices represent the same seat.
- Initial runtime is one Node.js 24+ app process and one SQLite database on local persistent storage.
- Public launch stays on hold. Do not deploy, change infrastructure, create production keys, publish routes or images, or push release changes.
- Preserve existing uncommitted UI work. Do not stage or commit that work; do not rewrite the dirty `tests/e2e/v1.spec.ts`.
- Tests use temporary databases and synthetic credentials. Do not run setup, provisioning, migration, or rotation against the user's `.env` or real data.
- Retain all existing history and original timestamps; atomically persist final state and one result per room/match.
- Require explicit room identity in every data operation; derive transport identity from the session, never payloads.
- Defaults: 100 active rooms, five sessions/seat, three sockets/session, 30-day sessions, 10 login requests/minute/IP, 120 HTTP requests/minute/IP, 30 new socket handshakes/minute/IP, 180 game messages/10 seconds/session, 16,384-byte input limit, maximum 10,000 limiter keys, 250-ms timer dispatch, five-second deadline checkpoints, one-second auth sweep.
- Approval of this plan permits code/test preparation only; production maintenance and release remain separately gated.

## Review focus

- Same seat number in two rooms or a delayed old socket event: switch authentication generations and never show or mutate the previous room (Tasks 4–5).
- Expiry, rotation, disable, or cookie replacement while a socket is already connected: deny the next operation and remove it before any private publish (Tasks 2–4).
- Timer expiry concurrent with another room's action, a disconnect, or a failed save: persist only the owning room, preserve authoritative revisions, and never report an unpersisted success (Tasks 3–4).
- Legacy WAL data, malformed snapshots, invitation-file failure, or a second migration invocation: retain a verified restorable backup and do not partially import or duplicate (Task 6).
- Parallel provisioning/session creation and many tabs or forged forwarding headers: enforce caps transactionally and aggregate action limits across sockets (Tasks 1–2, 4, 7).

## Planned file responsibilities

| Files | Responsibility |
| --- | --- |
| `server/repository.ts`, `server/store.ts`, `server/migrations.ts` | Contract, SQLite persistence, versioning/backup/import. |
| `server/access.ts`, `server/limits.ts` | Authentication, revocation, bounded rate limits. |
| `server/rooms.ts` | Room queues, state/presence lifecycle, engine integration and projections. |
| `server/operator.ts`, `scripts/setup.mjs` | Private CLI and retirement of site-wide setup generation. |
| `server/app.ts`, `server/index.ts`, `shared/types.ts` | Authenticated transports, validated startup configuration, scoped client state. |
| `src/hooks/useRoom.ts`, `src/App.tsx` | Browser authentication generation and invitation guidance only. |
| `tests/store.test.ts`, `tests/access.test.ts`, `tests/rooms.test.ts`, `tests/multi-room.test.ts`, `tests/operator.test.ts`, `tests/migrations.test.ts` | Focused regression suites. |
| `tests/support/rooms.ts`, `tests/e2e/multi-room.spec.ts`, `tests/e2e/auth-switch.spec.ts`, `scripts/seed-test-rooms.ts` | Synthetic provisioning and simultaneous browser acceptance. |
| `tests/server.test.ts`, `playwright.config.ts`, `package.json` | Adapt tracked baseline fixtures and commands; preserve existing dirty browser spec. |
| `.github/workflows/coupleogames.yml`, `Dockerfile`, `compose.yaml`, `deploy/compose.example.yaml`, `.env.example`, `README.md`, `docs/deployment.md` | Verification, release hold, container CLI, and deferred operations documentation. |

Keep `server/engine.ts`, cat components/assets, and game visuals unchanged unless an isolation test reveals a specific defect requiring a reviewed scope adjustment.

## Task 1: Versioned room repository and scoped SQLite persistence

**Files:** Create `server/repository.ts`, `server/migrations.ts`, `tests/store.test.ts`, `tests/support/rooms.ts`; modify `server/store.ts`.

**Interfaces:** Define `RoomId = string`, `AccessContext = { roomId: RoomId; seat: Seat; sessionHash: string; credentialVersion: number }`, `PersistedRoom = { id: RoomId; status: 'active' | 'disabled'; names: [string,string]; setup: boolean; snapshot: Snapshot; savedAt: number; revision: number }`, and `RoomWrite = { names: [string,string]; setup: boolean; snapshot: Snapshot }`. Retain `Snapshot`'s existing match/proposal/leaveVotes shape in the contract.

`RoomRepository` produces these asynchronous methods:

- `getRoom(roomId): Promise<PersistedRoom | null>` and `getRecords(roomId): Promise<RecordEntry[]>`.
- `saveRoom(roomId, expectedRevision, next: RoomWrite, now): Promise<PersistedRoom>`; throws a typed revision-conflict error, preserves status/credentials, transactionally appends a finished result.
- `createRoom(input: { roomId; invitationHashes: [string,string]; maxRooms; now }): Promise<PersistedRoom>`; always creates both seats, empty names, incomplete setup, empty snapshot, and revision zero atomically.
- `findInvitation(invitationHash): Promise<{ roomId; seat; credentialVersion } | null>`; active rooms only.
- `replaceSession(input: { invitationHash; tokenHash; previousTokenHash?: string; now; expires; maxSessionsPerSeat }): Promise<AccessContext>`; transactionally rechecks invitation/version/status, handles previous-session replacement, cleans expiry, and enforces the cap.
- `resolveSession(tokenHash, now): Promise<AccessContext | null>`, `deleteSession(tokenHash): Promise<void>`, `rotateSeat(roomId, seat, invitationHash, now): Promise<void>`, `disableRoom(roomId, now): Promise<void>`, and `listRooms(): Promise<Array<{id; status; createdAt}>>`.
- `close(): Promise<void>`; only the SQLite implementation depends on `DatabaseSync`.

Use explicit TypeScript property types for the signatures above in the contract; all timestamps/revisions/caps are numbers and hashes/IDs are strings. Repository contract tests can later be reused against PostgreSQL.

- [x] Write tests named `scopes_names_snapshots_and_records`, `rejects_invalid_or_missing_seats`, `records_finished_match_once_preserving_timestamp`, `rejects_stale_revision_without_partial_write`, `enforces_creation_cap_under_competing_connections`, and `refuses_legacy_unknown_or_newer_schema`. Assert two rooms retain distinct names/history even with the same synthetic match record ID; failed writes change neither snapshot nor records.
- [x] Run `npm test -- tests/store.test.ts`; confirm the new behavior fails before implementation.
- [x] Implement the contract and schema from the spec with room foreign keys, composite seat/record keys, indexed scoped queries, and short transactions. Fresh empty databases initialize; legacy databases require Task 6 and refuse serving. Inject filesystem/DB failures in tests, never mutate real data.
- [x] Run the targeted suite; require all assertions to pass. Keep existing tests runnable using synthetic compatibility fixture adapters until transport adaptation in Task 4; do not leave a production global-auth fallback.

## Task 2: Room-scoped authentication, private operator commands, and limits

**Files:** Create `server/access.ts`, `server/limits.ts`, `server/operator.ts`, `tests/access.test.ts`, `tests/operator.test.ts`; modify `package.json` and `scripts/setup.mjs`.

**Consumes:** Task 1's `RoomRepository` and `AccessContext`.

**Produces:** `AccessService.login(key: string, previousToken: string | undefined, now: number): Promise<{ token: string; access: AccessContext }>`, `resolve(token: string | undefined, now: number): Promise<AccessContext | null>`, `logout(token: string | undefined): Promise<void>`. Generate/hash opaque credentials with Node crypto. `WindowLimiter.consume(key: string, now: number): boolean` accepts configured count/window/maxKeys; expires entries and fails closed when full. `runOperator(argv: string[], dependencies): Promise<number>` uses injected repository, clock, credential generator, and exclusive invitation-file writer; exposes create/rotate/disable/list and later migrate-legacy.

- [x] Write tests named `invitation_selects_room_and_fixed_seat`, `hashes_all_bearer_tokens`, `replacement_revokes_only_previous_session`, `failed_login_preserves_previous_session`, `rotation_revokes_only_selected_seat`, `disable_denies_both_seats_preserving_data`, `session_cap_is_atomic`, `limiter_expires_and_bounds_keys`, and `operator_never_exposes_secrets_or_overwrites_output`. Assert expiry at exactly the deadline, five-session and three-socket defaults, no credential retrieval, and no third-seat provisioning.
- [x] Run `npm test -- tests/access.test.ts tests/operator.test.ts`; observe failures.
- [x] Implement services and commands, including validated positive integer limit config. Write the exclusive private invitation file before committing its corresponding create/rotate transaction; a file failure performs no DB change, and a DB failure removes the newly written file. Files from a process crash before DB commit contain inactive credentials; do not claim filesystem and SQLite have one crash-atomic transaction. Deny static-directory output paths and overwrite attempts. Redact secrets in error messages and console output.
- [x] Replace the old setup generator with a maintenance instruction to use the room CLI; do not generate site-wide keys or run this command locally. Add a build-compatible `rooms` npm script and keep the compiled entry point in `server/` for container execution.
- [x] Run targeted tests and `npm run typecheck`; require PASS. Do not invoke the operator against the repository's ordinary database.

## Task 3: Independent room runtimes, presence, deadlines, and durable mutations

**Files:** Create `server/rooms.ts`, `tests/rooms.test.ts`; modify `shared/types.ts`.

**Consumes:** Repository/access types and existing pure engine functions.

**Produces:** `RoomManager.connect(access: AccessContext, socketId: string, now: number): Promise<void>`, `disconnect(access, socketId, now): Promise<void>`, `execute(access, command: RoomCommand, now): Promise<{ revision: number }>`, `state(access, now): Promise<RoomState>`, `tick(now): Promise<void>`, and `close(now): Promise<void>`. `RoomCommand` is a discriminated union of validated setup/propose/ready/action/lobby/leave payloads matching current protocols. A callback `publish(roomId: RoomId): Promise<void>` supplied by transport runs after durable room changes. Add required `roomId: string` and `revision: number` to `RoomState`.

- [x] Write tests named `four_seats_have_independent_readiness_and_matches`, `last_disconnect_pauses_only_own_room`, `room_checkpoints_do_not_share_clock`, `recovery_resets_readiness_and_pauses_from_saved_at`, `foreign_match_or_proposal_cannot_select_room`, `failed_save_does_not_publish_or_acknowledge`, `late_action_persists_only_own_deadline_transition`, `conflicting_revision_resynchronizes`, and `offline_eviction_and_shutdown_preserve_state`.
- [x] Run `npm test -- tests/rooms.test.ts`; observe failures using injected clocks and faulting repositories rather than real sleeps.
- [x] Implement per-room queues/maps, cloned persistent mutations, revision checks, connection sets, 250-ms scheduler participation, five-second checkpoints, and safe queue draining/eviction. Include names/setup in the same room transaction. Keep actual presence authoritative if persistence fails and reject play until reconciliation. Do not let shutdown disconnect handlers schedule new writes/timers after closure.
- [x] Run targeted tests plus `npm test -- tests/engine.test.ts`; require unchanged game rules and secret projections to pass.

## Task 4: Authenticated HTTP/Socket.IO transport and concurrent isolation proofs

**Files:** Modify `server/app.ts`, `server/index.ts`, `tests/server.test.ts`; create `tests/multi-room.test.ts`.

**Consumes:** Tasks 1–3; `createApp(config)` keeps its HTTP/io/close return shape. Remove site-wide keys/names from ordinary `AppConfig`, replacing them with database/origin/production and validated limits/proxy trust configuration. Test injection can supply a repository, clock, and scheduler without exposing these via runtime environment.

- [x] Write integration tests with two rooms/four seat sessions before changing handlers. Maintain separate full event collectors and flush preexisting connection events before each test operation. After every operation in A, await its acknowledgement plus a positive delivery to A's partner, then assert no state event reached B and B's HTTP state/revision/history remained unchanged. Repeat B-to-A; test all setup/propose/ready/action/lobby/leave paths and all four game's action types.
- [x] Add anonymous/auth failure, forged room/seat fields, other-room match/proposal IDs, expired/revoked established sockets, rotation/disable via a second DB connection, polling/WebSocket handshake caps, aggregated multi-tab action limits, failed persistence, and independent countdown/restart tests. Assert a valid same-room secret never appears in its partner's projection before reveal, or in any foreign event/ack.
- [x] Run `npm test -- tests/server.test.ts tests/multi-room.test.ts`; confirm isolation assertions fail under the current global server before replacing it.
- [x] Wire request authentication to session-derived context; strictly validate login/actions; require matching browser Origin and reject cross-site metadata. Assign server-selected seat/session channels and validate room/seat/version/expiry before every action and recipient emission. Check socket cap before presence membership; implement one-second sweep. No global state publisher. Auth errors do not invoke room commit. API reads use scoped manager projections.
- [x] Configure bounded limiters for Fastify and Engine.IO entry paths, count only new handshakes, and honor explicitly trusted proxies while denying spoofed forwarding headers. Return generic auth errors, safe HTTP failure codes, and game acknowledgement errors with no foreign data.
- [x] Update baseline server tests with provisioned synthetic rooms/Origin headers and new scoped repository signatures. Keep preexisting privacy, restart, logout, and secret-answer coverage; do not weaken assertions to make them pass.
- [x] Run `npm test` and `npm run build`; require all server/engine/UI unit tests and both TypeScript builds to pass. Review every repository call and every state emit for a server-derived room boundary.

## Task 5: Browser room switching and four-context acceptance

**Files:** Modify `src/hooks/useRoom.ts`, `src/App.tsx`, `playwright.config.ts`; create `tests/e2e/multi-room.spec.ts`, `tests/e2e/auth-switch.spec.ts`, `scripts/seed-test-rooms.ts`.

**Consumes:** Scoped `RoomState`, cookie exchange, and current event protocol.

**Produces:** Existing `useRoom()` API with authentication generation, room-aware reconnects, and stale-event rejection. Browser test seeding creates synthetic rooms only inside `test-results/`, including the current known first-room e2e keys so the dirty baseline browser spec remains untouched. Start each e2e run with a fresh synthetic database rather than reusing prior results.

- [x] Write acceptance tests: `two_pairs_play_and_save_independent_results`, `disconnect_in_a_leaves_b_playing`, `same_seat_cross_room_switch_ignores_old_events`, `replacement_cookie_in_another_tab_resynchronizes`, and `failed_invite_recovers_previous_session`. Use four isolated phone contexts and positive counterpart controls. Complete different games simultaneously and compare both scorecards after reload/restart. Exercise drawings against rate-limit defaults.
- [x] Run `npm run test:e2e -- tests/e2e/multi-room.spec.ts tests/e2e/auth-switch.spec.ts`; confirm intended failures before client changes.
- [x] Disconnect/clear prior room state before login, increment auth generation, bind socket lifecycle to room ID/seat/generation, ignore stale promise and socket callbacks, and reject mismatched room IDs or decreasing revisions. Clear names, invite modal, and scorecard state on identity changes. Fetch session after access changes; failed login recovers prior cookie safely. Keep credentials only in transient login input; scrub fragment early.
- [x] Update invitation guidance to explain operator-issued seat links and keep the ordinary URL free of credentials. Do not allow retrieving/rotating the other seat invitation through the player API. Make no cat, artwork, layout, or effects edits.
- [x] Run targeted browser tests, then `npm run test:e2e` once with the preserved baseline spec, and `npm run build`. Require independent results, no leaked names/actions/state, no stale-room display, and no regression in existing game/UI acceptance. If preserved UI tests fail independently, report and isolate their baseline failure before touching the user's work.

## Task 6: Backed-up legacy import and recovery verification

**Files:** Modify `server/migrations.ts`, `server/operator.ts`; create `tests/migrations.test.ts`.

**Consumes:** Room schema, credential generator, private output handling, and existing `Snapshot`/record formats.

**Produces:** `migrateLegacy(input: { databasePath: string; backupPath: string; outputPath: string; legacyNameDefaults: [string,string]; now: number }, dependencies): Promise<{ roomId: RoomId; recordCount: number }>`; checks supported schema, uses `node:sqlite` backup capability, validates archived data, and executes the explicit offline import. The operator command reads optional legacy name defaults only for this command, never keys for normal serving.

- [x] Write synthetic legacy DB fixtures with committed WAL-backed changes, explicit names and unset-name/default-name variants, histories, duplicate persisted finished match, live drawing snapshot, proposal readiness, and old session hashes. Assert exact record IDs/timestamps/outcomes/streaks, one legacy room, two fresh invitation hashes, paused checkpoint timing, cleared readiness/new proposal ID, preserved leave votes, and denial of every old session/key.
- [x] Add `backup_restores_legacy_values`, `migration_rerun_refuses_duplicate_room`, `corrupt_or_unknown_schema_changes_nothing`, `backup_or_output_failure_changes_nothing`, and `transaction_failure_keeps_backup_and_legacy_tables`. Inject failures after schema/table creation before commit. Assert backups and private paths are not overwritten and post-failure invitation files contain no accidentally active credentials.
- [x] Run `npm test -- tests/migrations.test.ts`; observe failures.
- [x] Implement validation, checked backup, exclusive invitation output, one schema/data transaction, archived table preservation, migration metadata, and post-import integrity/foreign-key/count/value checks before final commit. Refuse unknown newer/mixed layouts. A crash before commit leaves legacy DB usable; a crash after commit with missing invitation output is recovered by seat rotation. Never run old code against a migrated DB.
- [x] Run targeted tests and restore the backup into another temporary DB to prove the old schema/values are usable. No live app shutdown, real key creation, or production migration is authorized by this step.

## Task 7: Verification-only CI, gated release source, and deferred deployment docs

**Files:** Modify `.github/workflows/coupleogames.yml`, `Dockerfile`, `compose.yaml`, `deploy/compose.example.yaml`, `.env.example`, `README.md`, `docs/deployment.md`; create `tests/release-config.test.ts` if needed to pin the release hold.

**Consumes:** Built app/operator entry points and test suites. No external service changes.

- [x] Add a meaningful configuration regression test: main push runs verification but cannot publish; only manual dispatch with `COUPLEOGAMES_RELEASE_ENABLED == 'true'`, selected main commit verification, and `coupleogames-release` environment reaches publication; no latest tag; Compose examples require a pinned image and carry no automatic-update labels. Test the final configuration rather than individual formatting details.
- [x] Run the configuration test before edits and confirm the current automatic publication/update behavior fails it.
- [x] Keep normal verification and local container builds. Gate publishing as specified, restrict package-write permissions to that job, and preserve cancellation behavior for PRs. Document that protected-environment reviewer setup is a future operator action and that the default-false setting keeps release disabled even before that setup. Do not dispatch workflows or push changes.
- [x] Include compiled operator code in the runtime image; remove automatic production key generation guidance. Replace site-wide environment keys/names with validated room limits/proxy settings. Update both source Compose examples for one pinned instance and disabled automatic updates; do not edit installed Compose or infrastructure.
- [x] Write deployment documentation for private create/rotate/disable/list commands, fragment invitations, file permissions, one process/local SQLite, explicit legacy maintenance/backup/recovery, and future PostgreSQL/adapter/shared-presence/order/timer/rate-limit requirements. Put public launch and proxy/route/package-visibility work behind a later explicit authorization section.
- [x] Run `npm test`, `npm run build`, `npm run test:e2e`, and, if available, `docker build --tag coupleogames-private-rooms-ci .` with no push. Use a temporary synthetic volume for a container health/CLI smoke check bound only to loopback, then clean up only those task-created resources. If Docker is unavailable, report container verification as unverified and rely on CI build as the remaining check; do not install/configure Docker without authorization.

## Completion review and handoff

- [x] Check every design acceptance clause against its owning tests. Review scoped SQL, session/version checks, socket event recipients, runtime timer queues, browser auth generation, migration failure recovery, and release gates.
- [x] Recheck git status and diff against the initial dirty-file inventory. No UI file from that inventory was staged, committed, reset, or rewritten. New multi-room tests live separately; report any baseline limitations.
- [x] Report passing verification with actual command output, remaining limitations, and that public launch is still held. Do not claim a production migration or deployment occurred.
- [x] Open a review of the implementation once requested/appropriate. Staging, commits, branches, PRs, publishing, or deployment must follow the approved scope and must never include the user's existing uncommitted UI work. No blanket `git add .`, automatic push, or release dispatch.

## Initial implementation completion evidence

| Requirement | Evidence |
| --- | --- |
| Independent names, fixed seats, snapshots and history | `store`, `access`, `server` tests; same synthetic match ID in different rooms remains independent |
| Every game action and room-only socket delivery | Four simultaneous authenticated seats, positive counterpart delivery, full foreign event collectors and unchanged foreign persisted snapshots/history in `multi-room` tests |
| Readiness, disconnects, timers, durability and restart | Injected-clock `rooms` tests; existing privacy/reconnect/restart server tests; recovery revisions and history uniqueness |
| Revocation, expiry and abuse limits | Established-socket rotation/logout/disable tests; expiry at deadline; atomic caps; spoofed forwarding headers, polling requests, WebSocket upgrade and multi-tab budgets |
| Browser identity changes and concurrent sessions | Eleven complete Chromium tests, including four auth-recovery cases, two pairs of players saving results concurrently and all preserved UI/game acceptance tests |
| Legacy preservation | Eighteen migration cases including exact history, uncheckpointed committed WAL backup, valid game snapshots, malformed engine relationships, file/transaction failures and rerun rejection |
| Release hold | Regression tests reject publication on push/PR, require deliberately enabled verified main dispatch, prohibit latest tags and require pinned loopback-only Compose templates without automatic updates |
| Preserve uncommitted UI | Seven protected file hashes unchanged; Git index empty; `git diff --check` passes |

Fresh review found three Important issues: failed readiness recovery did not publish a new proposal; a second disconnect after a failed pause could consume offline time; malformed legacy deck indexes could crash progression. Each was reproduced RED, fixed in one pass, and verified GREEN. Reconciliation now commits/publishes before subsequent commands, disconnect recovery uses the durable checkpoint and real presence, and migration checks deck bounds and engine-required relationships before changes. The final full suite is 90/90 PASS and complete browser suite 11/11 PASS. No second reviewer was dispatched.

Docker build/container smoke remain unverified locally because the daemon is unavailable. CI retains its image build, but no remote workflow was dispatched and CI success is not claimed. Real data, production credentials and infrastructure were not operated on.

## Initial implementation rulings and their costs

These record decisions made during execution, including the final review's excluded areas.

1. Work in the existing checkout, preserving current UI and leaving all work unstaged. Cost: feature and UI edits share a checkout and require careful selection in any later commit; protected hashes verify preservation.
2. Use Windows-native ledger bookkeeping rather than Bash skill scripts. Cost: manual bookkeeping replaces script automation.
3. Invoke the installed Node `npm.cmd` because the PATH shim is broken. Cost: the local verification command is Windows-specific; normal CI uses `npm`.
4. Publish already-projected seat views rather than recursively entering the same room queue. Cost: the transport must revalidate every recipient, which it does.
5. Use event collectors and scoped persisted-state checks between actions, with targeted HTTP checks, to preserve HTTP quotas. Cost: event and repository checks supplement rather than replace endpoint coverage.
6. Share private output validation in `server/invitations.ts` between operator commands and migration. Cost: one additional shared module avoids circular dependencies.
7. Require `--offline` acknowledgment for migration, with source fingerprints before commit. Cost: the operator must stop every writer; the CLI cannot certify process shutdown.
8. Give only the synthetic browser server 20 device sessions per seat because preserved UI tests repeatedly use fresh contexts. Cost: browser tests do not exercise the default five-device cap; direct access tests enforce it and reject the sixth session.
9. Exclude protected cat/artwork/UI changes from feature review while preserving their hashes and running existing acceptance tests. Cost: independent UI defects remain outside this feature review.
10. Exclude live migration, deployment, proxy configuration and production permissions under the release hold. Cost: those operating assumptions need later environment inspection and explicit authorization.
11. Exclude container runtime success because the Docker daemon is unavailable. Cost: an image/runtime defect could remain until CI and container smoke verification.
12. Defer PostgreSQL and multiple processes as designed. Cost: scaling requires a future repository, adapter, shared presence/ordering/timers/limits and tests; this implementation supports one instance.

No minor review findings were deferred. The ignored execution ledger is retained because there are no feature commits to preserve its evidence. The implementation remains in the current checkout for user review.

## Original approval request (approved)

Review the linked design and this plan together. Confirm the reusable operator-issued invitation model, deliberate legacy-session/key invalidation with preserved data, and release hold. Approve both artifacts and choose native execution in this chat (recommended) or explicitly authorize subagent-driven execution. No implementation starts while this review is pending.


## PR authorization and UI inclusion (2026-10-02)

The user subsequently authorized raising a PR and including the pending UI files if they improve the existing experience. This supersedes the original restrictions on staging/committing those files and pushing a review branch. Public launch, image publication, production keys/migration, infrastructure, and live route changes remain on hold.

PR preparation uses an isolated managed worktree based on `origin/main` and branch `codex/private-couple-rooms`. Only the explicit feature and UI file lists enter the PR; the primary checkout's original UI contents and empty index remain preserved. Untracked `output/`, `.playwright-cli/`, environment files, real databases, private invitation output, and local execution bookkeeping are excluded.

The seven approved UI files are `public/cat.svg`, `src/components/CatScene.tsx`, `src/components/Host.tsx`, `src/components/catMotion.ts`, `src/components/kittenModel.ts`, `tests/cat-motion.test.ts`, and `tests/e2e/v1.spec.ts`. They improve the kitten artwork, give movement explicit rise/walk/turn/sit phases with interruption continuity, share/dispose model resources, and allow instructions their reading time after arrival. These additions receive a separate focused UI review; the earlier room-feature review remains valid for its scope.

The isolated feature-only checkpoint passed 83 unit/server tests, 10 browser tests, and production builds. With the UI included, fresh full verification is recorded during PR preparation. At that checkpoint the Docker daemon was unavailable; the successful later checks are recorded below. No deployment or publication is performed by PR preparation.
After the user started Docker, the PR image built successfully locally. A disposable loopback-only container with tmpfs data ran as a non-root runtime identity and passed health/static/auth checks, operator creation of two synthetic rooms, invitation mode 0600, four authenticated seats, independent names/actions, and room-only Socket.IO delivery. The smoke container was stopped and removed with its temporary data. No image was published. The focused UI source review found no blocking issues. Final unit/server verification passed 90/90 and the production build passed; the final unchanged full Chromium suite passed 11/11 with normal tracing enabled. Earlier local attempts had a page-close timing failure and a context/trace ZIP cleanup timeout; an isolated trace-disabled run also passed. No application or test code changes were needed to obtain the final full-suite pass. GitHub CI provides the additional pre-merge verification.

PR preparation final evidence: 90/90 unit/server tests, 11/11 browser tests, production build, Docker image build and disposable container checks PASS. Both feature and UI reviews have no outstanding blocking findings. The primary checkout's seven protected UI hashes remain unchanged and its Git index remains empty. The explicitly selected feature and approved UI files are ready for committing and raising the requested PR; deployment and public launch remain held.
