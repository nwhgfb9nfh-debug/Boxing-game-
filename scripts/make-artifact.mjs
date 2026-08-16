// Strips the doctype/html/head/body wrapper off the single-file build so
// the result is bare content suitable for the Artifact tool, which supplies
// its own <!doctype>/<head>/<body> skeleton at publish time.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node make-artifact.mjs <in.html> <out.html>");
  process.exit(1);
}

const html = readFileSync(inPath, "utf8");

const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? "";

// Drop the charset meta (artifact skeleton sets its own); keep everything else
// (title, viewport meta, inlined <style>, inlined <script>).
const headContent = head.replace(/<meta charset="UTF-8"\s*\/?>\s*/i, "").trim();

const out = `${headContent}\n${body.trim()}\n`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${out.length} bytes)`);
