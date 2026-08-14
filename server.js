// server.js
// 负责把 `dsh web` 作为子进程拉起、解析它打印的 URL、并在退出时清理整个进程树。
// 纯 Node 模块（不依赖 Electron），可以单独用 `node scripts/selftest.mjs` 验证。
//
// 启动方式（按优先级）：
//   1. DSH_SERVER_COMMAND —— 整条命令字符串（例如 "node C:\\dsh\\lib\\bin.js"）
//   2. DSH_SERVER_CMD     —— 只给 JS 入口，自动用 node 运行
//   3. 默认               —— 直接定位 npx 缓存里的 @deepseek-ai/dsh 入口，用 node 拉起
//                            （找不到时回退到 npx --yes @deepseek-ai/dsh）
//
// 清理策略：Windows 下用 taskkill /T 杀整个进程树；对 npx 链路再叠加一次
// 按命令行匹配的清扫，防止 cmd.exe 提前退出导致漏杀。
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const URL_RE = /dsh web: (https?:\/\/[^\s]+)/;

export function resolveServerCommand() {
  const env = process.env;
  if (env.DSH_SERVER_COMMAND) return { kind: "string", value: env.DSH_SERVER_COMMAND };
  if (env.DSH_SERVER_CMD) return { kind: "node-script", value: env.DSH_SERVER_CMD };
  return { kind: "default" };
}

/** 在 %LOCALAPPDATA%\npm-cache\_npx\*\node_modules\@deepseek-ai\dsh\lib\bin.js 里找最新的入口。 */
export async function resolveDshBinPath() {
  const cacheRoot = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "npm-cache", "_npx") : null;
  if (!cacheRoot) return null;
  try {
    const entries = await readdir(cacheRoot, { withFileTypes: true });
    let best = null;
    let bestTime = 0;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(cacheRoot, e.name, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
      try {
        const st = await stat(p);
        if (st.isFile() && st.mtimeMs > bestTime) {
          best = p;
          bestTime = st.mtimeMs;
        }
      } catch {
        /* 该缓存目录里没有 dsh，跳过 */
      }
    }
    return best;
  } catch {
    return null;
  }
}

function quote(arg) {
  return /^[\w\-./:=@]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '\\"')}"`;
}

/**
 * 组装启动方式。返回 { command, args, shell, viaShell, killPattern }。
 * killPattern：npx/cmd 链路下用于按命令行清扫残留进程的 LIKE 模式。
 */
export async function buildSpawnSpec(port, extraArgs = []) {
  const base = ["web", "--port", String(port), ...extraArgs];
  const resolved = resolveServerCommand();
  if (resolved.kind === "string") {
    return {
      command: `${resolved.value} ${base.map(quote).join(" ")}`,
      args: [],
      shell: process.platform === "win32",
      viaShell: true,
      killPattern: null,
    };
  }
  if (resolved.kind === "node-script") {
    return {
      command: process.env.DSH_SERVER_NODE || "node",
      args: [resolved.value, ...base],
      shell: false,
      viaShell: false,
      killPattern: null,
    };
  }
  const entry = await resolveDshBinPath();
  if (entry) {
    return {
      command: process.env.DSH_SERVER_NODE || "node",
      args: [entry, ...base],
      shell: false,
      viaShell: false,
      killPattern: null,
    };
  }
  // 兜底：npx 解析（首次使用会联网下载）
  const pattern = `npx-cli.js" --yes @deepseek-ai/dsh web --port ${port}`;
  if (process.platform === "win32") {
    return {
      command: `npx --yes @deepseek-ai/dsh ${base.map(quote).join(" ")}`,
      args: [],
      shell: true,
      viaShell: true,
      killPattern: pattern,
    };
  }
  return { command: "npx", args: ["--yes", "@deepseek-ai/dsh", ...base], shell: false, viaShell: false, killPattern: pattern };
}

/**
 * 探测是否已有 dsh web 实例在运行（复用检测，避免两个实例并发写同一会话导致日志损坏）。
 * 命中条件：目标地址返回 200，且首页包含 dsh 注入的引导标记 __DSH_BOOT__。
 * @returns 命中时返回完整 URL，否则 null。
 */
export async function detectExistingServer({ host = "127.0.0.1", port = "3080", timeoutMs = 1200 } = {}) {
  const url = `http://${host}:${port}/`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes("__DSH_BOOT__") ? url : null;
  } catch {
    return null;
  }
}

/** 按命令行 LIKE 模式清扫残留的 node 进程（Windows，PowerShell）。 */
function sweepKill(pattern) {
  if (!pattern || process.platform !== "win32") return;
  try {
    const script = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${pattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

/** 杀掉服务进程树。 */
export function stopServer(child) {
  if (!child) return;
  const gone = child.exitCode !== null || child.signalCode !== null;
  if (process.platform === "win32") {
    if (gone) {
      // 直接子进程（如 cmd.exe）已退出，但仍可能有 npx/node 残留
      if (child.killPattern) sweepKill(child.killPattern);
      return;
    }
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      /* ignore */
    }
    if (child.killPattern) sweepKill(child.killPattern);
  } else if (!gone) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

/**
 * 启动 dsh web 服务，等待它打印 `dsh web: http://127.0.0.1:<port>`。
 * @returns Promise<{ url, child, stop }>
 */
export async function startDshServer({
  port = "0",
  extraArgs = [],
  logFile,
  showConsole = false,
  timeoutMs = 120_000,
  onLog,
} = {}) {
  const spec = await buildSpawnSpec(port, extraArgs);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(spec.command, spec.args, {
        shell: spec.shell,
        windowsHide: !showConsole,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      });
      child.killPattern = spec.killPattern;
    } catch (err) {
      reject(new Error(`无法启动服务进程：${err.message}`));
      return;
    }

    const log = logFile ? createWriteStream(logFile, { flags: "a" }) : null;
    const emit = (line) => {
      if (onLog) onLog(line);
      if (log) log.write(line + "\n");
    };
    if (log) log.write(`\n===== ${new Date().toISOString()} 启动 (pid=${child.pid}) =====\n`);

    let settled = false;
    let pending = "";
    let lastStderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopServer(child);
      reject(new Error(`等待 dsh web 就绪超时（${timeoutMs / 1000}s）\n最近输出：${lastStderr || "(无)"}`));
    }, timeoutMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const stop = () => stopServer(child);

    child.stdout?.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        emit(line);
        const m = line.match(URL_RE);
        if (m) finish(resolve, { url: m[1], child, stop });
      }
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      lastStderr = (lastStderr + text).slice(-2000);
      for (const line of text.split(/\r?\n/)) if (line.trim()) emit(line);
    });
    child.on("error", (err) => {
      lastStderr = err.message;
      emit(`[spawn error] ${err.message}`);
      finish(reject, new Error(`启动服务进程失败：${err.message}`));
    });
    child.on("exit", (code) => {
      emit(`[dsh server exited] code=${code}`);
      if (log) log.end();
      if (!settled) finish(reject, new Error(`dsh web 服务提前退出（code=${code}）\n最近输出：${lastStderr || "(无)"}`));
    });
  });
}
