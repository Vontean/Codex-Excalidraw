# Codex Excalidraw

English | [简体中文](README.zh-CN.md)

Let Codex / Claude Code help you draw, edit, and keep collaborating on your local Excalidraw canvas.

> Unlike ordinary image generation, this project creates an Excalidraw canvas that you can keep editing. You can let AI draw a first version, adjust it by hand in the browser, and then ask AI to read the canvas and improve it.

## What can it generate?

| Type | Examples |
| --- | --- |
| Technical diagrams | System architecture diagrams, API call relationships, data flow, module dependencies, deployment structure |
| Product diagrams | Product flow diagrams, page maps, user journeys, onboarding flows |
| Interaction sketches | Low-fidelity UI sketches, dashboard layouts, form pages, settings pages |
| Whiteboard maps | Decision trees, swimlane diagrams, concept relationship maps, evidence boards, problem breakdowns |
| Converted diagrams | Editable Excalidraw diagrams converted from Mermaid |

## What problem does it solve?

Many times, we do not just want a picture. We want a canvas that can keep changing, keep supporting discussion, and keep being worked on.

Codex Excalidraw mainly solves these problems:

* AI can draw directly on an Excalidraw canvas.
* You can see the generated process and result in the browser.
* The output is not a static image. It is made of editable elements.
* After you edit the canvas by hand, AI can still read and understand the current canvas.
* It helps turn technical plans, product flows, and interaction structures into diagrams quickly.

## Quick start

You can copy this prompt directly to Codex or Claude Code:

```text
Please help me install and run this project:
https://github.com/Vontean/Codex-Excalidraw
Requirements:
1. Clone the project locally.
2. Follow the README to finish installation.
3. Start the local Excalidraw workbench.
4. Open http://127.0.0.1:3000/.
5. Verify that Codex / Claude Code can create, read, and edit shapes on the canvas.
```

After installation, restart Codex or Claude Code so the new drawing capability takes effect.

## Manual installation

If you want to try the published beta package, install the CLI with:

```sh
npm install -g codex-excalidraw@beta
```

Then start the local workbench:

```sh
excalidraw-codex serve
```

For full local setup from source, including the bundled Codex / Claude Code skill, use:

```sh
git clone https://github.com/Vontean/Codex-Excalidraw.git
cd Codex-Excalidraw
npm run setup
```

`setup` first checks whether your machine already has a browser that can be used for export, such as a Playwright browser cache or system Chrome / Chromium. If none is found, it asks whether to download Playwright Chromium. You can choose not to download it and later install a browser yourself, or set `EXCALIDRAW_CODEX_BROWSER_EXECUTABLE` to a browser path.

After setup, start the local workbench:

```sh
excalidraw-codex serve
```

Open in your browser:

```text
http://127.0.0.1:3000/
```

## How to use

After opening the workbench, you can say this to Codex or Claude Code:

```text
Use Excalidraw to draw an editable system architecture diagram.
```

You can also ask it to keep editing:

```text
Turn this flowchart into a swimlane diagram, split by user, frontend, backend, and database.
```

## Typical use cases

| Use case | Good for | Example prompt |
| --- | --- | --- |
| Technical architecture diagrams | Frontend and backend architecture, API call relationships, data flow, module dependencies, deployment structure | Draw a system architecture diagram for a web app, including frontend, backend, database, cache, object storage, and third-party login service. |
| Product flow diagrams | User journeys, page transitions, operation flows, error branches, onboarding flows | Draw an onboarding flow for a new user's first time using an app, including registration, permission authorization, preference setup, and home page guidance. |
| Low-fidelity UI sketches | Web page structure, app page frames, dashboard layouts, form pages, settings pages | Draw a low-fidelity mobile home page sketch with a top status card, quick actions, notification list, and bottom navigation. |
| Whiteboard discussions | Concept maps, evidence boards, problem breakdowns, solution comparisons, pyramid structures | Use the pyramid principle to draw a product redesign presentation structure. Put the core conclusion at the top, then split the lower level into user problems, design solution, and data validation. |

### Example outputs

These PNGs were exported from local Excalidraw canvases and can be used as references for the generated result.

| 5W1H requirements | Task status transition | AI assistant app IA |
| --- | --- | --- |
| <img src="docs/images/codex-excalidraw-5w1h-requirements.png" alt="codex-excalidraw-5w1h-requirements" width="320"> | <img src="docs/images/test-4-task-status-transition.png" alt="test-4-task-status-transition" width="320"> | <img src="docs/images/ai-assistant-app-ia.png" alt="ai-assistant-app-ia" width="320"> |

## Where are generated files?

By default, generated canvases and exported files are saved in:

```text
artifacts/excalidraw/
```

You can find Excalidraw files, screenshots, and export results there.

## Requirements

| Dependency | Requirement |
| --- | --- |
| Node.js | 20 or newer. Node.js 22 LTS is recommended. |
| npm | Required |
| System | A terminal on macOS, Linux, or Windows |

## What is included in this project?

You do not need to understand this before using it. If you want a simple mental model, it includes:

| Part | Purpose |
| --- | --- |
| Local Excalidraw workbench | Open and edit the canvas in the browser |
| `excalidraw-codex` CLI | Install, start, export, diagnose, and manage libraries |
| MCP service | Let AI read and edit the current canvas |
| Drawing workflow | Excalidraw collaboration flow for Codex / Claude Code |

## Libraries

The project can load Excalidraw libraries. You can add common wireframe components, flowchart components, business canvas components, and data visualization components to the canvas library.

```sh
excalidraw-codex library list
excalidraw-codex library search "wireframe"
```

After installation, the assets appear in Excalidraw's Library panel.

## FAQ

### Is this an image generation tool?

No. It generates Excalidraw canvas content. The elements can still be edited, moved, copied, and changed.

### Can I manually edit diagrams drawn by AI?

Yes. You can edit the canvas directly in the browser. After that, AI can read the current canvas and continue improving it based on your edits.

### How is it different from Mermaid?

Mermaid is better for quickly generating structured diagrams from text. Excalidraw is better for freeform canvases, low-fidelity sketches, whiteboard discussions, and visual explanation.

You can also start with Mermaid, generate a basic structure, then convert it into an Excalidraw canvas for further editing.

### Who is this for?

It is useful for people who often need to turn ideas into diagrams, such as:

* Product managers
* Designers
* Indie developers
* Engineers
* Technical writers
* People using Codex / Claude Code for project development

## License

Codex Excalidraw is currently released under a beta source-available license.
You may view the source code and use the tool for personal, educational,
research, or internal evaluation purposes, but you may not redistribute modified
versions, publish competing packages, offer it as a hosted service, or use it as
a commercial product without written permission.

Excalidraw and other third-party dependencies remain under their own respective
open source licenses. See [LICENSE](LICENSE) for details.
