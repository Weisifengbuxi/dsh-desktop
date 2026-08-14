// main.js — DeepSeek Harness 桌面应用外壳（Electron 主进程）
// 双击启动 → 后台拉起 `dsh web` → 弹出应用窗口加载本地 URL；关闭窗口 → 杀掉服务进程。
import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { startDshServer, stopServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 应用名 / 版本号从 package.json 读取（由 `npm run diy` 个性化），无需改代码。
let APP_NAME = "DeepSeek Harness";
let APP_VERSION = "0.1.0";
try {
  const manifest = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
  APP_NAME = manifest.build?.productName || APP_NAME;
  APP_VERSION = manifest.version || APP_VERSION;
} catch {
  /* 读取失败时使用默认值 */
}

console.log(`[dsh-desktop] app: ${APP_NAME} v${APP_VERSION}`);
app.setName(APP_NAME);
app.setAppUserModelId("com.dsh.desktop");

let win = null;
let server = null; // { url, child, stop }
let shuttingDown = false;
let appOrigin = "";

// 单实例：重复双击时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    console.log("[dsh-desktop] second-instance → 聚焦已有窗口");
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("will-quit", () => console.log("[dsh-desktop] will-quit"));
  app.whenReady().then(() => {
    console.log("[dsh-desktop] app ready");
    main();
  });
}

function parsePort() {
  const argv = process.argv;
  const i = argv.indexOf("--port");
  if (i !== -1 && argv[i + 1] && /^\d+$/.test(argv[i + 1])) return argv[i + 1];
  if (process.env.DSH_PORT && /^\d+$/.test(process.env.DSH_PORT)) return process.env.DSH_PORT;
  return "0"; // 0 = 让系统分配空闲端口，避免和已有实例冲突
}

async function main() {
  const logFile = join(app.getPath("userData"), "dsh-server.log");
  mkdirSync(dirname(logFile), { recursive: true });

  const iconPath = join(__dirname, "build", "icon.png");
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#0d1117",
    autoHideMenuBar: true,
    icon: existsSync(iconPath) ? iconPath : undefined,
    show: false,
  });
  win.loadFile(join(__dirname, "splash.html"), { query: { name: APP_NAME } });
  win.once("ready-to-show", () => {
    console.log("[dsh-desktop] window ready-to-show");
    win.show();
  });
  win.on("closed", () => {
    console.log("[dsh-desktop] window closed");
    win = null;
    shutdown();
  });
  win.webContents.on("did-finish-load", () => {
    console.log("[dsh-desktop] page loaded:", win.webContents.getURL());
    // 页面加载完成后强制恢复标题（部分页面会在加载过程中改写标题）
    win.setTitle(APP_NAME);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => console.error("[dsh-desktop] page load failed:", code, desc, url));
  win.webContents.on("render-process-gone", (_e, details) => console.error("[dsh-desktop] renderer gone:", JSON.stringify(details)));
  // 阻止页面改写标题（配合 did-finish-load 里的 setTitle，标题栏始终显示 DIY 应用名）
  win.webContents.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (appOrigin && url.startsWith(appOrigin)) return; // 允许应用自身导航
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  installMenu(logFile);

  try {
    server = await startDshServer({
      port: parsePort(),
      logFile,
      onLog: (line) => console.log("[dsh-server]", line),
    });
    appOrigin = new URL(server.url).origin;
    console.log("[dsh-desktop] server ready:", server.url);
    if (win && !win.isDestroyed()) {
      win.setTitle(APP_NAME);
      win.loadURL(server.url);
    }
  } catch (err) {
    console.error("[dsh-desktop] 启动失败:", err);
    dialog.showErrorBox(`${APP_NAME} 启动失败`, String(err?.message || err));
    shutdown();
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[dsh-desktop] shutdown → 停止服务进程");
  if (server) {
    try {
      server.stop();
    } catch {
      /* ignore */
    }
  }
  app.quit();
}

app.on("before-quit", shutdown);
app.on("window-all-closed", shutdown);

process.on("uncaughtException", (err) => console.error("[dsh-desktop] uncaught:", err));
process.on("unhandledRejection", (err) => console.error("[dsh-desktop] unhandled:", err));

function installMenu(logFile) {
  const menu = Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        {
          label: "在浏览器中打开",
          click: () => server && shell.openExternal(server.url),
        },
        { type: "separator" },
        { label: "退出", accelerator: "CmdOrCtrl+Q", click: () => shutdown() },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "打开服务日志", click: () => shell.openPath(logFile) },
        {
          label: "关于",
          click: () =>
            dialog.showMessageBox(win, {
              type: "info",
              title: "关于",
              message: APP_NAME,
              detail: `桌面应用外壳 v${APP_VERSION}\n双击启动 dsh web 本地服务并以内嵌窗口打开。\n\n关闭本窗口即停止服务。`,
            }),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}
