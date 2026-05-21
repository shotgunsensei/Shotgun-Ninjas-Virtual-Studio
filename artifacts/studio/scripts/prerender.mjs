import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = resolve(root, "dist/public");
const serverEntry = resolve(root, "dist/server/entry-server.js");

const { render } = await import(serverEntry);

let template = readFileSync(resolve(publicDir, "index.html"), "utf-8");

const appHtml = render("/");

const html = template.replace(
  '<div id="root"></div>',
  `<div id="root">${appHtml}</div>`,
);

writeFileSync(resolve(publicDir, "index.html"), html);
console.log("Pre-rendered landing page injected into index.html");
