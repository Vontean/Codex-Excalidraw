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

const TOOL_DEFINITIONS = [
  {
    name: "read_me",
    description: "Compatibility guide inspired by mature Excalidraw MCP workflows. Read once before create_view or element-level drawing.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: ["workflow", "layout", "visual-language", "text", "review", "all"] }
      }
    }
  },
  {
    name: "create_view",
    description: "Official-style drawing entry: apply a compact Excalidraw element array, with pseudo-elements cameraUpdate/delete/restoreCheckpoint, then return a checkpoint.",
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
        reveal: { type: "boolean", description: "Optionally push intermediate live canvas states so the workbench can show the drawing evolving. Default false for speed." },
        revealDelayMs: { type: "number", description: "Delay between reveal stages; default 160, use 0-40 for smoke tests or fast reveals." },
        revealChunkSize: { type: "number", description: "Drawable elements per reveal stage; default 6." },
        viewportWidth: { type: "number", description: "Reference viewport width for cameraUpdate-to-zoom mapping; default 800." },
        cameraPadding: { type: "number", description: "Screen padding used when translating cameraUpdate to Excalidraw scroll values; default 40." },
        snapshot: { type: "boolean" },
        checkpointLabel: { type: "string" },
        baseUrl: { type: "string" }
      },
      required: ["elements"]
    }
  },
  {
    name: "describe_scene",
    description: "Third-party-style structured read-back of the current canvas: elements, texts, regions, connections, bounds, and layout warnings.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        includeElements: { type: "boolean" },
        maxElements: { type: "number" }
      },
      required: ["scene"]
    }
  },
  {
    name: "create_from_mermaid",
    description: "Convert Mermaid text to an editable Excalidraw scene through the official mermaid-to-excalidraw converter.",
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
        format: { type: "string", enum: ["png", "svg", "all"] },
        snapshot: { type: "boolean" },
        baseUrl: { type: "string" }
      },
      required: ["scene"]
    }
  },
  {
    name: "batch_create_elements",
    description: "Create multiple Excalidraw elements at once. For arrows, accepts startElementId/endElementId and converts them to bound connectors.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        elements: {
          anyOf: [
            { type: "string" },
            { type: "array", items: { type: "object" } }
          ]
        },
        snapshot: { type: "boolean" },
        label: { type: "string" }
      },
      required: ["scene", "elements"]
    }
  },
  {
    name: "export_scene",
    description: "Export the current scene as .excalidraw JSON, optionally writing to a specific file path.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        filePath: { type: "string" },
        out: { type: "string" },
        includeScene: { type: "boolean" },
        materializeLive: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "import_scene",
    description: "Import a .excalidraw scene or element array from filePath, raw data, or sceneData. Supports replace and merge modes.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        filePath: { type: "string" },
        data: {},
        sceneData: { type: "object" },
        mode: { type: "string", enum: ["replace", "merge"] },
        snapshot: { type: "boolean" }
      }
    }
  },
  {
    name: "export_to_image",
    description: "Export the scene through the browser render path as PNG, SVG, or both. Alias of export_canvas for MCP compatibility.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        format: { type: "string", enum: ["png", "svg", "all"] },
        baseUrl: { type: "string" }
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
        includeCustomData: { type: "boolean", description: "Include customData metadata; default false for privacy." }
      },
      required: ["scene"]
    }
  },
  {
    name: "update_element",
    description: "Update one element by id or selector. Compatibility wrapper for common Excalidraw MCP workflows.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        id: { type: "string" },
        elementId: { type: "string" },
        selector: { type: "object" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        text: { type: "string" },
        backgroundColor: { type: "string" },
        strokeColor: { type: "string" },
        fontSize: { type: "number" },
        fontFamily: { type: ["string", "number"] },
        snapshot: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "delete_element",
    description: "Delete one or more elements by id, ids, or selector.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        id: { type: "string" },
        elementId: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        selector: { type: "object" },
        snapshot: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "group_elements",
    description: "Group selected elements with an optional groupId.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        elementIds: { type: "array", items: { type: "string" } },
        ids: { type: "array", items: { type: "string" } },
        selector: { type: "object" },
        groupId: { type: "string" },
        snapshot: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "ungroup_elements",
    description: "Ungroup elements by groupId or selector.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        groupId: { type: "string" },
        selector: { type: "object" },
        snapshot: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "align_elements",
    description: "Align matched elements left, center, right, top, middle, or bottom.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        elementIds: { type: "array", items: { type: "string" } },
        ids: { type: "array", items: { type: "string" } },
        selector: { type: "object" },
        alignment: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"] },
        snapshot: { type: "boolean" }
      },
      required: ["scene", "alignment"]
    }
  },
  {
    name: "distribute_elements",
    description: "Evenly distribute matched elements horizontally or vertically.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        elementIds: { type: "array", items: { type: "string" } },
        ids: { type: "array", items: { type: "string" } },
        selector: { type: "object" },
        direction: { type: "string", enum: ["horizontal", "vertical"] },
        snapshot: { type: "boolean" }
      },
      required: ["scene", "direction"]
    }
  },
  {
    name: "snapshot_scene",
    description: "Compatibility alias for snapshot_canvas. Save a named snapshot/checkpoint of the current scene.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        label: { type: "string" }
      },
      required: ["scene"]
    }
  },
  {
    name: "restore_snapshot",
    description: "Restore a scene from a named checkpoint/snapshot or from latest. Use after risky drawing passes.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        from: { type: "string" },
        checkpointId: { type: "string" },
        snapshotName: { type: "string" },
        snapshot: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "open_or_create_canvas",
    description: "Open an existing workbench-managed Excalidraw scene or create a blank scene. Use this before drawing.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string", description: "Scene file name, for example product-map.excalidraw." },
        title: { type: "string", description: "Optional human title stored in scene metadata." },
        backgroundColor: { type: "string", description: "Optional canvas background color." },
        includeElements: { type: "boolean", description: "Return compact element outline; default true." }
      },
      required: ["scene"]
    }
  },
  {
    name: "get_canvas_context",
    description: "Read the current canvas as compact scene metadata: bounds, texts, groups, regions, connections, layout issues, and element outline.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        includeElements: { type: "boolean", description: "Return compact element outline; default true." },
        maxElements: { type: "number", description: "Maximum compact elements to return." },
        qa: { type: "boolean", description: "Include QA summary; default true." }
      },
      required: ["scene"]
    }
  },
  {
    name: "get_live_canvas_status",
    description: "Check whether the workbench has a live unsaved canvas draft for one scene or list all live drafts.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" }
      }
    }
  },
  {
    name: "get_canvas_screenshot",
    description: "Render the current scene to a PNG and return it as MCP image content, giving the agent visual feedback on the canvas.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "review_canvas",
    description: "Return a visual review packet: structured canvas context, QA notes, review checklist, and a PNG image for model inspection.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        includeImage: { type: "boolean", description: "Include PNG image content; default true." },
        includeElements: { type: "boolean", description: "Include compact element list in the text packet; default false for brevity." },
        includeGuide: { type: "boolean", description: "Include the review guide; default true." },
        qa: { type: "boolean", description: "Include QA summary; default true." },
        baseUrl: { type: "string", description: "Workbench URL, default http://127.0.0.1:3000/." }
      },
      required: ["scene"]
    }
  },
  {
    name: "read_diagram_guide",
    description: "Read diagram design guidance before drawing or reviewing. Topics: workflow, layout, visual-language, text, review, all.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: ["workflow", "layout", "visual-language", "text", "review", "all"] }
      }
    }
  },
  {
    name: "query_elements",
    description: "Query active elements by id, ids, type, role, kind, groupId, text, textIncludes, or bounds.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        selector: { type: "object" },
        limit: { type: "number" },
        includeRaw: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "get_element",
    description: "Read one active element by id, returning compact metadata by default.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        id: { type: "string" },
        includeRaw: { type: "boolean" }
      },
      required: ["scene", "id"]
    }
  },
  {
    name: "apply_canvas_patch",
    description: "Apply a semantic batch of Excalidraw element operations. Prefer one patch per section/region instead of one call per primitive.",
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
        label: { type: "string" }
      },
      required: ["scene"]
    }
  },
  {
    name: "clear_canvas",
    description: "Soft-delete all active elements in a scene, snapshotting first by default.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        snapshot: { type: "boolean" },
        dryRun: { type: "boolean" },
        label: { type: "string" }
      },
      required: ["scene"]
    }
  },
  {
    name: "duplicate_elements",
    description: "Duplicate a selected set of elements with an offset while preserving duplicated group and binding relationships where possible.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        selector: { type: "object" },
        dx: { type: "number" },
        dy: { type: "number" },
        offsetX: { type: "number" },
        offsetY: { type: "number" },
        snapshot: { type: "boolean" },
        dryRun: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "lock_elements",
    description: "Lock matching elements so accidental user or agent edits are less likely.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        selector: { type: "object" },
        snapshot: { type: "boolean" },
        dryRun: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "unlock_elements",
    description: "Unlock matching elements.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        selector: { type: "object" },
        snapshot: { type: "boolean" },
        dryRun: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "arrange_canvas",
    description: "Run deterministic layout or readability helpers after semantic drawing. Use sparingly as an assistant, not as the design authority.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        mode: { type: "string", enum: ["polish", "layout"], description: "polish for readable spacing, layout for align/distribute/grid." },
        plan: { type: "object", description: "Layout/polish options." },
        snapshot: { type: "boolean" },
        dryRun: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "set_viewport",
    description: "Persist viewport metadata such as scroll and zoom for the scene. Useful when preparing the browser view.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        scrollX: { type: "number" },
        scrollY: { type: "number" },
        zoom: { type: "number" },
        viewBackgroundColor: { type: "string" },
        dryRun: { type: "boolean" }
      },
      required: ["scene"]
    }
  },
  {
    name: "insert_library_item",
    description: "Insert an installed Excalidraw library item into the canvas. Search or inspect libraries first when unsure.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        libraryId: { type: "string" },
        item: { description: "Item index or name fragment." },
        x: { type: "number" },
        y: { type: "number" },
        scale: { type: "number" },
        snapshot: { type: "boolean" }
      },
      required: ["scene", "libraryId"]
    }
  },
  {
    name: "search_libraries",
    description: "Search installed Excalidraw libraries by user brief, component need, or visual language.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    name: "inspect_library",
    description: "Inspect one installed Excalidraw library and list its available item names.",
    inputSchema: {
      type: "object",
      properties: {
        libraryId: { type: "string" }
      },
      required: ["libraryId"]
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
    name: "snapshot_canvas",
    description: "Snapshot the current scene before user or agent edits.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        label: { type: "string" }
      },
      required: ["scene"]
    }
  },
  {
    name: "inspect_canvas",
    description: "Inspect the current canvas and compare it with a snapshot to infer what changed.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string" },
        from: { type: "string", description: "latest or snapshot file name/path." }
      },
      required: ["scene"]
    }
  },
  {
    name: "list_canvases",
    description: "List workbench-managed Excalidraw scenes in the configured artifacts directory.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_runtime_config",
    description: "Return project paths, artifacts directory, default font, and workbench URL.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

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
  const tool = canvasTools[name];
  if (!tool) {
    throw new Error(`Unknown Excalidraw Codex MCP tool: ${name}`);
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
        "Use this server as a canvas-aware Excalidraw bridge.",
        "Prefer read_me/read_diagram_guide, describe_scene or get_canvas_context before editing.",
        "Use create_view for compact official-style drawing, batch_create_elements for element-level drawing, and apply_canvas_patch for semantic edits.",
        "Use CLI/workbench for deterministic service startup, library installation, and final file management."
      ].join("\n")
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS
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
  return TOOL_DEFINITIONS;
}
