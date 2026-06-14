import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  canvasTools,
  getCanvasRuntime,
  listCanvases
} from "../server/canvas-bridge.mjs";
import { readDiagramGuide } from "../server/diagram-guide.mjs";

const GUIDE_TOPICS = [
  "workflow",
  "visual-strategy",
  "live-collaboration",
  "layout",
  "visual-language",
  "text",
  "review",
  "all"
];

const PUBLIC_TOOL_DEFINITIONS = [
  {
    name: "read_diagram_guide",
    description: "Read intent-first diagram guidance before drawing or reviewing. Use this to choose the visual model and collaboration rhythm.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: GUIDE_TOPICS }
      }
    }
  },
  {
    name: "open_or_create_canvas",
    description: "Open or create a workbench canvas and return browser URL, live session metadata, readiness, and compact context.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string", description: "Scene file name, for example product-map.excalidraw." },
        title: { type: "string", description: "Optional human title stored in scene metadata." },
        backgroundColor: { type: "string", description: "Optional canvas background color." },
        includeElements: { type: "boolean", description: "Return compact element outline; default true." },
        waitForSubscriberMs: { type: "number", description: "Optionally wait for the browser workbench to subscribe to this scene before returning readiness metadata." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "get_canvas_context",
    description: "Read the current shared canvas as compact metadata, live source info, layout issues, QA notes, and optional element outline.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        includeElements: { type: "boolean", description: "Return compact element outline; default true." },
        maxElements: { type: "number", description: "Maximum compact elements to return." },
        qa: { type: "boolean", description: "Include QA summary; default true." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "create_view",
    description: "Create an intent-first first pass or full view from compact elements. Optional reveal uses staged HTTP workbench updates, not true token streaming.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string", description: "Scene file name; default codex-view.excalidraw." },
        elements: {
          description: "Array or JSON array string of Excalidraw elements. Supports cameraUpdate, delete, and restoreCheckpoint pseudo-elements.",
          anyOf: [
            { type: "string" },
            { type: "array", items: { type: "object" } }
          ]
        },
        mode: { type: "string", enum: ["replace", "append"], description: "Default replace, or append when restoreCheckpoint is used." },
        title: { type: "string" },
        backgroundColor: { type: "string" },
        reveal: { type: "boolean", description: "Push staged live canvas updates when the user benefits from watching progress. Default false." },
        revealDelayMs: { type: "number", description: "Delay between reveal stages; default 160, use 0-40 for smoke tests or fast reveals." },
        revealChunkSize: { type: "number", description: "Drawable elements per reveal stage; default 6." },
        viewportWidth: { type: "number", description: "Reference viewport width for cameraUpdate-to-zoom mapping; default 800." },
        cameraPadding: { type: "number", description: "Screen padding used when translating cameraUpdate to Excalidraw scroll values; default 40." },
        refreshPreview: { type: "boolean", description: "Refresh the gallery PNG preview after writing; default false. Prefer export_canvas for the final preview." },
        snapshot: { type: "boolean" },
        checkpointLabel: { type: "string" },
        baseRevision: { type: "string", description: "Optional live canvas revision to protect against stale writes." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["elements"]
    }
  },
  {
    name: "apply_canvas_patch",
    description: "Apply a semantic batch of canvas changes after reading current context. Prefer meaningful user-facing increments over primitive-by-primitive edits.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        operations: {
          type: "array",
          description: "Patch operations. Supported ops: add, connect, set-text, move, resize, update, delete, group, ungroup.",
          items: { type: "object" }
        },
        plan: { type: "object", description: "Alternative patch plan object with ops or operations." },
        snapshot: { type: "boolean", description: "Create a snapshot before editing; default true." },
        dryRun: { type: "boolean" },
        label: { type: "string" },
        refreshPreview: { type: "boolean", description: "Refresh the gallery PNG preview after writing; default false. Prefer export_canvas for the final preview." },
        baseRevision: { type: "string", description: "Optional live canvas revision to protect against stale writes." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "review_canvas",
    description: "Return a visual review packet: structured context, QA notes, review checklist, and a temporary PNG image for model inspection.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        includeImage: { type: "boolean", description: "Include temporary PNG image content without refreshing the gallery preview; default true." },
        includeElements: { type: "boolean", description: "Include compact element list in the text packet; default false for brevity." },
        includeGuide: { type: "boolean", description: "Include the review guide; default true." },
        qa: { type: "boolean", description: "Include QA summary; default true." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "snapshot_canvas",
    description: "Create a named checkpoint before risky edits, redraws, restores, or user-directed exploration.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        label: { type: "string" },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "restore_snapshot",
    description: "Restore a scene from a named checkpoint/snapshot or the latest snapshot after an unsuccessful pass.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        from: { type: "string" },
        checkpointId: { type: "string" },
        snapshotName: { type: "string" },
        snapshot: { type: "boolean" },
        refreshPreview: { type: "boolean", description: "Refresh the gallery PNG preview after restoring; default false. Prefer export_canvas for the final preview." },
        baseRevision: { type: "string", description: "Optional live canvas revision to protect against stale writes." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "export_canvas",
    description: "Export the scene through the browser render path as PNG, SVG, or both.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        format: { type: "string", enum: ["png", "svg", "all"] },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "export_to_excalidraw_url",
    description: "Explicitly upload the current scene to excalidraw.com and return a shareable encrypted URL. Use only when the user asks to share outside the local workbench.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        dryRun: { type: "boolean", description: "Prepare and encrypt the payload without uploading. Useful for verification." },
        endpoint: { type: "string", description: "Optional Excalidraw JSON upload endpoint override." },
        includeFiles: { type: "boolean", description: "Include embedded files/images; default true." },
        includeDeleted: { type: "boolean", description: "Include deleted elements; default false." },
        includeCustomData: { type: "boolean", description: "Include customData metadata; default false for privacy." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "create_from_mermaid",
    description: "Convert Mermaid text to an editable Excalidraw scene when the user's source structure is naturally Mermaid-shaped.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        mermaidDiagram: { type: "string" },
        mermaid: { type: "string" },
        definition: { type: "string" },
        fontSize: { type: "number" },
        backgroundColor: { type: "string" },
        export: { type: "boolean", description: "Optionally export a preview after conversion." },
        refreshPreview: { type: "boolean", description: "Refresh the gallery PNG preview after conversion; default false. Prefer export_canvas for the final preview." },
        format: { type: "string", enum: ["png", "svg", "all"] },
        snapshot: { type: "boolean" },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  }
];

const PUBLIC_TOOL_NAMES = new Set(PUBLIC_TOOL_DEFINITIONS.map((tool) => tool.name));

function toolResult(value) {
  if (Array.isArray(value?._mcpContent)) {
    return {
      content: value._mcpContent
    };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error)
      }
    ]
  };
}

export async function callCanvasTool(name, args = {}) {
  if (!PUBLIC_TOOL_NAMES.has(name)) {
    throw new Error(`Unknown public Excalidraw Codex MCP tool: ${name}`);
  }
  const tool = canvasTools[name];
  if (!tool) {
    throw new Error(`Excalidraw Codex MCP tool is not implemented: ${name}`);
  }
  return tool(args || {});
}

export function createMcpServer() {
  const server = new Server(
    {
      name: "excalidraw-codex",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      },
      instructions: [
        "Use this server as an intent-first, live-first Excalidraw bridge.",
        "Choose the visual model from the user's intent before choosing layout primitives.",
        "Use open_or_create_canvas readiness.browserReady as the lightweight workbench handshake; when the target scene is already subscribed, do not navigate or reload the browser just to confirm it.",
        "Use open_or_create_canvas, get_canvas_context, create_view, apply_canvas_patch, review_canvas, snapshot/restore, and export_canvas as the main workflow.",
        "Optional create_view reveal is staged HTTP workbench reveal, not true MCP partial streaming.",
        "Use CLI/workbench for deterministic service startup, library installation, and final file management."
      ].join("\n")
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: PUBLIC_TOOL_DEFINITIONS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callCanvasTool(request.params.name, request.params.arguments || {});
      return toolResult(result);
    } catch (error) {
      return toolError(error);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "excalidraw-codex://config",
        name: "Excalidraw Codex runtime config",
        mimeType: "application/json"
      },
      {
        uri: "excalidraw-codex://scenes",
        name: "Excalidraw Codex scenes",
        mimeType: "application/json"
      },
      {
        uri: "excalidraw-codex://diagram-guide",
        name: "Excalidraw Codex diagram guide",
        mimeType: "application/json"
      }
    ]
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === "excalidraw-codex://config") {
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(getCanvasRuntime(), null, 2) }]
      };
    }
    if (uri === "excalidraw-codex://scenes") {
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(await listCanvases(), null, 2) }]
      };
    }
    if (uri === "excalidraw-codex://diagram-guide") {
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(readDiagramGuide({ topic: "all" }), null, 2) }]
      };
    }
    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

export async function startMcpServer() {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

export function listMcpTools() {
  return PUBLIC_TOOL_DEFINITIONS;
}
