---
name: excalidraw-diagram
description: Use when the user asks Codex or Claude Code to draw, sketch, create a whiteboard, architecture diagram, flowchart, system map, process diagram, product concept map, low-fidelity prototype, or visual explanation with Excalidraw; especially when they want an editable canvas, visual read-back, PNG/SVG exports, or a local browser workbench instead of Mermaid-only output.
metadata:
  short-description: Create editable Excalidraw diagrams
---

# Excalidraw Diagram

Use this skill as an intent-first, live-first Excalidraw workflow. Excalidraw is a shared canvas: read it, draw in meaningful increments, review visually, and continue from user edits.

## Runtime Discovery

Start a truly new or uncertain project/session by discovering the installed runtime:

```sh
excalidraw-codex config --json
excalidraw-codex mcp-config --json
```

Use the returned `artifactsDir`, `workspaceRoot`, `defaultFontFamilyName`, and MCP command. Do not assume a user-specific path.

If the CLI is unavailable, read `~/.codex-excalidraw/config.json` and run the CLI from `installedFrom`:

```sh
node <installedFrom>/bin/excalidraw-codex.mjs config --json
node <installedFrom>/bin/excalidraw-codex.mjs mcp-config --json
```

If neither exists, ask the user to run the repository setup script.

## Fast Workbench Entry

When the user is already working in the In-App Browser, or the current conversation includes an In-App Browser URL for the target scene, use this lighter entry path before doing heavier setup:

1. Create or load the scene with `open_or_create_canvas` and `waitForSubscriberMs` around `800-1500`.
2. If `readiness.browserReady` is true, treat the workbench as already open and bound to the scene. Do not initialize Browser automation, navigate, reload, or run `doctor` just to be safe.
3. If `readiness.browserReady` is false, start or reuse the local workbench with `excalidraw-codex serve`, then open the returned `browserUrl` in the In-App Browser. After navigation, call `open_or_create_canvas` again with `waitForSubscriberMs` and wait for `browserReady` before the first visible write.
4. Run `excalidraw-codex doctor --json` only when a tool is missing, the server cannot be reached, port `3000` is occupied by an incompatible process, export fails, or a live write does not appear in the workbench.
5. Use `config --json` when you need paths, artifact locations, or the default font and they are not already known for the session. Use `mcp-config --json` when configuring or debugging MCP, not as mandatory ceremony for every small drawing.

## Roles

- **Codex / LLM** decides intent, visual model, reading path, language, hierarchy, copy density, shape choice, and what to change after seeing the canvas.
- **MCP canvas bridge** is Codex's eye and hand for the shared canvas: open/read, draw/update semantically, snapshot/restore, review, and export.
- **CLI** handles deterministic work: install/setup, serve/reuse the workbench, configure paths, validate files, export assets, install libraries, and open URLs.
- **Workbench** is the user's editable browser canvas at `http://127.0.0.1:3000/`.

Do not treat MCP as a replacement for every CLI command. Use MCP when the agent needs current canvas state. Use CLI when the action is file, service, or library plumbing.

## Intent-First Workflow

1. Discover config and confirm readiness when needed:
   - `excalidraw-codex config --json`
   - `excalidraw-codex mcp-config --json`
   - `excalidraw-codex doctor --json` when a session is newly attached, a tool is missing, or port `3000` was started by another session.
2. Start or reuse the workbench when the user will inspect, steer, co-edit, or review:
   - `excalidraw-codex serve`
   - Reuse port `3000` when it is already serving Excalidraw Codex.
   - If `open_or_create_canvas` reports `readiness.browserReady` for the intended scene, skip Browser automation entirely; the workbench is already open.
3. Open or create the scene:
   - Use `open_or_create_canvas`.
   - Return or keep track of the `browserUrl`, `session`, `readiness`, and `baseRevision` when useful.
   - If also navigating the In-App Browser, create/open the scene first, then navigate to the returned `browserUrl`. Do not navigate to a scene URL before the scene exists. Do not navigate or reload when the user already has the matching scene open and `browserReady` is true.
   - After browser navigation, call `open_or_create_canvas` again with `waitForSubscriberMs` when the next write must be user-visible; wait until `readiness.browserReady` is true before drawing the first visible stage.
4. Read before editing:
   - Use `read_diagram_guide` with `topic: "workflow"` and, when helpful, `visual-strategy`, `live-collaboration`, `layout`, `visual-language`, `text`, or `review`.
   - Use `get_canvas_context` to read the live canvas/source of truth.
5. Choose the visual model before choosing shapes:
   - Sequence/procedure: flow, timeline, recipe, storyboard.
   - Choice/tradeoff: decision tree, option map, tension field.
   - System structure: architecture map, layered system, topology, dependency map.
   - Relationship/concept: concept map, constellation, matrix, annotated landscape.
   - Evidence/reasoning: evidence board, claim/support map, comparison spread.
   - Product/interface: UI sketch, screen flow, state map, journey storyboard.
   - If none fit, use a freeform whiteboard explanation.
6. Choose the collaboration rhythm from the task:
   - Use live-first when the user wants to watch, interrupt, steer, teach, explore, or co-edit.
   - Use fast batch mode for small one-shot requests where the user only wants the final artifact.
   - In live-first mode, sync the canvas after meaningful, user-visible stages chosen by the LLM from task complexity and visual strategy. Do not force a universal skeleton/region/lane/module sequence.
   - For complex multi-stage drawings, make each stage a real browser-visible result, such as structure, major groups, relationships, annotations, and polish. Push each completed stage to the workbench before moving to the next stage.
   - Do not slow down simple tasks or pause after every primitive. A small flowchart can be created in one pass; a complex architecture, product journey, or UI map should be updated at reviewable checkpoints before the final response.
7. Draw/update with public workflow tools:
   - `create_view` for expressive first passes or full-view creation. Optional `reveal: true` shows staged HTTP workbench updates; it is not true token streaming.
   - `apply_canvas_patch` for semantic changes after reading the current canvas.
   - Use `cameraUpdate`, `delete`, and `restoreCheckpoint` pseudo-elements only inside `create_view`; do not pass them as elements to `apply_canvas_patch`.
   - Keep stage updates live-only by default; do not refresh the gallery PNG preview while the drawing is still evolving.
   - Use `refreshPreview: true` only when an intermediate thumbnail is explicitly useful. Prefer `export_canvas` for the final PNG/SVG and gallery preview.
   - Use `baseRevision` when available so stale writes do not overwrite newer browser edits.
8. Review and continue:
   - Use `review_canvas` for non-trivial diagrams, dense layouts, UI sketches, and visual-quality-sensitive work.
   - For most medium diagrams, review once near the end. `review_canvas` returns a temporary inspection image and should not be treated as the final PNG preview.
   - If the user edits the canvas, read `get_canvas_context` again and infer intent from the latest live state before continuing.
   - Make targeted repairs instead of rebuilding the whole scene when the strategy is already right.
9. Snapshot/export:
   - Use `snapshot_canvas` before risky changes and `restore_snapshot` after an unsuccessful pass.
   - Use `export_canvas` or CLI `excalidraw-codex export` for final PNG/SVG assets.
   - Use `export_to_excalidraw_url` or CLI `share` only when the user explicitly asks for an external share link.

## Public MCP Tools

The MCP server intentionally exposes a small workflow surface:

- `read_diagram_guide`: intent-first guidance and review criteria.
- `open_or_create_canvas`: start/reuse a workbench scene and return live session metadata.
- `get_canvas_context`: read compact current canvas state from live draft when available.
- `create_view`: create a first pass or full view, with optional staged reveal.
- `apply_canvas_patch`: semantic updates to current canvas.
- `review_canvas`: screenshot-backed visual review packet.
- `snapshot_canvas`: checkpoint before risky work.
- `restore_snapshot`: roll back to a checkpoint.
- `export_canvas`: local PNG/SVG export through the browser render path.
- `export_to_excalidraw_url`: explicit external share export.
- `create_from_mermaid`: optional conversion only when the source is naturally Mermaid-shaped.

Avoid old micro-tool habits such as one tool for each update/delete/group/align/query operation. The public surface is designed to keep context small and push visual judgment back into the LLM.

## Fallbacks

- Use `create_from_mermaid` or CLI `from-mermaid` for simple conventional flowcharts when the source is already Mermaid-shaped.
- Use `patch`, `layout`, `polish`, `qa`, and `export` CLI commands only when MCP is unavailable or deterministic file work is the better path.
- Treat `plan` and `from-brief` as legacy quick-draft fallbacks only. Do not use them as the default path for expressive product, architecture, or UI diagrams.

## Live Canvas Rule

The workbench syncs the current browser canvas to the local service as a live draft. MCP tools prefer that live draft when available, then fall back to the saved `.excalidraw` file.

- Open the workbench early when the user wants participation.
- Ensure the browser is bound to the intended scene before the first live write. `readiness.browserReady` means the workbench has subscribed to that scene.
- When the user context says the In-App Browser is already at `http://127.0.0.1:3000/?scene=<slug>.excalidraw`, confirm with `open_or_create_canvas(waitForSubscriberMs)` instead of taking over the browser.
- Trust `get_canvas_context` over raw file reads for scenes that may be open in the browser.
- Patch/export/snapshot tools materialize the live draft first so unsaved user edits are not lost.
- Live writes use service-side revisions. If a conflict appears, read the latest canvas and continue from that state.
- Browser updates use SSE when available and polling as fallback.
- For participatory work, push each completed reviewable stage to the browser before describing it as done. Do not wait until the final assistant answer to make the first visible update.
- Do not update gallery thumbnails during ordinary stage writes. The user is watching the active canvas; refresh the gallery thumbnail when finalizing with `export_canvas` or when explicitly requested.
- Still return the saved file path in the final answer; live drafts are collaboration state, not the final artifact contract.

## User-Facing Communication

- Keep progress updates product-level and visual: say what is appearing on the canvas or what checkpoint is next.
- Avoid exposing implementation details such as MCP schemas, SSE, revisions, browser-ready polling, internal tool names, token cost, or compatibility work unless the user specifically asks.
- When there is a technical limitation that affects the user's experience, explain the impact first and the mechanism only as much as needed.
- Prefer short updates during drawing. Do not narrate every internal check.

## External Share Rule

Keep the normal workflow local. Do not upload a canvas to excalidraw.com unless the user explicitly asks for an external/shareable Excalidraw link.

- Local deliverables: `.excalidraw`, PNG, SVG, and the `http://127.0.0.1:3000/?scene=...` workbench URL.
- External sharing: use MCP `export_to_excalidraw_url` or CLI `excalidraw-codex share <scene.excalidraw>` only after explicit user intent.
- Use `--dry-run` / `dryRun: true` to verify encryption payload generation without uploading.
- The default share export omits customData metadata for privacy; include custom metadata only when the user asks for it.

## Snapshot Retention Rule

Snapshots are an edit safety net, not the long-term artifact. The workbench keeps only the latest configured snapshots per scene by default (`snapshotRetentionLimit`, normally `80`) and prunes older snapshots after new ones are created.

- Use snapshots before risky edits, large redraws, imports, restores, and user-edit inspection.
- Do not promise that old snapshots are permanent history unless the user has configured unlimited retention.
- Preserve final deliverables as `.excalidraw` source files plus exported PNG/SVG previews.
- If the user explicitly asks to keep all snapshots, tell them to set `EXCALIDRAW_CODEX_SNAPSHOT_LIMIT=0` or `"snapshotRetentionLimit": 0`.

## Language Rule

Follow the user's current conversation language for generated canvas text:

- If the user is communicating in Chinese, write titles, section headings, node labels, annotations, and UI/wireframe text in Chinese.
- If the user is communicating in English, write the canvas text in English.
- For other languages, use that same language.
- Preserve product names, API names, code identifiers, filenames, and quoted source terms unless the user asks to translate them.
- Prefer the configured default font from `excalidraw-codex config`. The default is `Nunito`, which avoids Virgil's poor Chinese coverage in mixed Chinese/English diagrams.

## Diagram Guidance

- Do not reduce Excalidraw to flowcharts or card grids. Support architecture exploration, product ideation, low-fidelity prototypes, page maps, data stories, planning maps, evidence boards, concept landscapes, and freeform visual explanations.
- Let rectangles, arrows, lanes, modules, and regions be optional vocabulary, not defaults.
- Keep text short and purposeful. Use annotations for context instead of stuffing long prose into nodes.
- Size text by role: title, area heading, primary label, annotation.
- Leave generous whitespace. Long labels need wider elements or a different composition, not smaller text squeezed into fixed boxes.
- Treat deterministic layout/polish as an assistant, not the design authority.
- When the user edits the canvas, read the edited scene first and infer their intent before changing direction.
- For large background zones, do not use bound/centered labels; place a standalone heading at the top-left of the zone.
- Keep arrow labels short. If the relationship needs a sentence, use a nearby annotation instead of squeezing text onto a short arrow.

## Output Contract

Return the actual paths and URL:

- Editable canvas: `<artifactsDir>/<slug>.excalidraw`
- PNG preview: `<artifactsDir>/<slug>.png` if exported
- SVG preview: `<artifactsDir>/<slug>.svg` if exported
- Browser URL: `http://127.0.0.1:3000/?scene=<slug>.excalidraw`
