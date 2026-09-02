import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargoToml = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const app = read("src/App.tsx");
const expected = packageJson.version;

const cargoTomlVersion = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLockVersion = cargoLock.match(/\[\[package\]\]\r?\nname = "efi-forge"\r?\nversion = "([^"]+)"/)?.[1];
const observed = new Map([
  ["package-lock.json root", packageLock.version],
  ["package-lock.json workspace", packageLock.packages?.[""]?.version],
  ["src-tauri/tauri.conf.json", tauri.version],
  ["src-tauri/Cargo.toml", cargoTomlVersion],
  ["src-tauri/Cargo.lock", cargoLockVersion],
]);

const mismatches = [...observed].filter(([, version]) => version !== expected);
for (const required of [
  `const appVersion = "${expected}"`,
  `ALPHA ${expected}`,
  `EFI Forge v${expected}-dev`,
]) {
  if (!app.includes(required)) mismatches.push(["src/App.tsx", `missing ${required}`]);
}

if (mismatches.length > 0) {
  const details = mismatches.map(([file, value]) => `${file}: ${value ?? "missing"}`).join("\n");
  throw new Error(`Version synchronization failed; expected ${expected}:\n${details}`);
}

console.log(`Version synchronization passed: ${expected}`);
