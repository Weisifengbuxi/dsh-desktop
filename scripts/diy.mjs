// scripts/diy.mjs — DIY 个性化向导
// 自定义应用名 / 版本号 / 图标，改完即可 `npm start` 体验或 `npm run dist` 打包成自己的 exe。
//
// 用法：
//   npm run diy                                        # 交互式提问
//   npm run diy -- --name "My App" --version 1.0.0 --icon C:\path\icon.png   # 非交互
//
// 图标要求（严格校验，不满足直接报错中止）：
//   PNG：正方形，边长 256~1024px（推荐 512），建议透明背景
//        —— 用于窗口/任务栏图标，打包时 electron-builder 自动生成安装器图标
//   ICO：必须包含至少一张 256×256 的图像
//        —— 提供 ICO 时安装器优先使用它
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PKG_PATH = join(ROOT, "package.json");
const ICON_DIR = join(ROOT, "build");
const ICON_PNG = join(ICON_DIR, "icon.png");
const ICON_ICO = join(ICON_DIR, "icon.ico");

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ICO_MAGIC = [0x00, 0x00, 0x01, 0x00];

function readPkg() {
  return JSON.parse(readFileSync(PKG_PATH, "utf8"));
}

function getFlag(flag, argv) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** 弹出 Windows 文件选择框，返回选中的图标路径；取消返回空字符串。 */
function pickIconFile() {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = '图标文件 (*.png;*.ico)|*.png;*.ico|PNG 图片 (*.png)|*.png|ICO 图标 (*.ico)|*.ico'
$d.Title = '选择应用图标（PNG 正方形 256~1024px，或含 256x256 的 ICO）'
$d.InitialDirectory = [Environment]::GetFolderPath('Desktop')
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }
`;
  const tmp = join(tmpdir(), `dsh-diy-pick-${process.pid}.ps1`);
  try {
    writeFileSync(tmp, "\uFEFF" + script, "utf8");
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp], {
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    });
    return r.stdout?.trim() || "";
  } catch {
    return "";
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 严格校验图标文件，返回 { kind: 'png'|'ico', source }，不满足要求直接抛错。 */
function validateIcon(src) {
  const buf = readFileSync(src);
  if (buf.length < 8) throw new Error("文件太短，不是有效的图标");

  const isPng = PNG_MAGIC.every((b, i) => buf[i] === b);
  const isIco = ICO_MAGIC.every((b, i) => buf[i] === b);

  if (isPng) {
    if (buf.length < 24) throw new Error("PNG 文件不完整（缺少尺寸信息）");
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w !== h) throw new Error(`PNG 必须是正方形（当前 ${w}×${h}）`);
    if (w < 256 || w > 1024) throw new Error(`PNG 边长必须在 256~1024px 之间（当前 ${w}px），推荐 512`);
    return { kind: "png", source: src };
  }

  if (isIco) {
    if (buf.length < 22) throw new Error("ICO 文件不完整");
    const count = buf.readUInt16LE(4);
    if (count < 1) throw new Error("ICO 中没有图像");
    let maxSize = 0;
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 16;
      if (off + 16 > buf.length) break;
      const w = buf[off] === 0 ? 256 : buf[off]; // 宽度字节为 0 表示 256px
      if (w > maxSize) maxSize = w;
    }
    if (maxSize < 128) throw new Error(`ICO 尺寸太小，必须包含至少一张 256×256 的图像（当前最大 ${maxSize}px）`);
    return { kind: "ico", source: src };
  }

  throw new Error("只支持 PNG 或 ICO 格式的图标（文件头无法识别）");
}

const argv = process.argv.slice(2);
const flagName = getFlag("--name", argv);
const flagVersion = getFlag("--version", argv);
const flagIcon = getFlag("--icon", argv);
// 只要给了任意 flag 就视为非交互模式，缺失项用当前配置
const interactive = !flagName && !flagVersion && !flagIcon;

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (q) => (await rl.question(q)).trim();

const pkg = readPkg();
const currentName = pkg.build?.productName ?? "DeepSeek Harness";
const currentVersion = pkg.version ?? "0.1.0";

console.log("\n=== DeepSeek Harness Desktop DIY 向导 ===\n");
console.log(`当前配置：应用名=${currentName}，版本=${currentVersion}\n`);

const name = flagName ?? ((await ask(`应用名（窗口标题 / 快捷方式名）[${currentName}]: `)) || currentName);
const version = flagVersion ?? ((await ask(`版本号（x.y.z）[${currentVersion}]: `)) || currentVersion);
let iconInput = flagIcon;
if (iconInput === undefined && interactive) {
  const ans = await ask(
    "图标路径（直接回车 = 打开文件选择框；或直接输入路径；取消选择 = 保留占位图标）: "
  );
  iconInput = ans || pickIconFile();
}
rl.close();

// ---------- 图标（严格校验） ----------
let icon = null;
if (iconInput) {
  const src = resolve(iconInput);
  if (!existsSync(src)) fail(`文件不存在：${src}`);
  try {
    icon = validateIcon(src);
  } catch (err) {
    fail(`图标不符合要求：${err.message}`);
  }
}

if (icon?.kind === "png") {
  mkdirSync(ICON_DIR, { recursive: true });
  copyFileSync(icon.source, ICON_PNG);
  pkg.build.win.icon = "build/icon.png";
  console.log(`\n✓ 已使用你的图标（PNG）：${icon.source} → build/icon.png`);
} else if (icon?.kind === "ico") {
  mkdirSync(ICON_DIR, { recursive: true });
  copyFileSync(icon.source, ICON_ICO);
  pkg.build.win.icon = "build/icon.ico";
  console.log(`\n✓ 已使用你的图标（ICO）：${icon.source} → build/icon.ico`);
} else if (!existsSync(ICON_PNG)) {
  console.log("\n未提供图标，正在生成占位图标…");
  spawnSync(process.execPath, [join(__dirname, "make-icon.js")], { stdio: "inherit" });
} else {
  console.log("\n保留现有图标：build/icon.png");
}

// ---------- 写入配置 ----------
pkg.version = version;
pkg.build = pkg.build ?? {};
pkg.build.productName = name;
pkg.build.win = pkg.build.win ?? {};
pkg.build.nsis = pkg.build.nsis ?? {};
pkg.build.nsis.shortcutName = name;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");

console.log(`\n✅ 完成！已写入：应用名=${name}，版本=${version}`);
console.log("\n下一步：");
console.log("  npm start              # 直接体验（弹出应用窗口）");
console.log("  npm run dist           # 打包成安装版 exe（release/）");
console.log("  npm run dist:portable  # 打包成便携版 exe（release/）");
