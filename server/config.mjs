import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const packageRoot = path.resolve(__dirname, "..");
export const configDir = expandPath(process.env.EXCALIDRAW_CODEX_CONFIG_DIR || path.join(os.homedir(), ".codex-excalidraw"));
export const configPath = path.join(configDir, "config.json");

function expandPath(value) {
  const text = String(value || "");
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function readConfigFile() {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    return {};
  }
}

function resolveConfiguredPath(value, fallback) {
  return path.resolve(expandPath(value || fallback));
}

const config = readConfigFile();

export const workspaceRoot = resolveConfiguredPath(
  process.env.EXCALIDRAW_CODEX_HOME || config.workspaceRoot,
  packageRoot
);

export const artifactsDir = resolveConfiguredPath(
  process.env.EXCALIDRAW_CODEX_ARTIFACTS_DIR || config.artifactsDir,
  path.join(workspaceRoot, "artifacts", "excalidraw")
);

export const snapshotsDir = path.join(artifactsDir, ".snapshots");

export function getRuntimeConfig() {
  return {
    packageRoot,
    workspaceRoot,
    artifactsDir,
    snapshotsDir,
    configDir,
    configPath,
    hasConfigFile: Object.keys(config).length > 0
  };
}
