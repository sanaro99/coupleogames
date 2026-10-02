# Private multi-room design

Status: approved by the user for local implementation; implementation prepared. Production migration, deployment and public launch remain held.

## Intent and agreed scope

Several couples can use one CoupleOGames website simultaneously. Every room still has exactly two partner identities, seats `0` and `1`. The operator creates rooms privately and distributes the two seat-specific invitations; the user selected this model on October 1, 2026. Success means a couple cannot receive, query, or modify another couple's names, presence, readiness, match, actions, or records through HTTP, Socket.IO, or reconnects.

Initial runtime: one Node.js 24+ app process, Fastify, Socket.IO, React/Vite, and one SQLite database on local persistent storage. Existing game rules and visual design remain intact. PostgreSQL and multiple app instances are a documented future boundary, not part of this implementation.

Public launch stays on hold. Do not deploy, change TrueNAS or Cloudflare, create production keys, publish routes or images, or push release changes. Preserve existing uncommitted UI work, including `public/cat.svg`, `src/components/CatScene.tsx`, `src/components/Host.tsx`, `src/components/catMotion.ts`, `src/components/kittenModel.ts`, `tests/cat-motion.test.ts`, `tests/e2e/v1.spec.ts`, `.playwright-cli/`, and `output/`. Do not stage or commit that work. These artifacts are documentation only and remain uncommitted pending review.

## Existing code and architectural alternatives

`server/app.ts` holds a single snapshot, two global socket sets, a global checkpoint, and a publisher iterating every socket. Authentication returns only a seat from two environment keys. `server/store.ts` stores global settings, records, and seat-only sessions. `scripts/setup.mjs` provisions those site-wide keys. `src/hooks/useRoom.ts` reconnects its socket only when the seat changes. `.github/workflows/coupleogames.yml` publishes `latest` on main pushes; Compose templates enable Watchtower. These are the relevant boundaries to change.

`server/engine.ts` already receives an explicit match and seat and projects seat-specific secrets through `viewMatch`; retain this separation. Changing broadcasts alone would leave HTTP, sessions, persistence, timers, and browser switching unsafe.

Three implementation approaches were considered:

1. **One room-aware repository and room runtime manager, recommended.** Keep one database and app, bind every request to an authenticated room/seat, and isolate in-memory runtimes and Socket.IO audiences. This addresses all shared state and provides a usable PostgreSQL seam.
2. **One database file per couple.** Simplifies some storage separation but adds file lifecycle, backup, connection-management, and migration work; sessions and sockets still need application-level room boundaries.
3. **Accounts, room memberships, and a general invitation platform.** Supports broader identity management but substantially expands onboarding, recovery, and administration. It is unnecessary for the selected operator-provisioned two-seat model.

Open registration and invite-gated self-service remain future product alternatives. There is no creation endpoint, public room directory, public operator interface, or player-controlled membership management in this design.

## Invitations, sessions, and operator workflow

Each room gets an opaque UUID and precisely two seat rows enforced by `CHECK(seat IN (0,1))` and a composite primary key. Room identifiers are routing identity, never access credentials. Generate a separate 32-byte random bearer invitation for each seat and store only its SHA-256 hash, unique across all seats. Hashing is appropriate here because tokens are randomly generated, not human passwords.

Invitations are reusable until the operator rotates them or disables the room. This deliberately preserves the existing ability to join from another phone or sign back in without an account. Whoever possesses a seat invitation can act as that seat; forwarded links do not establish a third seat. Multiple devices/tabs may represent the same partner, subject to limits below. One-time claims, account recovery, room switching menus, and seat transfer between people are out of scope.

The private CLI is shipped inside the image but never exposed over HTTP:

- `rooms create --output <private-file>` creates one empty room and its two credentials transactionally. The file contains separately labeled invitation links at `APP_ORIGIN/#invite=<token>`. Terminal output contains the room ID and output path, not credentials or names. No silent overwrite; output must be outside static asset directories. File output failure rolls back creation and removes any partial file.
- `rooms rotate --room <id> --seat <0|1> --output <private-file>` replaces only that seat's credential, increments its credential version, and deletes its sessions in the same transaction. The other partner and room data remain intact. A lost invitation cannot be retrieved from its hash; rotate it.
- `rooms disable --room <id>` disables access and revokes both seats' sessions without deleting names, snapshots, or history.
- `rooms list` returns IDs, status, and creation time only. There is no hard-delete command in the initial release.

CLI commands use the configured SQLite file, not an app HTTP admin token. They may run while the single app runs; conditional updates must modify only their owned columns, not overwrite a runtime snapshot. Room status and credential versions are checked on every authenticated operation. A one-second auth sweep disconnects revoked/expired sockets and evicts disabled runtimes. Disable never resumes a match; reloading a preserved snapshot later uses its saved checkpoint to pause it safely.

Files default to an ignored `data/invitations/` directory in examples. Use restrictive permissions on POSIX and document Windows ACL handling. Do not place tokens in logs, query strings, CI artifacts, tracked files, or frontend defaults. On first page load, read the URL fragment and remove it before issuing the login request. The frontend must not fetch either partner's invitation from the API. The existing invite button becomes a room-safe reminder to obtain/share the operator-issued partner invitation; it can copy the ordinary website address, but must not imply that address alone grants access.

Reserve and write the new private output file before the create/rotate/import database transaction commits. Output failure leaves the database unchanged; database failure removes the task-created output. Filesystem and SQLite commits are not one crash-atomic operation: a crash before database commit can leave an invitation file containing inactive credentials. A lost file after successful commit is recovered by rotation, never by returning stored hashes as credentials.

`POST /api/login` accepts only `{ key: string }`; looking up its hash supplies the room and seat. Ignore no caller-selected room/seat: reject additional properties. Return a generic authentication failure for unknown, disabled, or revoked invitations. Exchange a valid invitation for a fresh 32-byte random session token. Store its hash, room ID, seat, credential version, creation time, and expiry. Cookie: `couple_session`, host-only, path `/`, HttpOnly, SameSite=Strict, Secure in production, 30-day maximum lifetime. Never return the session token in JSON.

One browser cookie jar has one current room/seat. A successful login replacing an existing cookie revokes that previous session, including its sockets; other independent device sessions survive. Failed login does not revoke a valid existing session. Logout revokes only the current session. Rotation revokes all sessions for the rotated seat; disable revokes the room. Login limits are enforced before creating session rows.

## Persistence and service boundaries

Version the schema explicitly and enable SQLite foreign keys, WAL, and the existing busy timeout. Add these tables:

| Table | Scope and constraints |
| --- | --- |
| `schema_migrations` | Migration version and completion time; refuses unsupported newer versions. |
| `rooms` | `id` primary key; active/disabled status; `names_json` tuple; `setup_complete`; `snapshot_json`; `saved_at`; monotonic `revision`; creation/update times. |
| `room_seats` | `(room_id, seat)` primary key; room foreign key; unique invitation hash; credential version. |
| `room_sessions` | Token-hash primary key; composite foreign key to seat; credential version; creation/expiry; indexes for expiry and room/seat revocation. |
| `room_records` | `(room_id, id)` primary key; room foreign key; original completion time and record JSON; index `(room_id, finished_at DESC)`. |

Store all existing history; no silent pruning or score reset. A finished snapshot and its result are saved together transactionally; repeated persistence of that match cannot add another record or change its original completion time. Names/setup and game-state changes are also atomic. All room-data queries require `room_id`; no application method offers unscoped names, snapshots, or records. Authentication lookup by token hash and private operator listing are the intentional exceptions.

Introduce focused modules:

- `server/repository.ts`: asynchronous `RoomRepository` contract, persisted room types, and access identity. SQLite can implement async methods around synchronous short transactions today; consumers do not depend on `DatabaseSync` or SQLite SQL.
- `server/store.ts`: SQLite implementation with parameterized, room-filtered queries and conditional revision updates. Keep SQL within this implementation.
- `server/migrations.ts`: new-schema initialization and explicit legacy import/backup; no serving or invitation distribution.
- `server/access.ts`: invitation exchange, session resolution/revocation, identity comparison, and authentication limits.
- `server/rooms.ts`: per-room runtime ownership, serialized mutations, presence, timers, snapshots, and seat projections.
- `server/operator.ts`: private CLI orchestration and credential-file handling.
- `server/app.ts`: HTTP/socket transport wiring; `server/index.ts`: configuration and startup.

Repository operations distinguish an authenticated `AccessContext = { roomId, seat, sessionHash, credentialVersion }` from caller input. Payloads cannot supply or override this context. Internal mutation APIs accept an explicit room identity; transport handlers obtain that identity only from authentication.

## Live room isolation and broadcasts

Replace the singleton with a lazy `Map<RoomId, RoomRuntime>`. Every runtime owns its snapshot, names/setup projection, seat connection sets, serialization queue, revision, and checkpoint time. A shared 250-ms scheduler dispatches due work to separate room queues. It ticks only connected/active runtimes and checkpoints running deadlines every five seconds per room. Recovered matches pause from their persisted `saved_at`; proposal readiness resets with a fresh proposal ID. No readiness or online state is restored from a prior process.

All setup, propose, ready, action, lobby, leave, connect, disconnect, and deadline operations enter that room's queue. Clone persistent state before mutation, validate and save it, then replace the runtime snapshot and publish. A failed save must not publish unpersisted state or acknowledge success. Reject stale revisions rather than overwriting newer data; reload/pause safely and require resynchronization. Presence sets represent actual connections even when persistence fails; a failure pauses/rejects play until durable state can be reconciled. Each acknowledged mutation returns a matching persisted revision, included in `RoomState` for the client.

Authenticate the socket handshake from its session cookie and approved origin. Assign immutable access context on the server and join server-selected channels `room:<id>:seat:0` or `room:<id>:seat:1` and `session:<hash>`. Clients cannot select or join channels. At publish time revalidate recipient sessions and membership before sending; use only validated sockets from the target room's membership. Deliver `viewMatch(match, 0)` only to valid seat-0 recipients and the seat-1 projection only to seat-1 recipients. There is no namespace-wide state broadcast or shared complete-match payload. Socket.IO channels are delivery groups; repository authorization remains the access boundary.

Auth failures happen before mutation and cause no save or state broadcast. Malformed events are rejected before mutation. If the engine detects a deadline while processing an otherwise valid room action and then rejects that late action, persist/publish only that room's resulting deadline transition. A forged match/proposal ID cannot select another runtime or record; it is checked against the authenticated room's current state. A seat cannot ready both sides or change its identity through a payload.

Disconnecting the last valid connection for one seat resets only that seat's proposal readiness and pauses only that room's match. Other tabs for that seat keep it online. Logout, expiry, rotation, and disable remove invalid memberships before publishing further private state. When both seats go offline, save the paused state and evict the runtime immediately after its queued work drains. Later connections reconstruct it from persistence. Closing the app drains queues, pauses/checkpoints loaded matches, and closes sockets/database without reviving timers through shutdown callbacks.

## HTTP and browser isolation

Keep the current room API paths (`/api/session`, `/api/setup`, `/api/logout`, `/api/invite`) deriving room identity exclusively from the session. There are no room-addressed HTTP read endpoints or discovery routes. `/api/health` returns only process health. Authentication errors contain no room names, existence hints, or records. Setup is a one-time, room-scoped transaction, whether initiated over HTTP or Socket.IO.

Maintain no-store API responses and current CSP. Require the configured same origin for browser mutations and socket handshakes; reject cross-site fetch metadata and unsolicited missing-Origin browser mutation requests. Local operator commands bypass HTTP entirely. Test clients explicitly supply the configured origin. Trust forwarded client-IP headers only from a configured allowlist of proxy addresses, with default `trustProxy=false`; app deployment documentation describes this requirement without changing proxy infrastructure.

Add `roomId` and `revision` to `RoomState`. Tie the client's socket lifecycle to room ID, seat, and a local authentication generation. Disconnect the previous socket and clear old room data immediately when a new login starts; ignore results/events from older generations. After failed login, revalidate the existing cookie to recover the previous room safely. Reconnect from `/api/session` when access changes in another tab. A stale room event cannot overwrite a newly selected room; socket events must match the active room ID and nondecreasing revision. Different browsers/isolated contexts can visit different rooms simultaneously. Settings localStorage remains device preferences only; never store invitations or private room data there.

Limit interface edits to onboarding/authentication and invitation copy. Do not redesign the cat or merge/stage the user's UI changes. Put new multi-room browser tests in a separate spec and reusable fixture rather than rewriting the dirty `tests/e2e/v1.spec.ts`.

## Abuse protections for operator provisioning

No anonymous room-creation path exists. Operators must deliberately increase room capacity or rotate/disable a leaked invitation. Proposed initial limits, configurable through validated server-only configuration:

| Limit | Default and behavior |
| --- | --- |
| Active rooms | `MAX_ROOMS=100`; CLI rejects creation at the cap, transactionally, including concurrent CLI attempts. Disabled rooms retain data and do not count. |
| Session lifetime | 30 days; expiry rejects HTTP and socket actions immediately. |
| Sessions per seat | `MAX_SESSIONS_PER_SEAT=5`; reject further logins at capacity, after expiry cleanup and replacement-session revocation accounted for transactionally. |
| Sockets per session | `MAX_SOCKETS_PER_SESSION=3`; reject excess connections without changing presence. |
| Login requests | 10/minute/client IP, including invalid requests; retain general HTTP 120/minute/IP limit. |
| New socket handshakes | 30/minute/client IP, for polling and WebSocket entry paths; upgrades of an existing connection do not spend another handshake slot. |
| Game messages | 180/10 seconds/session, aggregated across sockets, including invalid events; limit reconnect bypass. |
| Incoming bodies/messages | 16,384 bytes; keep existing action schemas, text/stroke/point limits. |

Rate-limit tracking expires idle entries, has a maximum 10,000 keys per limiter, and rejects new keys while full rather than growing without bound. Avoid permanent lockouts of a seat due to failed guesses. IP limits on a private proxy require a verified proxy allowlist before a later rollout; never trust arbitrary `X-Forwarded-For` values. Test drawing interactions against the session message budget. Limits bound abuse, not guarantee a particular number of concurrently active drawing games; capacity tuning requires measurement before launch. History stays preserved; pagination/summary optimization can follow if real history sizes warrant it.

## Legacy data preservation and migration

Do not inspect or modify the real database or `.env` during this planning work. There may be existing single-room data; the procedure must work whether there is none, a finished match, or a paused active game.

Fresh empty databases initialize the new schema. Startup encountering the legacy `settings`/`records`/`sessions` schema refuses to serve with a clear maintenance instruction. It does not silently create a default room, replace names, generate keys, map old sessions to arbitrary rooms, or discard records.

Provide an explicit offline `rooms migrate-legacy --backup <new-file> --output <private-file>` command, to be run only after separately authorized maintenance:

1. Stop the sole app. Check schema and validate every legacy JSON value before changing data. Reject mixed/unknown/newer layouts or corrupt data rather than partially importing them.
2. Create a consistent SQLite backup using `backup(sourceDb, path)` from `node:sqlite`, documented in [Node 24's SQLite API](https://nodejs.org/download/release/v24.0.0/docs/api/sqlite.html), not a live copy of only the main `.sqlite` file. Require a nonexistent destination; verify integrity and legacy row counts. Detect the supported API before writing anything and fail on an unsupported runtime; do not improvise an unsafe copy.
3. In one transaction create a new legacy room, import persisted names and setup state (or legacy environment name defaults with setup still incomplete), preserve the snapshot and every record's ID, original timestamp, outcome, scores, and streak. Pause a live match at its saved checkpoint and reset proposal readiness. Preserve leave votes as existing saved room state.
4. Archive the old tables as `legacy_settings_v1`, `legacy_records_v1`, and `legacy_sessions_v1`. Archived sessions are never accepted by the new app. Keep the archives as preservation evidence; normal APIs never read them.
5. Provision two fresh room invitations and write the private output file with the same rollback-on-file-failure protections as creation. Do not import site-wide keys or active sessions as valid new access. Mark the migration completed with its legacy room ID and verify foreign keys, integrity, values, and record counts.
6. After commit, rerunning the migration refuses to create duplicates and reports the completed room ID without redisclosing invitations. If the invitation file is subsequently lost, use seat rotation.

Only future authorized maintenance creates production invitations. Tests use synthetic databases and credentials. On failure before commit, roll back schema/data changes and remove partial invitation output; retain the verified backup. Keep original keys/env and backup privately until the migration is accepted, but remove the keys from the new runtime config. Existing invitation links and sessions deliberately stop working after migration; the operator distributes replacements to the original couple.

Rollback is an operational procedure, not automatic down-migration: stop the new app, preserve its current database and invitation files, restore the verified pre-migration backup, and run the matching old image. New-room data cannot be made readable by the old app and must be retained separately. Never run old code against the new database or overwrite post-migration records without preservation. No migration commands are executed as part of this task's coding/test approval.

## CI/CD and deployment documentation

Keep CI verification on pull requests and main: unit/store/server isolation tests, production build/typecheck, browser tests, and a local Docker build. All tests use temporary databases and synthetic credentials; browser artifacts contain no production invitations.

Replace automatic main-branch publication with a release job requiring manual dispatch, a default-false release-enable repository setting, successful verification of the selected main-branch commit, and a protected GitHub release environment approval. Fail closed if publishing is disabled; document that environment protection must be configured separately before releasing. Only immutable commit image tags are planned; no `latest` updates. Changing repo workflow source later does not alter installed GitHub environment protection or live containers.

Future template edits remove the Watchtower enable label and use a required pinned-image variable, so existing unpinned deployments are not perpetuated in examples. Document one app process/replica, persistent local SQLite volume, UID/GID ownership, CLI usage and secret-file permissions, migration/recovery, proxy trust, invitations/revocation, and release hold. Replace current public-route instructions with deferred steps explicitly requiring a later launch decision. Docker must include the compiled operator CLI; runtime keys/names are no longer site-wide environment variables.

Do not trigger GitHub Actions publishing, change package visibility, edit live TrueNAS configuration, change Cloudflare/Traefik routes, or generate production invitations. Even approved code implementation is release preparation only.

## Path to PostgreSQL and multiple app instances

The asynchronous repository contract keeps database-specific SQL, schema migration, transactions, and serialization behind one implementation. A later PostgreSQL repository will preserve room IDs, seat constraints, token hashes, credential versions, original records, and revision semantics. Parameter placeholders/upserts are implementation details; they are not copied blindly from SQLite. Run the same repository isolation/transaction contract suite against PostgreSQL before cutover.

Multiple instances also need shared presence/session invalidation and rate limits; authoritative per-room action ordering and timer ownership with leases/fencing or transactionally serialized commands; cross-instance state notification; and a Socket.IO adapter. An adapter alone does not coordinate game-state mutations or ensure only one timer advances a room. These are required future work, not a claim that adding Redis makes this release horizontally scalable.

Seat-specific delivery channels can remain stable across instances. Preserve polling fallback and add routing affinity for polling; otherwise a deliberate WebSocket-only choice loses that fallback. Socket.IO documents both the adapter and load-balancing requirements in its [multiple-node guide](https://socket.io/docs/v4/using-multiple-nodes/). Room delivery is described in the [rooms guide](https://socket.io/docs/v4/rooms/); a consistent backup is described by the [SQLite backup API](https://www.sqlite.org/backup.html). No external database, Redis, adapter, or infrastructure is provisioned now.

## Acceptance and approval boundary

Automated acceptance must use at least two rooms and four authenticated seats concurrently, with positive same-room delivery controls. Prove isolation for HTTP names/setup/history and every socket mutation, readiness, disconnects, timers, pause/restart, and record persistence. Collect full socket event streams to prove absence of foreign broadcasts even when state is otherwise identical. Test forged room/seat fields, foreign match/proposal IDs, anonymous/expired/revoked access, room disable, leaked invitation rotation, duplicate completion, failed writes, resource caps, and same-seat cross-room browser switching.

Migration tests include populated legacy history, environment default names, live and finished snapshots, old-session rejection, verified backup/restore, idempotent rerun, corrupt/unknown schemas, and transaction/file-output failure. Browser tests use four isolated contexts, two simultaneous games, independent scorecards, reconnect/refresh, and switching from A/seat 0 to B/seat 0 with stale events.

Approve this written design and the companion implementation plan before product code, dependencies, or workflow/config changes begin. Approval of the operator-provisioned product model alone is not implementation approval. Deployment, production migration, production key creation, publishing, and public launch require separate explicit authorization.

## Subsequent approval scope (2026-10-02)

The user approved this design and plan, selected native implementation, and later authorized raising a PR. They additionally authorized including the pending cat UI work after reviewing its improvement over the existing version. See the plan's PR authorization section for the selected files and preservation approach. This authorizes a review branch and PR; public launch, deployment, image publication, production credentials/migration, and infrastructure changes remain on hold.