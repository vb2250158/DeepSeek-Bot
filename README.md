This fork integrates upstream 0.2.7 (0.2.7-rabi.1) with shared management for public Bots, Rabi assistant presets and deferred client loading. Private Bots require approval before native Bot tools publish their content to the team. Deleted private Bots retain protected folders, memory and chats until you release them in Settings. Rabi-bound Bots keep memory and learned skills under Rabi ownership; project AGENTS.md proposals remain available. Office directory inputs reject internal links, and PNG decoding bounds allocation and rejects truncated image data.

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

## Tested host and environment

This maintenance fork tests Windows x64, Node.js `24.15.0`, npm `11.12.1` and pnpm `11.28.5`, running Web from public Core source `vb2250158/deepseek-harness@de3fc0d70888e6ef7c2c6b64cb6d4f0c11db4ca2` (`0.2.2-alpha.3`). The CI runner is `windows-2025`. Earlier-host and cross-platform compatibility matrices are outside this target.

The recorded production baseline on 2026-11-04 remains Core `564bd14e9ec1d82d3e2985dbd8dea9f40129d71a` (`0.2.2-alpha.2`); the candidate above is not a formal-installation claim. See the [test policy](docs/dev/testing.md) for source preparation, behavior and saved-data regressions, Web smoke and CI scope.

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

![Say one sentence to Chief, and it sets up the bots and the group chat](docs/images/team.png)

**Harness integration:** DS Bot opens below automation in the native DSH sidebar. Its panel keeps the team list, shared conversation and details in separate columns. Native navigation stays available, and the floating title/memory-update pill is removed.

DS Bot follows the active DSH skin by default, including light and dark mode. **Settings → General → Theme** also keeps the standalone palettes and custom accents available.

Manage plugins through the native **Plugins** entry. The team footer opens **Bot settings** directly, where Bot usage, connectors and tasks remain available. Bot usage includes Bots and group chats; global usage stays in Harness settings.

**Rabi binding:** open **Bot settings → Rabi → Connect**, connect local Rabi, then choose **Bind as Bot** or **Bind all personas**. Binding reuses an existing Bot and waits for model selection. With `dsh-rabiroute-agent` 0.13.34 or newer and Agent Hooks enabled, the original DSH session uses Rabi’s persona, memories, plans, role skills and lifecycle decisions. Avatar images are read from Rabi; the Bot’s library displays Rabi memory, plans, skills and persona. The bound Bot stops using DS Bot’s independent memory and review. Data and changes stay in Rabi; connection or binding failures stop dependent work. Unlink keeps the Bot and restores its ordinary mode.

The right panel centers the avatar, name and role above Details and Library. Details starts with the full-width single-line model selector, followed by schedules; Rabi resources live in Library. A window-local cache separates Bot, persona, resource and item reads, keeps in-flight requests alive across navigation, and refreshes retained content in the background on return. Duplicate reads share one request. Pages append and resume; memory categories appear together without nested menus or manual refresh. The cache retains up to 64 views and about 4 MiB of inactive content, never enters browser storage, and never supplies Agent context.

Drag either column divider to resize the conversation list or details. Widths stay on this browser; double-click resets a column, and the focused divider accepts arrow keys. Narrow panels hide details and then compact the list to keep the chat usable.

Every Bot can create and change Bots and manage every group chat. Right-click a chat to pin or unpin it, or drag it to the pin region above the list. Pinned tiles are saved independently of permissions.

The chat tail shows feedback as soon as a message is submitted, names active Rabi connection/synchronization waits and retains actionable failures. Bound Bots connect automatically; a stopped Rabi Host is reported explicitly and is never silently started. Hook progress requires adapter 0.13.36 or newer.

## Install

For this fork's host and browser clients, follow [Host deployment](host/README.md). The instructions below install the original upstream plugin.

**Desktop app (Windows, macOS, Linux)**

The desktop app brings its own DSH, so you don't need to install DSH first. Download it from [Releases](https://github.com/Fei2411/DS-Bot/releases):

- Windows (x64): `DS-Bot-<version>-win-x64.exe`. Run it; it installs for your user only, without administrator rights. If Windows shows "Windows protected your PC", select **More info** → **Run anyway**. For other warnings and blocks, open **The browser or Windows warns you, or blocks the installer?** at the top of this page.
- macOS: `DS-Bot-<version>-mac-arm64.zip` for an Apple chip, `DS-Bot-<version>-mac-x64.zip` for Intel. Safari unzips it by itself; drag **DS Bot** into **Applications** and open it. When macOS says it cannot check the app, open **System Settings** → **Privacy & Security** and select **Open Anyway**.
- Linux (x64): `DS-Bot-<version>-linux-x86_64.AppImage` runs on every distribution with glibc 2.28 or newer — make it executable and open it. It mounts through FUSE 2, which you may need to install first (`sudo apt install libfuse2t64` on Ubuntu 24.04+, `sudo dnf install fuse-libs` on Fedora, `sudo pacman -S fuse2` on Arch). On Ubuntu 24.04 and later an AppImage can refuse to start (Ubuntu restricts the sandbox it needs); the `DS-Bot-<version>-linux-amd64.deb` on Debian/Ubuntu does not have this problem and adds a menu entry. On older-glibc systems such as CentOS 7 the app and DSH Web fail with `GLIBC_2.27 not found`; run the Docker image instead (see below and [known issues](docs/known-issues.md)).

At the first start the app keeps its data and the Bots' files in your home folder; the start window says where and lets you change it in one click. It offers to copy a Bot team from your DSH (it only reads your DSH). Set up a model in its settings. The Windows app and the Linux AppImage update themselves; the macOS app and the Linux deb tell you when a new version is ready to download.

If the app does not download, install or start, [report an install problem](https://github.com/Fei2411/DS-Bot/issues/new?template=install.yml); it needs no diagnostics.

**Desktop app from source (Windows)**

With Node.js 22.19 or later and npm installed, run `.\start.ps1` in PowerShell from this checkout. It prepares and launches the current source, keeping your Bots, chats and model settings in `.ds-bot-local/` between runs. See [source startup](app/README.md#run-from-source-windows).

**As a plugin in DSH**

First install DSH and set up at least one model in it. DS Bot uses the models from DSH.

**DSH Desktop (Windows, macOS)**

1. In the sidebar, select **Plugins** → **Add plugin**.
2. In **Package name or address**, enter `ds-bot`. In mainland China, set **Registry** to **Mainland China mirror**.
3. Select **Install**, then **Enable now**. If DSH says the change takes effect at the next start, quit DSH completely and open it again.

If npm is not reachable, in step 2 you can also enter the full path of `ds-bot-<version>.tgz` downloaded from [Releases](https://github.com/Fei2411/DS-Bot/releases), or `github:Fei2411/DS-Bot#v<version>&path:/ds-bot` (needs Git).

DS Bot 0.2.1 and earlier cannot update themselves in DSH Desktop 0.2.1-rc.2 or later: on the Plugins page, remove `ds-bot` and add `ds-bot` again. The Bots, chats and memory stay.

**DSH Web (Windows, macOS, Linux)**

Needs Node.js `22.19` or later, and pnpm. On Linux it needs the same glibc 2.28 or newer as the desktop app — the DSH install loads its own native libraries, so CentOS 7 and other older-glibc systems take the Docker route below instead.

```sh
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web add ds-bot
npx @deepseek-ai/dsh@0.2.1-rc.5 web
```

**Docker (NAS, Linux server)**

The [`docker/`](docker/) directory builds an image with DSH Web and DS Bot, for a NAS or any always-on machine. CI is configured to publish a prebuilt linux/amd64 image to GHCR. The container is the Bots' sandbox: they get full access to what you mount into it, and nothing else. See [`docker/README.md`](docker/README.md).

## Setup

I strongly recommend that you set up your other bots and group chats by just talking to a bot.

### Web search

DS Bot selects its `auto` search provider for the whole profile. If you disable `web-search-auto`, also select another registered search provider in that profile. See [Web search](ds-bot/README.md#web-search) and the [recovery steps](docs/known-issues.md#web-search-fails-everywhere-after-turning-off-web-search-auto).

## Features

### Bot

You can do all your talking and work with one bot, in one window. You don't need to worry about the context behind it. The bot's details page shows its info, and there you can pick the model you want it to use. You can switch models at any time, but I still recommend that you keep one model for a bot for a long time, and switch only when you really need to.

Bots also have memory. A bot remembers what you like and uses it in later work. You can manage its memory on the bot's details page, or just tell the bot.

![Bot details: model, memory, usage](docs/images/details.png)

### Main bot

The main bot is your chief. It has very high rights: it manages the other bots and the group chats. The first time you open DS Bot, there is already a main bot called Chief. Talk to it, and it walks you through the setup.

In short: have a question? Ask the main bot.

### Group chats

DS Bot has group chats. A group chat is a great way to get several bots to work together, but it clearly costs more. So DS Bot does this: every group chat has an admin. The admin answers your messages by default and calls in the other bots for you. You can also @ a bot directly, and it answers you directly: type @ and pick the bot from the list. To give the bots another chat as context, use + → Reference a chat in the message box.

Any bot can hand work to another bot with @. That bot does the work on its own, and the group goes on. While it works, it keeps the group posted, and the group, the sidebar and its own chat show what it is doing. When it is done, it posts the result in the group, and the bot that asked for the work answers. To stop the work, open the group's details.

A group chat has its own memory. What you tell the group stays in the group: its members use it there, and your other chats and the bots outside the group do not see it. You can manage it in the group's details.

For larger work, a group chat can run a goal: the admin aligns with you on what "done" means, splits the work into stages across members, and checks each stage against evidence before moving on.

![Group chat: the admin, Chief, hands the work to Writer and Coder](docs/images/group.png)

### Capabilities

Settings → **Capabilities** is a shared library of MCP servers, skills and packs. Add a capability to a Bot in its settings; it is available from that Bot's next message in its own chat and group chats. A local MCP command that a Bot adds needs your approval before it can run. Every Bot can manage shared capabilities; executable changes still require your approval.

### Usage

In **Settings** → **Usage**, you can see token usage by time, by bot and by model.

![Usage page](docs/images/usage.png)

### Office files

Bots work with Office documents. They can create and edit .docx, .pptx and .xlsx, read a document's structure with stable ids, check a package for the defects Office would refuse, make targeted edits (comments, tracked changes, fields, table cells), reorder or duplicate slides, list workbook errors, and review rendered pages on a contact sheet. The desktop app includes everything needed; in DSH Desktop Bots use DSH's Office runtime plus DS Bot's commands; in DSH Web the inspect, check and edit commands work, while creating files from scratch and rendering pages need the desktop app or DSH Desktop.

## Data

All data stays on your own computer, in `bot/` and `sessions/` in the DSH home folder (`~/.dsh` by default). Uninstalling the plugin does not delete this data.

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
