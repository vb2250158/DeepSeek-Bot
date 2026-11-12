<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg"><img src="docs/images/logo.svg" alt="DS Bot" width="260"></picture></p>

# DS Bot

English | [中文](README.zh.md)

![version](https://img.shields.io/badge/version-v0.3.0--rabi.3-blue) ![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-4D6BFE) ![license](https://img.shields.io/badge/license-Apache_2.0-green)

This fork integrates upstream 0.3.2 (0.3.2-rabi.1) with shared management for public Bots, Rabi assistant presets and deferred client loading. Private Bots require approval before native Bot tools publish their content to the team. Deleted private Bots retain protected folders, memory and chats until you release them in Settings. Rabi-bound Bots keep memory and learned skills under Rabi ownership; project AGENTS.md proposals remain available. Office directory inputs reject internal links, and PNG decoding bounds allocation and rejects truncated image data.

**[Download DS Bot for Windows 10/11 (64-bit) / 下载 Windows 10/11（64 位）版](https://github.com/Fei2411/DS-Bot/releases/latest)**, about 212 MB / 约 212 MB. A community project, not an official DeepSeek product. / 社区开源项目，不是 DeepSeek 官方产品。

On that page, download `DS-Bot-<version>-win-x64.exe`. Double-click it to install; DS Bot opens when it is done. No administrator rights, no Node or DSH needed. You need a DeepSeek account (you can sign up with a phone number on the spot) or a DeepSeek API key. DeepSeek bills by usage: see [its prices](https://api-docs.deepseek.com/quick_start/pricing). For macOS, Linux or the DSH plugin, see [Install](README.md#install).

在这个页面下载 `DS-Bot-<版本>-win-x64.exe`，双击就会安装，装好自动打开。不用管理员权限，不用另装 Node 或 DSH。需要一个 DeepSeek 账号（可以当场用手机号注册）或 DeepSeek API Key。DeepSeek 按用量收费，见[价格页](https://api-docs.deepseek.com/quick_start/pricing)。macOS、Linux 和 DSH 插件见[安装](README.zh.md#安装)。

<details>
<summary><b>The browser or Windows warns you, or blocks the installer? / 浏览器或 Windows 提示、拦下了安装包？</b></summary>

The installer is not signed yet, so Windows does not know its publisher.

- Edge says the file is not commonly downloaded: **···** → **Keep** → **Show more** → **Keep anyway**.
- "Windows protected your PC": **More info** → **Run anyway**.
- "Smart App Control blocked …", with no **Run anyway**: there is no safe way around this for an unsigned installer. Use [DSH Desktop with the DS Bot plugin](README.md#install) instead. Do not turn Smart App Control off.
- An antivirus blocks it: check the file first. In Command Prompt, run `certutil -hashfile <file> SHA256` and compare the result with the file's line in `SHA256SUMS.txt` on the release page. If they match, choose to trust the file in the antivirus.
- The installer says it could not uninstall the old version: close DS Bot and run the installer again. If your antivirus stopped the installer, check and trust it as above first.

Still stuck? [Report an install problem](https://github.com/Fei2411/DS-Bot/issues/new?template=install.yml).

安装包还没有签名，所以 Windows 认不出发布者。

- Edge 提示「不常下载」：「···」→「保留」→「显示更多」→「仍然保留」。
- 「Windows 已保护你的电脑」：「更多信息」→「仍要运行」。
- 「智能应用控制已阻止…」，而且没有「仍要运行」：未签名的安装包没有安全的绕过办法，请改用 [DSH Desktop 加 DS Bot 插件](README.zh.md#安装)。不要关掉智能应用控制。
- 杀毒软件拦截：先核对文件。在命令提示符里运行 `certutil -hashfile <文件> SHA256`，和 Release 页上 `SHA256SUMS.txt` 里这个文件的那一行比较，一致后再在杀毒软件里选「信任」。
- 安装时提示卸载旧版失败：先关掉 DS Bot，再运行一次安装包。杀毒软件拦了安装包时，先按上面的方法核对，选「信任」。

还是装不上？[报告安装问题](https://github.com/Fei2411/DS-Bot/issues/new?template=install.yml)。
</details>

Local agents settings read the request data directly. A failed settings page stays contained, and switching pages lets Usage load again.

## Tested host and environment

Release `0.3.2-rabi.24` fixes native delivery of long stable task IDs generated from Unicode role identifiers. The complete original ID remains intact for queue receipts and deduplication.

Release `0.3.2-rabi.23` adds explicit Rabi → DSH → DS Bot destinations and daily schedules with multiple times under one rule. Task lists follow the exact destination across storage roles. Editing retains source-role revisions, native queue receipts survive conversation parts and restarts, and plugin unload waits for accepted deliveries. Personal task creation no longer requires a primary-role session; group tasks retain DSH behavior.

Release `0.3.2-rabi.22` confines Bot layout overrides to its own chat column so ordinary Sessions retain their controls. Rabi user messages use the same avatar-column spacing and bounded bubble width as Bot messages. The published fixture corrections and upstream sponsor documentation are included.

Version 0.3.2-rabi.1 adds sidebar sections, one settings dialog for Bot and Harness pages, explicit Bot run modes, current local-agent protocol fixes, IM connection recovery, and memory entry IDs, pins, limits, recall, moves and reversible tidying. Existing team data gains optional sections and closed-view records; saved local CLI routes migrate to the `local-` prefix, preserving native OpenCode provider routes. Memory metadata is extended in place and group logs remain readable. Rabi-bound personas continue using Rabi memory and skills exclusively. The Bot workbench, independent pinned chats, reply avatars and last-reply times stay in place.

This maintenance fork tests Windows x64, Node.js `24.15.0`, npm `11.12.1` and pnpm `11.28.5`, running Web from public Core source `vb2250158/deepseek-harness@54931fbd25050ef036e44b1daec931da2bfe7b39` (`0.2.2-rc.1`). The CI runner is `windows-2025`. Earlier-host and cross-platform compatibility matrices are outside this target.

Windows local-agent discovery and the Codex, Claude and ACP drivers resolve npm `.cmd` shims to their Node entry point and run without a shell or console window. Paths with spaces and array arguments are preserved; cancellation and timeouts target the CLI process itself. Arbitrary `.cmd`/`.bat` scripts are rejected with `UNSUPPORTED_AGENT_WRAPPER`: select the executable or a Node npm entry point instead. No local-agent account is signed in automatically.

Inherited environment variables whose names contain `KEY`, `TOKEN`, `SECRET` or `PASSWORD`, and DSH-owned variables, are withheld from local agents. Explicit engine environment settings and the CLI's own file-based sign-in remain separate.

Set `localAgentsEnabled: false` in the DS Bot plugin configuration to exclude the local-agent integration in that profile. The default is `true`. Disabled profiles do not discover CLIs, register their providers, probe versions or models, or offer local-agent approval tools. The settings page reports the disabled state; modifying local-agent settings is refused. Saved custom agents, CLI session mappings and Bot model references remain intact, and other Bot providers keep working. Re-enable the field to restore the integration; disabling it does not sign accounts out or move their files.

The target above is not a formal-installation claim. Loading or reindexing the team preserves existing DSH Session archives, including an explicit archive with activity stopped. Opening an earlier part remains an explicit action that unarchives that part. See the [test policy](docs/dev/testing.md) for source preparation, behavior and saved-data regressions, Web smoke and CI scope.

**DS Bot**: the desktop app, the project and the plugin / 桌面应用、项目和插件 · **DeepSeek Harness (DSH)**: what they are built on / 它们的底层

Responsive chat changes response strategy while keeping configured tools available. Automatic conversation rollover retains delegated results in their original parent Session; explicit stop drains only owned children. Public Bots keep equal management and can initiate group rounds with posts.

<p align="center">

Rabi-bound Bots use the Rabi assistant preset for new conversations. Existing conversations can be rebuilt with their Bot identity and archived history retained.

Private maintenance 0.2.3-rabi.1 integrates upstream 0.2.3 with avatar storage, browser handoff and steering fixes. It retains the native DSH team panel, Rabi bindings and group library; avatar-library controls stay separate from group documents. Tests use the rc.3 tool executor and authenticated API route.
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo.svg" alt="DS Bot" width="260">
  </picture>
</p>

# DS Bot

The plugin list shows the DS Bot name and description in the DSH language: English, Chinese, Japanese, Spanish, French, German, Russian or Portuguese. The Bot interface supports English and Chinese.

`0.2.3-rabi.1` integrates the upstream 0.2.3 release, including reusable avatars, browser handoff cards and stored screenshots, task-safe conversation rollover, archived-history paging, group corrections and steering feedback. The Rabi workbench, team libraries, scoped-executor compatibility and deferred client loading remain.

`0.2.0-rabi.1` integrates upstream 0.2.0: group-scoped memory, structured view cards, photos, thinking levels and live turn metrics. This fork keeps equal team-management rights, independent pinned chats, the native Bot panel, Rabi-owned context and memory, group libraries and interrupted-turn recovery.

`0.2.0-rabi.2` retains Rabi bindings when the shared memory overlay opens and keeps the managed-memory label in wide Bot details.

Restoring a Bot chat requests only that Session's metadata on paged DSH hosts. Older hosts retain the full catalog refresh used for navigation.

Bot chats continue interrupted turns and quota failures automatically through DSH's native continuation API, without manual retry buttons or resending user messages. Repeated failures back off; new input, explicit stops and unloading cancel pending continuation. Unknown Rabi write outcomes are not replayed. See the [plugin configuration](ds-bot/README.md) for timing options.

Group chats have Details, Library and Members tabs. Add a Bot directly below the member list. Each group keeps its UTF-8 text documents in a separate folder keyed by the group ID; renaming the group keeps the same folder. Library supports creating, uploading and reading .md, .txt, .csv, .json and .yaml files, with a default 1 MiB file limit. Existing names are never overwritten. Team Bots read these references through read_group_library. Deleting a group retains its documents.

Bot name labels are work titles, assigned from actual responsibilities through the existing Bot settings tool. Rabi imports do not use the provider name as a title. Rabi settings discover the local service automatically, and each persona has a binding switch. Group feedback names the members working in that group.

Bot chat failures are shown for the current page visit. Refreshing clears historical error rows and their retry buttons from the chat view, while retaining messages and diagnostic records. New failures remain visible.

The lower-left **Bot settings** button opens the Bot settings.

**Settings → Rabi** opens Connection first, then Computers after connecting. A discovered but stopped Rabi shows **Start Rabi**; after it starts, retry the connection. If the installation cannot be found, open the Rabi GitHub repository or ask the existing Bot to install and configure it. That request asks your installation directory, personas and preferences before making installation changes. Local discovery and startup require `dsh-rabiroute-agent` 0.13.37 or newer.

**Remote computers:** **Settings → Rabi → Computers** contains one team-wide switch, enabled by default, and a read-only list of remote computers. Use **Manage computer access in Rabi** to open Rabi WebGUI for pairing and authorization. Disabling the switch blocks Bot calls to Rabi remote-computer APIs, including group parts; ordinary DSH sessions are unchanged. The old panel preference is ignored. Other computers need only the Rabi client, without a separate DSH runtime.

English | [中文](README.zh.md)

This is the [vb2250158 maintenance fork](https://github.com/vb2250158/DeepSeek-Bot) of [Fei2411/DeepSeek-Bot](https://github.com/Fei2411/DeepSeek-Bot). For a dedicated execution host with computer and phone browser clients, see [Host deployment](host/README.md).

![version](https://img.shields.io/badge/version-v0.2_preview-blue) ![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.5-4D6BFE) ![license](https://img.shields.io/badge/license-Apache_2.0-green)



DS Bot is a bot plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It turns DSH into bots. You create your own bots, then talk and work with them.

## Sponsors

<table>
<tr>
<td width="180" align="center"><a href="https://modelgo.ai/?utm_source=dsbot&utm_medium=sponsorship&utm_content=readme&campaign_id=dsbot&ad_group_id=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/sponsors/modelgo-dark.svg"><img src="docs/images/sponsors/modelgo.svg" alt="ModelGo" width="150"></picture></a></td>
<td>ModelGo is a reliable, high-performance, enterprise-grade AI API aggregation platform. Access leading AI models—including Claude, OpenAI, Gemini, and DeepSeek—with a single API key. Sign up now and get 40% off DeepSeek V4.1 Flash.<br>Exclusive perks for DS-Bot users: get $0.50 in credits when you sign up, earn another $2 after your first API call, and receive up to $10 in bonus credits when you top up! Try it now: <a href="https://modelgo.ai/?utm_source=dsbot&utm_medium=sponsorship&utm_content=readme&campaign_id=dsbot&ad_group_id=readme">ModelGo Official Website</a></td>
</tr>
</table>

<h2></h2>

![Say one sentence to Chief, and it sets up the bots and the group chat](docs/images/team.png)

**Harness integration:** DS Bot opens below automation in the native DSH sidebar. Its panel keeps the team list, shared conversation and details in separate columns. Native navigation stays available, and the floating title/memory-update pill is removed.

DS Bot follows the active DSH skin by default, including light and dark mode. **Settings → General → Theme** also keeps the standalone palettes and custom accents available.

Manage plugins through the native **Plugins** entry. The team footer opens **Bot settings** directly, where Bot usage, connectors and tasks remain available. Bot usage includes Bots and group chats; global usage stays in Harness settings.

**Rabi binding:** open **Bot settings → Rabi → Connect**, connect local Rabi, then choose **Bind as Bot** or **Bind all personas**. Binding reuses an existing Bot and waits for model selection. With `dsh-rabiroute-agent` 0.13.34 or newer and Agent Hooks enabled, the original DSH session uses Rabi’s persona, memories, plans, role skills and lifecycle decisions. Avatar images are read from Rabi; the Bot’s library displays Rabi memory, plans, skills and persona. The bound Bot stops using DS Bot’s independent memory and review. Data and changes stay in Rabi; connection or binding failures stop dependent work. Unlink keeps the Bot and restores its ordinary mode.

The right panel centers the avatar, name and role above Details and Library. Details starts with the full-width single-line model selector, followed by schedules; Rabi resources live in Library. A window-local cache separates Bot, persona, resource and item reads, keeps in-flight requests alive across navigation, and refreshes retained content in the background on return. Duplicate reads share one request. Pages append and resume; memory categories appear together without nested menus or manual refresh. The cache retains up to 64 views and about 4 MiB of inactive content, never enters browser storage, and never supplies Agent context.

Details and Scheduled tasks show only Rabi rules explicitly addressed to this DSH instance and personal Bot, across all Rabi storage roles. Persona binding does not decide which rules appear. Create, edit and delete personal schedules here; new tasks use the confirmed DS Bot destination and a selected Rabi storage role, while edits retain the original source role and rule identity. Daily schedules can include several times under one task identity and enable switch; duplicate times are combined on save. Daily, interval and one-time schedules use the Rabi host's time zone. Existing action targets, scripts and unrelated rules stay in Rabi. Changes check the exact destination and source-role configuration revision; uncertain operations retain their original request in this window for retry. Group chat schedules continue using DSH. Rabi integrations can discover personal Bot destinations through the authenticated `POST /api/bot` endpoints `rabi-automation-catalog`, `rabi-automation-deliver` and `rabi-automation-reconcile` (schemaVersion 1). Delivery uses an opaque Home/workspace scope, stable Bot ID, delivery ID and message; acceptance confirms the native queue, and retries reconcile the original Session receipt across conversation parts. Groups are excluded from this interface.

Rabi automation reminders use the native DSH schedule message source and public reminder framing. Optional `scheduledAt` is the UTC occurrence instant. When omitted, framing records the DS Bot admission time. Acceptance requires acknowledged Session persistence. Historical user-message receipts remain recoverable.

Drag either column divider to resize the conversation list or details. Widths stay on this browser; double-click resets a column, and the focused divider accepts arrow keys. Narrow panels hide details and then compact the list to keep the chat usable.

Every Bot can create and change Bots and manage every group chat. Right-click a chat to pin or unpin it, or drag it to the pin region above the list. Pinned tiles are saved independently of permissions.

The chat tail shows feedback as soon as a message is submitted, names active Rabi connection/synchronization waits and retains actionable failures. Bound Bots connect automatically; a stopped Rabi Host is reported explicitly and is never silently started. Hook progress requires adapter 0.13.36 or newer.

## Install

For this fork's host and browser clients, follow [Host deployment](host/README.md). The instructions below install the original upstream plugin.

**Desktop app (Windows, macOS, Linux)**

The desktop app brings its own DSH, so you don't need to install DSH first. Download the installer for your system from [Releases](https://github.com/Fei2411/DS-Bot/releases/latest), open it, and set up a model in Settings (it can also copy your existing bot team from DSH).

If your system warns about an unsigned app: on Windows select **More info** → **Run anyway**; on macOS open **System Settings** → **Privacy & Security** and select **Open Anyway**.

**As a plugin in DSH**

First install DSH and set up at least one model in it. DS Bot uses the models from DSH.

- **DSH Desktop**: In the sidebar, select **Plugins** → **Add plugin**, enter `ds-bot` (in mainland China, set **Registry** to **Mainland China mirror**), then select **Install** and **Enable now**.
- **DSH Web** (needs Node.js `22.19` or later, and pnpm):

```sh
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add ds-bot
npx @deepseek-ai/dsh@0.2.2-rc.1 web
```

**Docker (NAS, Linux server)**

See [`docker/README.md`](docker/README.md).

## Setup

I strongly recommend that you set up your other bots and group chats by just talking to a bot.

### Web search

DS Bot selects its `auto` search provider for the whole profile. If you disable `web-search-auto`, also select another registered search provider in that profile. See [Web search](ds-bot/README.md#web-search) and the [recovery steps](docs/known-issues.md#web-search-fails-everywhere-after-turning-off-web-search-auto).

## Features

### Bot

Messages sent while a Bot is working separate the surrounding replies. Each reply keeps its own speaker heading, reasoning disclosure and thinking time, including after reloading the chat.

You can do all your talking and work with one bot, in one window. You don't need to worry about the context behind it. The bot's details page shows its info, and there you can pick the model and thinking level you want it to use. You can switch models at any time, but I still recommend that you keep one model for a bot for a long time, and switch only when you really need to.

Bots also have memory. A bot remembers what you like and uses it in later work. You can manage its memory on the bot's details page, or just tell the bot.

Each bot can have its own working folder and permission preset — just tell the bot when you want to switch folders. While a bot is working, you can send a message to steer it right away, or type `/side` to ask a side question without interrupting its task; it can also draw charts, tables and forms in its replies, or run scheduled tasks. In the sidebar, you can group bots and group chats into collapsible sections by work.

![Bot details: model, memory, usage](docs/images/details.png)

### Main bot

The main bot is your chief. It has very high rights: it manages the other bots and the group chats. The first time you open DS Bot, there is already a main bot called Chief. Talk to it, and it walks you through the setup.

In short: have a question? Ask the main bot.

### Group chats

DS Bot has group chats. A group chat is a great way to get several bots to work together, but it clearly costs more. So DS Bot does this: every group chat has an admin. The admin answers your messages by default and calls in the other bots for you. You can also @ a bot directly, and it answers you directly. To give the bots another chat as context, use + → Reference a chat in the message box.

Any bot can hand work to other bots with @, and those bots do the work on their own and post the results back to the group. A group chat has its own memory and working folder, invisible to bots outside the group. For larger work, a group chat can run a Goal: the admin aligns with you on what "done" means, splits the work into stages across members, and checks each stage before moving on.

![Group chat: the admin, Chief, hands the work to Writer and Coder](docs/images/group.png)

### Private bot

Settings → **Capabilities** is a shared library of MCP servers, skills and packs. Add a capability to a Bot in its settings; it is available from that Bot's next message in its own chat and group chats. A local MCP command that a Bot adds needs your approval before it can run. Every Bot can manage shared capabilities; executable changes still require your approval.

Note that a private bot cannot be a main bot or join group chats. This boundary only isolates it from other bots in your team, not as an OS sandbox: if you give it shell or network access, its commands can still read and write system files or reach the network, and its model provider still receives the conversation.

### Local agents

Coding-agent CLIs you already use on your computer (Claude Code, Codex CLI, Cursor CLI, Devin CLI, OpenCode, Gemini CLI and others) can be connected as bots directly. Pick Local agent when creating a bot (or switch in the bot's settings), and it will use the CLI's own sign-in, plan and models while working like any other bot in private chats, group chats, handoffs and memory.

There are a few limits to keep in mind: a local agent uses the CLI's own tools and context, so shared capabilities and connectors in DS Bot are not passed to it, and switching how a bot runs starts a fresh conversation part; custom CLIs without HTTP MCP support do not get team tools such as creating bots or handing off work. Also, Cursor CLI saves the last selected model as its own global default (`~/.cursor`), so if you pick a specific model for a Cursor bot in DS Bot, other Cursor bots on the default model and Cursor in your terminal will switch to it too — keep "CLI default" if you don't want to change your global default (sign in to Cursor first so the model list loads).

### Browser

Each bot has its own isolated browser with separate sign-ins, and can import cookies from a file or from your local browsers. Turn on a browser plugin in Settings → Browser to let bots open and operate web pages on their own; posting, uploading, downloading and deleting need your approval, and sign-in, captchas or payments hand back to you with a card so you can take over and hand back at any time.

The browser feature is available in the desktop app and DSH Desktop only (not in DSH Web), and only the desktop app keeps browser sign-ins after you quit and supports cookie import. On Windows, new Chrome and Edge cookies encrypted with v20 cannot be read directly — export them to a file with a browser extension first.

### Computer use

Turn on Settings → Computer use to let bots operate apps on your computer as far as you allow. You can set a level (view only, background, or foreground) and allowed apps for each bot, with a top bar showing when a bot is working so you can pause or take over at any time; apps like system settings and password managers are never given to a bot.

All bots share your desktop, so only one bot can use a given app or the foreground mouse at a time. On Windows, Chrome and Electron apps often ignore background input and need "foreground", and apps running as administrator cannot be controlled; macOS requires 14 or later with Accessibility and Screen Recording permissions; Linux supports X11, with limited Wayland support.

### IM

In Settings → IM, you can link a bot or group chat to WeChat, Feishu, DingTalk, WeCom, QQ, Telegram, Discord or Slack. Once paired, you can talk to your bots, @ them in groups, and answer question and approval cards directly from your chat app without a public IP or open port on your computer.

Messages only flow while your computer is awake and DS Bot is running. WeChat only supports private chat with the QR-paired account, not group chats; WeChat and QQ only allow replies within a platform time window after you send a message, and sending another message resumes it. WeChat, QQ and DingTalk do not have card buttons, so reply with the option number instead; for security, secret cards cannot be filled in from chat apps.

### Connectors and capabilities

In Settings → Connectors, you can sign in to GitHub, Gmail, QQ Mail, 163 and other mailboxes, and remote MCP servers, or import existing configs from Claude Desktop, Cursor and VS Code. Credentials stay in DS Bot's secrets so bots never see the raw values, and emails written by a bot wait for your confirmation by default.

In Settings → Capabilities, you can manage shared MCP servers, skills and packs for the team and enable them per bot; local commands added by a bot need your approval before they run.

### Office files

Bots can create, check and edit Word (`.docx`), PowerPoint (`.pptx`) and Excel (`.xlsx`) documents directly, and render pages to images to check layout. The desktop app includes the full runtime out of the box; DSH Web does not bundle this runtime, so it can only check and edit existing documents, while creating files from scratch and rendering pages require the desktop app or DSH Desktop.

### Usage

In **Settings** → **Usage**, you can see token usage by time, by bot and by model.

![Usage page](docs/images/usage.png)

## Data

All data stays on your own computer: in the folder you chose on first start in the desktop app (`~/.ds-bot` by default), or in `bot/` and `sessions/` in the DSH home folder (`~/.dsh` by default) for the plugin. Uninstalling the app or the plugin does not delete this data.

## Development

The plugin source is in [`ds-bot/`](ds-bot/). For options and internals, see [`ds-bot/README.md`](ds-bot/README.md). For development, tests and how the team works, see [CONTRIBUTING.md](CONTRIBUTING.md). For changes between versions, see [CHANGELOG.md](CHANGELOG.md).

## Acknowledgments

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): DS Bot is built on the DSH plugin system. Every bot works in DSH sessions and uses the DSH tools and models.
- [esbuild](https://esbuild.github.io/): bundles the plugin's interface code.
- Thanks to these projects for the ideas they published. DS Bot learned from their designs and does not contain their code:
  - [AgentMemoryRepo](https://github.com/AgentMemoryRepo/agentmemoryrepo): the Markdown format of Bot memory.
  - [OpenAI Codex](https://github.com/openai/codex): checkpoints that keep the user's messages next to the summary, and message anchors for chat search.
  - [OpenMausBot](https://github.com/milind-soni/OpenMausBot): group chat rounds and @mention relays.
  - [Hermes Agent](https://github.com/NousResearch/hermes-agent) and [Hermes Bot Mode](https://github.com/NousResearch/Hermes-Bot-Mode): one session per member per group chat, and handoffs that carry the earlier user messages.
  - [OpenCode](https://github.com/sst/opencode), [goose](https://github.com/block/goose), [pi](https://github.com/badlogic/pi-mono) and [Gemini CLI](https://github.com/google-gemini/gemini-cli): when to condense a long chat, and what a handoff note holds.
  - [obelisk](https://github.com/tommy0103/obelisk): chat search with a SQLite full-text index.
- Everyone who tries DS Bot, asks questions and reports bugs.

## License

[Apache License 2.0](LICENSE). Provided "as is", without any warranty. Third-party code and its license are listed in [NOTICE](NOTICE).

## Disclaimer

DS Bot is an independent community project. **It is not an official DeepSeek product**, and it is not affiliated with, endorsed by or sponsored by DeepSeek. "DeepSeek", "DeepSeek Harness" and the other names are trademarks of their owners. They are used here only to say what this plugin works with.

Bots use your own model quota, and they read and write files and run commands when you ask them to. Check important actions yourself.
