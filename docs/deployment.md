# CoupleOGames deployment

## CI and image publishing

The `.github/workflows/coupleogames.yml` workflow runs on pull requests to `main` and pushes to `main`. It installs Node.js 24 dependencies, runs the unit/server and Playwright end-to-end suites, builds the production app, and builds the Docker image. A push to `main` publishes `ghcr.io/sanaro99/coupleogames:latest` and a commit-specific `sha-…` tag after verification succeeds.

The first successful publish creates the GHCR package. Set that package's visibility to **Public** before installing it on TrueNAS so the host can pull without registry credentials. Do not put app keys or invitation links in GitHub Actions, the image, or the repository. Watchtower only updates containers carrying its enable label.

## Seattle TrueNAS configuration

This template follows the existing Seattle Apps, Traefik, Cloudflare Tunnel, and label-scoped Watchtower pattern. Recheck the current node, free host port, storage pool, and route before installing; the saved infrastructure snapshot is not live state.

1. Create `/mnt/apps-pool/coupleogames/data` on the apps pool and give it read/write access to the image's `node` user (UID 1000). Keep the SQLite database and its WAL files together in this directory.
2. Create `/mnt/apps-pool/appconfig/coupleogames.env` with mode `0600`. Set `PARTNER_ONE_KEY` and `PARTNER_TWO_KEY` to distinct private keys of at least 24 characters. Set `APP_ORIGIN=https://coupleogames.sanchitarora.me`. Partner names may be left blank for first-run setup.
3. Generate the keys and invitation links from a trusted local checkout: set the production `APP_ORIGIN` in the ignored local `.env`, then run `npm run setup`. It writes the ignored `.env` and `data/invitations.html`. Transfer only the required environment values into the TrueNAS env file; keep the invitations file private and share each link only with its intended player.
4. In TrueNAS Apps, install using the YAML in `deploy/coupleogames-truenas.yaml`. Confirm port 3001 is free first. This binds the app to loopback and stores data on the host path above.
5. Add the Traefik HTTPS router for `coupleogames.sanchitarora.me` on `websecure`, with the existing `letsencrypt` resolver and upstream `http://127.0.0.1:3001`. Add a Cloudflare Tunnel published-application route to `https://localhost:443` and set Origin Server Name to `coupleogames.sanchitarora.me`. Preserve the Host header and WebSocket upgrade.

The TrueNAS host shell is required to create the data directory and set its ownership; use the Apps UI for container installation. Do not expose port 3001 to the LAN or route the database through Traefik or the tunnel.

## Verification and operations

- Confirm the container is healthy at `/api/health`, then open the public HTTPS URL.
- Open both private invitation links on separate devices. Verify both seats connect, a game can be played, and the scorecard survives a browser reload.
- Restart the container and confirm the active game resumes and saved records remain. Confirm the app still works through the Cloudflare Tunnel over WebSockets.
- Take and retain ZFS snapshots of the complete `/mnt/apps-pool/coupleogames/data` directory, including any SQLite `-wal` and `-shm` files. Test a restore before relying on it.

Watchtower polls every 120 seconds in the existing setup and updates the `latest` tag. To roll back, stop auto-update for this app, change its image to the known-good `sha-<full-commit>` tag, and redeploy. Restore the matching data snapshot only if a data-format change requires it.

## Scaling boundary

Run one app instance for this two-seat room. Live Socket.IO connection state is held in process memory and persistence uses SQLite. Moving to multiple replicas would require a shared Socket.IO adapter and a shared database, plus sticky-session or equivalent routing. Supporting multiple couples also requires an app-level room/account model. The OCI image and runtime configuration remain portable while those changes are deferred.
