// 按 manifest 递归收集运行时所需文件，输出到 dist/ 并打 zip。
// 运行：npm run pack
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const stage = join(dist, "extension");

rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 运行时需要的顶层目录
const INCLUDE = [
  "manifest.json",
  "background",
  "reader",
  "sidepanel",
  "shared",
  "options",
  "icons",
  "vendor",
];

for (const item of INCLUDE) {
  const src = join(root, item);
  if (!existsSync(src)) {
    console.warn("缺少:", item);
    continue;
  }
  const dst = join(stage, item);
  if (statSync(src).isDirectory()) cpSync(src, dst, { recursive: true });
  else cpSync(src, dst);
}

const version = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;
const zipPath = join(dist, `pdf-annotator-${version}.zip`);

// 用系统自带能力打 zip（Windows 用 Compress-Archive）
try {
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: stage, stdio: "inherit" });
  }
  console.log("✓ 打包完成:", relative(root, zipPath));
} catch (e) {
  console.warn("打包 zip 失败（扩展目录仍然可用）:", e.message);
}

function countFiles(dir, n = 0) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n = countFiles(p, n);
    else n++;
  }
  return n;
}
console.log("✓ 文件数:", countFiles(stage));
console.log("加载方式：edge://extensions → 开发人员模式 → 加载解压缩的扩展 →", relative(root, stage));

writeFileSync(join(dist, "LOAD.txt"), `把此目录作为"已解压的扩展程序"加载：\n${stage}\n`, "utf8");
