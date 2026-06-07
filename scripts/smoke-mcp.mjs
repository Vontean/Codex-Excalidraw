#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { deleteScene, readScene } from "../server/scene-workspace.mjs";
import { startServer } from "../server/server.mjs";

const scene = "smoke-mcp-toolkit.excalidraw";
const mermaidScene = "smoke-mcp-mermaid.excalidraw";
const importScene = "smoke-mcp-import.excalidraw";
const requiredTools = [
  "read_me",
  "create_view",
  "describe_scene",
  "create_from_mermaid",
  "batch_create_elements",
  "update_element",
  "delete_element",
  "export_scene",
  "import_scene",
  "export_to_image",
  "export_to_excalidraw_url",
  "snapshot_scene",
  "group_elements",
  "ungroup_elements",
  "align_elements",
  "distribute_elements",
  "restore_snapshot",
  "open_or_create_canvas",
  "get_live_canvas_status",
  "get_canvas_context",
  "get_canvas_screenshot",
  "review_canvas",
  "read_diagram_guide",
  "query_elements",
  "duplicate_elements",
  "lock_elements",
  "export_canvas"
];

async function cleanup() {
  for (const name of [scene, mermaidScene, importScene]) {
    try {
      await deleteScene(name);
    } catch {
      // Ignore missing smoke artifacts.
    }
    try {
      await fetch(`http://127.0.0.1:3000/api/live-scenes/${name}`, { method: "DELETE" });
    } catch {
      // The workbench server is optional for cleanup.
    }
  }
}

async function main() {
  await cleanup();
  const renderServer = await startServer({
    host: "127.0.0.1",
    port: 3000,
    fallbackPort: false,
    reuseExisting: true,
    mode: "production"
  });

  const client = new Client({ name: "codex-excalidraw-smoke-mcp", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["./bin/excalidraw-codex.mjs", "mcp"],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    const missing = requiredTools.filter((name) => !names.has(name));
    if (missing.length) {
      throw new Error(`Missing MCP tools: ${missing.join(", ")}`);
    }

    const guide = await client.callTool({ name: "read_diagram_guide", arguments: { topic: "layout" } });
    if (!guide.content?.[0]?.text?.includes("Readable Excalidraw layout")) {
      throw new Error("read_diagram_guide did not return the layout guide.");
    }
    const readMe = await client.callTool({ name: "read_me", arguments: {} });
    if (!readMe.content?.[0]?.text?.includes("cameraUpdate")) {
      throw new Error("read_me did not return the compatibility drawing guide.");
    }

    const view = await client.callTool({
      name: "create_view",
      arguments: {
        scene,
        title: "MCP toolkit smoke",
        reveal: true,
        revealDelayMs: 1,
        revealChunkSize: 2,
        elements: [
          { type: "cameraUpdate", x: 40, y: 40, width: 800, height: 600 },
          { id: "smoke-title", type: "text", x: 80, y: 80, width: 420, height: 44, text: "MCP toolkit smoke", fontSize: 32 },
          { id: "smoke-box", type: "rectangle", x: 80, y: 160, width: 320, height: 110, backgroundColor: "#e7f5ff", customData: { codexRole: "section" } },
          { id: "smoke-label", type: "text", x: 108, y: 198, width: 250, height: 32, text: "Canvas-aware tools", fontSize: 22 }
        ]
      }
    });
    const viewPayload = JSON.parse(view.content?.[0]?.text || "{}");
    if (!viewPayload.checkpointId) {
      throw new Error("create_view did not return a checkpoint.");
    }
    if (!viewPayload.reveal?.enabled || viewPayload.reveal.stages < 2) {
      throw new Error("create_view did not run progressive reveal stages.");
    }
    const createdScene = await readScene(scene);
    if (!createdScene.appState?.codex?.finalViewport || !createdScene.appState?.zoom?.value) {
      throw new Error("create_view did not translate cameraUpdate into viewport appState.");
    }

    await client.callTool({
      name: "batch_create_elements",
      arguments: {
        scene,
        elements: [
          { id: "smoke-step-a", type: "rectangle", x: 500, y: 160, width: 180, height: 80, text: "Read" },
          { id: "smoke-step-b", type: "rectangle", x: 750, y: 160, width: 180, height: 80, text: "Patch" },
          { id: "smoke-step-c", type: "rectangle", x: 1000, y: 160, width: 180, height: 80, text: "Review" },
          {
            id: "smoke-arrow-ab",
            type: "arrow",
            startElementId: "smoke-step-a",
            endElementId: "smoke-step-b",
            text: "then"
          }
        ]
      }
    });
    await client.callTool({ name: "update_element", arguments: { scene, id: "smoke-step-b", text: "Patch safely" } });
    await client.callTool({
      name: "align_elements",
      arguments: { scene, elementIds: ["smoke-step-a", "smoke-step-b", "smoke-step-c"], alignment: "middle" }
    });
    await client.callTool({
      name: "distribute_elements",
      arguments: { scene, elementIds: ["smoke-step-a", "smoke-step-b", "smoke-step-c"], direction: "horizontal" }
    });

    const query = await client.callTool({ name: "query_elements", arguments: { scene, selector: { role: "section" } } });
    if (!query.content?.[0]?.text?.includes("smoke-box")) {
      throw new Error("query_elements did not find the section element.");
    }
    const description = await client.callTool({ name: "describe_scene", arguments: { scene } });
    if (!description.content?.[0]?.text?.includes("Patch safely")) {
      throw new Error("describe_scene did not include updated element text.");
    }

    await client.callTool({ name: "duplicate_elements", arguments: { scene, selector: { id: "smoke-box" }, dx: 380, dy: 0 } });
    await client.callTool({ name: "lock_elements", arguments: { scene, selector: { textIncludes: "Canvas-aware" } } });
    await client.callTool({ name: "snapshot_scene", arguments: { scene, label: "compat-snapshot" } });
    await client.callTool({ name: "restore_snapshot", arguments: { scene, checkpointId: viewPayload.checkpointId } });

    const context = await client.callTool({ name: "get_canvas_context", arguments: { scene } });
    if (!context.content?.[0]?.text?.includes("Canvas-aware tools")) {
      throw new Error("get_canvas_context did not include smoke label text.");
    }
    const review = await client.callTool({ name: "review_canvas", arguments: { scene } });
    const reviewPayload = JSON.parse(review.content?.[0]?.text || "{}");
    if (!reviewPayload.reviewProtocol?.length || !reviewPayload.screenshot?.size) {
      throw new Error("review_canvas did not return a complete review packet.");
    }
    if (!review.content?.some((item) => item.type === "image" && item.mimeType === "image/png")) {
      throw new Error("review_canvas did not return PNG image content.");
    }

    await client.callTool({
      name: "create_from_mermaid",
      arguments: {
        scene: mermaidScene,
        mermaidDiagram: "flowchart LR\n  A[Prompt] --> B[Canvas]\n  B --> C[Preview]",
        fontSize: 22
      }
    });
    const mermaidContext = await client.callTool({ name: "describe_scene", arguments: { scene: mermaidScene } });
    if (!mermaidContext.content?.[0]?.text?.includes("Prompt")) {
      throw new Error("create_from_mermaid did not create readable scene content.");
    }

    const exportedScene = await client.callTool({
      name: "export_scene",
      arguments: { scene: mermaidScene, includeScene: true }
    });
    const exportedPayload = JSON.parse(exportedScene.content?.[0]?.text || "{}");
    if (!exportedPayload.sceneData?.elements?.length) {
      throw new Error("export_scene did not return scene data.");
    }
    await client.callTool({
      name: "import_scene",
      arguments: {
        scene: importScene,
        sceneData: exportedPayload.sceneData,
        mode: "replace"
      }
    });
    const imageExport = await client.callTool({
      name: "export_to_image",
      arguments: { scene: importScene, format: "png" }
    });
    const imagePayload = JSON.parse(imageExport.content?.[0]?.text || "{}");
    if (!imagePayload.exports?.[0]?.size) {
      throw new Error("export_to_image did not produce a non-empty PNG.");
    }
    const shareDryRun = await client.callTool({
      name: "export_to_excalidraw_url",
      arguments: { scene: importScene, dryRun: true }
    });
    const sharePayload = JSON.parse(shareDryRun.content?.[0]?.text || "{}");
    if (!sharePayload.share?.dryRun || !sharePayload.share?.payloadSize || !sharePayload.share?.payloadSha256) {
      throw new Error("export_to_excalidraw_url dry run did not prepare an encrypted payload.");
    }

    console.log(JSON.stringify({
      ok: true,
      toolCount: tools.tools.length,
      verified: requiredTools
    }, null, 2));
  } finally {
    await client.close();
    if (!renderServer.reused) {
      await renderServer.close();
    }
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
