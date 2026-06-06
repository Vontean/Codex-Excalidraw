#!/usr/bin/env node
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  artifactsDir,
  createSnapshot,
  diffSceneFromSnapshot,
  exportSceneAsset,
  generateSceneFromBrief,
  getRuntimeConfig,
  inspectSceneFile,
  listBriefTemplates,
  listScenes,
  listSnapshots,
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

const SCENE_SOURCE = "https://codex.local/excalidraw-codex";

function printHelp() {
  console.log(`excalidraw-codex

Usage:
  excalidraw-codex serve [--port 3000] [--host 127.0.0.1] [--open]
  excalidraw-codex from-mermaid <input.md|-> --out <name.excalidraw>
  excalidraw-codex from-brief <input.txt|-> --out <name.excalidraw> [--template auto|architecture|product-board|page-flow|wireframe|implementation-plan] [--preview] [--no-polish] [--libraries auto|none]
  excalidraw-codex templates
  excalidraw-codex library list [--json] [--stats]
  excalidraw-codex library search <query> [--json] [--limit 5]
  excalidraw-codex library remote-search <query> [--json] [--limit 10]
  excalidraw-codex library install <official-id|source|exact-name> [--id <local-id>] [--categories a,b] [--keywords a,b] [--dry-run] [--replace]
  excalidraw-codex library select <brief|-> [--json] [--limit 3]
  excalidraw-codex library inspect <id> [--json]
  excalidraw-codex library insert <scene.excalidraw> <library-id> <item-index|item-name> [--x 80] [--y 80] [--scale 1]
  excalidraw-codex library validate [--json]
  excalidraw-codex validate <scene.excalidraw>
  excalidraw-codex config [--json]
  excalidraw-codex export <scene.excalidraw> --format png|svg|all [--out <file>] [--require-qa] [--skip-qa]
  excalidraw-codex open <scene.excalidraw> [--port 3000]
  excalidraw-codex snapshot <scene.excalidraw> [--label <name>]
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

Scenes are stored in artifacts/excalidraw by default.`);
}

function readFlag(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
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

async function ensureBuild() {
  const required = ["index.html", "export.html", "mermaid.html"];
  try {
    await Promise.all(required.map((file) => fs.access(path.join(projectRoot, "dist", file))));
  } catch {
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
}

function createScene(elements, files = {}, appState = {}) {
  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      currentItemFontFamily: 1,
      ...appState
    },
    files
  };
}

async function commandServe(args) {
  const port = Number(readFlag(args, "--port", 3000));
  const host = readFlag(args, "--host", "127.0.0.1");
  const server = await startServer({ host, port, fallbackPort: port === 3000 ? 3001 : port + 1 });
  console.log(`Excalidraw Codex is running at ${server.url}`);
  console.log(`Artifacts: ${artifactsDir}`);

  if (hasFlag(args, "--open")) {
    spawn("open", [server.url], { stdio: "ignore", detached: true }).unref();
  }

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

async function commandFromMermaid(args) {
  const inputPath = args[0];
  const outName = normalizeSceneName(readFlag(args, "--out", "mermaid-diagram.excalidraw"));
  const fontSize = Number(readFlag(args, "--font-size", 24));
  const definition = await readInput(inputPath);

  await ensureBuild();
  const server = await startServer({
    host: "127.0.0.1",
    port: Number(readFlag(args, "--port", 3000)),
    fallbackPort: 3001,
    mode: "production"
  });
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.goto(`${server.url}mermaid.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__convertMermaidToExcalidraw__), null, {
      timeout: 30000
    });
    const parsed = await page.evaluate(
      async ({ source, size }) => window.__convertMermaidToExcalidraw__(source, size),
      { source: definition, size: fontSize }
    );
    const scene = createScene(parsed.elements, parsed.files ?? {}, {
      codex: {
        generator: "from-mermaid",
        elementsKind: "skeleton",
        mermaidDefinition: definition
      }
    });
    await writeScene(outName, scene);
    console.log(path.join(artifactsDir, outName));
  } finally {
    if (browser) {
      await browser.close();
    }
    await server.close();
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

async function commandFromBrief(args) {
  const inputPath = args[0];
  const outName = normalizeSceneName(readFlag(args, "--out", "brief-diagram.excalidraw"));
  const brief = await readInput(inputPath);
  const generated = generateSceneFromBrief({
    brief,
    title: readFlag(args, "--title"),
    template: readFlag(args, "--template", "auto")
  });
  let selectedLibraries = [];
  if (readFlag(args, "--libraries", "auto") !== "none") {
    selectedLibraries = await selectLibrariesForBrief(brief, {
      limit: Number(readFlag(args, "--library-limit", 3))
    });
    generated.scene.appState.codex = {
      ...(generated.scene.appState.codex || {}),
      libraries: selectedLibraries.map(({ id, name, score, reasons }) => ({ id, name, score, reasons }))
    };
  }
  await writeScene(outName, generated.scene);
  let polish;
  if (!hasFlag(args, "--no-polish")) {
    polish = await polishSceneFile(outName, { density: readFlag(args, "--density", "normal") }, {
      snapshot: false,
      label: "after-from-brief"
    });
  }
  const outputPath = path.join(artifactsDir, outName);
  if (hasFlag(args, "--preview")) {
    await ensureBuild();
    const server = await startServer({
      host: "127.0.0.1",
      port: Number(readFlag(args, "--port", 3000)),
      fallbackPort: 3001,
      mode: "production"
    });
    try {
      await exportSceneAsset(outName, { format: "png", baseUrl: server.url });
    } finally {
      await server.close();
    }
  }
  if (hasFlag(args, "--json")) {
    printJson({
      path: outputPath,
      template: generated.template,
      title: generated.title,
      elementCount: generated.elementCount,
      polished: Boolean(polish),
      libraries: selectedLibraries
    });
  } else {
    console.log(outputPath);
    console.error(`Template: ${generated.template}; elements: ${generated.elementCount}; polished: ${polish ? "yes" : "no"}; libraries: ${selectedLibraries.map((library) => library.id).join(", ") || "none"}`);
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
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
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
  if (path.resolve(inputPath) !== path.resolve(targetPath)) {
    const raw = await fs.readFile(inputPath, "utf8");
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(targetPath, raw, "utf8");
  }

  if (!hasFlag(args, "--skip-qa")) {
    const exportQa = qaScene(await readSceneFromInput(targetPath), { name: sceneName });
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
      explicitOutPath || path.join(artifactsDir, sceneName.replace(/\.excalidraw$/, `.${format}`))
    );

  const server = await startServer({
    host: "127.0.0.1",
    port: Number(readFlag(args, "--port", 3000)),
    fallbackPort: 3001,
    mode: "production"
  });

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
    await server.close();
  }
}

async function commandOpen(args) {
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
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const snapshot = await createSnapshot(input, { label: readFlag(args, "--label", "") });
  if (hasFlag(args, "--json")) {
    printJson(snapshot);
  } else {
    console.log(snapshot.path);
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
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const fileName = normalizeSceneName(path.basename(input));
  const summary = summarizeScene(await readSceneFromInput(input), { name: fileName });
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
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const result = await inspectSceneFile(input, { from: readFlag(args, "--from", "latest") });
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
  const input = args[0];
  if (!input) {
    throw new Error("Missing scene path.");
  }
  const fileName = normalizeSceneName(path.basename(input));
  const result = qaScene(await readSceneFromInput(input), { name: fileName });
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
  const server = await startServer({
    host: "127.0.0.1",
    port: Number(readFlag(args, "--port", 3000)),
    fallbackPort: 3001,
    mode: "production"
  });
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
    await server.close();
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
  if (command === "from-brief") return commandFromBrief(args);
  if (command === "templates") return commandTemplates(args);
  if (command === "library" || command === "libraries") return commandLibrary(args);
  if (command === "validate") return commandValidate(args);
  if (command === "config") return commandConfig(args);
  if (command === "export") return commandExport(args);
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
