# Codex Excalidraw

English | [简体中文](README.zh-CN.md)

Local Excalidraw workbench, MCP canvas bridge, CLI, and agent skill for Codex and Claude Code.

The goal is not to replace Mermaid. It gives agents a canvas-aware way to create editable Excalidraw canvases, read the current scene, patch it in semantic batches, export PNG/SVG previews, open a local browser workbench, and continue from user edits during an implementation conversation.

## What You Get

- A Vite + React + TypeScript Excalidraw workbench.
- A lightweight MCP server named `excalidraw-codex` for canvas-aware agent collaboration.
- A CLI named `excalidraw-codex`.
- A portable `excalidraw-diagram` skill for Codex and Claude Code.
- Mermaid-to-Excalidraw conversion with `@excalidraw/mermaid-to-excalidraw`.
- Canvas tools for reading scene context, applying patches, inserting library items, inspecting user edits, snapshots, and exports.
- Legacy quick-draft helpers for Mermaid and natural-language briefs when MCP is unavailable or a rough first pass is enough.
- Optional public Excalidraw library registry for wireframes, emoji accents, decision controls, business canvases, and data-viz components.

## How It Is Organized

- `Canvas Bridge`: the main agent Interface for opening scenes, reading compact canvas context, applying semantic patches, inserting library items, snapshotting, inspecting, and exporting.
- `MCP Server`: exposes the Canvas Bridge to Codex / Claude Code as tools. This is Codex's "eye and hand" for the canvas.
- `CLI`: owns deterministic setup, workbench serving, config, library installation/search, validation, file export, and fallback commands.
- `Scene Workspace`: owns local scene files, snapshots, preview metadata, and artifact paths.
- `Quality / Export`: keeps QA and browser-rendered PNG/SVG export close to the actual Excalidraw rendering path.
- `Legacy Draft Recipes`: keep Mermaid and brief-to-scene helpers available as fallback, not as the default creative path.

## Requirements

- macOS, Linux, or Windows with a recent shell.
- Node.js 20+; Node 22 LTS is recommended.
- npm.

Core dependencies are installed by the setup script:

```sh
npm install react react-dom @excalidraw/excalidraw @excalidraw/mermaid-to-excalidraw @modelcontextprotocol/sdk
```

## Install

Clone the repository, then run the setup script:

```sh
git clone https://github.com/Vontean/Codex-Excalidraw.git
cd Codex-Excalidraw
npm run setup
```

The setup script will:

- install npm dependencies;
- install Playwright Chromium for export rendering;
- build the workbench;
- link the `excalidraw-codex` CLI locally with `npm link`;
- write local runtime config to `~/.codex-excalidraw/config.json`;
- install the `excalidraw-diagram` skill into Codex and Claude Code skill folders.

Restart Codex or Claude Code after setup so the skill list is refreshed.

### Install Options

Install only for Codex:

```sh
npm run setup -- --agents codex
```

Install only for Claude Code:

```sh
npm run setup -- --agents claude
```

Choose a different workspace or artifacts directory:

```sh
npm run setup -- --workspace ~/Codex-Excalidraw --artifacts ~/Codex-Excalidraw/artifacts/excalidraw
```

Skip optional steps:

```sh
npm run setup -- --skip-playwright
npm run setup -- --skip-link
```

Run build and smoke tests during setup:

```sh
npm run setup -- --verify
```

## Run The Workbench

Start the local server:

```sh
excalidraw-codex serve
```

Open:

```text
http://127.0.0.1:3000/
```

Open a specific scene:

```sh
excalidraw-codex open my-diagram.excalidraw
```

## CLI

Common commands:

```sh
excalidraw-codex config
excalidraw-codex doctor
excalidraw-codex serve
excalidraw-codex mcp-config
excalidraw-codex mcp
excalidraw-codex from-mermaid diagram.md --scene architecture.excalidraw
excalidraw-codex validate product-map.excalidraw
excalidraw-codex qa product-map.excalidraw
excalidraw-codex export product-map.excalidraw --format all --require-qa
excalidraw-codex share product-map.excalidraw --dry-run
excalidraw-codex inspect product-map.excalidraw --from latest
excalidraw-codex snapshot product-map.excalidraw --label before-edit --keep 80
excalidraw-codex gallery-refresh --all
```

`serve` uses the production build by default and is safe to launch from another project directory. It checks `dist/` before starting and automatically rebuilds when the workbench assets are missing or older than the source files. Use `excalidraw-codex serve --dev` only when developing this workbench itself.

MCP commands:

```sh
excalidraw-codex mcp-config --json
excalidraw-codex mcp
```

Use `mcp-config` to get the agent config snippet. `mcp` starts the stdio MCP server and is intended to be launched by Codex / Claude Code, not manually kept in a terminal.

Public MCP workflow tools:

- Guidance: `read_diagram_guide`.
- Session/read: `open_or_create_canvas`, `get_canvas_context`.
- Draw/update: `create_view`, `apply_canvas_patch`.
- Review/checkpoint: `review_canvas`, `snapshot_canvas`, `restore_snapshot`.
- Finalize: `export_canvas`, `export_to_excalidraw_url`.
- Structured conversion: `create_from_mermaid` when the source is naturally Mermaid-shaped.

The MCP surface is intentionally small so the agent sees workflows instead of dozens of low-level edit helpers. `create_view` translates `cameraUpdate` pseudo-elements into the workbench viewport. Optional `reveal: true` sends staged HTTP live updates for demos and walkthroughs; it is not true MCP partial streaming.

`share` / `export_to_excalidraw_url` are explicit external-sharing actions. They encrypt the scene payload locally and upload it to Excalidraw's JSON store only when invoked. Use `--dry-run` to verify payload generation without uploading.

Path semantics:

- `--scene <name.excalidraw>` means a named scene in the configured workbench `artifactsDir`.
- `--out ./path/to/file.excalidraw` writes a real file path.
- Read commands such as `validate`, `read`, `inspect`, `qa`, and `export` respect absolute or relative file paths.
- Quote browser URLs that contain `?`, for example: `"http://127.0.0.1:3000/?scene=product-map.excalidraw"`.

Library commands:

```sh
excalidraw-codex library list
excalidraw-codex library search "wireframe"
excalidraw-codex library select "mobile onboarding flow"
excalidraw-codex library remote-search "kanban"
excalidraw-codex library install <official-id-or-source>
```

Library search is read-only. New public libraries should only be installed when the user explicitly asks for a specific library.

Installed registry libraries are also loaded into the workbench's Excalidraw Library panel at startup. After installing a new library, refresh or restart the workbench to make its components available in the in-browser canvas.

## Agent Usage

After setup and restart, ask Codex or Claude Code for diagrams naturally:

```text
Use Excalidraw to draw an editable architecture map for this product idea.
```

The skill tells the agent to:

- read `excalidraw-codex config` and `excalidraw-codex mcp-config` first;
- use the MCP canvas bridge as the default drawing path;
- open or create a canvas, read drawing guidance, read current live canvas context, then draw with semantic workflow tools instead of blind whole-file generation;
- use `review_canvas` for complex or visual-quality-sensitive diagrams before calling the work done; it returns a temporary inspection PNG plus structure/QA/review guidance in one packet;
- choose the expression strategy in the LLM layer: intent, visual model, reading path, language, copy density, and shape/component language;
- choose live-first cadence from the user's intent and task complexity rather than applying one fixed skeleton/region/lane/module rhythm;
- keep simple requests fast, while pushing complex participatory diagrams to the browser at reviewable checkpoints before the final answer;
- use Mermaid only when the structure is naturally Mermaid-shaped;
- treat recipes and libraries as optional visual building blocks, not rigid templates or mandatory decoration;
- validate and QA without turning every warning into rigid automatic layout;
- export PNG/SVG previews when finalizing the artifact;
- open the local browser workbench for editing;
- inspect or diff the edited canvas before continuing.

Generated canvas text follows the user's current language by default. If the user is speaking Chinese, the diagram labels should be Chinese; if the user is speaking English, labels should be English. Product names, API names, filenames, and code identifiers are preserved.

Live canvas behavior:

- The browser workbench syncs the current canvas to the local service as a live draft.
- MCP tools prefer the live draft when available, then fall back to the saved `.excalidraw` file.
- Patch/export/snapshot tools materialize the live draft first so unsaved user edits are not dropped.
- After MCP writes a scene, the browser workbench receives live updates over SSE when available and polls as a fallback.
- `open_or_create_canvas` can report `readiness.browserReady` and wait for a scene subscriber with `waitForSubscriberMs`, which is the safe handshake before the first visible live write.
- MCP writing tools keep stage updates live-only by default. They refresh the active browser canvas, not the gallery thumbnail.
- Use `export_canvas` for the final PNG/SVG and gallery thumbnail refresh, or pass `refreshPreview: true` only when an intermediate thumbnail is explicitly useful.
- Live writes use server-side revisions. If a stale write is detected, the caller should read the latest live canvas before continuing.
- Live-first does not mean pausing after every element. It means completed meaningful stages become visible in the browser while the agent is still working on complex tasks.
- Agent progress updates should describe visible drawing progress and avoid exposing internal protocol details unless the user asks.
- Manual Save remains the user-facing explicit persistence action for browser edits.

## Runtime Configuration

The setup script writes:

```text
~/.codex-excalidraw/config.json
```

Example:

```json
{
  "workspaceRoot": "/path/to/Codex-Excalidraw",
  "artifactsDir": "/path/to/Codex-Excalidraw/artifacts/excalidraw",
  "defaultFontFamily": "Nunito",
  "snapshotRetentionLimit": 80,
  "installedFrom": "/path/to/Codex-Excalidraw",
  "cli": "excalidraw-codex",
  "mcp": {
    "command": "excalidraw-codex",
    "args": ["mcp"]
  }
}
```

You can also override paths with environment variables:

```sh
export EXCALIDRAW_CODEX_HOME=~/Codex-Excalidraw
export EXCALIDRAW_CODEX_ARTIFACTS_DIR=~/Codex-Excalidraw/artifacts/excalidraw
export EXCALIDRAW_CODEX_CONFIG_DIR=~/.codex-excalidraw
export EXCALIDRAW_CODEX_FONT=Nunito
export EXCALIDRAW_CODEX_SNAPSHOT_LIMIT=80
export EXCALIDRAW_CODEX_SHARE_ENDPOINT=https://json.excalidraw.com/api/v2/post/
```

`EXCALIDRAW_CODEX_FONT` controls generated text and the workbench blank-scene default. The default is `Nunito`, which works better for mixed Chinese/English diagrams than Virgil. Supported names include `Nunito`, `Excalifont`, `Virgil`, `Helvetica`, `Cascadia`, `Lilita One`, `Comic Shanns`, and `Liberation Sans`.

Snapshots are a safety net for iterative agent edits. By default, each scene keeps its latest `80` snapshots and prunes older ones after new snapshots are created. Set `EXCALIDRAW_CODEX_SNAPSHOT_LIMIT=0` or `"snapshotRetentionLimit": 0` to keep all snapshots, or use `excalidraw-codex snapshot <scene> --keep <count>` for a one-off override.

## Project Structure

```text
bin/                         CLI entrypoint
mcp/                         MCP server exposing canvas-aware tools
server/                      canvas bridge, local API, scene IO, QA, export, libraries
src/                         Vite React Excalidraw workbench
skills/excalidraw-diagram/   portable Codex / Claude Code skill
libraries/                   optional Excalidraw library registry
scripts/install.mjs          setup script
artifacts/excalidraw/        local generated scenes, ignored by git
dist/                        build output, ignored by git
```

## Development

```sh
npm install
npm run build
excalidraw-codex doctor
npm run test:mcp
npm run test:live
npm run verify
npm run dev
```

`test:mcp` verifies the MCP toolkit surface. `test:live` opens a real browser and checks the bidirectional workbench/live/MCP bridge. `verify` runs the production build plus both smoke tests.

`excalidraw-codex doctor` also checks the production build assets, MCP tool surface, local share-payload encryption dry run, and the running port `3000` service capabilities. If the build is missing/stale, run `npm run build` or `excalidraw-codex serve` to rebuild. If an older workbench process is still running, doctor reports the missing capabilities so you can restart the shared workbench instead of silently reusing an incompatible service.

The default local URL is:

```text
http://127.0.0.1:3000/
```

Port 3000 is the shared workbench port. If it is already serving Excalidraw Codex, new sessions should reuse it instead of opening 3001/3002. If another process owns port 3000 and the health check fails, stop that process or choose an explicit port for a temporary manual run.

## Privacy Notes

This repository should not include local user paths, private planning notes, build output, `node_modules`, or generated diagrams. Runtime files stay local through `.gitignore` and `~/.codex-excalidraw/config.json`.
