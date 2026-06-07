#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const configDir = path.join(os.homedir(), ".codex-excalidraw");
const configPath = path.join(configDir, "config.json");
const skillName = "excalidraw-diagram";

function hasFlag(name) {
  return process.argv.includes(name);
}

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: process.env,
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function copySkill(targetRoot) {
  const source = path.join(repoRoot, "skills", skillName);
  const target = path.join(targetRoot, "skills", skillName);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true });
  return target;
}

async function install() {
  const workspaceRoot = path.resolve(expandHome(readFlag("--workspace", repoRoot)));
  const artifactsDir = path.resolve(
    expandHome(readFlag("--artifacts", path.join(workspaceRoot, "artifacts", "excalidraw")))
  );
  const defaultFontFamily = readFlag("--font", process.env.EXCALIDRAW_CODEX_FONT || "Nunito");
  const agents = readFlag("--agents", "codex,claude")
    .split(",")
    .map((agent) => agent.trim().toLowerCase())
    .filter(Boolean);

  console.log("Installing npm dependencies...");
  await run("npm", ["install"]);

  if (!hasFlag("--skip-playwright")) {
    console.log("Installing Playwright Chromium...");
    await run("npx", ["playwright", "install", "chromium"]);
  }

  console.log("Building the workbench...");
  await run("npm", ["run", "build"]);

  if (!hasFlag("--skip-link")) {
    console.log("Linking the excalidraw-codex CLI...");
    await run("npm", ["link"]);
  }

  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        workspaceRoot,
        artifactsDir,
        defaultFontFamily,
        installedFrom: repoRoot,
        cli: "excalidraw-codex",
        mcp: {
          command: "excalidraw-codex",
          args: ["mcp"]
        },
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const installedSkills = [];
  if (agents.includes("codex")) {
    installedSkills.push(await copySkill(path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"))));
  }
  if (agents.includes("claude")) {
    installedSkills.push(await copySkill(path.resolve(process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"))));
  }

  if (hasFlag("--verify")) {
    console.log("Running smoke verification...");
    await run("npm", ["run", "test"]);
  }

  console.log("");
  console.log("Codex Excalidraw is installed.");
  console.log(`Config: ${configPath}`);
  console.log(`Artifacts: ${artifactsDir}`);
  console.log(`Default font: ${defaultFontFamily}`);
  for (const skill of installedSkills) {
    console.log(`Skill: ${skill}`);
  }
  console.log("");
  console.log("Try:");
  console.log("  excalidraw-codex serve");
  console.log("  excalidraw-codex doctor");
  console.log("  excalidraw-codex mcp-config");
  console.log("  excalidraw-codex config");
  console.log("  npm run verify");
}

install().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
