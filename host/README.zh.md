# DS Bot 主机与浏览器客户端

[English](README.md) | 中文

这个 fork 增加独立主机部署。DSH Web 在一台电脑上执行 Bot、模型、工具和定时任务，保存聊天与记忆。其他电脑和手机通过浏览器连接，无需安装 Node.js 或 DSH。关闭浏览器后主机继续工作；关闭主机则停止执行。

## 安装与启动

主机安装 Node.js 22.19+ 或 24+、Git 和 pnpm。在本仓库执行：

```sh
npm --prefix ds-bot ci
npm --prefix ds-bot run build
npm --prefix host ci
npm --prefix host run setup
npm --prefix host start
```

安装步骤把这个 fork 打包为固定归档，安装到独立 DSH Web profile，不安装上游 npm 版本，也不修改已有 DSH profile。数据默认保存在本仓库的 `.ds-bot-host/`。需要其他位置时，在安装及每次启动前设置 `DS_BOT_HOST_HOME` 为持久目录的绝对路径。备份时保留整个主机数据目录及其中的插件归档。模型服务在主机网页设置中配置，客户端无需保存模型凭据。

后端只监听 `127.0.0.1:3097`，通过 `DS_BOT_HOST_PORT` 修改端口。DSH 启动时输出用于浏览器认证的私有链接，不要放进仓库、截图或共享日志。浏览器通过它换取 DSH 的签名 Cookie。所有客户端共用同一操作员身份和权限，适用于个人团队主机，不提供多用户权限隔离。

## 电脑与手机连接

在主机安装 [Caddy](https://caddyserver.com/docs/install)，选择客户端能访问的主机名或局域网 IP。启动主机前，把 `DS_BOT_PUBLIC_URL` 设为对应 HTTPS 地址。另行启动 Caddy，`DS_BOT_PUBLIC_ADDRESS` 使用同一主机名和端口，后端端口也须一致。PowerShell 示例：

```powershell
$env:DS_BOT_PUBLIC_URL = 'https://bots.example:8443'
$env:DS_BOT_PUBLIC_ADDRESS = 'bots.example:8443'
$env:DS_BOT_HOST_PORT = '3097'
npm --prefix host start
# 在另一个终端设置相同的 Caddy 地址和后端端口：
caddy run --config host/Caddyfile
```

将示例地址替换为主机实际可达地址。附带 Caddyfile 使用 Caddy 内部 CA，需要在各电脑和手机信任该 CA。已有公网域名及证书时，用 Caddy 的正常证书配置替换 `tls internal`。主机防火墙仅放行选定的 HTTPS 代理端口。Caddy 保留 Host 并转发 WebSocket；DSH 仍校验请求来源及每次 Bot API 请求的身份。首版支持域名根路径，不支持路径前缀。

每个获准客户端首次打开私有登录链接，此后访问干净的 HTTPS 地址。Bot 名册、聊天及记忆都来自主机；浏览器自身的展示偏好可以不同。工作目录和文件夹选择均指主机上的目录。依赖 DSH Desktop 的嵌入式浏览器控制不属于本 Web 部署的已支持范围。

## Rabi 分工

Rabi 继续管理外部消息路由、业务计划和投递收据。这里提供 DSH 执行主机及现有 Bot 协作界面。安装不会绑定 Rabi 路由、复制 Rabi 人格或迁移业务记忆。Rabi 到 Bot 的绑定需要精确主机及会话，并单独验证投递和回传。

## 验证与更新

```sh
npm --prefix host test
npm --prefix ds-bot test
node ds-bot/scripts/build-client.mjs --check
npm --prefix ds-bot run lint
```

真实浏览器测试使用脚本模拟模型、独立主机数据和真实 Caddy 代理。将 `DS_BOT_CADDY` 设为 Caddy 可执行文件，`DS_BOT_PLAYWRIGHT_ROOT` 设为含 Playwright 的现有依赖目录，然后运行 `npm --prefix host run test:browser`。可选的 `DS_BOT_BROWSER_EXECUTABLE` 指定已安装的 Chromium 浏览器，`DS_BOT_EVIDENCE_DIR` 指定私有截图目录。测试覆盖认证、请求来源、电脑及手机布局、Bot 信息共享、关闭客户端后继续工作和重启恢复，不使用真实模型密钥，也不修改 Rabi 绑定。

更新前停止本主机，备份整个数据目录。拉取 fork，构建浏览器产物，重新安装并启动。安装会拒绝内容变化但插件版本不变的归档，不重置 Bot、聊天或记忆。客户端刷新后加载主机已安装版本的界面。

Windows 下，Bot 插件在原子替换状态文件时遇到临时共享冲突，会在最多 1000 毫秒内重试。通过 `host.patch.yml` 中 `bot` 配置的 `stateWriteRetryMs` 调整时限，0 表示关闭，上限为 60000。替换失败时保留原状态文件。
