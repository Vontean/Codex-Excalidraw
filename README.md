# Codex Excalidraw

Local Excalidraw workbench, CLI, and agent skill for Codex and Claude Code.

The goal is not to replace Mermaid. It gives agents a lightweight way to create editable Excalidraw canvases, export PNG/SVG previews, open a local browser workbench, and read back user edits during an implementation conversation.

## What You Get

- A Vite + React + TypeScript Excalidraw workbench.
- A CLI named `excalidraw-codex`.
- A portable `excalidraw-diagram` skill for Codex and Claude Code.
- Mermaid-to-Excalidraw conversion with `@excalidraw/mermaid-to-excalidraw`.
- Natural-language brief templates for architecture maps, product boards, page flows, wireframes, and implementation plans.
- Read-back commands for inspecting, diffing, patching, polishing, QA, snapshots, and exports.
- Optional public Excalidraw library registry for wireframes, emoji accents, decision controls, business canvases, and data-viz components.

## Requirements

- macOS, Linux, or Windows with a recent shell.
- Node.js 20+; Node 22 LTS is recommended.
- npm.

Core dependencies are installed by the setup script:

```sh
npm install react react-dom @excalidraw/excalidraw @excalidraw/mermaid-to-excalidraw
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
excalidraw-codex serve
excalidraw-codex from-mermaid diagram.md --out architecture.excalidraw
excalidraw-codex from-brief brief.txt --out product-map.excalidraw --preview
excalidraw-codex validate product-map.excalidraw
excalidraw-codex qa product-map.excalidraw
excalidraw-codex export product-map.excalidraw --format all --require-qa
excalidraw-codex inspect product-map.excalidraw --from latest
excalidraw-codex snapshot product-map.excalidraw --label before-edit
excalidraw-codex gallery-refresh --all
```

Library commands:

```sh
excalidraw-codex library list
excalidraw-codex library search "wireframe"
excalidraw-codex library select "mobile onboarding flow"
excalidraw-codex library remote-search "kanban"
excalidraw-codex library install <official-id-or-source>
```

Library search is read-only. New public libraries should only be installed when the user explicitly asks for a specific library.

## Agent Usage

After setup and restart, ask Codex or Claude Code for diagrams naturally:

```text
Use Excalidraw to draw an editable architecture map for this product idea.
```

The skill tells the agent to:

- choose an expression strategy first;
- use Mermaid only when the structure is naturally Mermaid-shaped;
- create editable `.excalidraw` files;
- use libraries as optional visual building blocks, not mandatory decoration;
- validate and QA without turning every warning into rigid automatic layout;
- export PNG/SVG previews;
- open the local browser workbench for editing;
- inspect or diff the edited canvas before continuing.

Generated canvas text follows the user's current language by default. If the user is speaking Chinese, the diagram labels should be Chinese; if the user is speaking English, labels should be English.

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
  "installedFrom": "/path/to/Codex-Excalidraw",
  "cli": "excalidraw-codex"
}
```

You can also override paths with environment variables:

```sh
export EXCALIDRAW_CODEX_HOME=~/Codex-Excalidraw
export EXCALIDRAW_CODEX_ARTIFACTS_DIR=~/Codex-Excalidraw/artifacts/excalidraw
export EXCALIDRAW_CODEX_CONFIG_DIR=~/.codex-excalidraw
```

## Project Structure

```text
bin/                         CLI entrypoint
server/                      local API, scene IO, QA, export, libraries
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
npm run dev
```

The default local URL is:

```text
http://127.0.0.1:3000/
```

If port 3000 is occupied, the server falls back to 3001 and prints the active URL.

## Privacy Notes

This repository should not include local user paths, private planning notes, build output, `node_modules`, or generated diagrams. Runtime files stay local through `.gitignore` and `~/.codex-excalidraw/config.json`.
