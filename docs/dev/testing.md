# Tested host and environment

This fork tests its current DS Bot behavior on one source Web host. It does not promise compatibility with earlier DSH releases, other Node versions or other operating systems. Existing saved-team, Session, binding, memory and recovery fixtures remain behavior regressions for the current host; they are not an old-host matrix.

| Input | Tested value |
|---|---|
| Platform | Windows x64; GitHub runner `windows-2025` |
| Node.js | `24.15.0` |
| npm, plugin tools | `11.12.1` |
| pnpm, Core source dependencies | `11.28.5` |
| Core source | [`vb2250158/deepseek-harness@de3fc0d70888e6ef7c2c6b64cb6d4f0c11db4ca2`](https://github.com/vb2250158/deepseek-harness/commit/de3fc0d70888e6ef7c2c6b64cb6d4f0c11db4ca2) |
| Core host version | `0.2.2-alpha.3` |
| Runtime entry | Source `dsh` Web profile through `@deepseek-ai/dsh/profile-boot` |

The recorded production baseline on 2026-11-04 is Core `564bd14e9ec1d82d3e2985dbd8dea9f40129d71a` / `0.2.2-alpha.2`. The tested Core above is a candidate, not a claim of formal installation. Production switching belongs to the environment-maintenance owner.

## Prepare the source host

Use an independent Core checkout at the exact commit above. In PowerShell, from that checkout:

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
pnpm install --frozen-lockfile
pnpm run build:native-system
pnpm exec tsx scripts/compile-referenced-projects.ts host-libraries
pnpm run build:lib:client
pnpm run build:web
```

These existing Core commands emit the native Host addon, Host and Client libraries, and Web assets. They do not package SDK executables, desktop installers or mobile apps. `DSH_HARNESS` must name this checkout; do not run `npm run harness` to download an older npm Core for this verification target.

From `ds-bot/`, with `DSH_HARNESS` set to the absolute Core checkout path:

```powershell
npm ci --no-fund --no-audit
npm test -- --test-concurrency=4
node scripts/build-client.mjs --check
npm run lint
node dev/ci-web-smoke.mjs
```

The Web smoke creates and removes its own temporary Home/profile, starts the public source Web profile on a dynamically allocated loopback port, checks authenticated HTML, the Bot API and exact served client bytes, and verifies public shutdown with exit code zero and a closed port. It uses no production profile, credentials or model calls.

## Default CI and local evidence

[`Test`](../../.github/workflows/test.yml) has one Windows job named **Test result**. Pushes to `main`, pull requests and manual dispatch run current behavior regressions, generated-artifact checks, lint, source Host Web smoke and a leak scan of the tracked publication tree. No old DSH, multi-Node or multi-OS matrix runs. Desktop, mobile, Docker and SDK packaging are outside this automatic test workflow; it offers no optional package build path.

Locally, select checks for the changed surface and reuse passing results whose inputs have not changed. Configuration-only or documentation-only changes do not require replaying the historical full behavior suite or desktop acceptance. Validate the new workflow and any changed smoke fixture; CI runs the declared current target. A change to runtime behavior still needs its affected behavior and current-data regressions. Keep assertions that protect production history; do not remove them to make a host update pass.

Standalone app releases in `release.yml` are a separate, explicitly initiated release operation. They are not triggered by a push or pull request and are not evidence for this source Web target.
