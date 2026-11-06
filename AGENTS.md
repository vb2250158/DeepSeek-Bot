# AGENTS.md

Instructions for AI coding agents that work on this repository. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md), which has the same rules with more detail.

## What this project is

DS Bot is a team of long-lived Bots, built on DeepSeek Harness (DSH). It has two parts:

- `ds-bot/`: the Bot features, written as a DSH plugin. The plugin runs in DSH Desktop, in DSH Web and in the desktop app.
- `app/`: the desktop app for Windows, macOS and Linux. It runs a pinned DSH with the `ds-bot` plugin, in its own profile and its own `DSH_HOME`, and imports an existing team from the user's DSH.

The Bot team:

- Every Bot is a long-lived identity whose work runs in DSH Sessions: one for its own chat, one for each group it is in, and a fresh one when the context fills up (earlier ones stay readable). Every turn runs through the normal DSH agent loop, tools and model routes.
- The team works together: Bots message each other, share group chats and can see what the other Bots are doing. Each Bot still runs on its own and does not disturb the others.
- Bots have clear, different jobs and equal team-management rights: every Bot can create, change and remove Bots and manage every group chat. Sidebar pins are independent of permissions.
- Users customize each Bot (name, role label, instructions, model, character).
- Behavior must be reliable: a Bot acts on evidence, stays inside its goal, and its results can be checked.

## Hard rules

1. **Build on DSH; never patch it.** Bot features use the documented plugin APIs. The desktop app starts DSH only through its documented entry points (`@deepseek-ai/dsh/profile-boot`, the `dsh` CLI). Never patch DeepSeek Harness or depend on files inside a DSH install. If something is missing in DSH, stop and say so; do not work around it with a patch.
2. **No secrets.** Never write, print or commit API keys, tokens, cookies or `DSH_HOME` contents. Use the mock model (`ds-bot/dev/mock-llm.mjs`) for tests; it needs no key.
3. **Only original material.** Do not copy code, text, icons, logos or graphics from other products or websites. Code under a license compatible with Apache 2.0 is the only exception: say where it comes from and add its notice to the `NOTICE` file. This rule is about DS Bot's own interface. To name a third-party product that DS Bot connects to (for example the agent CLI a Bot runs on), use that product's official logo, and list it in `NOTICE` with its source and owner.
4. **`client.js` is generated.** Change `ds-bot/src/client/`, then run `npm run build` and commit both files. Never edit `client.js` by hand.
5. **Do not touch the user's own DSH data.** The desktop app keeps its data in its own `DSH_HOME`; its import only reads `~/.dsh` and never writes there. The test bench keeps its data in `.dsh-test-<name>/`. Never point a test at `~/.dsh`, at the desktop app's data or at a DSH that the user runs.

## Commands

Use the current Windows source Web target in [docs/dev/testing.md](docs/dev/testing.md): Node `24.15.0`, npm `11.12.1`, pnpm `11.28.5`, Core `3ff2154e44fcec3b98e1c529ae9f62b26b20096c` / `0.2.2-alpha.3`. Set `DSH_HARNESS` to that independent Core source checkout. Prepare only the existing native Host, Host/Client library and Web build steps listed there; do not install older npm Core versions for compatibility or build SDK executables and desktop/mobile packages.

In `ds-bot/`:

```powershell
npm ci
node --import ./test/harness-resolve.mjs --test --test-concurrency=4 --test-reporter=tap "test/*.test.js"
node scripts/build-client.mjs --check
npm run lint
node dev/ci-web-smoke.mjs
```

Select local checks by the changed surface and reuse passing evidence with unchanged inputs. Keep current behavior and production-history regressions. CI runs this one Windows target plus the tracked-tree leak scan; documentation and configuration changes do not justify replaying unrelated historical suites. The recorded formal Core is `3ff2154e44fcec3b98e1c529ae9f62b26b20096c` / `0.2.2-alpha.3` with DS Bot `0.2.7-rabi.2`; the new plugin candidate is separate from its formal installation.

## Branches, pull requests and issues

The full workflow is in [CONTRIBUTING.md](CONTRIBUTING.md#how-we-work). The parts that an agent must follow:

- Maintain this fork on the existing `main`; do not create maintenance branches. The upstream contribution workflow in CONTRIBUTING is separate from routine fork maintenance.
- Publish normal commits with an ordinary push and verify the remote commit. Preserve unrelated drafts and existing history.
- Fill in the pull request template. Link the issue with `Fixes #<number>`; a bug fix names the bug it fixes. Write the user-visible change in the Changelog field, and do not edit `CHANGELOG.md`.
- Do not start work on an issue or pull request with the `maintainer` label; it waits for the maintainer. Do not take an issue that someone else is assigned to.
- Before you change behavior, read the design for it in `docs/plans/` (and `docs/vision.md`); for interface work also `docs/design/ui-standard.md`. A change to a decided design needs the maintainer; a new large feature adds its design note to the same pull request.
- Do not close an issue without evidence: the pull request or commit that fixed it, the issue it duplicates, or the reason it will not be fixed.
- To triage issues, follow [.agents/skills/issue-triage/SKILL.md](.agents/skills/issue-triage/SKILL.md).
- To record a demonstration GIF for an interface change, follow [.agents/skills/record-browser-gif/SKILL.md](.agents/skills/record-browser-gif/SKILL.md).

## Layout

- `ds-bot/index.js` and `ds-bot/src/host/`: the server side (roster and store, tools, turns and delivery, groups, conversation parts and the search index, images, the browser bridge, the `api/bot` channel).
- `ds-bot/src/client/`: the browser side (sidebar, chat, panels, themes, characters, the Bot browser panel).
- `ds-bot/web-search.js`: the `auto` web-search provider, independent of the Bot team code.
- `ds-bot/test/`: unit tests and fixtures. `ds-bot/dev/`: the DSH packages for the tests (`harness/`), mock model, test bench, smoke test, character generator, Desktop scripts for Linux.
- `app/`: the desktop app (Electron main process and window, first-run setup and import, installer and updates).

## Style

- Follow the code around your change. Keep functions small and names plain.
- Write a comment only when the reason is not clear from the code: a hidden constraint, an invariant, a workaround. Do not describe what the code does.
- Commit messages in English, imperative subject, the reason in the body. Keep commits small.
- The person who asked for the change is the commit author. Do not set an AI agent or bot as author or committer, and do not add `Co-authored-by` lines for one.
- User-facing text in the plugin is English. Keep the README and README.zh.md in step when you change one of them.
