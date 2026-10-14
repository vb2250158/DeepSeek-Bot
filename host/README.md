# DS Bot host and browser clients

English | [中文](README.zh.md)

This fork adds a dedicated host deployment. DSH Web runs the Bot team, models, tools, schedules and persistence on one computer. Other computers and phones open its browser UI; they need neither Node.js nor a local DSH installation. Closing a browser does not stop host work. Stopping the host stops execution.

## Install and start

Install Node.js 22.19+ or 24+, Git and pnpm on the host. In this checkout:

```sh
npm --prefix ds-bot ci
npm --prefix ds-bot run build
npm --prefix host ci
npm --prefix host run setup
npm --prefix host start
```

Setup packs this fork and installs that fixed archive into a separate DSH Web profile. It does not install the upstream npm release or modify an existing DSH profile. The default data directory is `.ds-bot-host/` in this checkout. Set `DS_BOT_HOST_HOME` to an absolute persistent directory before setup and every start to use another location. Keep the host data and installed package archives together when backing up. Configure model providers in the host browser settings; no model credential belongs on a client.

The backend listens only on `127.0.0.1:3097`. `DS_BOT_HOST_PORT` changes this port. DSH prints a private launch link for browser authentication; do not put it in a repository, screenshot or shared log. Browsers exchange it for DSH's signed session cookie. All clients share one operator identity and authority; this is a personal team host, not a multi-user permission system.

## Connect computers and phones

Install [Caddy](https://caddyserver.com/docs/install) on the host. Choose a hostname or LAN IP reachable from the clients. Set `DS_BOT_PUBLIC_URL` to its HTTPS origin before starting the host. Run Caddy separately, using the same authority in `DS_BOT_PUBLIC_ADDRESS` and the same backend port. For example, in PowerShell:

```powershell
$env:DS_BOT_PUBLIC_URL = 'https://bots.example:8443'
$env:DS_BOT_PUBLIC_ADDRESS = 'bots.example:8443'
$env:DS_BOT_HOST_PORT = '3097'
npm --prefix host start
# In another terminal with the same two Caddy settings:
caddy run --config host/Caddyfile
```

Replace the example authority with the host's reachable address. The supplied Caddyfile uses Caddy's internal CA; trust that CA on each computer or phone. For an existing public domain and public certificate, use the normal Caddy certificate configuration instead of `tls internal`. Permit only the selected HTTPS proxy port through the host firewall. Caddy preserves Host and forwards WebSockets; DSH still checks request origins and authenticates every Bot API request. The deployment supports an origin root, not a path prefix.

Open the private launch link on each intended client once. Subsequent visits use the clean HTTPS address. Bot roster, conversations and memories come from the host; browser-local presentation choices can differ. Working folders and directory selection refer to the host computer. Desktop-only embedded browser controls remain dependent on DSH Desktop and are not promised by this Web deployment.

## Rabi ownership

Rabi continues to own external message routing, business plans and delivery receipts. This deployment supplies a DSH execution host and the existing Bot collaboration UI. Installing it does not bind Rabi routes, copy Rabi personas or migrate business memory. A Rabi-to-Bot binding needs an exact host/session and a separately verified delivery and reply path.

## Validate and update

```sh
npm --prefix host test
npm --prefix ds-bot test
node ds-bot/scripts/build-client.mjs --check
npm --prefix ds-bot run lint
```

The real browser smoke uses the scripted mock model, isolated host data and a real Caddy proxy. Set `DS_BOT_CADDY` to the Caddy executable and `DS_BOT_PLAYWRIGHT_ROOT` to an existing package root containing Playwright, then run `npm --prefix host run test:browser`. Optionally set `DS_BOT_BROWSER_EXECUTABLE` to an installed Chromium browser and `DS_BOT_EVIDENCE_DIR` to a private screenshot directory. It checks authentication, request origins, computer and phone layouts, shared Bot updates, work after closing a client, and restart persistence; it does not use a real model key or change Rabi bindings.

Before updating, stop this host and back up its entire data directory. Pull the fork, build the browser bundle, rerun setup and start the host. Setup rejects a changed archive with an unchanged plugin version. It does not reset Bots, conversations or memories. Client reloads receive the host's installed bundle.

On Windows, the Bot plugin retries transient sharing violations during atomic state replacement for up to 1000 ms. Set `stateWriteRetryMs` in the `bot` row of `host.patch.yml` to change the budget (0 disables retries; maximum 60000). The old state remains intact if replacement fails.
