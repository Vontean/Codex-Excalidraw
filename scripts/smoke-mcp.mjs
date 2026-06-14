#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { deleteScene, readScene } from "../server/scene-workspace.mjs";
import { qaScene, startServer } from "../server/server.mjs";

const scene = "smoke-mcp-workflow.excalidraw";
const mermaidScene = "smoke-mcp-mermaid.excalidraw";
const requiredTools = [
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
  "create_from_mermaid"
];
const removedMcpTools = [
  "read_me",
  "describe_scene",
  "batch_create_elements",
  "update_element",
  "delete_element",
  "group_elements",
  "ungroup_elements",
  "align_elements",
  "distribute_elements",
  "snapshot_scene",
  "export_scene",
  "import_scene",
  "export_to_image",
  "query_elements",
  "get_element",
  "duplicate_elements",
  "lock_elements",
  "unlock_elements",
  "arrange_canvas",
  "set_viewport",
  "get_canvas_screenshot",
  "get_live_canvas_status",
  "list_canvases",
  "get_runtime_config"
];

async function cleanup() {
  for (const name of [scene, mermaidScene]) {
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

function parseToolPayload(result) {
  return JSON.parse(result.content?.[0]?.text || "{}");
}

function closeMcpTransport(transport) {
  try {
    void transport.close?.();
  } catch {
    // The smoke process exits explicitly after cleanup.
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
      throw new Error(`Missing public MCP workflow tools: ${missing.join(", ")}`);
    }
    const stillListed = removedMcpTools.filter((name) => names.has(name));
    if (stillListed.length) {
      throw new Error(`Removed MCP tools are still listed: ${stillListed.join(", ")}`);
    }

    const guide = await client.callTool({ name: "read_diagram_guide", arguments: { topic: "workflow" } });
    if (!guide.content?.[0]?.text?.includes("intent")) {
      throw new Error("read_diagram_guide did not return intent-first workflow guidance.");
    }

    const opened = parseToolPayload(await client.callTool({
      name: "open_or_create_canvas",
      arguments: { scene, title: "MCP workflow smoke" }
    }));
    if (!opened.browserUrl || !opened.session || !opened.readiness) {
      throw new Error("open_or_create_canvas did not return live session metadata.");
    }

    const view = parseToolPayload(await client.callTool({
      name: "create_view",
      arguments: {
        scene,
        title: "MCP workflow smoke",
        reveal: true,
        revealDelayMs: 1,
        revealChunkSize: 2,
        elements: [
          { type: "cameraUpdate", x: 40, y: 40, width: 900, height: 620 },
          { id: "smoke-title", type: "text", x: 80, y: 80, width: 480, height: 44, text: "MCP workflow smoke", fontSize: 32 },
          { id: "smoke-board", type: "rectangle", x: 80, y: 160, width: 420, height: 140, backgroundColor: "#e7f5ff", customData: { codexRole: "focus" } },
          { id: "smoke-label", type: "text", x: 110, y: 205, width: 340, height: 32, text: "Intent-first public tools", fontSize: 22 },
          { id: "smoke-arrow-without-points", type: "arrow", x: 540, y: 190, width: 80, height: 0, strokeColor: "#64748B", customData: { codexRole: "guide-arrow" } },
          { id: "smoke-line-without-points", type: "line", x: 540, y: 230, width: 80, height: 20, strokeColor: "#64748B", customData: { codexRole: "annotation-line" } }
        ]
      }
    }));
    if (!view.checkpointId) {
      throw new Error("create_view did not return a checkpoint.");
    }
    if (!view.reveal?.enabled || view.reveal.stages < 2) {
      throw new Error("create_view did not run staged reveal.");
    }
    if (view.preview !== undefined) {
      throw new Error(`create_view refreshed a preview during a stage write: ${JSON.stringify(view.preview)}`);
    }
    const createdScene = await readScene(scene);
    if (!createdScene.appState?.codex?.finalViewport || !createdScene.appState?.zoom?.value) {
      throw new Error("create_view did not translate cameraUpdate into viewport appState.");
    }
    for (const id of ["smoke-arrow-without-points", "smoke-line-without-points"]) {
      const element = createdScene.elements.find((item) => item.id === id);
      if (!Array.isArray(element?.points) || element.points.length < 2) {
        throw new Error(`create_view did not normalize linear element points for ${id}.`);
      }
    }

    const context = parseToolPayload(await client.callTool({ name: "get_canvas_context", arguments: { scene } }));
    if (context.source !== "live" || !JSON.stringify(context).includes("Intent-first public tools")) {
      throw new Error("get_canvas_context did not read the live public workflow scene.");
    }

    await client.callTool({ name: "snapshot_canvas", arguments: { scene, label: "before-public-patch" } });
    const patch = parseToolPayload(await client.callTool({
      name: "apply_canvas_patch",
      arguments: {
        scene,
        operations: [
          {
            op: "add",
            elements: [
              { id: "smoke-note", type: "text", x: 80, y: 350, width: 560, height: 32, text: "Semantic patch keeps the workflow small.", fontSize: 22 },
              { id: "smoke-patch-line-without-points", type: "line", x: 80, y: 410, width: 560, height: 0, strokeColor: "#94A3B8", customData: { codexRole: "annotation-line" } }
            ]
          }
        ]
      }
    }));
    if (!JSON.stringify(patch).includes("Semantic patch keeps the workflow small")) {
      throw new Error("apply_canvas_patch did not update the canvas context.");
    }
    if (patch.preview !== undefined) {
      throw new Error(`apply_canvas_patch refreshed a preview during a stage write: ${JSON.stringify(patch.preview)}`);
    }
    const patchedScene = await readScene(scene);
    const patchLine = patchedScene.elements.find((item) => item.id === "smoke-patch-line-without-points");
    if (!Array.isArray(patchLine?.points) || patchLine.points.length < 2) {
      throw new Error("apply_canvas_patch add did not normalize line points.");
    }
    await client.callTool({
      name: "apply_canvas_patch",
      arguments: {
        scene,
        operations: [
          { op: "update", id: "smoke-arrow-without-points", props: { points: null }, width: 120, height: 24 }
        ]
      }
    });
    const updatedScene = await readScene(scene);
    const updatedArrow = updatedScene.elements.find((item) => item.id === "smoke-arrow-without-points");
    if (!Array.isArray(updatedArrow?.points) || updatedArrow.points.length < 2) {
      throw new Error("apply_canvas_patch update did not repair missing arrow points.");
    }
    const invalidLinearQa = qaScene({
      type: "excalidraw",
      version: 2,
      source: "smoke",
      elements: [
        { id: "invalid-arrow", type: "arrow", x: 0, y: 0, width: 20, height: 0, isDeleted: false }
      ],
      appState: {},
      files: {}
    }, { name: "invalid-linear-smoke.excalidraw" });
    if (invalidLinearQa.ok || !invalidLinearQa.issues.some((issue) => issue.type === "invalid-linear-element")) {
      throw new Error("qa did not report missing linear element points as blocking.");
    }

    const review = await client.callTool({ name: "review_canvas", arguments: { scene } });
    const reviewPayload = parseToolPayload(review);
    if (!reviewPayload.reviewProtocol?.length || !reviewPayload.screenshot?.size) {
      throw new Error("review_canvas did not return a complete review packet.");
    }
    if (!reviewPayload.screenshot?.path?.includes(".review.png")) {
      throw new Error(`review_canvas should use a temporary review image: ${JSON.stringify(reviewPayload.screenshot)}`);
    }
    if (!review.content?.some((item) => item.type === "image" && item.mimeType === "image/png")) {
      throw new Error("review_canvas did not return PNG image content.");
    }
    const reviewIssues = reviewPayload.qa?.issues || reviewPayload.review?.qa?.issues || [];
    const falseTextOverlap = reviewIssues.find((issue) =>
      issue.type === "possible-overlap" &&
      (issue.elementIds || []).includes("smoke-board") &&
      (issue.elementIds || []).includes("smoke-label")
    );
    if (falseTextOverlap) {
      throw new Error("review_canvas reported a false overlap for text placed inside a node.");
    }

    const pseudoPatch = await client.callTool({
      name: "apply_canvas_patch",
      arguments: {
        scene,
        dryRun: true,
        operations: [
          { op: "add", elements: [{ type: "cameraUpdate", x: 0, y: 0, width: 100, height: 100 }] }
        ]
      }
    });
    if (!pseudoPatch.isError || !pseudoPatch.content?.[0]?.text?.includes("Pseudo element type")) {
      throw new Error("apply_canvas_patch did not reject create_view pseudo-elements.");
    }

    const restore = parseToolPayload(await client.callTool({ name: "restore_snapshot", arguments: { scene, checkpointId: view.checkpointId } }));
    if (restore.preview !== undefined) {
      throw new Error(`restore_snapshot refreshed a preview during a stage write: ${JSON.stringify(restore.preview)}`);
    }
    const restored = parseToolPayload(await client.callTool({ name: "get_canvas_context", arguments: { scene } }));
    if (JSON.stringify(restored).includes("Semantic patch keeps the workflow small")) {
      throw new Error("restore_snapshot did not restore the create_view checkpoint.");
    }

    const mermaid = parseToolPayload(await client.callTool({
      name: "create_from_mermaid",
      arguments: {
        scene: mermaidScene,
        mermaidDiagram: "flowchart LR\n  A[Prompt] --> B[Canvas]\n  B --> C[Preview]",
        fontSize: 22
      }
    }));
    if (mermaid.preview !== undefined) {
      throw new Error(`create_from_mermaid refreshed a preview before export: ${JSON.stringify(mermaid.preview)}`);
    }
    const mermaidContext = parseToolPayload(await client.callTool({ name: "get_canvas_context", arguments: { scene: mermaidScene } }));
    if (!JSON.stringify(mermaidContext).includes("Prompt")) {
      throw new Error("create_from_mermaid did not create readable scene content.");
    }

    const imageExport = parseToolPayload(await client.callTool({
      name: "export_canvas",
      arguments: { scene: mermaidScene, format: "png" }
    }));
    if (!imageExport.exports?.[0]?.size) {
      throw new Error("export_canvas did not produce a non-empty PNG.");
    }

    const shareDryRun = parseToolPayload(await client.callTool({
      name: "export_to_excalidraw_url",
      arguments: { scene: mermaidScene, dryRun: true }
    }));
    if (!shareDryRun.share?.dryRun || !shareDryRun.share?.payloadSize || !shareDryRun.share?.payloadSha256) {
      throw new Error("export_to_excalidraw_url dry run did not prepare an encrypted payload.");
    }

    console.log(JSON.stringify({
      ok: true,
      toolCount: tools.tools.length,
      verified: requiredTools,
      removedFromPublicSurface: removedMcpTools
    }, null, 2));
  } finally {
    closeMcpTransport(transport);
    await cleanup();
    if (!renderServer.reused) {
      void renderServer.close();
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
