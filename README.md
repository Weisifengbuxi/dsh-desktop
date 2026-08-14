# DeepSeek Harness Desktop（DSH 桌面应用 · DIY）

### 你是否也遇到过这些场景？

- **网页上跑着 DSH，手一抖把浏览器标签关了**——服务跟着一起没了，会话状态得从头再来；
- **想用一次 DSH 太麻烦**——开终端、敲命令、等它打印 URL、再手动打开浏览器……折腾完就没兴致了；
- DSH 这么好用，**为什么不能像微信、VS Code 那样，双击图标就是一个应用**？

现在可以了。**DeepSeek Harness Desktop** 把 DSH 的网页界面装进一个**独立的桌面应用窗口**：
双击启动 → 自动在后台拉起本地服务 → 窗口直接打开界面；关闭窗口 → 服务自动停止
再也不怕手滑关掉浏览器连服务一起没了。

**支持diy**。应用名、图标全由你决定，
一条命令个性化，一条命令打包，出来的就是**你的专属 DSH 应用**

---

## 快速开始（3 步）

### 第 1 步：终端拉取源码

```bash
git clone git@github.com:Weisifengbuxi/dsh-desktop.git
cd dsh-desktop
npm install
```


### 第 2 步：DIY 个性化

```bash
npm run diy
```

**① 应用名** — 例如 `我的AI助手`、`My DSH`
- 会显示在：窗口标题栏、开始菜单/桌面快捷方式、安装包文件名、"关于"对话框
- 支持中英文、空格

**③ 图标路径** — **要求是严格的，报错中止即输入不符合要求**：

| 格式 | 要求 | 用途 |
|---|---|---|
| **PNG** | 必须**正方形**，边长 **256~1024px**（推荐 **512×512**），建议透明背景 | 窗口/任务栏图标；打包时自动生成安装器图标 |
| **ICO** | 必须**包含至少一张 256×256** 的图像 | 安装器图标（提供 ICO 时优先使用） |

- 只接受这两种格式，其他一律拒绝；
- PNG 不是正方形、边长超出 256~1024、ICO 里没有大尺寸图像，向导都会报错并中止，
- 如果不满意，重新运行 `npm run diy` 随时更换。

也可以一行命令完成（适合脚本/CI）：
>
```bash
npm run diy -- --name "My DSH" --version 1.0.0 --icon C:\path\icon.png
```

向导完成时会输出：

```
✅ 完成！已写入：应用名=My DSH，版本=1.0.0
```

### 第 3 步：运行或打包

```bash
npm start              # 直接体验（弹出应用窗口，无需打包）
npm run dist           # 打包成安装版 exe（输出到 release/）
npm run dist:portable  # 打包成便携版 exe（输出到 release/）
```

装好后，桌面上就是你的专属应用：自己的名字、自己的图标、自己的版本号。

---

## 系统要求

- **Windows 10/11 x64**
- **Node.js 18+**（应用通过 `npx` 启动 dsh 服务；首次运行需联网下载 dsh 包，之后走本地缓存）
- 首次 `npm install` 需要联网（下载 Electron）

---

## 开发者指南

### 目录结构

```
dsh-desktop/
├── main.js              Electron 主进程（窗口、菜单、生命周期；应用名/版本从 package.json 读取）
├── server.js            服务子进程管理（启动 dsh web、解析 URL、退出清理）
├── splash.html          启动时的加载页（显示 DIY 后的应用名）
├── scripts/
│   ├── diy.mjs          DIY 个性化向导（npm run diy，严格校验图标）
│   ├── make-icon.js     生成占位图标（build/icon.png、build/icon.ico）
│   └── selftest.mjs     无需 Electron 的服务自测（node scripts/selftest.mjs）
├── build/               图标资源（DIY 写入的 icon.png / icon.ico 在这里）
└── release/             打包产物（不入库）
```

### 原理

双击启动 → `server.js` 直接定位 npx 缓存中的 `@deepseek-ai/dsh` 入口，用 `node` 拉起
（`dsh web --port 0`，端口自动分配，避免冲突）→ 解析它打印的 `dsh web: http://...` URL →
`main.js` 用 Electron 窗口加载该 URL，标题栏固定显示 DIY 应用名 → 关闭窗口时
`taskkill /T` 清理整个服务进程树（含 npx 链路的双保险清扫）。

### 服务启动方式与环境变量

| 环境变量 | 作用 |
|---|---|
| `DSH_SERVER_COMMAND` | 整条启动命令（例如 `node C:\dsh\lib\bin.js`），适用于离线打包场景 |
| `DSH_SERVER_CMD` | 只给 JS 入口路径，自动用 `node` 运行 |
| `DSH_PORT` | 固定端口（默认 0 = 自动分配） |
| `DSH_APP_SHOW_CONSOLE=1` | 启动时保留一个可见的终端窗口显示服务日志 |

服务日志默认写入 `%APPDATA%\<应用名>\dsh-server.log`（应用内菜单：帮助 → 打开服务日志）。

### 常见问题

- **SmartScreen 提示"未知发布者"？** 项目未做代码签名，这是正常的，选择"仍要运行"即可。
- **换图标/改名后没生效？** 重新执行 `npm run diy`，然后重新 `npm run dist` 打包。
- **图标校验被拒？** 按上面的表格准备：PNG 务必正方形、512×512 最稳妥；在线生成 ICO 时选包含 256×256。
- **首次启动要联网？** 是——npx 首次拉取 dsh 包需要网络，之后走本地缓存，离线也能启动。

---

## English

**DeepSeek Harness Desktop** is a DIY Windows desktop shell for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web UI —
tired of closing the browser tab and killing the service with it, or of typing
startup commands every time? Get the source via terminal, personalize your own
app (name / version / icon), and build it — or just run it without packaging.

**Install & personalize:**

```bash
git clone <this repodsh-desktop
cd dsh-desktop
npm install
npm run diy            # wizard: app name / version / icon
npm start              # run in dev mode (no packaging needed)
npm run dist           # build NSIS installer into release/
npm run dist:portable  # build portable exe into release/
```

**Icon requirements (strictly validated by the wizard):**

| Format | Requirements | Used for |
|---|---|---|
| PNG | Square, 256–1024px (512×512 recommended), transparent background preferred | Window/taskbar icon; installer icon is auto-generated from it |
| ICO | Must contain at least one 256×256 image | Installer icon (takes priority over PNG) |

**Requirements**: Windows 10/11 x64, Node.js 18+ (first run needs network to
fetch the dsh package via npx).

---

## License

[MIT](LICENSE)
