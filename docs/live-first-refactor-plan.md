# Live-first Excalidraw Refactor Plan

Status: implemented refactor record. This document keeps the original baseline findings and the migration plan, then records the implementation outcome.

## Goal

Refactor this project into a simpler, intent-first, live-first Excalidraw collaboration plugin for Codex.

The end state should let a user open the Codex In-App Browser, watch meaningful drawing progress on a shared Excalidraw canvas, interrupt early, give feedback, and have Codex continue from the current live canvas state.

At the same time, the Skill, CLI, and MCP surfaces should stop behaving like a large capability dump. They should guide Codex through a small number of real workflows while preserving the LLM's visual judgment.

## Original Baseline Evidence

### Skill and guide bias

- `skills/excalidraw-diagram/SKILL.md` correctly says the LLM owns intent, visual metaphor, hierarchy, copy density, shape choice, and library choice.
- The same Skill then repeats workflow terms such as `semantic batches`, `section`, `region`, `flow lane`, `screen`, `cluster`, `node`, and `connector`. That language can push Codex toward modular rectangle diagrams even when the user intent calls for a different visual model.
- `server/diagram-guide.mjs` is currently the strongest source of box-heavy defaults:
  - `workflow` says to inspect after each meaningful `region`.
  - `layout` is framed around sections, nodes, callouts, flows, screens, containers, regions, boxes, and lanes.
  - `visual-language` says rectangles/cards are for stable concepts, but it appears before a richer intent taxonomy.
- The current guidance already has useful anti-rigidity statements: deterministic layout helpers should be assistants only, not the design authority; QA should not flatten expressive composition; the user's edited canvas should be read before continuing.

### MCP surface

Before this refactor, `mcp-config --json` exposed 40 public tools:

`read_me`, `create_view`, `describe_scene`, `create_from_mermaid`, `batch_create_elements`, `export_scene`, `import_scene`, `export_to_image`, `export_to_excalidraw_url`, `update_element`, `delete_element`, `group_elements`, `ungroup_elements`, `align_elements`, `distribute_elements`, `snapshot_scene`, `restore_snapshot`, `open_or_create_canvas`, `get_canvas_context`, `get_live_canvas_status`, `get_canvas_screenshot`, `review_canvas`, `read_diagram_guide`, `query_elements`, `get_element`, `apply_canvas_patch`, `clear_canvas`, `duplicate_elements`, `lock_elements`, `unlock_elements`, `arrange_canvas`, `set_viewport`, `insert_library_item`, `search_libraries`, `inspect_library`, `export_canvas`, `snapshot_canvas`, `inspect_canvas`, `list_canvases`, `get_runtime_config`.

Observed redundancy:

- `read_me` overlaps with `read_diagram_guide`.
- `export_to_image` aliases `export_canvas`.
- `snapshot_scene` aliases `snapshot_canvas`.
- `update_element`, `delete_element`, `group_elements`, `ungroup_elements`, `lock_elements`, and `unlock_elements` are wrappers over semantic patch operations.
- `describe_scene`, `get_canvas_context`, `query_elements`, and `get_element` overlap as read/query tools.
- Many model-facing tools are micro-operations that encourage coordinate-level work instead of intent-level drawing.

Verification was also coupled to the large surface:

- `bin/excalidraw-codex.mjs` checks `mcpTools.length >= 35`.
- `scripts/smoke-mcp.mjs` hardcodes many individual tool names and exercises micro-tools as the definition of health.

### CLI surface

The CLI is already closer to the desired boundary. It owns deterministic operations:

- setup/service/config: `serve`, `config`, `doctor`, `mcp`, `mcp-config`, `open`;
- file operations: `validate`, `export`, `share`, `snapshot`, `snapshots`, `restore`, `read`, `diff`, `inspect`, `patch`, `batch`, `layout`, `polish`, `qa`, `gallery-refresh`;
- library operations;
- legacy quick-draft helpers: `from-mermaid`, `plan`, `from-brief`.

The issue is not that these commands exist. The issue is that some legacy and low-level concepts leak into the default agent workflow.

### Live canvas

The live bridge is real:

- Workbench edits debounce for about 650 ms and POST a full scene to `/api/live-scenes/:name`.
- The browser polls live scene state roughly every 1200 ms.
- MCP tools read live state first when available.
- MCP tools materialize live state before many file operations.
- MCP-origin edits push full scene updates back to live state.
- `create_view` supports staged reveal via `reveal`, `progressive`, or `stream`.
- `cameraUpdate` pseudo-elements are translated into `scrollX`, `scrollY`, and `zoom`.
- Smoke tests prove Workbench -> live -> MCP read -> MCP patch -> Workbench update.

Baseline limitations:

- The current live bridge is whole-scene replacement, not patch-level collaboration.
- There is no SSE/WebSocket event channel yet; the browser polls.
- User edit protection is opportunistic timestamp checking, not conflict-safe revision control.
- Current `stream` wording can imply token-level or MCP App partial streaming, but the implementation is staged reveal after the tool call begins processing.

Implemented live updates after this refactor:

- live entries now use service-owned monotonic revisions;
- live writes accept `baseRevision` and reject stale writes with a conflict response;
- the workbench subscribes to live scene SSE events and keeps polling as a fallback;
- MCP writes carry the latest live base revision when they materialize or read live state;
- `open_or_create_canvas` returns session/readiness/live metadata.

### Official `excalidraw/excalidraw-mcp`

The official MCP app uses a different architecture:

- only two public tools in the manifest: `read_me` and `create_view`;
- an MCP App widget receives `ontoolinputpartial` and `ontoolinput`;
- partial JSON is rendered into SVG through `exportToSvg` and `morphdom`;
- camera movement is driven by `cameraUpdate`;
- checkpoint/restore is central;
- fullscreen user edits are persisted through checkpoint tools and local storage;
- screenshot context is sent back to the model.

This project should not blindly copy the official architecture. The official repo optimizes for chat-embedded MCP App streaming. This project should keep its local Excalidraw workbench and real editable canvas, while borrowing:

- smaller public tool surface;
- progressive element ordering discipline;
- checkpoint/edit contract;
- model-visible screenshot review loop;
- camera as a narrative device.

## Target Architecture

### Boundary 1: Skill

The Skill should be an intent-first workflow contract.

It should teach Codex to choose a visual model before choosing a tool. It should not prescribe a universal drawing rhythm.

Replace default "regions/sections/modules" wording with a decision step:

1. Interpret the user's intent.
2. Choose a visual model.
3. Choose the collaboration rhythm.
4. Choose the canvas operation.
5. Review the result visually.
6. Continue from user edits or finalize.

Examples of visual models:

- flowchart for procedural logic;
- branching map for choices;
- architecture map for system boundaries;
- layered system for stacks or dependencies;
- timeline for temporal evolution;
- concept map for relationships;
- tension field for competing forces;
- evidence board for claims and support;
- storyboard for journey or scenario;
- UI sketch for product surfaces;
- annotated object/anatomy for component explanation;
- spatial map for domains, territory, or conceptual geography;
- freeform explanation when no standard diagram type fits.

Boxes and arrows remain valid, but only when the chosen visual model calls for them.

### Boundary 2: MCP

MCP should expose workflow tools, not every helper operation.

Target public surface should be roughly 8-12 tools:

| Target public tool | Purpose | Current source | Recommendation |
| --- | --- | --- | --- |
| `read_diagram_guide` | Intent-first guidance and review criteria | `read_diagram_guide`, `read_me` | Keep one public guide tool; make `read_me` compatibility-only. |
| `open_or_create_canvas` or `start_live_session` | Open/create scene, return browser URL, live status, and session metadata | `open_or_create_canvas`, `get_live_canvas_status`, `get_runtime_config` | Merge toward one session starter. |
| `get_canvas_context` | Read compact current canvas state | `get_canvas_context`, `describe_scene`, `query_elements`, `get_element` | Keep one structured read tool; hide or deprecate the rest. |
| `create_view` | Intent-first first pass or full view creation, with optional staged reveal | `create_view`, `batch_create_elements` | Keep public; make `batch_create_elements` internal/compatibility. |
| `apply_canvas_patch` | Semantic updates to current canvas | `apply_canvas_patch`, `update/delete/group/align/distribute/...` | Keep one semantic patch tool; hide micro-ops. |
| `review_canvas` | Visual review packet with QA and screenshot | `review_canvas`, `get_canvas_screenshot` | Keep `review_canvas`; keep screenshot as internal or optional alias. |
| `snapshot_canvas` / `restore_snapshot` | Preserve and restore user/agent checkpoints | `snapshot_canvas`, `snapshot_scene`, `restore_snapshot`, `inspect_canvas` | Keep snapshot/restore, but expose as checkpoint workflow. |
| `export_canvas` | Final PNG/SVG export | `export_canvas`, `export_to_image`, `export_scene` | Keep browser-rendered export public; make aliases/file IO internal. |
| `export_to_excalidraw_url` | Explicit external share | `export_to_excalidraw_url` | Keep public but non-default and explicit. |
| `create_from_mermaid` | Optional structured conversion | `create_from_mermaid` | Keep only if Mermaid remains a first-class input workflow; otherwise CLI fallback. |

Compatibility tools can remain internally callable, or remain temporarily available behind a compatibility mode, but should not be in the default model-facing tool list.

Implementation note: the final implementation is stricter than the initial compatibility suggestion. Old MCP micro-tools were removed from the public tool list, rejected by public `callTool`, removed from `canvasTools`, and their MCP-only implementation functions were deleted where they had no remaining public workflow or CLI dependency.

### Boundary 3: CLI

CLI should stay deterministic and operational.

Keep:

- `serve`, `open`, `doctor`, `config`, `mcp`, `mcp-config`;
- `export`, `share`, `snapshot`, `restore`, `validate`, `qa`, `inspect`, `diff`, `read`;
- library installation and registry operations;
- package setup and verification commands.

Deprecate as default agent workflows:

- `plan`;
- `from-brief`;
- template-heavy quick drafts.

They can remain as legacy fallback commands, but the Skill should not route expressive diagram work through them.

### Boundary 4: Workbench live collaboration

The workbench should become the user's visible collaboration surface.

Target live flow:

1. Start/reuse workbench.
2. Open or create a named canvas.
3. Return the browser URL immediately.
4. Read current live state.
5. Choose drawing strategy from user intent.
6. Draw or update in meaningful increments.
7. After each user-meaningful pass, make the latest state visible and optionally review screenshot/context.
8. If the user interrupts, read live state again and infer their intent from canvas changes plus message.
9. Snapshot before risky changes.
10. Export only after the user or task says the artifact is ready.

Near-term live implementation can keep HTTP staged reveal. The plan should not claim true streaming unless SSE/WebSocket or MCP App partial input is implemented.

Longer-term live protocol:

- add a live session id;
- add monotonic server revisions;
- require `baseRevision` for writes;
- reject stale writes instead of silently overwriting;
- surface conflict status in the workbench;
- move browser updates from polling to SSE first, WebSocket only if needed;
- apply MCP-origin patches when possible instead of replacing whole scenes;
- treat user edits as first-class live checkpoints.

## Tool Disposition Plan

| Current tool | Disposition | Rationale |
| --- | --- | --- |
| `read_diagram_guide` | Keep public | Main guidance tool; rewrite around intent-first strategy. |
| `read_me` | Hide/deprecate | Compatibility alias; duplicates guide. |
| `open_or_create_canvas` | Keep public or merge into `start_live_session` | Needed for session start; should also include live status/browser URL. |
| `get_live_canvas_status` | Merge | Useful but should be part of session/read flow, not standalone default. |
| `get_runtime_config` | Hide | Operational metadata; CLI or resource can expose it. |
| `list_canvases` | Hide | Useful admin/listing helper, not core drawing workflow. |
| `get_canvas_context` | Keep public | Core shared-state read. |
| `describe_scene` | Hide/deprecate | Overlaps with context; prose can be generated by the LLM from structured context. |
| `query_elements` | Hide | Low-level query; internal helper for context/patch flows. |
| `get_element` | Hide | Micro-read; use context or semantic selectors. |
| `create_view` | Keep public | Primary first-pass drawing path; ensure it preserves visual freedom. |
| `batch_create_elements` | Hide/deprecate | Lower-level version of draw/patch; encourages primitive batching. |
| `apply_canvas_patch` | Keep public | Core semantic update path. |
| `update_element` | Hide/deprecate | Wrapper over patch. |
| `delete_element` | Hide/deprecate | Wrapper over patch. |
| `group_elements` | Hide/deprecate | Wrapper over patch. |
| `ungroup_elements` | Hide/deprecate | Wrapper over patch. |
| `align_elements` | Hide/deprecate | Deterministic helper; keep internal or CLI layout. |
| `distribute_elements` | Hide/deprecate | Deterministic helper; keep internal or CLI layout. |
| `duplicate_elements` | Hide | Low-level edit helper. |
| `lock_elements` | Hide | Low-level protection helper; may be patch option. |
| `unlock_elements` | Hide | Low-level protection helper. |
| `clear_canvas` | Keep only if part of session reset | Otherwise hide; destructive enough to require explicit workflow. |
| `arrange_canvas` | Hide or keep as review repair | Risk of flattening expressive composition. |
| `set_viewport` | Hide | Viewport should be part of draw/review/session, not standalone. |
| `get_canvas_screenshot` | Merge into review | Keep as internal rendering primitive. |
| `review_canvas` | Keep public | Best final/review loop tool. |
| `snapshot_canvas` | Keep public as checkpoint | Needed before risky/user-visible edits. |
| `snapshot_scene` | Hide/deprecate | Alias. |
| `restore_snapshot` | Keep public | Needed for user feedback and rollback. |
| `inspect_canvas` | Hide | Specialized diff helper; make internal or CLI. |
| `export_canvas` | Keep public | Final local artifact export. |
| `export_to_image` | Hide/deprecate | Alias. |
| `export_scene` | Hide or CLI-only | File IO should be deterministic CLI unless model specifically needs raw scene transfer. |
| `import_scene` | Hide or CLI-only | File IO/import should not be normal drawing workflow. |
| `export_to_excalidraw_url` | Keep public explicit | External share requires explicit user intent. |
| `create_from_mermaid` | Optional public | Keep if Mermaid input is a core workflow; otherwise CLI fallback. |
| `search_libraries` | Hide or optional advanced | Library selection should not distract default workflow. |
| `inspect_library` | Hide or optional advanced | Same as above. |
| `insert_library_item` | Hide or optional advanced | Could be invoked by a higher-level draw/update workflow. |

## Skill Redesign Plan

Replace the current fixed workflow with this shape:

1. Runtime discovery.
2. Read current canvas if a scene exists.
3. Interpret the user intent.
4. Choose visual model and drawing rhythm.
5. Choose whether live-first is useful for this task.
6. Use one public MCP workflow tool at a time.
7. Review visually when the result matters.
8. Continue from live user edits.
9. Export final artifacts.

Add a `Visual Strategy` section:

- Ask: is this explaining sequence, choice, structure, geography, evidence, comparison, time, journey, anatomy, or interface?
- Pick the visual model from that answer.
- Let rectangles, arrows, lanes, modules, and regions be optional vocabulary, not defaults.
- Prefer fewer, stronger visual decisions over many same-looking boxes.

Add a `Live-first Trigger` section:

- Turn on live-first when the user wants to watch, steer, co-edit, explore, teach, or build a complex diagram.
- Use fast batch mode only for simple final-output requests.
- In live-first mode, sync meaningful completed stages to the browser before the final answer. The cadence is chosen from task complexity and drawing strategy; it is not a fixed skeleton/region/lane recipe or a pause after every primitive.

## Migration Plan

### Phase 0: Review this plan

No implementation. Confirm target tool surface, naming, and compatibility stance.

### Phase 1: Documentation and Skill behavior

- Rewrite `skills/excalidraw-diagram/SKILL.md` around intent-first visual strategy.
- Rewrite `server/diagram-guide.mjs` so visual strategy precedes layout primitives.
- Update README/README.zh-CN to describe live-first collaboration and compatibility mode.
- Keep existing tool names for now.

### Phase 2: Public MCP surface separation

- Split MCP definitions into `publicWorkflowTools` and `compatibilityTools`.
- Make `listMcpTools()` return the public set by default.
- Keep internal `canvasTools` implementations so existing code is not deleted prematurely.
- Provide a compatibility mode if needed for older agents/tests.

### Phase 3: Verification migration

- Change `doctor` from `toolCount >= 35` to workflow capability checks.
- Replace inventory-style `smoke-mcp` with workflow smoke:
  - guide;
  - open session;
  - create staged view;
  - read live/current context;
  - semantic patch;
  - review canvas with image;
  - snapshot/restore;
  - export;
  - share dry-run only.
- Keep a separate compatibility smoke if old names remain supported.

### Phase 4: Live session maturity

- Add a session-oriented tool or enhance `open_or_create_canvas` to include live status, browser URL, and readiness.
- Add server revisions and `baseRevision`.
- Add stale-write rejection and conflict status.
- Replace polling with SSE.
- Keep WebSocket as a later option only if bidirectional event pressure warrants it.

### Phase 5: Legacy path cleanup

- Mark `plan` and `from-brief` as legacy fallback.
- Stop routing expressive diagram tasks through them.
- Move micro-tools and file IO behind internal helpers or compatibility mode.
- Remove compatibility only after a release boundary and docs update.

## Verification Gates For The Refactor

The refactor is not complete until these can be verified:

- Public MCP tool count is reduced and intentional, ideally around 8-12 default tools.
- `doctor` validates workflow capabilities rather than raw tool count.
- `smoke-mcp` proves workflow behavior rather than enumerating micro-tools.
- `smoke-live-bridge` still proves bidirectional live collaboration.
- Skill guidance contains an intent-first visual strategy section.
- The guide no longer makes rectangles/regions/modules the first default.
- Live-first docs say staged reveal is staged HTTP reveal unless true streaming is implemented.
- Existing local export and share dry-run still work.
- Compatibility/deprecation behavior is documented.

## Implementation Outcome

Implemented in this refactor:

- Public MCP tool count reduced from 40 to 11 workflow tools.
- Old MCP micro-tools and aliases were removed from the public list and from the MCP dispatch table.
- MCP-only dead code for removed tools was deleted from `server/canvas-bridge.mjs`.
- Skill and diagram guide were rewritten around intent-first visual strategy.
- README and README.zh-CN now describe the small workflow surface and staged HTTP reveal accurately.
- `doctor` now validates workflow capabilities instead of `toolCount >= 35`.
- `smoke-mcp` now proves the public workflow and asserts that removed tools are not listed.
- Live canvas now has server revisions, optional `baseRevision`, stale-write conflicts, and SSE with polling fallback.

## Non-goals For The First Implementation Pass

- Do not remove working internals before public compatibility is planned.
- Do not adopt the official SVG-only MCP App rendering architecture wholesale.
- Do not implement CRDT/OT unless a later conflict model requires it.
- Do not force all diagrams into a new fixed taxonomy.
- Do not make live-first mandatory for small/simple one-shot diagram tasks.
- Do not add artificial waits by default; live-first means visible checkpoints, not slow drawing.
