# Codex Excalidraw

English | [简体中文](README.zh-CN.md)

AI agents draw with you on a local Excalidraw canvas. Keep the workbench open in your browser, let Codex or Claude Code create and revise the diagram, edit by hand when you want, and export editable `.excalidraw`, PNG, or SVG files at the end.

Codex Excalidraw is local by default. Your scenes, snapshots, and exports stay on your machine. External Excalidraw share links are created only when you run a share command.

This repository packages four pieces:

- a browser workbench at `http://127.0.0.1:3000/`;
- the `excalidraw-codex` CLI for setup, serving, export, snapshots, QA, and libraries;
- an MCP server so agents can read and update the current canvas;
- an optional `excalidraw-diagram` skill for Codex and Claude Code.

## When to use it

Use this when a diagram needs to stay editable, or when you want to collaborate with an agent while watching the canvas change.

Good fits:

- architecture maps and system explanations;
- product flows, page maps, and low-fidelity UI sketches;
- process diagrams and decision trees;
- whiteboard-style planning, evidence boards, and concept maps;
- Mermaid-style diagrams that should become editable Excalidraw scenes.

If you only need a static Mermaid diagram in Markdown, Mermaid is usually enough. This project is for the moments where the canvas matters.

## Quick start

Requirements:

- Node.js 20 or newer. Node 22 LTS is recommended.
- npm.
- A terminal on macOS, Linux, or Windows.

Install:

```sh
git clone https://github.com/Vontean/Codex-Excalidraw.git
cd Codex-Excalidraw
npm run setup
```

The setup script installs dependencies, installs Playwright Chromium for export rendering, builds the workbench, links the `excalidraw-codex` CLI, writes local config to `~/.codex-excalidraw/config.json`, and installs the `excalidraw-diagram` skill when Codex or Claude Code skill folders are available.

Restart Codex or Claude Code after setup so the new skill and MCP configuration are loaded.

Start the workbench:

```sh
excalidraw-codex serve
```

Open:

```text
http://127.0.0.1:3000/
```

Then ask your agent for a diagram:

```text
Use Excalidraw to draw an editable system architecture map for this project.
```

Generated scenes are stored in the configured artifacts directory. By default:

```text
artifacts/excalidraw/
```

## How the workflow works

1. Open or reuse the local browser workbench.
2. Ask Codex or Claude Code to draw with Excalidraw.
3. The agent creates a scene, reads the current canvas, and makes meaningful updates instead of replacing the file blindly.
4. You can edit the canvas in the browser. The agent can read those edits and continue from them.
5. Export the final result as `.excalidraw`, PNG, SVG, or all of them.

The important part is read-back. The agent is not just generating a file once; it can inspect the current canvas and keep working from the latest version.

## Common commands

```sh
excalidraw-codex config
excalidraw-codex doctor
excalidraw-codex serve
excalidraw-codex open product-map.excalidraw
excalidraw-codex validate product-map.excalidraw
excalidraw-codex qa product-map.excalidraw
excalidraw-codex export product-map.excalidraw --format all
excalidraw-codex snapshot product-map.excalidraw --label before-edit
excalidraw-codex restore product-map.excalidraw --from latest
```

Convert Mermaid when the source is already Mermaid-shaped:

```sh
excalidraw-codex from-mermaid diagram.md --scene architecture.excalidraw
```

Create a rough first pass from a text brief:

```sh
excalidraw-codex from-brief brief.txt --scene product-flow.excalidraw
```

Create an external Excalidraw share link only when you mean to:

```sh
excalidraw-codex share product-map.excalidraw --dry-run
```

Without `--dry-run`, `share` uploads an encrypted payload to Excalidraw's JSON store. Normal editing, MCP work, export, snapshots, and local files stay on your machine.

## Agent and MCP setup

For most users, `npm run setup` is enough. It installs the skill and writes the MCP config snippet when the expected folders exist.

If you need to configure an agent manually, print the snippet:

```sh
excalidraw-codex mcp-config --json
```

The MCP server command is:

```sh
excalidraw-codex mcp
```

The MCP tools are intentionally workflow-level. They cover opening a canvas, reading context, creating or patching a view, reviewing the result, taking snapshots, restoring snapshots, exporting, and creating a scene from Mermaid.

## Setup options

Install only for Codex:

```sh
npm run setup -- --agents codex
```

Install only for Claude Code:

```sh
npm run setup -- --agents claude
```

Choose where scenes and exports are stored:

```sh
npm run setup -- --workspace ~/Codex-Excalidraw --artifacts ~/Codex-Excalidraw/artifacts/excalidraw
```

Skip optional steps:

```sh
npm run setup -- --skip-playwright
npm run setup -- --skip-link
```

Run smoke verification during setup:

```sh
npm run setup -- --verify
```

## Libraries

The bundled library registry includes optional Excalidraw building blocks for wireframes, decision controls, business canvases, and data visualization.

Search local libraries:

```sh
excalidraw-codex library list
excalidraw-codex library search "wireframe"
excalidraw-codex library select "mobile onboarding flow"
```

Install a public library only after choosing one:

```sh
excalidraw-codex library remote-search "kanban"
excalidraw-codex library install <official-id-or-source>
```

Installed libraries load into the Excalidraw Library panel when the workbench starts.

## Configuration

Setup writes local config to:

```text
~/.codex-excalidraw/config.json
```

Common environment overrides:

```sh
export EXCALIDRAW_CODEX_HOME=~/Codex-Excalidraw
export EXCALIDRAW_CODEX_ARTIFACTS_DIR=~/Codex-Excalidraw/artifacts/excalidraw
export EXCALIDRAW_CODEX_CONFIG_DIR=~/.codex-excalidraw
export EXCALIDRAW_CODEX_FONT=Nunito
export EXCALIDRAW_CODEX_CANVAS_BACKGROUND="#f8f9fa"
export EXCALIDRAW_CODEX_SNAPSHOT_LIMIT=80
```

## Development

```sh
npm install
npm run build
npm run test:mcp
npm run test:live
npm run verify
npm run dev
```

`npm run verify` runs the production build plus MCP and live-browser smoke tests.

## Repository hygiene

This repository should publish the tool, not local working state.

Keep these out of commits:

- generated scenes and exports under `artifacts/excalidraw/`;
- `dist/` and `node_modules/`;
- local `.env` files;
- local agent instructions such as `AGENTS.md` or `CLAUDE.md`;
- private notes, drafts, planning documents, or discussion transcripts.

## License

MIT
