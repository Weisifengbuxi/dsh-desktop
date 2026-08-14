// selftest.mjs — 独立验证 server.js 的启动/解析/清理逻辑（不需要 Electron）
// 运行：node scripts/selftest.mjs
// 会真实拉起一个 dsh web 服务（默认 npx），拿到 URL 后立刻杀掉。
import { startDshServer } from "../server.js";

console.log("启动 dsh web（端口自动分配）…");
const s = await startDshServer({
  port: "0",
  timeoutMs: 120_000,
  onLog: (line) => console.log("  |", line),
});
console.log("OK，服务已就绪:", s.url);
s.stop();
console.log("已停止服务进程。");
process.exit(0);
