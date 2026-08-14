// scripts/dist.mjs — 打包入口
// 自动为 electron-builder 配置国内镜像（npmmirror，解决 GitHub 下载超时问题），
// 再调用 electron-builder 执行打包。用户可用环境变量覆盖镜像地址。
//
// 用法：
//   node scripts/dist.mjs --win           # 等同 npm run dist
//   node scripts/dist.mjs --win portable  # 等同 npm run dist:portable
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 国内网络访问 GitHub 不稳定：默认走 npmmirror 镜像，已配置则尊重用户设置
process.env.ELECTRON_MIRROR ??= "https://npmmirror.com/mirrors/electron/";
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= "https://npmmirror.com/mirrors/electron-builder-binaries/";

const args = process.argv.slice(2);
const cli = join(ROOT, "node_modules", "electron-builder", "out", "cli", "cli.js");
const r = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", cwd: ROOT });
process.exit(r.status ?? 1);
