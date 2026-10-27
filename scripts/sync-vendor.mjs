// Copies third-party libs from node_modules into vendor/.
// Run: npm run vendor
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const out = join(root, "vendor");

const files = [
  ["pdfjs-dist/build/pdf.mjs", "pdfjs/pdf.mjs"],
  ["pdfjs-dist/build/pdf.worker.mjs", "pdfjs/pdf.worker.mjs"],
  ["pdfjs-dist/build/pdf.sandbox.mjs", "pdfjs/pdf.sandbox.mjs"],
  ["pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["epubjs/dist/epub.min.js", "epubjs/epub.min.js"],
  ["dompurify/dist/purify.min.js", "dompurify/purify.min.js"],
  ["marked/marked.min.js", "marked/marked.min.js"],
];

import { cpSync, existsSync, statSync } from "node:fs";

mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = join(nm, from);
  const dst = join(out, to);
  if (!existsSync(src)) {
    console.warn("  skip (missing):", from);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  if (statSync(src).isDirectory()) cpSync(src, dst, { recursive: true });
  else copyFileSync(src, dst);
  console.log("  vendor:", to);
}
console.log("done.");
