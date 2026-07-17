<div align="center">

# Tokibean 码豆 🫘

### 一只看得见你的 AI 编程 agent 在干嘛的桌面宠物

Claude Code 和 Codex 都盯。它陪你思考、写码、搜索、完工撒花——顺便帮你盯着额度。

[![Release](https://img.shields.io/github/v/release/ZGhey/tokibean?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ZGhey/tokibean/total?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/releases)
[![Stars](https://img.shields.io/github/stars/ZGhey/tokibean?style=flat-square&color=e8916c)](https://github.com/ZGhey/tokibean/stargazers)
![Platforms](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)
[![License](https://img.shields.io/github/license/ZGhey/tokibean?style=flat-square)](LICENSE)

[English](README.md) | **简体中文**

<img src="docs/gifs/thinking.gif" width="150" alt="思考中"> <img src="docs/gifs/coding.gif" width="150" alt="改代码"> <img src="docs/gifs/done.gif" width="150" alt="完工庆祝">

**[⬇ 下载 macOS / Windows / Linux 安装包](https://github.com/ZGhey/tokibean/releases/latest)** &nbsp;·&nbsp; macOS 一行装:`brew install --cask zghey/tap/tokibean`

</div>

住在桌面上的 AI 编程 agent 状态监视宠物——支持 **Claude Code** 和 **Codex**。不用喂食、不用养成,它只做三件事:

1. **知道你的 agent 在不在干活**:实时接收 hook 事件,工作中会思考冒点点,完工时开心弹跳并发系统通知,等你输入/授权时会挥手提醒。同时开几个 agent 也照看得过来:一只宠物、一个 ×N 徽章,会话列表会告诉你是**哪个 agent、哪个项目**在等你。
2. **实时额度与 token 用量**:Claude 的 5 小时窗口和 Codex 自己的窗口并排各占一张卡——各有各的长度、各有各的重置时刻,**绝不混算**。外加今日/本周的全 agent token 总量。
3. **额度状态可视化**:**任一** agent 用量超 80%,头顶就冒感叹号;但只有**所有** agent 都耗尽才躺平睡觉(Codex 还有额度,就还有活可干)。

跨平台:Windows / macOS / Linux(Tauri 2)。

**和其他编程 agent 桌宠的区别:** Claude 这边它接的是 **Anthropic 官方用量 API**(面板里一次性 OAuth 连接账号),所以 5 小时窗口百分比和重置倒计时是真实数字,不是估算。另外它有一整套环境系统——真实月相、四季、天气、节日,全部离线由本地时钟算出。

Claude Code 是旗舰:官方用量 API、应用内连接账号、WSL hook 同步都只有它有。Codex 是一等公民但更简单——它的额度白送在本地日志里,不用登录。

> 本项目为社区作品,与 Anthropic 无关联、未获其背书;"Claude" 仅作兼容性事实描述。默认角色「拱门·墩墩」为原创形象,项目所有内置皮肤均可自由分发。

## 状态图鉴

每种状态一套专属动画,瞟一眼就知道 agent 干到哪一步了:

| 思考中 | 跑命令 | 改代码 |
| :---: | :---: | :---: |
| ![thinking](docs/gifs/thinking.gif) | ![cmd](docs/gifs/cmd.gif) | ![coding](docs/gifs/coding.gif) |
| 爱因斯坦发型+八字胡,叼烟斗背手踱步 | QWER 键帽随小手敲击随机亮起 | 想通了先亮灯泡,再戴工程帽抡镐 |

| 读文件 | 搜代码 | 查资料 |
| :---: | :---: | :---: |
| ![reading](docs/gifs/reading.gif) | ![searching](docs/gifs/searching.gif) | ![browsing](docs/gifs/browsing.gif) |
| 博士帽+单片眼镜,流苏轻摆慢翻书 | 举放大镜左右扫地 | 身旁小地球自转 |

| 派子任务 | 列计划 | 完工庆祝 |
| :---: | :---: | :---: |
| ![agents](docs/gifs/agents.gif) | ![planning](docs/gifs/planning.gif) | ![done](docs/gifs/done.gif) |
| 两侧冒出迷你分身同蹦 | 写字板任务逐条打勾 | 弹跳撒彩纸,气泡报耗时与摘要 |

| 等你输入 | 出错了 | 被拎起来 |
| :---: | :---: | :---: |
| ![attention](docs/gifs/attention.gif) | ![oops](docs/gifs/oops.gif) | ![drag](docs/gifs/drag.gif) |
| 挥手蹦跳,久等升级喇叭/叹气 | 红色恼火纹+气得直晃 | 悬空蹬腿,松手落回 |

| 发呆摸鱼 | 后台任务在跑 | |
| :---: | :---: | :---: |
| ![idle](docs/gifs/idle.gif) | ![satellite](docs/gifs/satellite.gif) | |
| 溜达/打盹/伸懒腰/追蝴蝶 | 小卫星绕头顶巡航 | |

### 环境与彩蛋

一整套"活着"的背景,全靠本机时钟,不联网:

- **🌙 真实月相**:夜里挂的月亮按日期算,一个月里阴晴圆缺跟着变。
- **🍂 四季**:飘雪 / 春樱 / 夏夜萤火 / 秋叶。
- **🎉 节日**:跨年烟花、春节灯笼、圣诞树、万圣南瓜、中秋月饼配满月。
- **🌦 天气**:偶尔下雨(会撑伞)或刮大风(东西被横吹)。
- **☕ 作息**:早晨喝咖啡歇会儿,凌晨困得直点头。
- **👀 眼睛跟着光标转**;**😆 挠痒痒**(在它头上快速蹭)会傻笑,摸头会冒心。
- **🌅 额度回血**:5 小时窗口快重置时,睡着的它在晨光里慢慢醒来。

再加上原有的隐藏戏份——额度耗尽躺平睡觉等等,装上自己发现。

## 运行要求

所有平台:
- [Rust](https://rustup.rs/)(1.77.2+,`rustup` 安装即可)
- Node.js 18+

各平台额外依赖:
- **Windows**:Microsoft C++ Build Tools(装 Rust 时会提示);WebView2 一般系统自带
- **macOS**:`xcode-select --install`
- **Linux (Debian/Ubuntu)**:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

> **WSL 用户注意**:这是图形程序,要在 Windows 侧运行(Windows 上装 Rust + Node),不要在 WSL 里跑。Claude Code 跑在 WSL 里也能被感知:面板的「安装 hooks」会自动同步到每个 WSL 发行版的 `~/.claude/settings.json`(镜像网络模式直接用 `127.0.0.1`;NAT 模式自动改用 Windows 主机网关地址,但还需在宠物配置里把 `bind` 设为 `"0.0.0.0"` 并重启宠物)。

## 快速开始

```bash
cd tokibean
npm install
npm run dev        # 开发模式启动
```

宠物出现在屏幕上之后,打开**设置**窗口(托盘菜单,或用量面板底部的 ⚙)。安装这类事只做一次,所以它待在设置里,不占用你每天要看的面板。

**Claude Code** —— *Claude Code* 标签页:

1. 点 **「安装 hooks」** → 自动往 `~/.claude/settings.json` 写入 7 个事件转发(写入前会备份为 `settings.json.bak-tokibean`)。Windows 上还会同步进每个装了 Claude Code 的 WSL 发行版
2. **重启 Claude Code**(或在里面执行 `/hooks`)使配置生效
3. 在 Claude Code 里随便发条消息 → 宠物应该立刻进入"思考中"状态

**Codex** —— *Codex* 标签页(设置里始终列出它,不管你装没装;面板则只显示你真正在用的 agent):

1. 点 **「安装 hooks」** → 写入 `~/.codex/hooks.json`(先备份)
2. **在 Codex 里执行 `/hooks` 批准这些 hook。** 这步不能省:Codex 会给每个 hook 定义算哈希,不经你批准就**拒绝执行**,而且任何改动都会重新触发审核。而且它不是安静地跳过——它会照常打印 `hook: … Completed`,但命令**根本没执行**。
3. 在 Codex 里随便跑点什么 → 面板翻成「**已生效**」,因为**真的收到了事件**。这是唯一诚实的证据,所以我们只认它

> hooks 装了但宠物还是不理 Codex?见 [docs/codex-hooks.md](docs/codex-hooks.md)——为什么 Codex 会给一个根本没执行的 hook 打印 `Completed`,以及怎么分辨失败的到底是谁的 hook。

> **如果你让 Codex 导入过 Claude Code 的配置**(它首次启动时会问),它把 Tokibean 自己的 hook 原样复制进了 `~/.codex/hooks.json`——但仍然指向 Claude 的端点。放着不管,你在 Codex 里干的活会被**算到 Claude 头上**。安装 Codex hooks 时会自动清理掉这些副本,面板会告诉你清了几个。

顶部悬停会出现拖动手柄,按住可以把宠物拖到任意位置。系统托盘图标可以隐藏/退出。

打正式安装包:`npm run build`(macOS 打包前先跑一次 `npm run tauri icon app-icon.png` 生成 icns 图标)。

## 工作原理

```
Claude Code hooks ──POST──▶ 127.0.0.1:8737/event        ─┐
Codex hooks       ──POST──▶ 127.0.0.1:8737/event/codex  ─┴─▶ 同一台状态机 ──▶ 宠物动画 + 系统通知

~/.claude/projects/*.jsonl  ──增量解析──▶ 5 小时窗口   ─┐
~/.codex/sessions/*.jsonl   ──增量解析──▶ Codex 的窗口 ─┴─▶ 各占一张额度卡
```

- **事件映射**:`UserPromptSubmit`→工作中,`PreToolUse`→显示正在用的工具("跑命令"/"改代码"…),`Stop`→完工(气泡显示耗时和最后一条消息摘要,干满 1 分钟撒彩纸,10 分钟大庆祝),`Notification`→等你输入,`SessionStart/End`→会话边界。shell 命令还会再细分——`git`、跑测试、装依赖各有专属动画。
- **多 agent、多会话**:按 `(agent, session_id)` 独立记状态,agent 身份在**安装时**由 hook 的 URL 路径决定,**绝不从 payload 里猜**。多路并行时头顶显示 ×N 徽章(跨 agent 合计);任一路在干活就算干活,全部完工才庆祝。用量面板按 agent + 项目目录逐一列出每个会话的状态和时长。
- **额度窗口绝不归一化**:Claude 的是 5 小时计费块;Codex 报的是它自己的窗口(免费档 30 天)和自己的重置时刻。**它们不是同一个量**,所以各占一张卡,窗口长度从 agent 自己的数据渲染。**任一** agent 超 80% 就警告,但**所有** agent 都耗尽才睡觉——Codex 还有额度却躺平,那是撒谎。
- **Codex 的额度是白送的**:它把 `used_percent`、窗口长度、重置时刻直接写进 `~/.codex/sessions/**/*.jsonl`。不用 OAuth、不用调 API、没有 token 要刷新。(token 计入总量;**成本不计**——我们只建模了 Anthropic 的价格,所以美元数字明确标注是 Claude 的,不冒充总数。)
- **Codex 的信任门**:Codex 会给每个 hook 定义算哈希,不经你在 `/hooks` 里批准就不执行——所以「写入」不等于「生效」。只有**真的收到过事件**,面板才敢说「已生效」。另外有两件事 Codex 根本没法告诉我们:工具**有没有失败**(成功的 `true` 和失败的 `false` payload 逐字节相同),以及它在读文件还是搜索(两者都走 `Bash`)。所以宠物在 Codex 上不做生气动画,也不瞎猜。
- **通知降噪**:工作不足 30 秒的小活完工不发系统通知(配置里 `notify_min_secs` 可调)
- **hooks 用 curl 转发**而不是 http 类型 hook,为了兼容更多 Claude Code 版本;curl 在 Win10+/macOS/主流 Linux 都自带
- **5 小时窗口口径**:从窗口内首次活动所在的 UTC 整点开始,持续 5 小时(与 ccusage 的 blocks 口径一致)
- **官方用量(订阅模式)**:在面板里点一次**「连接 Claude 账号」**——浏览器走标准 OAuth 授权,Tokibean 存**自己的**一份凭据,再去查 Anthropic 官方用量接口,拿到真实的 5 小时窗口和周限额百分比。这份令牌由它自己在后台续期(带退避),所以**只需连接一次**:access token 过期、甚至重启电脑都不用重连。作为独立 app,它刻意**不借用** Claude Code CLI 的凭据(Keychain / `.credentials.json` / 凭据管理器);连接之前,除非手动设了限额,否则没有 5 小时窗口百分比。令牌只留在本机,只发给 `api.anthropic.com`。(存的凭据万一失效,面板会直接提示你重新连接。)
- **订阅限额说明**:Anthropic 不公开具体限额,且会随服务器负载浮动。没有官方数据时,面板不显示窗口百分比;想不连接也有个数,就改配置里的 `block_limit`(token 数)手动指定
- **订阅/API 判定**:自动模式下,环境里有 `ANTHROPIC_API_KEY` 视为 API 计费,否则视为订阅。判不准就在面板里手动切
- **自动更新**(0.2.0 起):启动时和每 24 小时检查新版本;发现后面板会出现一键「更新」提示条(或用托盘的「检查更新…」),自动下载、安装、重启。手动点「检查更新…」时,若已是最新版本也会弹窗告知。更新包经签名,托管在 GitHub Releases。现有 0.1.x 用户需手动下一次 0.2.0,之后即可应用内更新。
- **开机启动**(0.3.3 起):在设置窗口里勾选即可——码豆会把自己注册到系统(Windows 注册表 `Run` 键 / macOS LaunchAgent / Linux `.desktop`),随登录静默启动。开关读取系统真实状态,即使你在别处改过也能保持同步。
- **宠物大小**(0.4.4 起):在设置窗口里选 小 / 中 / 大 / 特大。只缩放宠物(使用率面板尺寸不变),从脚底原地长大、即时生效。任意大小都清晰——像素画不糊。

## 配置

配置文件:`~/.config/tokibean/config.json`(macOS:`~/Library/Application Support/tokibean/config.json`;Windows:`%APPDATA%\tokibean\config.json`),首次运行自动生成:

> 从 0.5.0 之前的版本升级过来?那会儿宠物只看 Claude Code,配置放在 `claude-pet` 目录里。新版本首次启动会自动**收养**它——已连接的账号、宠物位置、皮肤,全都在,不用重连、不用重设。旧目录原样保留,万一你想退回去。

```jsonc
{
  "mode": "auto",        // auto | subscription | api
  "port": 8737,          // hook 服务器端口,改了要重装 hooks
  "block_limit": 0,      // 订阅窗口限额(token 数),0 = 无本地百分比(连接账号可用官方用量)
  "notify": true,        // 系统通知开关
  "prices": { ... }      // API 成本估算用的模型单价,美元/百万 token,过期了自己改
}
```

## 卸载 hooks

打开 `~/.claude/settings.json`(和/或 `~/.codex/hooks.json`),删掉 hooks 里所有 `command` 包含 `127.0.0.1:8737/event` 的条目即可;或直接用备份文件恢复——Claude Code 是 `settings.json.bak-tokibean`,Codex 是 `hooks.json.bak-tokibean`。

## 换皮肤

内置皮肤:**拱门·墩墩(默认,柿子橙)** / 豆豆 / 橘猫·摸鱼,面板下拉即时切换。皮肤是 `src/skins/` 下覆盖 `window.PetRenderer` 的独立文件,可复用 `window.PetKit` 工具箱(像素/气泡/状态框/爱心/彩纸)。

皮肤还能自动轮换:设置 → 皮肤循环,每小时或每天(对齐整点/本地午夜)在勾选的皮肤间轮换。当前皮肤由时钟推导,重启落在同一张;手动选中某张皮肤即自动关闭循环。

所有绘制逻辑都在 `src/pet.js` 一个文件里,保持 `window.PetRenderer.draw(ctx, canvas, state, warn, bubble, t, extra)` 接口不变,随便怎么画。状态共 5 个:`idle / working / attention / done / limit`,外加 `warn` 叠加标记。第 7 个参数 `extra` 可选(老皮肤可忽略):`{sessions, workSecs, attnSecs, toolNote, celebrate, oops, bgCount, dragging, pat}`,分别用于多会话徽章、工时角标/疲惫脸、工具标签、庆祝等级、出错恼火、后台任务卫星、拖拽悬空、摸头。

> 本项目与 Anthropic 无关联,"Claude Code" 仅作兼容性事实描述。

## 已知限制

- **Linux Wayland**:透明、置顶的支持取决于合成器,不行就会退化成普通窗口;X11 无此问题
- **额度百分比需要官方数据或手动限额**:连接账号可得真实百分比,或设 `block_limit`。两者都没有时,不显示窗口百分比,也没有 80%/100% 提醒(早先按历史最高窗口的自动估算因不够可靠已移除)
- **只统计本地 agent 的用量**:claude.ai / ChatGPT 网页版的用量不落在本地文件里,监控不到
- **Codex 上没有「生气」动画**:Codex 的 hook payload **无法表达工具失败**——成功的 `true` 和失败的 `false` 打出来的 payload 逐字节相同——所以宠物不猜。同理 `reading`/`searching` 动画在 Codex 上很少出现,因为它读文件和搜索都走 shell。
- **周限额**:官方口径未公开,面板里的"近 7 天"是滚动近似值
- 端口 8737 被占用时 hook 服务器会启动失败(看终端日志),在配置里换端口后重装 hooks

## Star history

觉得墩墩可爱的话,点个 ⭐ 能帮更多人发现它。

<a href="https://star-history.com/#ZGhey/tokibean&Date">
  <img src="https://api.star-history.com/svg?repos=ZGhey/tokibean&type=Date" width="600" alt="Star History Chart">
</a>
