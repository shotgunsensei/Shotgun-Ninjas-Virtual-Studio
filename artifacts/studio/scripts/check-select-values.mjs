import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), "src");
const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    scanFile(path);
  }
}

function addFinding(path, line, text, reason) {
  findings.push({
    file: relative(process.cwd(), path),
    line,
    text: text.trim(),
    reason,
  });
}

function scanFile(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (/<Select(Item|\.Item)\b[^>]*\bvalue=(["'])\2/.test(line)) {
      addFinding(path, lineNo, line, "Select item uses an empty string literal");
    }
    if (/<Select(Item|\.Item)\b[^>]*\bvalue=\{\s*(["'])\2\s*\}/.test(line)) {
      addFinding(path, lineNo, line, "Select item uses an empty string expression");
    }
    if (/\bvalue\s*:\s*(["'])\1/.test(line)) {
      addFinding(path, lineNo, line, "Option-like object uses value: empty string");
    }
  });
}

walk(root);

if (findings.length > 0) {
  console.error("Empty Select values are not allowed. Use src/lib/ui/selectSentinels.ts sentinels instead.");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.reason}`);
    console.error(`  ${finding.text}`);
  }
  process.exit(1);
}

console.log("No empty Radix Select item values found.");
