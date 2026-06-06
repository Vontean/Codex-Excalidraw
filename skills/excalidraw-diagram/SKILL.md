---
name: excalidraw-diagram
description: Use when the user asks Codex or Claude Code to draw, sketch, create a whiteboard, architecture diagram, flowchart, system map, process diagram, product concept map, low-fidelity prototype, or visual explanation with Excalidraw; especially when they want an editable .excalidraw canvas, PNG/SVG exports, or a local browser workbench instead of Mermaid-only output.
metadata:
  short-description: Create editable Excalidraw diagrams
---

# Excalidraw Diagram

Use this skill to create editable Excalidraw diagrams with the `excalidraw-codex` CLI and local workbench.

## Runtime Discovery

Prefer the installed CLI:

```sh
excalidraw-codex config
```

Read this first in every new project/session. Use the returned `artifactsDir` and `workspaceRoot` in the final answer instead of assuming the current repository has `artifacts/excalidraw`.

If the command is unavailable, read `~/.codex-excalidraw/config.json` and run the CLI from the recorded `installedFrom` path:

```sh
node <installedFrom>/bin/excalidraw-codex.mjs config
```

If neither exists, ask the user to run the repository setup script.

## Default Workflow

1. Decide the expression strategy before choosing a tool path:
   - Identify whether the diagram should explain, compare, brainstorm, decide, plan, or prototype.
   - Choose the visual organization: pipeline, hierarchy, board, map, timeline, swimlane, wireframe, page flow, decision tree, dashboard, or a freer whiteboard composition.
   - Decide the shape/component language, title hierarchy, copy density, reading path, and whether the scene should feel structured, exploratory, playful, technical, or product-focused.
2. For non-trivial briefs, ask the CLI for a lightweight expression plan before generating:
   - `excalidraw-codex plan - --template auto --json`
   - Use the plan to confirm language, intent, visual organization, reading path, component language, copy density, and library intent.
   - Treat the expression plan as a structured design brief, not as a rigid visual mode. Override it only when the user's intent clearly asks for a different expression.
3. Choose the generation path:
   - Use Mermaid conversion for conventional flowcharts, architecture maps, sequence diagrams, state diagrams, and process diagrams.
   - Use `from-brief` recipes for architecture exploration, product sketches, low-fidelity wireframes, annotated UI guide maps, page maps, implementation plans, and layouts where precise placement matters.
   - Use direct `.excalidraw` element generation when the user wants a more expressive whiteboard than Mermaid or the templates can express.
4. Generate or update an editable source file:
   - `excalidraw-codex from-brief - --scene <slug>.excalidraw --template auto --preview`
   - `excalidraw-codex from-mermaid - --scene <slug>.excalidraw`
   - Use `--scene <slug>.excalidraw` for workbench-managed scenes. Use `--out ./path/to/file.excalidraw` only when the user explicitly wants a real external file path.
   - For existing scenes, prefer `patch` or `batch` over regenerating the whole canvas.
5. Use public Excalidraw libraries only when they improve expression:
   - `excalidraw-codex library select "<brief>"`
   - `excalidraw-codex library inspect <library-id>`
   - `excalidraw-codex library insert <slug>.excalidraw <library-id> <item-index|item-name> --x 80 --y 80`
   - Do not install new libraries unless the user explicitly asks.
6. Validate and QA:
   - `excalidraw-codex validate <slug>.excalidraw`
   - `excalidraw-codex qa <slug>.excalidraw`
   - Fix blocking issues such as empty scenes, broken structure, clear text clipping, or severe overlap.
   - Treat polish freshness, connector label spacing, unbound annotation/guide lines, and route-crossing warnings as design review prompts, not automatic reasons to make the canvas rigid.
7. Export:
   - For quick discussion, export PNG only.
   - For final delivery, reuse one render pass: `excalidraw-codex export <slug>.excalidraw --format all --require-qa`
8. Review the rendered PNG/SVG or browser canvas like a designer:
   - Check clarity, hierarchy, copy fit, route readability, and whether the composition matches the user's intent.
   - Keep one default workflow. Do not expose multiple quality modes to the user.
   - After the first good visual pass, make at most one automatic targeted repair unless the user explicitly asks for a more polished or presentation-ready diagram.
9. Start or reuse the workbench when the user wants to edit:
   - `excalidraw-codex serve`
   - `serve` defaults to the production build so it is safe to launch from another project directory. Use `--dev` only when editing the workbench itself.
   - Open `"http://127.0.0.1:3000/?scene=<slug>.excalidraw"` in the available browser surface. Quote URLs containing `?` in shell commands.
   - Report the actual selected port from the `serve` output if the CLI falls back from 3000 to another port.

## Read-Back Workflow

Use this when the user edited a canvas and asks the agent to inspect, understand, compare, or continue:

1. Snapshot first:
   - `excalidraw-codex snapshot <slug>.excalidraw --label before-agent`
2. Inspect in one combined pass:
   - `excalidraw-codex inspect <slug>.excalidraw --from latest`
3. Explain the current canvas and likely edit intent before changing it.
4. If the user wants edits, prefer local changes with `patch`, `batch`, `layout`, or `polish`.
5. Run `validate`, `qa`, and refresh previews after meaningful changes.

## Language Rule

Follow the user's current conversation language for generated canvas text:

- If the user is communicating in Chinese, write titles, section headings, node labels, annotations, and UI/wireframe text in Chinese.
- If the user is communicating in English, write the canvas text in English.
- For other languages, use that same language.
- Preserve product names, API names, code identifiers, filenames, and quoted source terms unless the user asks to translate them.

## Diagram Guidance

- Do not reduce Excalidraw to flowcharts. Support architecture exploration, product ideation, low-fidelity prototypes, page relationship maps, data stories, planning maps, and visual explanations.
- Choose shapes deliberately: sections for boundaries, cards for entities, sticky notes for ideas, phone/web frames for product UI, decision controls for branching, chart components for data stories, and freeform marks only when they clarify.
- For product feature walkthroughs or UI explanations, prefer the annotated UI map recipe over a generic wireframe. A good output should include a recognizable screen frame, numbered callouts, feature notes, and guide arrows.
- Prefer grouped shape + text primitives over hidden shape labels so the canvas stays readable, editable, and easy for the agent to inspect after user edits.
- Keep text short and purposeful. Use annotations for context instead of stuffing long prose into nodes.
- Size text by role: title, section heading, node label, annotation.
- Use layout direction deliberately: left-to-right for pipelines, top-down for hierarchy, boards for exploration, page-like grids for wireframes.
- Treat `polish` as a readability assistant, not a style authority.
- Treat the expression plan, recipe layer, component layer, and public libraries as token-saving building blocks, not fixed templates.

## Output Contract

Return useful paths when generation succeeds:

- Editable canvas: `<artifactsDir>/<slug>.excalidraw` from `excalidraw-codex config`, unless the user explicitly requested `--out <path>`.
- PNG preview: `<artifactsDir>/<slug>.png`
- SVG preview: `<artifactsDir>/<slug>.svg`
- Browser URL: `"http://127.0.0.1:<actual-port>/?scene=<slug>.excalidraw"`
