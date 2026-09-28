// Stamps the service worker template with this build's id and writes
// public/sw.js (gitignored). Runs before every `dev` and `build` (see
// package.json's predev/prebuild). Ported from the Bill-a project.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12);

const template = fs.readFileSync(path.join(root, "scripts", "sw.template.js"), "utf8");
if (!template.includes("__BUILD_ID__")) {
  throw new Error("build-sw: template placeholder missing");
}
fs.writeFileSync(path.join(root, "public", "sw.js"), template.replaceAll("__BUILD_ID__", buildId));
console.log(`build-sw: public/sw.js (build ${buildId})`);
