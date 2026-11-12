<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg"><img src="docs/images/logo.svg" alt="DS Bot" width="260"></picture></p>

# DS Bot

[English](README.md) | 中文

![版本](https://img.shields.io/badge/版本-v0.3.0--rabi.3-blue) ![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-4D6BFE) ![许可](https://img.shields.io/badge/许可-Apache_2.0-green)

本 fork 已合并上游 0.3.2（0.3.2-rabi.1），保留公开 Bot 平等管理、Rabi 助手预设和延迟加载。私密 Bot 通过原生 Bot 工具向团队发布内容前需要批准；删除后，其文件夹、记忆和聊天仍受保护，可在设置中解除。Rabi 绑定 Bot 的记忆和学习技能继续由 Rabi 管理，项目 AGENTS.md 提案仍可使用。Office 目录输入拒绝内部链接，PNG 读取限制内存并拒绝截断图像。

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

设置中的本地 Agent 页直接读取请求数据；单页渲染错误仅显示在当前页，切换页面后用量页可重新加载。

## 受测宿主与环境

`0.3.2-rabi.24` 修正 Unicode 角色标识生成的长任务 ID 被原生投递错误拒绝的问题。队列回执和去重继续使用完整原始 ID。

`0.3.2-rabi.23` 支持明确选择 Rabi → DSH → DS Bot 投递目标，每日多个时间点仍是一条规则。任务列表按完整目标跨存储人格汇总；编辑沿用原人格配置修订号，原生队列回执在换段和重启后仍可核对，插件卸载等待已接纳投递完成。个人任务新建无需主角色会话，群任务沿用 DSH 行为。

`0.3.2-rabi.22` 将 Bot 布局覆盖限定在自己的聊天栏，普通会话保留原有控件；Rabi 来源的用户消息沿用头像列间距，并按聊天栏限制气泡宽度。本版同时合入已发布的测试夹具修复和上游赞助说明。

0.3.2-rabi.1 新增侧栏分组、统一 Bot 与 Harness 设置、明确的 Bot 运行方式、本地 Agent 协议修正、IM 连接恢复，以及记忆条目编号、置顶、容量、召回、移动和可撤销整理。现有团队数据增加可选分组和已关闭视图记录；已保存的本地 CLI 路由迁移到 `local-` 前缀，保留原生 OpenCode 服务商路由。记忆元数据在原文件中扩展，原群聊日志继续可读。Rabi 绑定人格的记忆和技能仍由 Rabi 独占管理，保留 Bot 工作台、独立置顶、回复头像和最后回复时间。

本维护 fork 的单一受测目标为 Windows x64、Node.js `24.15.0`、npm `11.12.1`、pnpm `11.28.5`，使用公开 Core 源码 `vb2250158/deepseek-harness@54931fbd25050ef036e44b1daec931da2bfe7b39`（`0.2.2-rc.1`）运行 Web。CI runner 为 `windows-2025`。不运行旧宿主或跨平台兼容矩阵。

Windows 本地 Agent 发现及 Codex、Claude、ACP 驱动会把 npm `.cmd` 启动器解析为 Node 入口，不经过 shell，也不弹出控制台窗口。含空格的路径和数组参数保持原样；取消和超时直接作用于 CLI 进程。任意 `.cmd`/`.bat` 脚本会以 `UNSUPPORTED_AGENT_WRAPPER` 明确拒绝，请选择可执行文件或 Node npm 入口。不会自动登录本地 Agent 账号。

本地 Agent 不继承名称含 `KEY`、`TOKEN`、`SECRET` 或 `PASSWORD` 的环境变量，也不继承 DSH 自有变量。引擎显式指定的环境设置及 CLI 自己保存在文件中的登录状态另行保留。

在 DS Bot 插件配置中设置 `localAgentsEnabled: false`，可在该 profile 停用本地 Agent 集成，默认值为 `true`。停用后不发现 CLI、不注册对应提供者、不探测版本或模型，也不提供本地 Agent 审批工具；设置页会显示停用状态，并拒绝修改本地 Agent 设置。已存自定义 Agent、CLI 会话映射和 Bot 模型引用保持不变，其他 Bot 提供者继续工作。重新启用该字段即可恢复集成；停用不会注销账号或移动其文件。

上述目标不代表已正式安装。加载或重建团队索引会保留 DSH Session 的既有归档，包括明确归档并停止活动的状态；用户显式打开较早部分时，仍会解除该部分的归档。源码准备、当前行为与已存数据回归、Web smoke 和 CI 范围见[测试策略](docs/dev/testing.md)。

**DS Bot**: the desktop app, the project and the plugin / 桌面应用、项目和插件 · **DeepSeek Harness (DSH)**: what they are built on / 它们的底层

快速响应模式只改变回复策略，保留已配置的工具。自动转段时，子任务结果仍交回原父会话；显式停止只处理所属子任务。公开 Bot 保持平等管理，发送群消息仍可发起一轮讨论。

<p align="center">

绑定 Rabi 人格的 Bot 使用 Rabi 助手模式创建新会话。既有会话可重建，保留 Bot 身份与归档历史。

私有维护版 0.2.3-rabi.1 合并上游 0.2.3 的头像库、浏览器交接和消息转向修复，保留原生 DSH 团队面板、Rabi 绑定与群资料库；头像库与群资料使用不同入口。测试适配 rc.3 执行器和已认证 API 路由。
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo.svg" alt="DS Bot" width="260">
  </picture>
</p>

# DS Bot

插件列表的 DS Bot 名称与说明跟随 DSH 语言，支持中文、英文、日文、西班牙文、法文、德文、俄文和葡萄牙文。Bot 界面支持中文和英文。

`0.2.3-rabi.1` 合入上游 0.2.3 正式版本，包括可复用头像库、浏览器接管卡片与持久截图、会话换段前安全迁移任务、历史分页、群内纠正和转向反馈。Rabi 工作台、群资料库、scoped-executor 兼容和延迟加载客户端保持。

`0.2.0-rabi.1` 合入上游 0.2.0 的群记忆、结构化卡片、头像、思考档位和运行统计；保留团队平权、独立置顶、原生 Bot 面板、Rabi 上下文与记忆归属、群资料库和中断续作。

`0.2.0-rabi.2` 在共享记忆弹窗打开时保留 Rabi 绑定，并在宽版详情中保留受管记忆标识。

恢复 Bot 聊天时，支持分页的 DSH 只查询该会话的元数据；较旧宿主仍通过刷新完整列表定位会话。

群聊右侧提供“详情 / 资料库 / 成员”三个标签，可直接在成员列表下添加 Bot。每个群按群 ID 保存独立的资料文件夹，改名后仍使用原文件夹。资料库支持新建、上传和查看 UTF-8 的 .md、.txt、.csv、.json、.yaml 文件，单文件默认上限 1 MiB，同名文件不会覆盖。团队 Bot 通过 read_group_library 读取群资料；删除群聊后保留资料文件。

Bot 名字旁显示的是称号，由 Bot 通过现有设置工具根据实际工作生成；Rabi 导入不会把连接类型写成称号。Rabi 设置页自动检测本机服务，每个人格通过滑动开关控制绑定。群聊反馈显示正在本群工作的成员姓名。

Bot 聊天不显示手动继续或重试按钮。中断任务和额度失败由 DSH 原生续接接口自动继续，不重新发送用户消息。重复额度失败逐步延长等待，新消息、主动停止和卸载会取消等待中的续接；其它错误及结果未确认的 Rabi 写操作不自动重放。原有模型请求重试仍然生效。刷新后隐藏历史报错，消息和诊断记录保留，新发生的错误正常提示。

左下角的 **Bot设置** 按钮打开 Bot 设置。

**设置 → Rabi** 默认显示“连接”，连接成功后可进入“电脑”。发现 Rabi 已安装但未启动时显示 **启动 Rabi**，启动后点击连接重试；找不到安装位置时可访问 Rabi GitHub 主页，或向现有主 Bot 投递安装配置请求。主 Bot 会先询问安装目录、初始化人格和偏好，再进行安装配置。本机发现和启动需要 `dsh-rabiroute-agent` 0.13.37 或更新版本。

这是 [vb2250158 维护的 fork](https://github.com/vb2250158/DeepSeek-Bot)，上游为 [Fei2411/DeepSeek-Bot](https://github.com/Fei2411/DeepSeek-Bot)。独立执行主机及电脑、手机浏览器客户端见[主机部署](host/README.zh.md)。

**远端电脑**：**设置 → Rabi → 电脑** 只保留一个默认开启的团队总开关，并只读展示远端电脑列表。点击 **在 Rabi 管理电脑授权**，在 Rabi WebGUI 中配对和授权。关闭开关会拦截所有 Bot（含群聊分会话）对 Rabi 远端电脑接口的调用，普通 DSH 会话不受影响；旧面板偏好不再生效。其他电脑只需 Rabi 客户端，无需运行另一套 DSH。

[English](README.md) | 中文

![版本](https://img.shields.io/badge/版本-v0.2_预览-blue) ![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.5-4D6BFE) ![许可](https://img.shields.io/badge/许可-Apache_2.0-green)


DS Bot 是一个基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（简称 dsh）的 bot 插件，插件将 dsh 改造为 bot 形式。你可以与自己创建的 bot 交流、工作。

## 赞助

<table>
<tr>
<td width="180" align="center"><a href="https://modelgo.ai/?utm_source=dsbot&utm_medium=sponsorship&utm_content=readme&campaign_id=dsbot&ad_group_id=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/sponsors/modelgo-dark.svg"><img src="docs/images/sponsors/modelgo.svg" alt="ModelGo" width="150"></picture></a></td>
<td>ModelGo 是一个稳定、高效的企业级 AI API 聚合平台，一个 API Key 即可调用 Claude、OpenAI、Gemini、DeepSeek 等主流 AI 模型。当前注册即享 6 折 deepseek v4.1 flash。<br>另为 DS-Bot 用户提供专属福利：注册即送 $0.5 额度，完成首次 API 调用再送 $2，充值赠金最高至 $10！立即体验：<a href="https://modelgo.ai/?utm_source=dsbot&utm_medium=sponsorship&utm_content=readme&campaign_id=dsbot&ad_group_id=readme">ModelGo 官网</a></td>
</tr>
</table>

<h2></h2>

![和 Chief 说一句话，它就把 bot 和群聊建好](docs/images/team.zh.png)

**Harness 集成：** 原生 DSH 侧栏的自动化下方提供 DS Bot 入口。面板内依次排列团队会话列表、共享聊天组件和详情栏，保留原生 DSH 导航，并移除旧的浮动标题与记忆更新提示。

DS Bot 默认跟随当前 DSH 皮肤及浅色、深色模式。在 **设置 → 通用 → 主题** 中仍可选择独立配色和自定义强调色。

插件管理统一使用原生侧栏的 **插件** 入口。团队列表底部直接打开 **Bot 设置**，保留 Bot 用量、连接器和定时任务。Bot 用量只统计 Bot 与群聊，全局用量仍使用 Harness 设置中的统计。

**Rabi 绑定：** 打开 **Bot 设置 → Rabi 连接**，连接本机 Rabi 后选择 **绑定为 Bot** 或 **一键绑定全部人格**。重复绑定复用已有 Bot，并等待选择模型。需安装 `dsh-rabiroute-agent` 0.13.34 或更新版本并启用 Agent Hooks；原 DSH 会话使用 Rabi 的人格、记忆、计划、角色技能及生命周期决策。头像从 Rabi 读取，Bot 的资料库显示 Rabi 记忆、计划、技能和人格。绑定期间停用 DS Bot 独立记忆和自动整理，数据及修改仍由 Rabi 管理；连接或绑定异常会停止相关操作。解除关联保留 Bot，并恢复普通模式。

头像成功读取后会保存到 Bot 数据目录的 `bot/rabi-avatars/`。启动和 Rabi 离线时立即显示上次成功的头像，后台每分钟最多刷新一次，刷新失败时保留旧图。角色名称和绑定继续保存在团队数据中，头像缓存只用于显示。

右侧头像、名称和角色居中排列，下方保留“详情 / 资料库”。“详情”第一项是横向铺满的单行模型选择，其后显示定时任务；Rabi 资料统一放在“资料库”。资料按 Bot、人格、类型和条目在当前窗口缓存，切走不中断加载，返回时保留内容并后台刷新；同一请求只执行一次。分页结果追加保留，记忆直接展示近期、沉淀和归档内容，不提供二级菜单或手动刷新。缓存最多保留 64 个视图、约 4 MiB 的非活动内容，不写入浏览器持久存储，也不作为 Agent 上下文。

详情和定时任务页只显示明确指向当前 DSH 实例和个人 Bot 的 Rabi 规则，并汇总所有规则存储人格；Bot 绑定人格不决定列表归属。可直接新建、编辑和删除个人任务。新建时选择 Rabi 存储人格并核验当前 Bot 目的地；编辑保留原存储人格和规则 ID。每天任务可添加多个时间，共用一个任务标识和启用开关，保存时合并重复时间。每日、间隔和一次性任务使用 Rabi 所在电脑的时区；已有动作目标、脚本和其他规则保留原样。写入核对明确目的地和原存储人格的配置修订号；结果未知时在当前窗口保留原请求，连接故障保留已有列表并提供重试。群聊定时任务继续使用 DSH。Rabi 可通过已鉴权的 `POST /api/bot` 端点 `rabi-automation-catalog`、`rabi-automation-deliver` 和 `rabi-automation-reconcile`（schemaVersion 1）发现个人 Bot 目的地。投递携带不透明的 Home/工作区范围、稳定 Bot ID、delivery ID 和消息；接受回执只表示进入原生队列，重试会跨对话分段核对原 Session 回执。此接口暂不支持群聊。

Rabi 自动化提醒采用 DSH 原生 schedule 消息来源和公共提醒格式。可选 `scheduledAt` 表示 UTC 计划发生时刻，省略时使用 DS Bot 实际接收时刻。接受回执以 Session 持久化确认为准，旧版用户消息回执仍可核对恢复。

拖动两侧分隔线可调整会话列表或详情栏宽度，并保存在当前浏览器。双击恢复默认宽度，选中分隔线后也可用方向键调整。空间不足时先隐藏详情，再收起列表，保留聊天区。

所有 Bot 都能创建、修改 Bot 和管理所有群聊。右键聊天可置顶或取消置顶，也可以按住聊天拖到列表上方的置顶区；置顶单独保存，与权限无关。

消息提交后，聊天底部立即显示处理反馈；连接 Rabi、读取资料及结束同步分别显示当前状态，失败后保留原因与连接设置入口。已绑定 Bot 会自动连接；Rabi 未启动时明确提示，不静默启动。Hook 状态反馈需适配器 0.13.36 或更新版本。

## 安装

安装本 fork 的主机和浏览器客户端，请按[主机部署](host/README.zh.md)操作。下文保留上游原插件的安装方法。

**桌面应用（Windows、macOS、Linux）**

桌面应用自带 dsh，不用先装 dsh。直接在 [Releases](https://github.com/Fei2411/DS-Bot/releases/latest) 下载对应系统的安装包，打开后在设置里配好模型就能用（也可以直接复制你原来在 dsh 里的 bot 团队）。

如果安装或打开时提示未签名拦截：Windows 点 **更多信息** → **仍要运行**；macOS 在 **系统设置** → **隐私与安全性** 里点 **仍要打开**。

**作为 dsh 插件**

先装好 dsh，并在 dsh 里配好至少一个模型。ds bot 直接使用 dsh 里的模型。

- **dsh Desktop**：侧栏点 **插件** → **添加插件**，包名填 `ds-bot`（在中国大陆，安装源选 **中国大陆镜像源**），点 **安装** 并 **立即启用**。
- **dsh Web**（需要 Node.js `22.19` 以上和 pnpm）：

```sh
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add ds-bot
npx @deepseek-ai/dsh@0.2.2-rc.1 web
```

**Docker（NAS、Linux 服务器）**

见 [`docker/README.md`](docker/README.md)。

## 配置

我强烈建议你直接通过和 bot 对话来配置其他 bot 和群聊。

### 网页搜索

DS Bot 会把 `auto` 搜索 provider 选为整个 profile 的后端。禁用 `web-search-auto` 时，也要为该 profile 选择另一个已注册的搜索 provider。详见[网页搜索说明](ds-bot/README.md#web-search)和[恢复步骤](docs/known-issues.zh.md#关掉-web-search-auto-后所有会话的网页搜索都失败)。

## 功能

### Bot

Bot 工作时发出的插话会隔开前后的回复。每段回复独立显示头像、思考过程和思考用时，刷新对话后也保持分开。

你可以在一个窗口中和一个 bot 完成所有对话和工作，你无需担心背后的上下文问题。你可以在 bot 详情页查看 bot 信息，也可以为 bot 选择你想使用的模型和思考强度。你可以随时切换模型，但我仍然建议你为一个 bot 长期保持一个模型，仅在真正必要的时刻切换。

另外，bot 拥有记忆，它会记住你的喜好并在下次的工作中应用。你可以在 bot 的详情页管理记忆，也可以直接和 bot 对话来进行管理。

每个 bot 可以单独设置工作文件夹和权限，换文件夹直接和它说一声就行。它干活时你可以随时插话，或者输入 `/side` 开侧边对话顺手问一句而不打断它；它也能在回复里直接画图表、表格和表单，或者跑定时任务。侧边栏里还可以把 bot 和群聊按工作收进分组。

![bot 详情页：模型、记忆、用量](docs/images/details.zh.png)

### Main bot

这个 bot 作为你的 chief，它拥有非常高的权限，可以管理其他 bot 和群聊。第一次进入 ds bot 时，默认会有一个 main bot 叫 Chief。你可以直接和它对话，让它引导你完成配置。

总之，有问题，找 main bot。

### 群聊

ds bot 拥有群聊功能。群聊是非常好的多 bot 协作方式，但它会带来非常明显的费用问题。ds bot 为此特意做了优化：在一个群聊中，你需要设置一个管理员。你的消息默认由管理员回复，它会帮你调用其他 bot。你也可以直接 @ 你需要沟通的 bot，它会直接回应你。想让 bot 参考另一段对话，点输入框的 + → 引用对话就行。

任何 bot 都可以用 @ 把活派给其他 bot，接活的 bot 自己去做，做完把结果发回群里。群聊有自己独立的记忆和工作文件夹，群外的 bot 看不到。做大任务时，群聊可以设定目标（Goal），由管理员先和你对齐完成标准，再拆成阶段分给成员，逐段验收推进。

![群聊：管理员 Chief 把活派给写手和程序员](docs/images/group.zh.png)

### 隐私 bot

设置 → **能力** 是团队共享的 MCP 服务、技能和能力包列表。在 Bot 设置中启用能力后，从该 Bot 下一条消息开始生效，也适用于它参与的群聊。Bot 添加的本地 MCP 命令需要你先批准才能运行。所有 Bot 都能管理共享能力；可执行配置变更仍须用户批准。

要注意，隐私 bot 不能作为 main bot，也不能进群聊。这道隔离只防团队里的其他 bot，不是系统沙箱：如果给了它终端命令或联网权限，它仍然能读写系统文件或联网，模型服务商也会收到对话内容。

### 本地 Agent

你电脑上已经在用的编程 Agent CLI（Claude Code、Codex CLI、Cursor CLI、Devin CLI、OpenCode、Gemini CLI 等）可以直接接入当 bot 用。新建 bot 时选本地 Agent（或在 bot 设置里切换），它就会直接用 CLI 自己的登录、套餐和模型，同时照常参与私聊、群聊、派活和记忆。

不过有几点限制：本地 Agent 走的是 CLI 自己的工具和上下文，ds bot 里的共享能力和连接器不会传给它，切换运行方式也会新开一段对话；不支持 HTTP MCP 的自定义 CLI 拿不到建 bot、派活等团队工具。另外，Cursor CLI 会把最后一次切换的模型存成它自己的全局默认（`~/.cursor`），如果你在 ds bot 里给某个 Cursor bot 选了具体模型，其他用默认模型的 Cursor bot 和你终端里的 Cursor 都会跟着变，不想改全局默认的话保持“CLI 默认”即可（需要先登录 Cursor 才能看到模型列表）。

### 浏览器

每个 bot 有自己独立的浏览器，登录状态互不干扰，也支持从文件或本机浏览器导入 Cookie。在 设置 → 浏览器 里开启操作插件后，bot 可以自己打开和操作网页；发帖、上传、下载、删除需要你批准，遇到登录、验证码或付款会发卡片交给你处理，你随时可以接管再交还。

浏览器功能仅桌面应用和 dsh Desktop 可用（dsh Web 没有），且只有桌面应用在退出后会保留网页登录状态、支持导入 Cookie。Windows 上 Chrome 和 Edge 开启了 v20 加密的新 Cookie 无法直接读取，需要先用浏览器扩展导出成文件再导入。

### 电脑操控

在 设置 → 电脑操控 里打开开关后，bot 可以在你允许的范围内操作电脑上的应用。你可以给每个 bot 单独设档位（只看、后台操作、可以动前台）和允许使用的应用，操作时屏幕顶部有指示条，随时能暂停或接管；系统设置、密码管理这类应用永远不会交给 bot。

所有 bot 和你共用同一个桌面，同一个应用或前台鼠标同一时间只能有一个 bot 用。Windows 上 Chrome、Electron 这类应用在后台常收不到点击和输入，需要设为“可以动前台”，且无法操作管理员权限的应用；macOS 需要 14 及以上并开启辅助功能与屏幕录制权限；Linux 支持 X11，Wayland 受限。

### IM

在 设置 → IM 里，可以把 bot 或群聊连到微信、飞书、钉钉、企业微信、QQ、Telegram、Discord 或 Slack。配对账号后就能在聊天软件里直接对话、在群里 @ 机器人、回复提问卡和审批卡，电脑不需要公网地址或开放端口。

只有你的电脑开着、ds bot 在运行时才能收发消息。微信只支持和扫码账号私聊，不支持群聊；微信和 QQ 受平台限制，只有在你发消息后的一段时间内能回复，超时后你在聊天软件里再发一句就能恢复。微信、QQ、钉钉没有卡片按钮，直接回复数字编号来选择；出于安全，密钥卡不能在聊天软件里填。

### 连接器与能力

在 设置 → 连接器 里，可以登录 GitHub、Gmail、QQ 邮箱、163 等邮箱和远程 MCP 服务，也能从 Claude Desktop、Cursor、VS Code 导入已有配置。凭据保存在 ds bot 的密钥里，bot 看不到明文，写的邮件默认也要你确认后才发。

在 设置 → 能力 里，可以管理团队共享的 MCP 服务、技能和能力包，并在每个 bot 的设置里按需开启；bot 自己添加的本地命令需要先经你批准才能运行。

### Office 文件

bot 可以直接创建、检查和修改 Word（`.docx`）、PowerPoint（`.pptx`）和 Excel（`.xlsx`）文档，还能把页面渲染成图片来检查排版。桌面应用已经自带完整的运行环境，开箱即用；dsh Web 没有打包这套环境，只能检查和修改已有文档，从零建文件和渲染页面需要用桌面应用或 dsh Desktop。

### 用量

在 设置 → 用量 里，可以按时间、按 bot、按模型查看 Token 用量。

![用量页](docs/images/usage.zh.png)

## 数据

所有数据都在你自己的电脑上：桌面应用存在首次启动选定的位置（默认 `~/.ds-bot`），插件版存在 dsh 主目录（默认 `~/.dsh`）的 `bot/` 和 `sessions/` 里。卸载应用或插件不会删除这些数据。

## 开发

在 `ds-bot/` 内运行 `npm ci && npm run build` 重生成客户端与 Office 产物。构建仅使用插件目录内的依赖，拒绝指向外部目录的 `node_modules` 链接；提交前运行 `node scripts/build-client.mjs --check` 和 `npm test`。

插件源码在 [`ds-bot/`](ds-bot/)。配置项和内部结构见 [`ds-bot/README.md`](ds-bot/README.md)，开发、测试和协作方式见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：ds bot 建在 dsh 的插件系统上。每个 bot 都在 dsh 会话里工作，用的是 dsh 的工具和模型。
- [esbuild](https://esbuild.github.io/)：用来打包插件的界面代码。
- 感谢下面这些项目公开的设计思路。ds bot 参考了它们的思路，没有使用它们的代码：
  - [AgentMemoryRepo](https://github.com/AgentMemoryRepo/agentmemoryrepo)：bot 记忆的 Markdown 格式。
  - [OpenAI Codex](https://github.com/openai/codex)：压缩时把用户原话留在摘要旁边，以及搜索聊天记录用的消息锚点。
  - [OpenMausBot](https://github.com/milind-soni/OpenMausBot)：群聊轮流发言和 @ 接力。
  - [Hermes Agent](https://github.com/NousResearch/hermes-agent) 和 [Hermes Bot Mode](https://github.com/NousResearch/Hermes-Bot-Mode)：每个成员在每个群里一个会话，以及交接时带上用户之前的原话。
  - [OpenCode](https://github.com/sst/opencode)、[goose](https://github.com/block/goose)、[pi](https://github.com/badlogic/pi-mono)、[Gemini CLI](https://github.com/google-gemini/gemini-cli)：长对话什么时候压缩，交接笔记写哪些内容。
  - [obelisk](https://github.com/tommy0103/obelisk)：用 SQLite 全文索引搜索聊天记录。
- 每一位试用 ds bot、提问题、报 bug 的人。

## 许可

[Apache License 2.0](LICENSE)。按“原样”提供，不附带任何担保。用到的第三方代码和它的许可见 [NOTICE](NOTICE)。

## 声明

ds bot 是独立的社区项目，**不是 DeepSeek 官方产品**，与 DeepSeek 没有隶属、认可或赞助关系。“DeepSeek”“DeepSeek Harness”等名称是各自所有者的商标，这里只用来说明本插件和什么一起用。

bot 会消耗你自己的模型额度，也会按你的要求读写文件、运行命令。重要的操作请自己检查。
