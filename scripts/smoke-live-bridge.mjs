#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
import { deleteScene, writeScene } from "../server/scene-workspace.mjs";
import { startServer } from "../server/server.mjs";

const scene = "smoke-live-bridge.excalidraw";
const baseUrl = "http://127.0.0.1:3000/";

async function cleanup() {
  try {
    await fetch(`${baseUrl}api/live-scenes/${scene}`, { method: "DELETE" });
  } catch {
    // Ignore cleanup when the server is not reachable.
  }
  try {
    await deleteScene(scene);
  } catch {
    // Ignore missing smoke artifacts.
  }
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

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const client = new Client({ name: "codex-excalidraw-smoke-live", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["./bin/excalidraw-codex.mjs", "mcp"],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  try {
    await page.goto(`${baseUrl}?scene=${encodeURIComponent(scene)}`, { waitUntil: "networkidle" });
    await page.waitForFunction(async (sceneName) => {
      const response = await fetch(`/api/live-scenes/${sceneName}`);
      if (!response.ok) return false;
      const live = await response.json();
      return live?.source === "workbench" && live?.activeElementCount === 1;
    }, scene, { timeout: 8000 });

    await client.connect(transport);
    const before = await client.callTool({ name: "get_canvas_context", arguments: { scene } });
    const beforeJson = JSON.parse(before.content[0].text);
    if (beforeJson.source !== "live") {
      throw new Error(`Expected MCP to read live canvas, got ${beforeJson.source}`);
    }

    await client.callTool({
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
    });

    await page.waitForFunction(() => document.body.innerText.includes("Applied live update from mcp"), null, { timeout: 8000 });

    const liveResponse = await fetch(`${baseUrl}api/live-scenes/${scene}?includeScene=true`);
    const live = await liveResponse.json();
    const after = await client.callTool({ name: "get_canvas_context", arguments: { scene } });
    const afterJson = JSON.parse(after.content[0].text);
    if (live.source !== "mcp" || live.activeElementCount !== 3) {
      throw new Error(`Unexpected live state after MCP patch: ${JSON.stringify({ source: live.source, activeElementCount: live.activeElementCount })}`);
    }
    if (afterJson.source !== "live" || !after.content[0].text.includes("MCP pushed update")) {
      throw new Error("MCP did not read back the pushed live update.");
    }

    console.log(JSON.stringify({
      ok: true,
      workbenchToLive: true,
      mcpReadLive: true,
      mcpToWorkbench: true,
      activeElementCount: live.activeElementCount
    }, null, 2));
  } finally {
    await client.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await cleanup();
    if (!server.reused) {
      await server.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
