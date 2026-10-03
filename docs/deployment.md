# Two-player sessions and deployment

Visitors can create private two-seat rooms from the website. One app process owns one SQLite database on local storage. Image publication and installation remain explicit operator actions through the protected release process; source changes do not update live infrastructure.

## Verification and protected releases

`.github/workflows/coupleogames.yml` verifies pull requests and main pushes with Node 24, unit/server tests, production builds, Chromium acceptance tests and a local Docker build. Those events cannot publish. Publishing requires all of:

- A deliberate `workflow_dispatch` on `main`, with its `publish` checkbox selected.
- Verification of that same dispatch commit succeeding.
- Repository variable `COUPLEOGAMES_RELEASE_ENABLED` set to the exact string `true`; missing or other values keep release disabled.
- The `coupleogames-release` environment, which must be configured with required reviewers before enabling release.

Only that job has package-write permission. It publishes a commit-specific `sha-<full commit>` tag, with no `latest` tag. Prefer an image digest when installing. Both source Compose templates require an immutable image and privately supplied port settings, bind only to loopback, and omit automatic-update labels. Updating source YAML does not change installed infrastructure. Keep environment-specific overrides in ignored `.local-deployment/` files or outside the repository; never commit service URLs, host paths, or infrastructure inventories.

Environment protection and reviewer availability depend on repository visibility and GitHub plan. If required reviewers are unavailable, keep release disabled and arrange an explicitly approved alternative before publication. See manual dispatch and environment protection. No workflow dispatch or repository-setting change is part of this implementation.

## Configuration and local development

Use Node 24 or newer. Run `npm ci` and `npm run build`. Copy `.env.example` to an ignored `.env` only for the intended local environment. Normal serving no longer consumes `PARTNER_ONE_KEY`, `PARTNER_TWO_KEY` or partner-name defaults.

| Setting | Default / purpose |
| --- | --- |
| `APP_ORIGIN` | Local development origin; explicit HTTPS origin in production |
| `DATABASE_PATH` | `./data/coupleogames.sqlite`; the app and CLI must use the same path |
| `HOST`, `PORT` | Configure the listener privately; containers listen on internal interfaces |
| `MAX_ROOMS` | 100 active rooms; creation fails atomically at capacity |
| `MAX_SESSIONS_PER_SEAT` | 5 unexpired device sessions per seat |
| `MAX_SOCKETS_PER_SESSION` | 3 open socket connections per session |
| `TRUSTED_PROXY_ADDRESSES` | Empty; optional comma-separated exact proxy IPs, never a blanket trust flag |
| `COUPLEOGAMES_IMAGE` | Required immutable image in deferred Compose examples |
| `COUPLEOGAMES_ENV_FILE` | Private environment-file location for Compose |
| `COUPLEOGAMES_CONTAINER_PORT`, `COUPLEOGAMES_BIND_PORT` | Required app and loopback ports, selected privately |
| `COUPLEOGAMES_UID`, `COUPLEOGAMES_GID` | Non-root runtime identity for the bind-mount example |
| `COUPLEOGAMES_DATA_DIR` | Private local data-directory location for the bind-mount example |

Limits must be positive safe integers. The browser test server uses a fresh, synthetic `test-results/e2e.sqlite` and a larger device-session allowance because the preserved UI suite logs in repeatedly from new contexts. Repository/access tests enforce the production five-session default. Do not point test seeding at real data.

For local testing only, choose a new local database and run the following after building:

```sh
npm run rooms -- create --output ./data/private/local-session.html
npm run dev
```

The command prints a room ID and output path, never credentials. Open that private HTML file locally and give one seat link to each intended partner. Do not upload it to static hosting, commit it, or include it in an image. `npm run setup` has been retired and creates no keys.

## Operator access and invitation lifecycle

The public `POST /api/rooms` endpoint creates a room and signs the creator into seat `0`. Its no-store response supplies separate creator and partner credentials; the partner uses seat `1`. Creation requires the configured same origin, an empty JSON body, available capacity, and no existing authenticated room. No room listing or administrative HTTP endpoint is exposed. The operator must have filesystem access to the database for rotation and disabling rooms.

The creator credential contains its own independently random 256-bit secret and the partner's independently random 256-bit secret. SQLite stores only hashes of the full creator credential and the partner credential. Knowing the partner credential cannot grant the creator seat. Creator sessions include the creator credential inside their random HttpOnly session cookie, with only a hash of that entire cookie stored in SQLite. The authenticated, creator-only `GET /api/invitations` endpoint recovers both invitations from that cookie; partner and legacy operator sessions receive no invitations. Forged cookies must first pass full-token authentication. No plaintext credentials are persisted in the database or browser storage accessible to JavaScript. Copy the return link for use after session expiry or sign-out. Invitation tokens use URL fragments, which are removed when consumed. Operator rotations invalidate the affected old invitation, so distribute the replacement privately. Anyone who obtains a seat link can use that seat.

```sh
npm run rooms -- list
npm run rooms -- create --output ./data/private/session-new.html
npm run rooms -- rotate --room ROOM_ID --seat 0 --output ./data/private/player0-new.html
npm run rooms -- disable --room ROOM_ID
```

Output is created exclusively, never overwritten. Parent directories are requested with mode `0700`, files with `0600`; on Windows, restrict the directory's ACL as POSIX modes do not replace Windows access controls. Output beneath `public/` or `dist/`, including resolved symlink paths, is rejected. Use a new filename for every creation or rotation. An output failure prevents the DB mutation; a DB failure removes the newly written file. Filesystem and SQLite are separate transactions: a process crash before the DB commit can leave an inactive link file. Delete it and retry. If a crash leaves committed access without a usable file, rotate the affected seat.

Opening `/#invite=...` scrubs the fragment promptly, exchanges it for a new opaque HttpOnly, SameSite=Strict cookie and replaces only that browser's previous session. Production cookies require HTTPS. Sessions expire after 30 days. Signing out revokes that device session; rotation revokes all sessions for only the chosen seat, including existing sockets. Disable revokes both seats and preserves names, games and history; there is currently no re-enable command. A seat at its device limit must sign out elsewhere or ask the operator for rotation.

The creator can copy the partner invitation and their own return link during setup or from Settings. Players cannot rotate credentials; existing operator-issued rooms retain their separate invitations. Creator access includes persistent credentials for both seats: sign-out revokes the device session, not copied invitations. If a creator link or session is compromised, rotate both seats or disable the room. Both partners can configure names once within their own room. Names, readiness, online state, actions, scorecards and socket projections use the authenticated room and fixed seat; request parameters cannot choose a different room or seat. Invitation responses use `Cache-Control: no-store`.

## Abuse controls and proxies

Anonymous creation is limited to five attempts per hour per trusted client IP and thirty attempts per hour across the app. The active room cap defaults to 100; the operator can disable unused rooms to release capacity while retaining their data. Active-room creation and device/session limits run inside SQLite transactions. If creator sign-in fails after creation, the new room is disabled to release capacity. Bounded in-memory limiters also enforce 120 API requests per minute per IP, 10 login attempts per minute per IP, 30 new Socket.IO handshakes per minute per IP and 180 events per 10 seconds per session across tabs. Invalid game events also consume that budget. Bodies and socket messages are capped at 16 KiB; drawing coordinates, counts and payloads are validated.

Mutation requests require the configured Origin and reject cross-site browser metadata; new sockets require the configured Origin and a valid cookie. Established sockets are checked before each action and every recipient emission, with a periodic revocation/expiry sweep. CORS is not an authorization boundary.

Forwarded client addresses are honored only through an explicitly trusted proxy chain. Before any later deployment, determine the actual immediate proxy addresses and configure only those exact IPs. Without that configuration, a proxy's clients share its limit bucket; arbitrary callers cannot evade quotas using `X-Forwarded-For`. An IP quota can affect players on the same network; choose future tuning from observed traffic rather than disabling it. Limit buckets reset on a single-process restart.

## SQLite preservation and legacy migration

Normal startup initializes an empty database or opens a supported multi-room schema. It refuses old single-room, mixed, corrupt, unknown or newer schemas instead of silently discarding data. Do not run the old app against a migrated database.

Before a future production migration, preserve the existing deployment image/configuration and obtain an independent verified backup. Stop the old app and all writers. The following example is maintenance documentation, not authorization to run it on real data:

```sh
npm run rooms -- migrate-legacy --offline --backup ./data/private/pre-rooms.sqlite --output ./data/private/legacy-session.html
```

`--offline` acknowledges that writers have been stopped; it does not stop them for you. Optional `PARTNER_ONE_NAME` and `PARTNER_TWO_NAME` are read only by this maintenance command to fill unset legacy names. Existing site-wide keys are never imported. The command:

1. Validates the supported legacy schema, JSON snapshots and record identities/timestamps before changes.
2. Uses SQLite's online backup API to make an exclusive backup, including committed WAL data, and checks integrity and exact legacy values. See SQLite backup and Node SQLite backup API.
3. Creates the private two-seat invitation output before committing the migration.
4. Imports all existing names, setup state, history and snapshot into one private legacy room in a single transaction, archives the original tables, and verifies foreign keys, integrity, record counts and values before commit. A fingerprint check rejects concurrent changes after backup.
5. Pauses restored play at its saved checkpoint, clears readiness and refreshes any proposal ID. Legacy sessions and invitation keys stop working; give the two new links to the existing players.

The backup and output cannot overwrite existing files or target static directories. Failure before commit leaves the legacy tables/data usable and retains a successful backup; unusable new invitation output is removed. A repeated migration refuses to create a duplicate legacy room; its ID is recorded in the migration metadata and appears in the room list. If the CLI prints only its generic failure message, inspect schema and maintenance paths privately, keep the source and backup intact, and do not force startup.

For rollback before new multi-room activity, stop every writer and restore the verified backup to a separate path first. Confirm its legacy schema/values and launch only the matching old version against that restored database. Keep the migrated database and its sidecars intact. Once new rooms have played, rolling back to a pre-migration backup would lose their data; preserve the new DB and recover forward instead. There is no automatic destructive down-migration.

For routine backups, prefer SQLite's backup API or stop the app before a filesystem backup. Copying only the main file while WAL writes are active is insufficient. Take a backup before upgrades and rehearse restoration into a separate path. Restrict the DB, backups and invitation files to operators; room privacy does not hide data from a filesystem administrator.

## Deferred container operation

The image includes `server-dist/server/operator.js`; its runtime needs no TypeScript tooling. After a separately approved installation, container commands would use the same mounted database and a private output directory:

```sh
docker compose exec coupleogames node server-dist/server/operator.js list
docker compose exec coupleogames node server-dist/server/operator.js create --output /app/data/private/session-new.html
```

Run create/rotate/disable/list with the app online if needed. Migration requires offline maintenance: stop the app, then use a one-off container with the same pinned image, database mount and environment, without a web port. Keep output in the restricted data mount and retrieve it through an operator channel.

`compose.yaml` uses one local persistent volume. `deploy/compose.example.yaml` illustrates a local bind mount with privately supplied runtime identity, environment-file location, ports, and storage directory. Neither example contains an installation-specific setting. Verify permissions for the database directory, WAL files, backups and private output before installation. Never mount SQLite on a network share or run replicas against the same file. Public health reports only `{ok:true}` and does not prove a particular room is playable.

Later release authorization must separately cover image publication/visibility, actual storage and service setup, protected-environment reviewers, the pinned image selection, proxy addresses, HTTPS router, tunnel/DNS configuration and any public launch. No network configuration change is included here.

## Path to multiple app instances

`RoomRepository` is asynchronous and separates storage from room runtimes and transports. Implement a PostgreSQL repository using the same scoped contract tests, composite room/seat keys, credential-version checks, revision compare-and-swap and transactional uniqueness for history/session/cap writes. Move schema versions through explicit migrations and retain backups.

A Socket.IO adapter can distribute room broadcasts, but it does not coordinate the game engine. Before replicas, add shared connection presence, distributed room ownership/action ordering, deadline/checkpoint ownership and shared rate limits. Make reconnects read the authoritative persisted revision and retain per-recipient secret projection and credential checks. Use sticky routing if keeping HTTP polling, or deliberately select WebSocket-only transport. See Socket.IO rooms and multiple-node requirements. Do not enable replicas after installing an adapter alone.

## Verification

```sh
npm test
npm run build
npm run test:e2e
docker build --tag coupleogames-private-rooms-ci .
```

Tests create temporary/synthetic databases. They cover scoped writes and broadcasts, all four games, simultaneous two-player games, fixed seats, revocation/expiry, limits, room switching, durable history, restart recovery, migration rollback/backup restoration and release gating. Container verification requires a working Docker daemon; if unavailable locally, the build remains a CI check. These commands do not push an image or deploy.
