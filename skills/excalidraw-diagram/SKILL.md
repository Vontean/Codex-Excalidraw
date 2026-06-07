---
name: excalidraw-diagram
description: Use when the user asks Codex or Claude Code to draw, sketch, create a whiteboard, architecture diagram, flowchart, system map, process diagram, product concept map, low-fidelity prototype, or visual explanation with Excalidraw; especially when they want an editable canvas, visual read-back, PNG/SVG exports, or a local browser workbench instead of Mermaid-only output.
metadata:
  short-description: Create editable Excalidraw diagrams
---

# Excalidraw Diagram

Use this skill as a canvas-aware Excalidraw workflow. The main path is MCP-first: Codex reads the current canvas, applies semantic batches of edits, reviews the resulting canvas, and keeps deterministic file/service work in the CLI.

## Runtime Discovery

Start every new project/session by discovering the installed runtime:

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

## Roles

- **Codex / LLM** decides intent, visual metaphor, language, hierarchy, copy density, shape choice, library choice, and what to change after seeing the canvas.
- **MCP canvas bridge** is Codex's eye and hand: read canvas context, snapshot, apply semantic patches, insert library items, inspect changes, and export visual previews.
- **CLI** handles deterministic work: install/setup, serve/reuse the workbench, configure paths, install/search public libraries, validate files, export assets, and open URLs.
- **Workbench** is the user's editable canvas at `http://127.0.0.1:3000/`.

Do not treat MCP as a replacement for every CLI command. Use MCP when the agent needs canvas state. Use CLI when the action is file/service/library plumbing.

## Default MCP-First Workflow

1. Discover config and confirm MCP availability:
   - `excalidraw-codex config --json`
   - `excalidraw-codex mcp-config --json`
   - `excalidraw-codex doctor --json` when a session is newly attached, a tool is missing, or port `3000` was started by another session. If doctor reports missing server capabilities, restart the shared workbench on `3000` instead of falling back to another port.
   - If doctor reports stale or missing `build-assets`, run `excalidraw-codex serve` or `npm run build`; do not switch ports to work around a blank or outdated workbench.
   - If doctor reports a failing `share-payload` check, external Excalidraw URL sharing is not safe to use in that runtime; continue with local `.excalidraw`/PNG/SVG outputs until the runtime is fixed.
2. Start or reuse the workbench when the user will inspect or edit:
   - `excalidraw-codex serve`
   - Port `3000` is the shared workbench. If it is already serving Excalidraw Codex, reuse it.
3. Open or create a scene through MCP:
   - `open_or_create_canvas`
4. Read the current canvas before editing:
   - `read_diagram_guide` with `topic: "workflow"` and then the relevant topic (`layout`, `visual-language`, `text`, or `review`).
   - `get_live_canvas_status` to see whether the browser workbench has an unsaved live draft.
   - `get_canvas_context`
   - If the user edited the canvas, also use `snapshot_canvas` and `inspect_canvas`.
5. Decide the visual expression in natural language before patching:
   - What should the diagram explain, compare, explore, decide, plan, or prototype?
   - Which visual organization fits: pipeline, hierarchy, board, map, timeline, swimlane, wireframe, page flow, decision tree, dashboard, or freer whiteboard?
   - Which shapes/components/libraries best express the idea?
6. Draw with semantic batches:
   - Prefer `create_view` for expressive first-pass drawing from a compact element array. Use `cameraUpdate` to frame the workbench view.
   - Keep `create_view` reveal/progressive mode off by default for speed. Turn `reveal: true` on only for demos, teaching, complex walkthroughs, or when the user explicitly benefits from watching the drawing evolve.
   - Prefer `batch_create_elements`, `update_element`, `delete_element`, `align_elements`, and `distribute_elements` when following common Excalidraw MCP element-level workflows.
   - Use `apply_canvas_patch` once per meaningful section, region, flow lane, screen, or cluster.
   - Avoid one MCP call per primitive. Avoid one giant blind patch for the whole diagram when the canvas is complex.
   - Use grouped shape + text primitives so the canvas stays readable, editable, and inspectable.
7. Use libraries only when they improve expression:
   - `search_libraries`
   - `inspect_library`
   - `insert_library_item`
   - Do not install new libraries unless the user explicitly asks; installation is a CLI task.
8. Review after meaningful edits:
   - `review_canvas` when visual review matters. Use it for complex diagrams, low-fidelity UI, dense layouts, or whenever the user is evaluating visual quality. It returns the PNG image plus context, QA notes, and the review checklist in one packet.
   - `get_canvas_context` for structure and layout issues when a full visual packet is unnecessary.
   - `get_canvas_screenshot` when you only need the PNG image or want a separate visual check after a small patch.
   - `export_canvas` or CLI `excalidraw-codex export` for final PNG/SVG assets.
   - Make at most one automatic targeted repair after a good first pass unless the user asks for more polish.
9. Return useful outputs:
   - Editable canvas: `<artifactsDir>/<slug>.excalidraw`
   - Browser URL: `http://127.0.0.1:3000/?scene=<slug>.excalidraw`
   - PNG/SVG paths when exported.

## MCP Tool Use

Prefer these tools:

- `open_or_create_canvas`: create or load the working scene.
- `read_me`: compatibility guide for mature Excalidraw MCP drawing patterns; read once before `create_view` if starting from element arrays.
- `create_view`: official-style compact drawing path; supports `cameraUpdate`, `delete`, and `restoreCheckpoint` pseudo-elements, returns a checkpoint, and can optionally reveal stages live in the workbench.
- `describe_scene`: structured canvas read-back compatible with common Excalidraw MCP workflows.
- `create_from_mermaid`: convert Mermaid into an editable Excalidraw canvas when the source structure is naturally Mermaid-shaped.
- `batch_create_elements`: create multiple elements at once; accepts `startElementId` / `endElementId` for bound arrows.
- `update_element` / `delete_element`: targeted element updates.
- `group_elements` / `ungroup_elements`: keep related elements movable and editable.
- `align_elements` / `distribute_elements`: deterministic small layout helpers, used after the LLM chooses the composition.
- `export_scene` / `import_scene`: move `.excalidraw` JSON or element arrays through the MCP layer when staying inside the canvas workflow is more ergonomic than shelling out.
- `export_to_image`: MCP-compatible alias for browser-rendered PNG/SVG export.
- `export_to_excalidraw_url`: explicitly upload an encrypted scene payload to excalidraw.com and return a shareable URL. Use only when the user asks for an external/shareable Excalidraw link; otherwise keep work local.
- `get_live_canvas_status`: check whether the workbench has an unsaved live draft. MCP reads live canvas state by default when available.
- `get_canvas_context`: read compact metadata, elements, regions, connections, and layout issues.
- `get_canvas_screenshot`: return a rendered PNG as MCP image content so the agent can visually review the result.
- `review_canvas`: preferred visual review packet for non-trivial diagrams; includes context, QA, review principles, and a PNG image. Inspect the image before deciding the canvas is done.
- `read_diagram_guide`: load reusable drawing guidance for workflow, layout, visual language, text, or review.
- `query_elements` / `get_element`: inspect specific canvas elements before targeted edits.
- `apply_canvas_patch`: add/update/delete/group/connect elements in semantic batches.
- `clear_canvas`: reset a scene while snapshotting first.
- `duplicate_elements`: duplicate selected groups/elements with an offset.
- `lock_elements` / `unlock_elements`: protect or release stable regions.
- `set_viewport`: persist viewport metadata for the workbench.
- `arrange_canvas`: use deterministic layout/polish helpers sparingly after the semantic design is already clear.
- `search_libraries` / `inspect_library` / `insert_library_item`: use installed Excalidraw libraries as visual vocabulary.
- `snapshot_canvas` / `snapshot_scene` / `inspect_canvas`: understand user edits before continuing.
- `restore_snapshot`: roll back after an unsuccessful drawing pass or continue from a checkpoint.
- `export_canvas`: render PNG/SVG through the browser path.
- `list_canvases` / `get_runtime_config`: discover available scenes and runtime paths.

## Fallbacks

- Use `create_from_mermaid` or CLI `from-mermaid` for simple conventional flowcharts when editable Excalidraw output is useful but canvas-aware iteration is unnecessary.
- Use `patch`, `layout`, `polish`, `qa`, and `export` CLI commands when MCP is unavailable.
- Treat `plan` and `from-brief` as legacy quick-draft helpers only. Do not use them as the default path for expressive product, architecture, or UI diagrams.

## Live Canvas Rule

The workbench syncs the current browser canvas to the local service as a live draft. MCP tools prefer that live draft when available, then fall back to the saved `.excalidraw` file.

- Before modifying a scene that may be open in the browser, call `get_live_canvas_status`.
- If a live draft exists, trust `get_canvas_context` over a raw file read.
- Patch/export/snapshot tools materialize the live draft first so unsaved user edits are not lost.
- After MCP writes a scene, the browser workbench can pick up the new live revision automatically. The user should not need to refresh for normal agent patches.
- Still return the saved file path in the final answer; live drafts are collaboration state, not the final artifact contract.

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

- Do not reduce Excalidraw to flowcharts. Support architecture exploration, product ideation, low-fidelity prototypes, page maps, data stories, planning maps, and visual explanations.
- Use sections for boundaries, cards for entities, sticky notes for ideas, phone/web frames for product UI, decision controls for branching, chart components for data stories, and freeform marks only when they clarify.
- Keep text short and purposeful. Use annotations for context instead of stuffing long prose into nodes.
- Size text by role: title, section heading, node label, annotation.
- Leave generous whitespace. Long labels need wider elements or a different composition, not smaller text squeezed into fixed boxes.
- Treat deterministic layout/polish as an assistant, not the design authority. Codex should make the visual judgment after reading the canvas.
- When the user edits the canvas, read the edited scene first and infer their intent before changing direction.
- For large background zones, do not use bound/centered labels; place a standalone heading at the top-left of the zone.
- Keep arrow labels short. If the relationship needs a sentence, use a nearby annotation instead of squeezing text onto a short arrow.
- Route long cross-zone connectors around clear lanes rather than through unrelated cards, frames, or UI screens.

## Output Contract

Return the actual paths and URL:

- Editable canvas: `<artifactsDir>/<slug>.excalidraw`
- PNG preview: `<artifactsDir>/<slug>.png` if exported
- SVG preview: `<artifactsDir>/<slug>.svg` if exported
- Browser URL: `http://127.0.0.1:3000/?scene=<slug>.excalidraw`
