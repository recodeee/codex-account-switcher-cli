import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJsonPath = resolve(process.cwd(), "package.json");
const publicDir = resolve(process.cwd(), "public");
const versionOutputPath = resolve(publicDir, "version.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = typeof packageJson.version === "string" && packageJson.version.trim().length > 0
  ? packageJson.version.trim()
  : "0.0.0";

mkdirSync(publicDir, { recursive: true });
writeFileSync(versionOutputPath, JSON.stringify({ version }, null, 2) + "\n", "utf8");
