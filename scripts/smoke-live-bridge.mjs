#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { launchRenderBrowser } from "../server/browser-runtime.mjs";
import { deleteScene, writeScene } from "../server/scene-workspace.mjs";
import { startServer } from "../server/server.mjs";

const scene = "smoke-live-bridge.excalidraw";
const missingFirstScene = "smoke-live-missing-first.excalidraw";
const renameSourceScene = "smoke-live-rename-source.excalidraw";
const renameTargetScene = "smoke-live-rename-target.excalidraw";
const renameTargetDisplayName = "smoke-live-rename-target";
const baseUrl = "http://127.0.0.1:3000/";

async function cleanup() {
  for (const name of [scene, missingFirstScene, renameSourceScene, renameTargetScene]) {
    try {
      await fetch(`${baseUrl}api/live-scenes/${name}`, { method: "DELETE" });
    } catch {
      // Ignore cleanup when the server is not reachable.
    }
    try {
      await deleteScene(name);
    } catch {
      // Ignore missing smoke artifacts.
    }
  }
}

async function waitForBrowserReady(sceneName) {
  const deadline = Date.now() + 8000;
  let lastState = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}api/live-scenes/${sceneName}/status`);
    if (response.ok) {
      const status = await response.json();
      lastState = status;
      if (status?.browserReady && status?.subscriberCount > 0) {
        return status;
      }
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for browser-ready scene subscription: ${JSON.stringify(lastState)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeMcpTransport(transport) {
  try {
    void transport.close?.();
  } catch {
    // The smoke process exits explicitly after cleanup.
  }
}

async function waitForNodeLiveScene() {
  const deadline = Date.now() + 8000;
  let lastState = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}api/live-scenes/${scene}?includeScene=true`);
    if (response.ok) {
      const live = await response.json();
      lastState = live;
      if (
        live?.source === "workbench" &&
        live?.activeElementCount === 1 &&
        live?.sceneData?.type === "excalidraw" &&
        Array.isArray(live.sceneData.elements)
      ) {
        return live;
      }
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for Node live scene payload: ${JSON.stringify(lastState)}`);
}

async function waitForLiveSceneSource(sceneName, allowedSources) {
  const expected = new Set(allowedSources);
  const deadline = Date.now() + 8000;
  let lastState = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}api/live-scenes/${sceneName}?includeScene=true`);
    if (response.ok) {
      const live = await response.json();
      lastState = live;
      if (expected.has(live?.source)) {
        return live;
      }
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for live scene source ${allowedSources.join("/")}: ${JSON.stringify(lastState)}`);
}

async function waitForCurrentScene(sceneName) {
  const deadline = Date.now() + 8000;
  let lastState = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}api/current-scene`);
    if (response.ok) {
      const current = await response.json();
      lastState = current;
      if (current?.active && current?.scene === sceneName) {
        return current;
      }
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for current scene ${sceneName}: ${JSON.stringify(lastState)}`);
}

function textElement(id, text, x, y) {
  return {
    id,
    type: "text",
    x,
    y,
    width: 520,
    height: 44,
    text,
    originalText: text,
    fontSize: 32,
    fontFamily: 6,
    textAlign: "left",
    verticalAlign: "top",
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false
  };
}

async function main() {
  const server = await startServer({
    host: "127.0.0.1",
    port: 3000,
    fallbackPort: false,
    reuseExisting: true,
    mode: "production"
  });

  await cleanup();
  await writeScene(scene, {
    type: "excalidraw",
    version: 2,
    source: "smoke-live-bridge",
    elements: [textElement("smoke-live-title", "Live bridge smoke", 80, 80)],
    appState: { viewBackgroundColor: "#ffffff", currentItemFontFamily: 6 },
    files: {}
  });

  const browser = await launchRenderBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const client = new Client({ name: "codex-excalidraw-smoke-live", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["./bin/excalidraw-codex.mjs", "mcp"],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  try {
    await page.goto(`${baseUrl}?scene=${encodeURIComponent(scene)}`, { waitUntil: "domcontentloaded" });
    await waitForCurrentScene(scene);
    await page.waitForFunction(async (sceneName) => {
      const response = await fetch(`/api/live-scenes/${sceneName}`);
      if (!response.ok) return false;
      const live = await response.json();
      return live?.source === "workbench" && live?.activeElementCount === 1;
    }, scene, { timeout: 8000 });
    await waitForNodeLiveScene();

    await client.connect(transport);
    const before = await client.callTool({ name: "get_canvas_context", arguments: {} });
    const beforeJson = JSON.parse(before.content[0].text);
    if (beforeJson.scene !== scene || beforeJson.source !== "live") {
      throw new Error(`Expected MCP to read the active live canvas, got ${JSON.stringify({ scene: beforeJson.scene, source: beforeJson.source })}`);
    }

    const patchResult = JSON.parse((await client.callTool({
      name: "apply_canvas_patch",
      arguments: {
        scene,
        operations: [
          {
            op: "add",
            elements: [
              { id: "smoke-mcp-box", type: "rectangle", x: 80, y: 160, width: 340, height: 110, backgroundColor: "#e7f5ff" },
              { id: "smoke-mcp-label", type: "text", x: 108, y: 198, width: 280, height: 32, text: "MCP pushed update", fontSize: 22 }
            ]
          }
        ]
      }
    })).content[0].text);
    if (patchResult.preview !== undefined) {
      throw new Error(`MCP patch refreshed a preview during a stage write: ${JSON.stringify(patchResult.preview)}`);
    }

    await waitForLiveSceneSource(scene, ["mcp"]);
    const previewBeforeExport = await page.evaluate((sceneName) => {
      const pngName = sceneName.replace(/\.excalidraw$/, ".png");
      return Array.from(document.querySelectorAll(".gallery-preview img")).some((image) =>
        decodeURIComponent(image.getAttribute("src") || "").includes(pngName)
      );
    }, scene);
    if (previewBeforeExport) {
      throw new Error("Gallery preview appeared before final export.");
    }

    const patchExport = JSON.parse((await client.callTool({
      name: "export_canvas",
      arguments: { scene, format: "png" }
    })).content[0].text);
    if (!patchExport.exports?.[0]?.size) {
      throw new Error(`export_canvas did not create a final PNG preview: ${JSON.stringify(patchExport)}`);
    }
    await waitForLiveSceneSource(scene, ["mcp-export"]);
    await page.waitForFunction((sceneName) => {
      const pngName = sceneName.replace(/\.excalidraw$/, ".png");
      return Array.from(document.querySelectorAll(".gallery-preview img")).some((image) =>
        decodeURIComponent(image.getAttribute("src") || "").includes(pngName)
      );
    }, scene, { timeout: 8000 });

    const liveResponse = await fetch(`${baseUrl}api/live-scenes/${scene}?includeScene=true`);
    const live = await liveResponse.json();
    const after = await client.callTool({ name: "get_canvas_context", arguments: { scene } });
    const afterJson = JSON.parse(after.content[0].text);
    if (!["mcp", "mcp-export"].includes(live.source) || live.activeElementCount !== 3) {
      throw new Error(`Unexpected live state after MCP patch: ${JSON.stringify({ source: live.source, activeElementCount: live.activeElementCount })}`);
    }
    if (afterJson.source !== "live" || !after.content[0].text.includes("MCP pushed update")) {
      throw new Error("MCP did not read back the pushed live update.");
    }

    await page.goto(`${baseUrl}?scene=${encodeURIComponent(missingFirstScene)}`, { waitUntil: "domcontentloaded" });
    await waitForBrowserReady(missingFirstScene);
    const openedMissing = JSON.parse((await client.callTool({
      name: "open_or_create_canvas",
      arguments: { scene: missingFirstScene, title: "Missing first scene", waitForSubscriberMs: 2000 }
    })).content[0].text);
    if (!openedMissing.readiness?.browserReady || openedMissing.readiness?.subscriberCount < 1) {
      throw new Error(`open_or_create_canvas did not observe browser readiness: ${JSON.stringify(openedMissing.readiness)}`);
    }
    const missingView = JSON.parse((await client.callTool({
      name: "create_view",
      arguments: {
        scene: missingFirstScene,
        title: "Missing first scene",
        elements: [
          { type: "cameraUpdate", x: 40, y: 40, width: 700, height: 420 },
          { id: "missing-first-title", type: "text", x: 80, y: 80, width: 520, height: 44, text: "First live write after browser-ready", fontSize: 28 }
        ]
      }
    })).content[0].text);
    if (missingView.preview !== undefined) {
      throw new Error(`create_view refreshed a preview during a stage write: ${JSON.stringify(missingView.preview)}`);
    }
    await waitForLiveSceneSource(missingFirstScene, ["mcp"]);
    const missingLiveResponse = await fetch(`${baseUrl}api/live-scenes/${missingFirstScene}?includeScene=true`);
    const missingLive = await missingLiveResponse.json();
    if (missingLive.source !== "mcp" || missingLive.activeElementCount !== 1) {
      throw new Error(`Unexpected missing-first live state: ${JSON.stringify({ source: missingLive.source, activeElementCount: missingLive.activeElementCount })}`);
    }

    await writeScene(renameSourceScene, {
      type: "excalidraw",
      version: 2,
      source: "smoke-live-rename",
      elements: [textElement("smoke-live-rename-title", "Rename smoke", 80, 80)],
      appState: { viewBackgroundColor: "#ffffff", currentItemFontFamily: 6 },
      files: {}
    });
    await page.goto(`${baseUrl}?scene=${encodeURIComponent(renameSourceScene)}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#scene-name", { timeout: 8000 });
    await waitForCurrentScene(renameSourceScene);
    const renameInputBefore = await page.inputValue("#scene-name");
    if (renameInputBefore !== renameSourceScene.replace(/\.excalidraw$/, "")) {
      throw new Error(`Scene name input exposed the file extension: ${renameInputBefore}`);
    }
    await waitForLiveSceneSource(renameSourceScene, ["workbench"]);
    await page.fill("#scene-name", renameTargetDisplayName);
    await page.click(".codex-save-button");
    await page.waitForFunction((targetScene) => {
      return new URL(window.location.href).searchParams.get("scene") === targetScene;
    }, renameTargetScene, { timeout: 12000 });
    await waitForCurrentScene(renameTargetScene);
    const renameInputAfter = await page.inputValue("#scene-name");
    if (renameInputAfter !== renameTargetDisplayName) {
      throw new Error(`Scene name input did not stay extension-free after save: ${renameInputAfter}`);
    }
    await page.waitForFunction(async ({ sourceScene, targetScene }) => {
      const [scenesResponse, targetLiveResponse, oldSceneResponse] = await Promise.all([
        fetch("/api/scenes"),
        fetch(`/api/live-scenes/${targetScene}?includeScene=true`),
        fetch(`/api/scenes/${sourceScene}`)
      ]);
      if (!scenesResponse.ok || !targetLiveResponse.ok) return false;
      const scenes = await scenesResponse.json();
      const targetLive = await targetLiveResponse.json();
      return (
        scenes.some((entry) => entry.name === targetScene) &&
        !scenes.some((entry) => entry.name === sourceScene) &&
        oldSceneResponse.status === 404 &&
        targetLive?.source === "workbench" &&
        targetLive?.activeElementCount === 1
      );
    }, {
      sourceScene: renameSourceScene,
      targetScene: renameTargetScene
    }, { timeout: 12000 });

    console.log(JSON.stringify({
      ok: true,
      workbenchToLive: true,
      mcpReadLive: true,
      mcpToWorkbench: true,
      stageWritesSkippedPreview: true,
      galleryPreviewUpdatedAfterExport: true,
      browserReadyBeforeFirstWrite: true,
      saveRenameKeepsCodexReadable: true,
      extensionFreeRenameInput: true,
      mcpDefaultsToCurrentBrowserScene: true,
      activeElementCount: live.activeElementCount
    }, null, 2));
  } finally {
    closeMcpTransport(transport);
    await browser.close().catch(() => undefined);
    await cleanup();
    if (!server.reused) {
      void server.close();
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
