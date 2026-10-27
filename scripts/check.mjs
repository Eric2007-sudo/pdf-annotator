// 静态检查：JS 语法 + import 路径存在性 + manifest 引用的文件存在性。
// 运行：npm run check
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { parse } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "vendor", "dist", ".git"]);

const errors = [];
const warns = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);
const js = files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));

/* 1. 语法检查 */
for (const f of js) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    errors.push(`语法错误: ${relative(root, f)}\n${e.stderr?.toString() || e.message}`);
  }
}

/* 2. import 路径解析 */
const extRoot = pathToFileURL(root + "\\").href; // chrome-extension://模拟
for (const f of js) {
  const src = readFileSync(f, "utf8");
  const re = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith(".") && !spec.startsWith("/")) continue; // 裸模块名跳过
    const target = spec.startsWith("/")
      ? join(root, spec.slice(1))
      : resolve(dirname(f), spec);
    if (!existsSync(target)) errors.push(`找不到模块: ${relative(root, f)} -> ${spec}`);
  }
  void extRoot;
}

/* 3. manifest 引用 */
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const refs = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean);
for (const r of refs) {
  if (!existsSync(join(root, r))) errors.push(`manifest 引用缺失: ${r}`);
}

/* 4. HTML 里引用的脚本/样式 */
for (const f of files.filter((x) => x.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const p = m[1];
    if (/^(https?:|#|mailto:|about:)/.test(p)) continue;
    // 以 / 开头的是扩展根路径
    const target = p.startsWith("/") ? join(root, p.slice(1)) : resolve(dirname(f), p);
    if (!existsSync(target)) errors.push(`HTML 引用缺失: ${relative(root, f)} -> ${p}`);
  }
}

/* 5. vendor 是否就位 */
for (const req of ["vendor/pdfjs/pdf.mjs", "vendor/pdfjs/pdf.worker.mjs", "vendor/epubjs/epub.min.js", "vendor/dompurify/purify.min.js", "vendor/marked/marked.min.js"]) {
  if (!existsSync(join(root, req))) errors.push(`vendor 缺失: ${req}（先运行 npm run vendor）`);
}

/* 输出 */
if (warns.length) console.log("警告:\n" + warns.join("\n"));
if (errors.length) {
  console.error(`\n${errors.length} 个问题:\n\n` + errors.join("\n\n"));
  process.exit(1);
}
console.log(`✓ 检查通过：${js.length} 个 JS 文件，${files.length} 个文件`);
