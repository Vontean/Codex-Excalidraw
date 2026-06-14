#!/usr/bin/env node
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  artifactsDir,
  createSnapshot,
  diffScenes,
  diffSceneFromSnapshot,
  exportSceneAsset,
  exportSceneToExcalidrawUrl,
  getRuntimeConfig,
  isCompatibleHealth,
  inspectSceneFile,
  listBriefTemplates,
  listScenes,
  listSnapshots,
  missingServerCapabilities,
  normalizeSceneName,
  patchSceneFile,
  polishSceneFile,
  projectRoot,
  qaScene,
  readScene,
  restoreSnapshot,
  startServer,
  layoutSceneFile,
  summarizeScene,
  writeScene
} from "../server/server.mjs";
import { createExpressionPlan } from "../server/expression-plan.mjs";
import { runBriefGenerationWorkflow } from "../server/generation-workflow.mjs";
import {
  createLibraryItemElements,
  installOfficialLibrary,
  inspectRegisteredLibrary,
  listLibraryRegistry,
  searchLibraryRegistry,
  searchOfficialLibraries,
  selectLibrariesForBrief,
  validateLibraryRegistry
} from "../server/library-registry.mjs";
import { convertMermaidToScene } from "../server/mermaid-scene.mjs";
import { listMcpTools, startMcpServer } from "../mcp/server.mjs";

function printHelp() {
  console.log(`excalidraw-codex

Usage:
  # Agent canvas bridge
  excalidraw-codex serve [--port 3000] [--host 127.0.0.1] [--open] [--dev]
  excalidraw-codex config [--json]
  excalidraw-codex doctor [--json]
  excalidraw-codex mcp
  excalidraw-codex mcp-config [--json]
  excalidraw-codex open <scene.excalidraw> [--port 3000]

  # Libraries
  excalidraw-codex templates
  excalidraw-codex library list [--json] [--stats]
  excalidraw-codex library search <query> [--json] [--limit 5]
  excalidraw-codex library remote-search <query> [--json] [--limit 10]
  excalidraw-codex library install <official-id|source|exact-name> [--id <local-id>] [--categories a,b] [--keywords a,b] [--dry-run] [--replace]
  excalidraw-codex library select <brief|-> [--json] [--limit 3]
  excalidraw-codex library inspect <id> [--json]
  excalidraw-codex library insert <scene.excalidraw> <library-id> <item-index|item-name> [--x 80] [--y 80] [--scale 1]
  excalidraw-codex library validate [--json]

  # Deterministic file operations
  excalidraw-codex validate <scene.excalidraw>
  excalidraw-codex export <scene.excalidraw> --format png|svg|all [--out <file>] [--require-qa] [--skip-qa]
  excalidraw-codex share <scene.excalidraw> [--dry-run] [--json] [--no-files] [--include-custom-data]
  excalidraw-codex snapshot <scene.excalidraw> [--label <name>] [--keep <count>]
  excalidraw-codex snapshots <scene.excalidraw>
  excalidraw-codex restore <scene.excalidraw> [--from latest|snapshot.excalidraw]
  excalidraw-codex read <scene.excalidraw> [--json]
  excalidraw-codex diff <scene.excalidraw> [--from latest|snapshot.excalidraw] [--json]
  excalidraw-codex inspect <scene.excalidraw> [--from latest|snapshot.excalidraw] [--json]
  excalidraw-codex patch <scene.excalidraw> <plan.json|-> [--dry-run] [--no-snapshot]
  excalidraw-codex batch <scene.excalidraw> <plan.json|-> [--dry-run] [--no-snapshot]
  excalidraw-codex layout <scene.excalidraw> --mode align|distribute|grid [--align middle] [--axis x] [--gap 48] [--dry-run]
  excalidraw-codex polish <scene.excalidraw> [--density compact|normal|loose] [--dry-run]
  excalidraw-codex qa <scene.excalidraw> [--json]
  excalidraw-codex gallery-refresh [scene.excalidraw|--all] [--format png|svg]

  # Legacy quick-draft fallbacks
  excalidraw-codex from-mermaid <input.md|-> --out|--scene <name.excalidraw>
  excalidraw-codex plan <input.txt|-> [--template auto|architecture|product-board|page-flow|wireframe|annotated-ui-map|implementation-plan] [--json]
  excalidraw-codex from-brief <input.txt|-> --out|--scene <name.excalidraw> [--template auto|architecture|product-board|page-flow|wireframe|annotated-ui-map|implementation-plan] [--plan plan.json] [--preview] [--no-polish] [--libraries auto|none]

Scenes are stored in artifacts/excalidraw by default.

Primary agent workflow: use the MCP canvas tools for drawing/read-back, and keep CLI commands for deterministic setup, serving, libraries, export, and file management.`);
}

const COMMAND_USAGE = {
  serve: "Usage: excalidraw-codex serve [--port 3000] [--host 127.0.0.1] [--open] [--dev]\n\nDefault serve mode uses the production build from the package root so it works from any current directory. Use --dev only when editing the workbench itself.",
  "from-mermaid": "Usage: excalidraw-codex from-mermaid <input.md|-> --scene <name.excalidraw>\n       excalidraw-codex from-mermaid <input.md|-> --out ./path/to/file.excalidraw",
  plan: "Usage: excalidraw-codex plan <input.txt|-> [--template auto|architecture|product-board|page-flow|wireframe|annotated-ui-map|implementation-plan] [--json]",
  "from-brief": "Usage: excalidraw-codex from-brief <input.txt|-> --scene <name.excalidraw> [--template auto|architecture|product-board|page-flow|wireframe|annotated-ui-map|implementation-plan] [--preview]\n       excalidraw-codex from-brief <input.txt|-> --out ./path/to/file.excalidraw [--preview]",
  validate: "Usage: excalidraw-codex validate <scene.excalidraw|./path/to/scene.excalidraw>",
  export: "Usage: excalidraw-codex export <scene.excalidraw|./path/to/scene.excalidraw> --format png|svg|all [--out <file>] [--require-qa] [--skip-qa]",
  share: "Usage: excalidraw-codex share <scene.excalidraw|./path/to/scene.excalidraw> [--dry-run] [--json] [--no-files] [--include-custom-data]\n\nUploads an encrypted scene payload to excalidraw.com only when explicitly invoked. Use --dry-run to verify payload generation without upload.",
  snapshot: "Usage: excalidraw-codex snapshot <scene.excalidraw|./path/to/scene.excalidraw> [--label <name>] [--keep <count>]\n\nSnapshots are pruned per scene according to EXCALIDRAW_CODEX_SNAPSHOT_LIMIT or --keep. Use 0 to disable pruning for this command.",
  mcp: "Usage: excalidraw-codex mcp\n\nStarts the Excalidraw Codex MCP server over stdio. Configure Codex or Claude Code to run this command as an MCP server.",
  "mcp-config": "Usage: excalidraw-codex mcp-config [--json]\n\nPrints an MCP config snippet for agents.",
  doctor: "Usage: excalidraw-codex doctor [--json]\n\nChecks local config, MCP tools, library registry, server health, and live canvas API.",
  open: "Usage: excalidraw-codex open <scene.excalidraw> [--port 3000]",
  read: "Usage: excalidraw-codex read <scene.excalidraw|./path/to/scene.excalidraw> [--json]",
  inspect: "Usage: excalidraw-codex inspect <scene.excalidraw|./path/to/scene.excalidraw> [--from latest|snapshot.excalidraw] [--json]",
  qa: "Usage: excalidraw-codex qa <scene.excalidraw|./path/to/scene.excalidraw> [--json]"
};

function readFlag(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

function readAnyFlag(args, names, fallback = undefined) {
  for (const name of names) {
    const value = readFlag(args, name);
    if (value !== undefined) return value;
  }
  return fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function hasHelpFlag(args) {
  return hasFlag(args, "--help") || hasFlag(args, "-h") || hasFlag(args, "help");
}

function printCommandHelp(command) {
  console.log(COMMAND_USAGE[command] || `Usage: excalidraw-codex ${command} --help`);
}

function isPathLike(input) {
  const value = String(input || "");
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\");
}

function readSceneTarget(args, fallbackName) {
  const sceneValue = readFlag(args, "--scene");
  if (sceneValue) {
    if (isPathLike(sceneValue)) {
      throw new Error("--scene expects a scene name stored in the workbench artifacts directory. Use --out for file paths.");
    }
    return {
      sceneName: normalizeSceneName(sceneValue),
      externalOutPath: null
    };
  }
  const outValue = readFlag(args, "--out");
  if (outValue && isPathLike(outValue)) {
    return {
      sceneName: normalizeSceneName(path.basename(outValue)),
      externalOutPath: path.resolve(process.cwd(), outValue)
    };
  }
  return {
    sceneName: normalizeSceneName(outValue || fallbackName),
    externalOutPath: null
  };
}

async function copyArtifactScene(sceneName, externalOutPath) {
  if (!externalOutPath) return path.join(artifactsDir, sceneName);
  await fs.mkdir(path.dirname(externalOutPath), { recursive: true });
  await fs.copyFile(path.join(artifactsDir, sceneName), externalOutPath);
  return externalOutPath;
}

function parseExportFormats(value = "png") {
  const normalized = String(value || "png").trim().toLowerCase();
  if (["all", "both", "png,svg", "svg,png"].includes(normalized)) {
    return ["png", "svg"];
  }
  if (normalized.includes(",")) {
    const formats = normalized
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item === "png" || item === "svg");
    return [...new Set(formats)].length ? [...new Set(formats)] : ["png"];
  }
  return normalized === "svg" ? ["svg"] : ["png"];
}

function positionalArgs(args, flagsWithValues = []) {
  const valueFlags = new Set(flagsWithValues);
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (String(arg).startsWith("--")) {
      continue;
    }
    result.push(arg);
  }
  return result;
}

function readListFlag(args, name) {
  const value = readFlag(args, name);
  if (!value) return undefined;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readInput(inputPath) {
  if (!inputPath || inputPath === "-") {
    return await new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  }
  return fs.readFile(path.resolve(process.cwd(), inputPath), "utf8");
}

const BUILD_REQUIRED_FILES = ["index.html", "export.html", "mermaid.html"];
const BUILD_SOURCE_ENTRIES = [
  "src",
  "index.html",
  "export.html",
  "mermaid.html",
  "vite.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "tsconfig.json",
  "package.json",
  "package-lock.json"
];

async function collectBuildSourceFiles(entry) {
  const absolutePath = path.join(projectRoot, entry);
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isDirectory()) {
    return [{ path: absolutePath, relativePath: entry, mtimeMs: stat.mtimeMs }];
  }
  const names = await fs.readdir(absolutePath);
  const nested = await Promise.all(
    names
      .filter((name) => !name.startsWith("."))
      .map((name) => collectBuildSourceFiles(path.join(entry, name)))
  );
  return nested.flat();
}

async function getBuildStatus() {
  const distDir = path.join(projectRoot, "dist");
  const required = await Promise.all(
    BUILD_REQUIRED_FILES.map(async (file) => {
      const filePath = path.join(distDir, file);
      try {
        const stat = await fs.stat(filePath);
        return { file, path: filePath, exists: true, mtimeMs: stat.mtimeMs };
      } catch (error) {
        if (error?.code === "ENOENT") return { file, path: filePath, exists: false };
        throw error;
      }
    })
  );
  const missing = required.filter((file) => !file.exists).map((file) => file.file);
  const sourceFiles = (await Promise.all(BUILD_SOURCE_ENTRIES.map(collectBuildSourceFiles))).flat();
  const newestSource = sourceFiles.reduce((latest, file) => (
    !latest || file.mtimeMs > latest.mtimeMs ? file : latest
  ), null);
  const existingRequired = required.filter((file) => file.exists);
  const oldestBuild = existingRequired.reduce((oldest, file) => (
    !oldest || file.mtimeMs < oldest.mtimeMs ? file : oldest
  ), null);
  const stale = Boolean(
    missing.length === 0 &&
      newestSource &&
      oldestBuild &&
      newestSource.mtimeMs > oldestBuild.mtimeMs + 1000
  );

  return {
    ok: missing.length === 0 && !stale,
    distDir,
    missing,
    stale,
    sourceCount: sourceFiles.length,
    newestSource: newestSource
      ? {
          path: newestSource.relativePath,
          modifiedAt: new Date(newestSource.mtimeMs).toISOString()
        }
      : undefined,
    oldestBuild: oldestBuild
      ? {
          file: oldestBuild.file,
          modifiedAt: new Date(oldestBuild.mtimeMs).toISOString()
        }
      : undefined
  };
}

async function runBuild(reason) {
  if (reason) {
    console.log(`Building the workbench (${reason})...`);
  }
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed with exit code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function ensureBuild() {
  const status = await getBuildStatus();
  if (status.ok) return status;

  const reason = status.missing.length
    ? `missing ${status.missing.join(", ")}`
    : `source changed after build: ${status.newestSource?.path || "unknown"}`;
  await runBuild(reason);
  return getBuildStatus();
}

function shouldCloseServer(server) {
  return !server?.reused;
}

async function getRenderServer(args, options = {}) {
  const host = options.host || "127.0.0.1";
  const port = Number(readFlag(args, "--port", options.port || 3000));
  return startServer({
    host,
    port,
    fallbackPort: false,
    reuseExisting: true,
    mode: options.mode || "production"
  });
}

async function commandServe(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("serve");
    return;
  }
  const port = Number(readFlag(args, "--port", 3000));
  const host = readFlag(args, "--host", "127.0.0.1");
  const mode = hasFlag(args, "--dev") ? "development" : "production";
  if (mode === "production") {
    const buildStatus = await ensureBuild();
    if (!buildStatus.ok) {
      throw new Error(`Production build is not ready: ${buildStatus.missing.join(", ") || "stale assets"}`);
    }
  }
  const server = await startServer({ host, port, fallbackPort: false, reuseExisting: true, mode });
  console.log(`Excalidraw Codex is ${server.reused ? "already running" : "running"} at ${server.url}`);
  console.log(`Mode: ${mode}`);
  if (server.reused) {
    console.log(`Port ${port} is already serving Excalidraw Codex; reusing it instead of opening another port.`);
  }
  console.log(`Artifacts: ${artifactsDir}`);
  try {
    const health = await fetch(`${server.url}api/health`);
    if (!health.ok) {
      console.error(`Health check returned HTTP ${health.status}.`);
    }
  } catch (error) {
    console.error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (hasFlag(args, "--open")) {
    spawn("open", [server.url], { stdio: "ignore", detached: true }).unref();
  }

  if (server.reused) {
    return;
  }

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

async function commandFromMermaid(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("from-mermaid");
    return;
  }
  const inputPath = args[0];
  if (!inputPath) {
    throw new Error(COMMAND_USAGE["from-mermaid"]);
  }
  const { sceneName: outName, externalOutPath } = readSceneTarget(args, "mermaid-diagram.excalidraw");
  const fontSize = Number(readFlag(args, "--font-size", 24));
  const definition = await readInput(inputPath);

  await ensureBuild();
  const server = await getRenderServer(args);
  try {
    const scene = await convertMermaidToScene(definition, {
      baseUrl: server.url,
      fontSize
    });
    await writeScene(outName, scene);
    console.log(await copyArtifactScene(outName, externalOutPath));
  } finally {
    if (shouldCloseServer(server)) await server.close();
  }
}

async function commandTemplates(args) {
  const templates = listBriefTemplates();
  if (hasFlag(args, "--json")) {
    printJson(templates);
  } else {
    for (const template of templates) {
      console.log(`${template.id}\t${template.name}`);
    }
  }
}

async function readJsonFlag(args, name) {
  const file = readFlag(args, name);
  if (!file) return undefined;
  const raw = await readInput(file);
  return JSON.parse(raw);
}

async function commandPlan(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("plan");
    return;
  }
  const inputPath = args[0];
  if (!inputPath) {
    throw new Error(COMMAND_USAGE.plan);
  }
  const brief = await readInput(inputPath);
  const plan = createExpressionPlan({
    brief,
    title: readFlag(args, "--title"),
    template: readFlag(args, "--template", "auto"),
    expressionPlan: await readJsonFlag(args, "--plan")
  });
  if (hasFlag(args, "--json")) {
    printJson(plan);
    return;
  }
  console.log(`Template\t${plan.template}`);
  console.log(`Intent\t${plan.intent}`);
  console.log(`Language\t${plan.language}`);
  console.log(`Organization\t${plan.visualOrganization}`);
  console.log(`Reading path\t${plan.readingPath}`);
  console.log(`Copy density\t${plan.copyDensity}`);
  console.log(`Components\t${plan.componentLanguage.join(", ")}`);
}

async function commandFromBrief(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("from-brief");
    return;
  }
  const inputPath = args[0];
  if (!inputPath) {
    throw new Error(COMMAND_USAGE["from-brief"]);
  }
  const { sceneName: outName, externalOutPath } = readSceneTarget(args, "brief-diagram.excalidraw");
  const brief = await readInput(inputPath);
  const result = await runBriefGenerationWorkflow({
    brief,
    title: readFlag(args, "--title"),
    template: readFlag(args, "--template", "auto"),
    expressionPlan: await readJsonFlag(args, "--plan"),
    libraries: readFlag(args, "--libraries", "auto"),
    libraryLimit: Number(readFlag(args, "--library-limit", 3)),
    polish: !hasFlag(args, "--no-polish"),
    density: readFlag(args, "--density"),
    preview: false,
    out: outName
  }, {
    writeScene,
    polishSceneFile
  });
  if (hasFlag(args, "--preview")) {
    await ensureBuild();
    const server = await getRenderServer(args);
    try {
      result.preview = await exportSceneAsset(outName, { format: "png", baseUrl: server.url });
    } finally {
      if (shouldCloseServer(server)) await server.close();
    }
  }
  const outputPath = await copyArtifactScene(outName, externalOutPath);
  if (hasFlag(args, "--json")) {
    printJson({
      path: outputPath,
      template: result.template,
      title: result.title,
      elementCount: result.elementCount,
      expressionPlan: result.expressionPlan,
      polished: result.polished,
      libraries: result.libraries,
      preview: result.preview
    });
  } else {
    console.log(outputPath);
    console.error(`Template: ${result.template}; intent: ${result.expressionPlan?.intent || "unknown"}; elements: ${result.elementCount}; polished: ${result.polished ? "yes" : "no"}; libraries: ${result.libraries.map((library) => library.id).join(", ") || "none"}`);
  }
}

function printLibraryRows(libraries) {
  for (const library of libraries) {
    const detail = [
      library.itemCount !== undefined ? `${library.itemCount} items` : null,
      library.score !== undefined ? `score ${library.score}` : null,
      Array.isArray(library.categories) && library.categories.length ? library.categories.join("/") : null
    ].filter(Boolean).join("; ");
    console.log(`${library.id}\t${library.name}${detail ? `\t${detail}` : ""}`);
  }
}

async function commandLibrary(args) {
  const subcommand = args[0] || "list";
  const rest = args.slice(1);
  if (subcommand === "list") {
    const result = await listLibraryRegistry({ includeStats: hasFlag(rest, "--stats") });
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      printLibraryRows(result.libraries);
    }
    return;
  }
  if (subcommand === "search") {
    const query = positionalArgs(rest, ["--limit"]).join(" ");
    const result = await searchLibraryRegistry(query, { limit: Number(readFlag(rest, "--limit", 10)) });
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      printLibraryRows(result);
    }
    return;
  }
  if (subcommand === "remote-search" || subcommand === "search-remote") {
    const query = positionalArgs(rest, ["--limit"]).join(" ");
    const result = await searchOfficialLibraries(query, { limit: Number(readFlag(rest, "--limit", 10)) });
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      for (const library of result.libraries) {
        console.log(`${library.id}\t${library.name}\t${library.author}\tscore ${library.score}`);
      }
    }
    return;
  }
  if (subcommand === "install") {
    const selector = positionalArgs(rest, ["--id", "--categories", "--keywords", "--use-when", "--avoid-when"]).join(" ");
    if (!selector) {
      throw new Error("Usage: excalidraw-codex library install <official-id|source|exact-name>");
    }
    const result = await installOfficialLibrary(selector, {
      id: readFlag(rest, "--id"),
      categories: readListFlag(rest, "--categories"),
      keywords: readListFlag(rest, "--keywords"),
      useWhen: readListFlag(rest, "--use-when"),
      avoidWhen: readListFlag(rest, "--avoid-when"),
      dryRun: hasFlag(rest, "--dry-run"),
      replace: hasFlag(rest, "--replace")
    });
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      const mode = result.dryRun ? "Would install" : result.action === "replace" ? "Reinstalled" : "Installed";
      console.log(`${mode}\t${result.library.id}\t${result.library.name}\t${result.itemCount ?? "unknown"} items`);
      console.log(`Source\t${result.library.path}`);
      console.log(`Preview\t${result.library.preview}`);
    }
    return;
  }
  if (subcommand === "select") {
    const input = rest[0] === "-" || positionalArgs(rest, ["--limit"]).length === 0
      ? await readInput(rest[0])
      : positionalArgs(rest, ["--limit"]).join(" ");
    const result = await selectLibrariesForBrief(input, { limit: Number(readFlag(rest, "--limit", 3)) });
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      printLibraryRows(result);
    }
    return;
  }
  if (subcommand === "inspect") {
    const id = rest[0];
    if (!id) throw new Error("Missing library id.");
    const result = await inspectRegisteredLibrary(id);
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      console.log(`${result.id}\t${result.name}\t${result.itemCount} items`);
      for (const item of result.items || []) {
        console.log(`${item.index}\t${item.name}\t${item.elementCount} elements`);
      }
    }
    return;
  }
  if (subcommand === "insert") {
    const sceneName = rest[0];
    const libraryId = rest[1];
    const itemSelector = rest[2] ?? "0";
    if (!sceneName || !libraryId) {
      throw new Error("Usage: excalidraw-codex library insert <scene.excalidraw> <library-id> <item-index|item-name>");
    }
    const snapshot = hasFlag(rest, "--no-snapshot") ? null : await createSnapshot(sceneName, { label: "before-library-insert" });
    const scene = await readScene(sceneName);
    const insertion = await createLibraryItemElements(libraryId, itemSelector, {
      x: Number(readFlag(rest, "--x", 80)),
      y: Number(readFlag(rest, "--y", 80)),
      scale: Number(readFlag(rest, "--scale", 1))
    });
    scene.elements = Array.isArray(scene.elements) ? scene.elements : [];
    scene.elements.push(...insertion.elements);
    scene.appState = {
      ...(scene.appState || {}),
      codex: {
        ...(scene.appState?.codex || {}),
        libraryInsertions: [
          ...((scene.appState?.codex?.libraryInsertions) || []),
          {
            id: insertion.library.id,
            name: insertion.library.name,
            itemIndex: insertion.item.index,
            itemName: insertion.item.name,
            elementCount: insertion.item.elementCount
          }
        ]
      }
    };
    const fileName = await writeScene(sceneName, scene);
    const result = {
      scene: fileName,
      snapshot,
      library: insertion.library,
      item: insertion.item,
      insertedElementCount: insertion.elements.length
    };
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      console.log(`${fileName}\tinserted ${insertion.item.elementCount} elements from ${insertion.library.id}:${insertion.item.index}`);
    }
    return;
  }
  if (subcommand === "validate") {
    const result = await validateLibraryRegistry();
    if (hasFlag(rest, "--json")) {
      printJson(result);
    } else {
      for (const item of result.results) {
        console.log(`${item.ok ? "OK" : "FAIL"}\t${item.id}\t${item.itemCount ?? 0} items`);
      }
    }
    return;
  }
  throw new Error(`Unknown library command: ${subcommand}`);
}

async function commandValidate(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("validate");
    return;
  }
  const input = args[0];
  if (!input) {
    throw new Error(COMMAND_USAGE.validate);
  }
  const raw = await fs.readFile(resolveScenePath(input), "utf8");
  const scene = JSON.parse(raw);
  const errors = [];
  if (scene.type !== "excalidraw") errors.push("type must be excalidraw");
  if (!Array.isArray(scene.elements)) errors.push("elements must be an array");
  if (scene.files && typeof scene.files !== "object") errors.push("files must be an object");
  if (errors.length) {
    throw new Error(errors.join("; "));
  }
  console.log(`OK ${resolveScenePath(input)}`);
}

async function commandConfig(args) {
  const config = getRuntimeConfig();
  if (hasFlag(args, "--json")) {
    printJson(config);
    return;
  }
  for (const [key, value] of Object.entries(config)) {
    console.log(`${key}\t${value}`);
  }
}

async function commandDoctor(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("doctor");
    return;
  }

  const checks = [];
  const addCheck = (name, ok, details = {}) => {
    checks.push({ name, ok: Boolean(ok), ...details });
  };

  const config = getRuntimeConfig();
  addCheck("config", Boolean(config.packageRoot && config.artifactsDir), {
    packageRoot: config.packageRoot,
    artifactsDir: config.artifactsDir,
    defaultFontFamilyName: config.defaultFontFamilyName,
    snapshotRetentionLimit: config.snapshotRetentionLimit
  });

  try {
    const buildStatus = await getBuildStatus();
    addCheck("build-assets", buildStatus.ok, buildStatus);
  } catch (error) {
    addCheck("build-assets", false, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    const shareDryRun = await exportSceneToExcalidrawUrl({
      type: "excalidraw",
      version: 2,
      source: "https://codex.local/excalidraw-codex-doctor",
      elements: [
        {
          id: "doctor-box",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 220,
          height: 96,
          strokeColor: "#1e1e1e",
          backgroundColor: "#e7f5ff",
          seed: 1,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          groupIds: [],
          boundElements: []
        },
        {
          id: "doctor-label",
          type: "text",
          x: 24,
          y: 32,
          width: 172,
          height: 32,
          text: "Share dry run",
          originalText: "Share dry run",
          fontSize: 20,
          fontFamily: 2,
          strokeColor: "#1e1e1e",
          backgroundColor: "transparent",
          seed: 2,
          version: 1,
          versionNonce: 2,
          isDeleted: false,
          groupIds: [],
          boundElements: [],
          containerId: null,
          lineHeight: 1.25
        }
      ],
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files: {}
    }, {
      dryRun: true,
      includeFiles: false
    });
    addCheck("share-payload", Boolean(shareDryRun.payloadSize && shareDryRun.payloadSha256), {
      dryRun: true,
      elementCount: shareDryRun.elementCount,
      payloadSize: shareDryRun.payloadSize,
      payloadSha256: shareDryRun.payloadSha256
    });
  } catch (error) {
    addCheck("share-payload", false, {
      dryRun: true,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const mcpTools = listMcpTools();
  const requiredMcpTools = [
    "read_diagram_guide",
    "open_or_create_canvas",
    "get_canvas_context",
    "create_view",
    "apply_canvas_patch",
    "review_canvas",
    "snapshot_canvas",
    "restore_snapshot",
    "export_canvas",
    "export_to_excalidraw_url",
    "create_from_mermaid",
  ];
  const missingMcpTools = requiredMcpTools.filter(
    (name) => !mcpTools.some((tool) => tool.name === name)
  );
  addCheck("mcp-workflow-tools", missingMcpTools.length === 0, {
    toolCount: mcpTools.length,
    required: requiredMcpTools,
    missing: missingMcpTools
  });

  try {
    const libraries = await validateLibraryRegistry();
    addCheck("libraries", libraries.ok, {
      count: libraries.count,
      failing: libraries.results.filter((result) => !result.ok).map((result) => result.id)
    });
  } catch (error) {
    addCheck("libraries", false, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const serverUrl = `http://${readFlag(args, "--host", "127.0.0.1")}:${Number(readFlag(args, "--port", 3000))}/`;
  let health = null;
  try {
    const response = await fetch(`${serverUrl}api/health`);
    health = response.ok ? await response.json() : null;
    const missingCapabilities = missingServerCapabilities(health);
    addCheck("server-health", Boolean(health && isCompatibleHealth(health)), {
      url: serverUrl,
      status: response.status,
      serverName: health?.name,
      version: health?.version,
      capabilities: health?.capabilities,
      missingCapabilities
    });
  } catch (error) {
    addCheck("server-health", false, {
      url: serverUrl,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    const response = await fetch(`${serverUrl}api/live-scenes`);
    const live = response.ok ? await response.json() : null;
    addCheck("live-canvas-api", Boolean(response.ok && live?.ok && Array.isArray(live.scenes)), {
      status: response.status,
      liveSceneCount: Array.isArray(live?.scenes) ? live.scenes.length : undefined
    });
  } catch (error) {
    addCheck("live-canvas-api", false, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const result = {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    checks
  };

  if (hasFlag(args, "--json")) {
    printJson(result);
    return;
  }

  console.log(`Excalidraw Codex doctor: ${result.ok ? "OK" : "needs attention"}`);
  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "FAIL"}\t${check.name}`);
    if (!check.ok && check.error) console.log(`  ${check.error}`);
    if (!check.ok && Array.isArray(check.missing) && check.missing.length) console.log(`  Missing: ${check.missing.join(", ")}`);
    if (!check.ok && Array.isArray(check.missingCapabilities) && check.missingCapabilities.length) console.log(`  Missing capabilities: ${check.missingCapabilities.join(", ")}`);
    if (!check.ok && check.stale && check.newestSource?.path) console.log(`  Stale build: ${check.newestSource.path} is newer than ${check.oldestBuild?.file || "dist"}`);
    if (!check.ok && Array.isArray(check.failing) && check.failing.length) console.log(`  Failing: ${check.failing.join(", ")}`);
  }
}

async function commandMcp(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("mcp");
    return;
  }
  await startMcpServer();
}

function mcpConfigSnippet() {
  return {
    mcpServers: {
      "excalidraw-codex": {
        command: "excalidraw-codex",
        args: ["mcp"]
      }
    }
  };
}

async function commandMcpConfig(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("mcp-config");
    return;
  }
  const snippet = mcpConfigSnippet();
  if (hasFlag(args, "--json")) {
    printJson({
      ...snippet,
      tools: listMcpTools().map((tool) => ({
        name: tool.name,
        description: tool.description
      }))
    });
    return;
  }
  console.log(JSON.stringify(snippet, null, 2));
  console.log("");
  console.log("Tools:");
  for (const tool of listMcpTools()) {
    console.log(`- ${tool.name}: ${tool.description}`);
  }
}

function resolveScenePath(input) {
  const absolute = path.resolve(process.cwd(), input);
  if (path.isAbsolute(input) || input.includes(path.sep)) {
    return absolute;
  }
  return path.join(artifactsDir, normalizeSceneName(input));
}

async function readSceneFromInput(input) {
  const raw = await fs.readFile(resolveScenePath(input), "utf8");
  return JSON.parse(raw);
}

async function commandExport(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("export");
    return;
  }
  const input = args[0];
  const formats = parseExportFormats(readFlag(args, "--format", "png"));
  const explicitOutPath = readFlag(args, "--out");
  if (!input) {
    throw new Error("Missing scene path.");
  }
  if (explicitOutPath && formats.length > 1) {
    throw new Error("--out can only be used when exporting a single format.");
  }

  await ensureBuild();

  const inputPath = resolveScenePath(input);
  const sceneName = normalizeSceneName(path.basename(inputPath));
  const targetPath = path.join(artifactsDir, sceneName);
  const externalInput = path.resolve(inputPath) !== path.resolve(targetPath);
  if (externalInput) {
    const raw = await fs.readFile(inputPath, "utf8");
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(targetPath, raw, "utf8");
  }

  if (!hasFlag(args, "--skip-qa")) {
    const exportQa = qaScene(await readSceneFromInput(input), { name: inputPath });
    if (!exportQa.ok) {
      const preview = exportQa.issues
        .slice(0, 4)
        .map((issue) => `${issue.type}: ${issue.message}`)
        .join("; ");
      const message = `QA warning before export: ${preview}`;
      if (hasFlag(args, "--require-qa")) {
        throw new Error(message);
      }
      console.error(message);
    }
  }

  const outputPathFor = (format) =>
    path.resolve(
      process.cwd(),
      explicitOutPath ||
        (externalInput
          ? path.join(path.dirname(inputPath), path.basename(inputPath).replace(/\.excalidraw$/, `.${format}`))
          : path.join(artifactsDir, sceneName.replace(/\.excalidraw$/, `.${format}`)))
    );

  const server = await getRenderServer(args);

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (const format of formats) {
      const outPath = outputPathFor(format);
      await page.goto(
        `${server.url}export.html?scene=${encodeURIComponent(sceneName)}&format=${format}`,
        { waitUntil: "networkidle" }
      );
      await page.waitForFunction(
        () => window.__EXCALIDRAW_EXPORT_RESULT__ || window.__EXCALIDRAW_EXPORT_ERROR__,
        null,
        { timeout: 30000 }
      );
      const error = await page.evaluate(() => window.__EXCALIDRAW_EXPORT_ERROR__);
      if (error) {
        throw new Error(error);
      }
      const result = await page.evaluate(() => window.__EXCALIDRAW_EXPORT_RESULT__);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      if (format === "png") {
        const base64 = result.content.replace(/^data:image\/png;base64,/, "");
        await fs.writeFile(outPath, Buffer.from(base64, "base64"));
      } else {
        await fs.writeFile(outPath, result.content, "utf8");
      }
      console.log(outPath);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    if (shouldCloseServer(server)) await server.close();
  }
}

async function commandShare(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("share");
    return;
  }
  const input = args[0];
  if (!input) {
    throw new Error(COMMAND_USAGE.share);
  }
  const scene = await readSceneFromInput(input);
  const result = await exportSceneToExcalidrawUrl(scene, {
    dryRun: hasFlag(args, "--dry-run"),
    endpoint: readFlag(args, "--endpoint"),
    includeFiles: !hasFlag(args, "--no-files"),
    includeDeleted: hasFlag(args, "--include-deleted"),
    includeCustomData: hasFlag(args, "--include-custom-data")
  });
  const payload = {
    ok: true,
    scene: isPathLike(input) ? resolveScenePath(input) : normalizeSceneName(input),
    share: result
  };
  if (hasFlag(args, "--json")) {
    printJson(payload);
    return;
  }
  if (result.dryRun) {
    console.log(`Dry run OK: ${result.elementCount} elements, ${result.payloadSize} bytes encrypted payload`);
    console.log(`SHA-256: ${result.payloadSha256}`);
    return;
  }
  console.log(result.url);
}

async function commandOpen(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("open");
    return;
  }
  const scene = args[0] ? normalizeSceneName(path.basename(args[0])) : "";
  const port = Number(readFlag(args, "--port", 3000));
  const url = `http://127.0.0.1:${port}/${scene ? `?scene=${encodeURIComponent(scene)}` : ""}`;
  console.log(url);
  if (hasFlag(args, "--system-browser")) {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function formatSummary(summary) {
  const lines = [];
  lines.push(`Scene: ${summary.scene.name || "(unnamed)"}`);
  lines.push(`Elements: ${summary.scene.activeElementCount} active / ${summary.scene.elementCount} total`);
  if (summary.scene.bounds) {
    lines.push(`Bounds: ${summary.scene.bounds.width}x${summary.scene.bounds.height} at ${summary.scene.bounds.x},${summary.scene.bounds.y}`);
  }
  lines.push(`Types: ${Object.entries(summary.elementsByType).map(([type, count]) => `${type}=${count}`).join(", ") || "none"}`);

  if (summary.texts.length) {
    lines.push("");
    lines.push("Text:");
    for (const item of summary.texts.slice(0, 24)) {
      lines.push(`- ${item.text} (${item.type}, ${item.id})`);
    }
    if (summary.texts.length > 24) {
      lines.push(`- ... ${summary.texts.length - 24} more`);
    }
  }

  if (summary.connections.length) {
    lines.push("");
    lines.push("Connections:");
    for (const connection of summary.connections.slice(0, 24)) {
      lines.push(`- ${connection.from || "(unbound)"} -> ${connection.to || "(unbound)"}`);
    }
    if (summary.connections.length > 24) {
      lines.push(`- ... ${summary.connections.length - 24} more`);
    }
  }

  if (summary.groups.length) {
    lines.push("");
    lines.push(`Groups: ${summary.groups.length}`);
  }

  if (summary.layoutIssues.length) {
    lines.push("");
    lines.push("Layout issues:");
    for (const issue of summary.layoutIssues.slice(0, 12)) {
      lines.push(`- ${issue.type}: ${issue.message}`);
    }
  }

  return lines.join("\n");
}

function formatChange(change) {
  if (change.field === "text") {
    return `text "${change.before}" -> "${change.after}"`;
  }
  if (change.field === "position") {
    return `position (${change.before.x},${change.before.y}) -> (${change.after.x},${change.after.y})`;
  }
  if (change.field === "size") {
    return `size ${change.before.width}x${change.before.height} -> ${change.after.width}x${change.after.height}`;
  }
  return `${change.field} ${change.before} -> ${change.after}`;
}

function formatDiff(diff) {
  const lines = [];
  lines.push(`Scene: ${diff.scene}`);
  lines.push(`Compared with: ${diff.comparedWith}`);
  lines.push(`Changes: +${diff.stats.added} -${diff.stats.removed} ~${diff.stats.modified}`);

  if (diff.added.length) {
    lines.push("");
    lines.push("Added:");
    for (const element of diff.added.slice(0, 24)) {
      lines.push(`- ${element.text || element.type} (${element.type}, ${element.id})`);
    }
  }

  if (diff.removed.length) {
    lines.push("");
    lines.push("Removed:");
    for (const element of diff.removed.slice(0, 24)) {
      lines.push(`- ${element.text || element.type} (${element.type}, ${element.id})`);
    }
  }

  if (diff.modified.length) {
    lines.push("");
    lines.push("Modified:");
    for (const element of diff.modified.slice(0, 24)) {
      lines.push(`- ${element.label} (${element.type}, ${element.id}): ${element.changes.map(formatChange).join("; ")}`);
    }
  }

  return lines.join("\n");
}

function formatPatchResult(result) {
  const lines = [];
  lines.push(`Scene: ${result.scene}`);
  lines.push(`Snapshot: ${result.snapshot?.path || "none"}`);
  lines.push(`Dry run: ${result.dryRun ? "yes" : "no"}`);
  lines.push(`Changes: +${result.diff.stats.added} -${result.diff.stats.removed} ~${result.diff.stats.modified}`);
  if (result.report?.length) {
    lines.push("");
    lines.push("Applied:");
    for (const item of result.report) {
      const count =
        (Array.isArray(item.matched) ? item.matched.length : item.matched) ||
        item.added?.length ||
        item.deleted?.length ||
        item.moved ||
        0;
      lines.push(`- ${item.op || item.mode}: ${count} element${count === 1 ? "" : "s"}`);
    }
  }
  if (result.qa?.issueCount) {
    lines.push("");
    lines.push(`QA notes: ${result.qa.issueCount}`);
    for (const issue of result.qa.issues.slice(0, 8)) {
      lines.push(`- ${issue.severity || "warning"} ${issue.type}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

function formatQa(result) {
  const lines = [];
  lines.push(`Scene: ${result.scene}`);
  lines.push(`QA: ${result.ok ? (result.warningCount ? "pass with notes" : "pass") : "needs attention"}`);
  lines.push(`Elements: ${result.summary.activeElementCount}`);
  lines.push(`Text nodes: ${result.summary.textCount}`);
  lines.push(`Connections: ${result.summary.connectionCount}`);
  if (result.blockingIssueCount !== undefined || result.warningCount !== undefined) {
    lines.push(`Blocking: ${result.blockingIssueCount || 0}; warnings: ${result.warningCount || 0}`);
  }
  if (result.issueCount) {
    lines.push("");
    lines.push("Notes:");
    for (const issue of result.issues.slice(0, 16)) {
      lines.push(`- ${issue.severity || "warning"} ${issue.type}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

function formatInspect(result) {
  const lines = [];
  lines.push(`Scene: ${result.scene}`);
  lines.push(`Inspected: ${result.inspectedAt}`);
  lines.push(`Elements: ${result.summary.scene.activeElementCount}`);
  lines.push(`Text nodes: ${result.summary.texts.length}`);
  lines.push(`Connections: ${result.summary.connections.length}`);
  if (result.diff) {
    lines.push(`Changes from snapshot: +${result.diff.stats.added} -${result.diff.stats.removed} ~${result.diff.stats.modified}`);
  } else {
    lines.push(`Changes from snapshot: unavailable (${result.diffError})`);
  }

  if (result.takeaways.length) {
    lines.push("");
    lines.push("Takeaways:");
    for (const takeaway of result.takeaways) {
      lines.push(`- ${takeaway}`);
    }
  }

  if (result.summary.texts.length) {
    lines.push("");
    lines.push("Visible labels:");
    for (const item of result.summary.texts.slice(0, 16)) {
      lines.push(`- ${item.text}`);
    }
  }

  if (result.nextActions.length) {
    lines.push("");
    lines.push("Next actions:");
    for (const action of result.nextActions) {
      lines.push(`- ${action}`);
    }
  }

  return lines.join("\n");
}

async function readJsonPlan(inputPath) {
  const raw = await readInput(inputPath);
  return JSON.parse(raw);
}

async function commandSnapshot(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("snapshot");
    return;
  }
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const snapshot = await createSnapshot(input, {
    label: readFlag(args, "--label", ""),
    keep: readFlag(args, "--keep", undefined)
  });
  if (hasFlag(args, "--json")) {
    printJson(snapshot);
  } else {
    console.log(snapshot.path);
    if (snapshot.prunedSnapshots?.length) {
      console.error(`Pruned ${snapshot.prunedSnapshots.length} old snapshot(s).`);
    }
  }
}

async function commandSnapshots(args) {
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const snapshots = await listSnapshots(input);
  if (hasFlag(args, "--json")) {
    printJson(snapshots);
  } else if (!snapshots.length) {
    console.log(`No snapshots for ${normalizeSceneName(input)}`);
  } else {
    for (const snapshot of snapshots) {
      console.log(`${snapshot.name}\t${snapshot.path}`);
    }
  }
}

async function commandRestore(args) {
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const restored = await restoreSnapshot(input, readFlag(args, "--from", "latest"));
  if (hasFlag(args, "--json")) {
    printJson(restored);
  } else {
    console.log(restored.path);
  }
}

async function commandRead(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("read");
    return;
  }
  const input = args[0];
  if (!input) {
    throw new Error(COMMAND_USAGE.read);
  }
  const scenePathLabel = isPathLike(input) ? resolveScenePath(input) : normalizeSceneName(path.basename(input));
  const summary = summarizeScene(await readSceneFromInput(input), { name: scenePathLabel });
  if (hasFlag(args, "--json")) {
    printJson(summary);
  } else {
    console.log(formatSummary(summary));
  }
}

async function commandDiff(args) {
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const diff = await diffSceneFromSnapshot(input, readFlag(args, "--from", "latest"));
  if (hasFlag(args, "--json")) {
    printJson(diff);
  } else {
    console.log(formatDiff(diff));
  }
}

async function commandInspect(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("inspect");
    return;
  }
  const input = args[0];
  if (!input) {
    throw new Error(COMMAND_USAGE.inspect);
  }
  let result;
  if (isPathLike(input)) {
    const inputPath = resolveScenePath(input);
    const scene = await readSceneFromInput(input);
    const summary = summarizeScene(scene, { name: inputPath });
    let diff = null;
    let diffError = "External path inspection has no artifact snapshot unless --from is provided.";
    const reference = readFlag(args, "--from");
    if (reference) {
      try {
        const previous = await readSceneFromInput(reference);
        diff = diffScenes(previous, scene, {
          name: inputPath,
          comparedWith: resolveScenePath(reference)
        });
        diffError = undefined;
      } catch (error) {
        diffError = error instanceof Error ? error.message : String(error);
      }
    }
    result = {
      scene: inputPath,
      inspectedAt: new Date().toISOString(),
      summary,
      diff,
      diffError,
      takeaways: diff
        ? ["External file compared with the provided reference."]
        : ["Current-state inspection for an external scene file."],
      nextActions: summary.layoutIssues.length
        ? ["Review QA notes before exporting or sharing."]
        : ["Use this scene as the current editable source."]
    };
  } else {
    result = await inspectSceneFile(input, { from: readFlag(args, "--from", "latest") });
  }
  if (hasFlag(args, "--json")) {
    printJson(result);
  } else {
    console.log(formatInspect(result));
  }
}

async function commandPatch(args) {
  const input = args[0];
  const planPath = args[1] || "-";
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const result = await patchSceneFile(input, await readJsonPlan(planPath), {
    dryRun: hasFlag(args, "--dry-run"),
    snapshot: !hasFlag(args, "--no-snapshot"),
    label: readFlag(args, "--label", "before-cli-patch")
  });
  if (hasFlag(args, "--json")) {
    printJson(result);
  } else {
    console.log(formatPatchResult(result));
  }
}

async function commandLayout(args) {
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const planPath = readFlag(args, "--plan");
  const plan = planPath
    ? await readJsonPlan(planPath)
    : {
        mode: readFlag(args, "--mode", "align"),
        align: readFlag(args, "--align", readFlag(args, "--to", "middle")),
        axis: readFlag(args, "--axis", "x"),
        gap: Number(readFlag(args, "--gap", 48)),
        columns: Number(readFlag(args, "--columns", 3))
      };
  const result = await layoutSceneFile(input, plan, {
    dryRun: hasFlag(args, "--dry-run"),
    snapshot: !hasFlag(args, "--no-snapshot"),
    label: readFlag(args, "--label", "before-cli-layout")
  });
  if (hasFlag(args, "--json")) {
    printJson(result);
  } else {
    console.log(formatPatchResult(result));
  }
}

async function commandPolish(args) {
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const plan = {
    density: readFlag(args, "--density", "normal"),
    itemGap: readFlag(args, "--item-gap") ? Number(readFlag(args, "--item-gap")) : undefined,
    labelPadding: readFlag(args, "--label-padding") ? Number(readFlag(args, "--label-padding")) : undefined,
    containerPadding: readFlag(args, "--container-padding") ? Number(readFlag(args, "--container-padding")) : undefined,
    rowTolerance: readFlag(args, "--row-tolerance") ? Number(readFlag(args, "--row-tolerance")) : undefined
  };
  const result = await polishSceneFile(input, plan, {
    dryRun: hasFlag(args, "--dry-run"),
    snapshot: !hasFlag(args, "--no-snapshot"),
    label: readFlag(args, "--label", "before-cli-polish")
  });
  if (hasFlag(args, "--json")) {
    printJson(result);
  } else {
    console.log(formatPatchResult(result));
  }
}

async function commandQa(args) {
  if (hasHelpFlag(args)) {
    printCommandHelp("qa");
    return;
  }
  const input = args[0];
  if (!input) {
    throw new Error(COMMAND_USAGE.qa);
  }
  const scenePathLabel = isPathLike(input) ? resolveScenePath(input) : normalizeSceneName(path.basename(input));
  const result = qaScene(await readSceneFromInput(input), { name: scenePathLabel });
  if (hasFlag(args, "--json")) {
    printJson(result);
  } else {
    console.log(formatQa(result));
  }
}

async function commandGalleryRefresh(args) {
  const input = args[0];
  const format = readFlag(args, "--format", "png") === "svg" ? "svg" : "png";
  await ensureBuild();
  const server = await getRenderServer(args);
  try {
    const sceneNames =
      !input || input === "--all" || hasFlag(args, "--all")
        ? (await listScenes()).map((scene) => scene.name)
        : [normalizeSceneName(path.basename(input))];
    const results = [];
    for (const sceneName of sceneNames) {
      results.push(await exportSceneAsset(sceneName, { format, baseUrl: server.url }));
    }
    if (hasFlag(args, "--json")) {
      printJson(results);
    } else {
      for (const result of results) {
        console.log(result.path);
      }
    }
  } finally {
    if (shouldCloseServer(server)) await server.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "serve") return commandServe(args);
  if (command === "from-mermaid") return commandFromMermaid(args);
  if (command === "plan") return commandPlan(args);
  if (command === "from-brief") return commandFromBrief(args);
  if (command === "templates") return commandTemplates(args);
  if (command === "library" || command === "libraries") return commandLibrary(args);
  if (command === "validate") return commandValidate(args);
  if (command === "config") return commandConfig(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "mcp") return commandMcp(args);
  if (command === "mcp-config") return commandMcpConfig(args);
  if (command === "export") return commandExport(args);
  if (command === "share") return commandShare(args);
  if (command === "open") return commandOpen(args);
  if (command === "snapshot") return commandSnapshot(args);
  if (command === "snapshots") return commandSnapshots(args);
  if (command === "restore") return commandRestore(args);
  if (command === "read") return commandRead(args);
  if (command === "diff") return commandDiff(args);
  if (command === "inspect") return commandInspect(args);
  if (command === "patch") return commandPatch(args);
  if (command === "batch") return commandPatch(args);
  if (command === "layout") return commandLayout(args);
  if (command === "polish") return commandPolish(args);
  if (command === "qa") return commandQa(args);
  if (command === "gallery-refresh") return commandGalleryRefresh(args);

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
