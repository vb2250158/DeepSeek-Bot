<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo.svg" alt="DeepSeek Bot" width="260">
  </picture>
</p>

# DeepSeek Bot

Bot 名字旁显示的是称号，由 Bot 通过现有设置工具根据实际工作生成；Rabi 导入不会把连接类型写成称号。Rabi 设置页自动检测本机服务，每个人格通过滑动开关控制绑定。群聊反馈显示正在本群工作的成员姓名。

Bot 聊天中的报错只在本次打开页面期间显示。刷新后不再显示历史报错及对应的重试按钮，消息和诊断记录仍然保留；新发生的错误正常提示。

左下角的 **Bot设置** 按钮打开 Bot 设置。

**设置 → Rabi** 默认显示“连接”，连接成功后可进入“电脑”。发现 Rabi 已安装但未启动时显示 **启动 Rabi**，启动后点击连接重试；找不到安装位置时可访问 Rabi GitHub 主页，或向现有主 Bot 投递安装配置请求。主 Bot 会先询问安装目录、初始化人格和偏好，再进行安装配置。本机发现和启动需要 `dsh-rabiroute-agent` 0.13.37 或更新版本。

这是 [vb2250158 维护的 fork](https://github.com/vb2250158/DeepSeek-Bot)，上游为 [Fei2411/DeepSeek-Bot](https://github.com/Fei2411/DeepSeek-Bot)。独立执行主机及电脑、手机浏览器客户端见[主机部署](host/README.zh.md)。

**远端电脑**：**设置 → Rabi → 电脑** 只保留一个默认开启的团队总开关，并只读展示远端电脑列表。点击 **在 Rabi 管理电脑授权**，在 Rabi WebGUI 中配对和授权。关闭开关会拦截所有 Bot（含群聊分会话）对 Rabi 远端电脑接口的调用，普通 DSH 会话不受影响；旧面板偏好不再生效。其他电脑只需 Rabi 客户端，无需运行另一套 DSH。

[English](README.md) | 中文

![版本](https://img.shields.io/badge/版本-v0.1_预览-blue) ![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2-4D6BFE) ![许可](https://img.shields.io/badge/许可-Apache_2.0-green)

DeepSeek Bot（简称 DS Bot）是一个基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（简称 dsh）的 bot 插件，插件将 dsh 改造为 bot 形式。你可以与自己创建的 bot 交流、工作。

![和 Chief 说一句话，它就把 bot 和群聊建好](docs/images/team.zh.png)

**Harness 集成：** 原生 DSH 侧栏的自动化下方提供 DS Bot 入口。面板内依次排列团队会话列表、共享聊天组件和详情栏，保留原生 DSH 导航，并移除旧的浮动标题与记忆更新提示。

DS Bot 默认跟随当前 DSH 皮肤及浅色、深色模式。在 **设置 → 通用 → 主题** 中仍可选择独立配色和自定义强调色。

插件管理统一使用原生侧栏的 **插件** 入口。团队列表底部直接打开 **Bot 设置**，保留 Bot 用量、连接器和定时任务。Bot 用量只统计 Bot 与群聊，全局用量仍使用 Harness 设置中的统计。

**Rabi 绑定：** 打开 **Bot 设置 → Rabi 连接**，连接本机 Rabi 后选择 **绑定为 Bot** 或 **一键绑定全部人格**。重复绑定复用已有 Bot，并等待选择模型。需安装 `dsh-rabiroute-agent` 0.13.34 或更新版本并启用 Agent Hooks；原 DSH 会话使用 Rabi 的人格、记忆、计划、角色技能及生命周期决策。头像从 Rabi 读取，Bot 的资料库显示 Rabi 记忆、计划、技能和人格。绑定期间停用 DS Bot 独立记忆和自动整理，数据及修改仍由 Rabi 管理；连接或绑定异常会停止相关操作。解除关联保留 Bot，并恢复普通模式。

右侧头像、名称和角色居中排列，下方保留“详情 / 资料库”。“详情”第一项是横向铺满的单行模型选择，其后显示定时任务；Rabi 资料统一放在“资料库”。资料按 Bot、人格、类型和条目在当前窗口缓存，切走不中断加载，返回时保留内容并后台刷新；同一请求只执行一次。分页结果追加保留，记忆直接展示近期、沉淀和归档内容，不提供二级菜单或手动刷新。缓存最多保留 64 个视图、约 4 MiB 的非活动内容，不写入浏览器持久存储，也不作为 Agent 上下文。

拖动两侧分隔线可调整会话列表或详情栏宽度，并保存在当前浏览器。双击恢复默认宽度，选中分隔线后也可用方向键调整。空间不足时先隐藏详情，再收起列表，保留聊天区。

所有 Bot 都能创建、修改 Bot 和管理所有群聊。右键聊天可置顶或取消置顶，也可以按住聊天拖到列表上方的置顶区；置顶单独保存，与权限无关。

消息提交后，聊天底部立即显示处理反馈；连接 Rabi、读取资料及结束同步分别显示当前状态，失败后保留原因与连接设置入口。已绑定 Bot 会自动连接；Rabi 未启动时明确提示，不静默启动。Hook 状态反馈需适配器 0.13.36 或更新版本。

## 安装

安装本 fork 的主机和浏览器客户端，请按[主机部署](host/README.zh.md)操作。下文保留上游原插件的安装方法。

先装好 dsh，并在 dsh 里配好至少一个模型。ds bot 直接使用 dsh 里的模型。

**dsh Desktop（Windows、macOS）**

1. 侧栏点 **插件** → **添加插件**。
2. **包名或地址** 填 `ds-bot`。在中国大陆，**安装源** 选 **中国大陆镜像源**。
3. 点 **安装**，再点 **立即启用**。如果提示“下次启动生效”，完全退出 dsh 再打开。

连不上 npm 时，第 2 步也可以填 [Releases](https://github.com/Fei2411/DeepSeek-Bot/releases) 里下载的 `ds-bot-0.1.5.tgz` 的完整路径，或者 `github:Fei2411/DeepSeek-Bot#v0.1.5&path:/ds-bot`（需要装 Git）。

**dsh Web（Windows、macOS、Linux）**

需要 Node.js `22.19` 以上和 pnpm。

```sh
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add ds-bot
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

## 配置

我强烈建议你直接通过和 bot 对话来配置其他 bot 和群聊。

## 功能

### Bot

你可以在一个窗口中和一个 bot 完成所有对话和工作，你无需担心背后的上下文问题。你可以在 bot 详情页查看 bot 信息，也可以为 bot 选择你想使用的模型。你可以随时切换模型，但我仍然建议你为一个 bot 长期保持一个模型，仅在真正必要的时刻切换。

另外，bot 拥有记忆，它会记住你的喜好并在下次的工作中应用。你可以在 bot 的详情页管理记忆，也可以直接和 bot 对话来进行管理。

![bot 详情页：模型、记忆、用量](docs/images/details.zh.png)

### Main bot

这个 bot 作为你的 chief，它拥有非常高的权限，可以管理其他 bot 和群聊。第一次进入 ds bot 时，默认会有一个 main bot 叫 Chief。你可以直接和它对话，让它引导你完成配置。

总之，有问题，找 main bot。

### 群聊

ds bot 拥有群聊功能。群聊是非常好的多 bot 协作方式，但它会带来非常明显的费用问题。ds bot 为此特意做了优化：在一个群聊中，你需要设置一个管理员。你的消息默认由管理员回复，它会帮你调用其他 bot。你也可以直接 @ 你需要沟通的 bot，它会直接回应你：输入 @，从列表里选 bot 就行。想让 bot 参考另一段对话，点输入框的 + → 引用对话。

任何 bot 都可以用 @ 把活派给另一个 bot。接活的 bot 自己去做，群聊照常进行。它干活时会在群里同步进度，群聊、侧边栏和它自己的聊天里也能看到它在做什么。做完后，它把结果发到群里，由派活的 bot 接着回应。要停下它的工作，打开群聊详情。

![群聊：管理员 Chief 把活派给写手和程序员](docs/images/group.zh.png)

### 能力

设置 → **能力** 是团队共享的 MCP 服务、技能和能力包列表。在 Bot 设置中启用能力后，从该 Bot 下一条消息开始生效，也适用于它参与的群聊。Bot 添加的本地 MCP 命令需要你先批准才能运行。所有 Bot 都能管理共享能力；可执行配置变更仍须用户批准。

### 用量

在 设置 → 用量 里，可以按时间、按 bot、按模型查看 Token 用量。

![用量页](docs/images/usage.zh.png)

## 数据

所有数据都在你自己的电脑上，在 dsh 主目录（默认 `~/.dsh`）的 `bot/` 和 `sessions/` 里。卸载插件不会删除这些数据。

## 开发

插件源码在 [`ds-bot/`](ds-bot/)。配置项和内部结构见 [`ds-bot/README.md`](ds-bot/README.md)，开发和测试见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：ds bot 建在 dsh 的插件系统上。每个 bot 都是一个 dsh 会话，用的是 dsh 的工具和模型。
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
