# Excalidraw library registry

This folder contains optional public Excalidraw libraries that can be loaded into the local workbench. They are useful when a canvas needs real UI controls, decision symbols, business templates, or chart pieces instead of plain boxes and arrows.

The raw `.excalidrawlib` files live in `libraries/vendor/`. Metadata and local search rules live in `libraries/registry.json`.

## Included libraries

- `basic-ux-wireframing-elements`: low-fidelity UI and product wireframes.
- `emojis-anumitha-apollo`: small emotion and status accents.
- `decision-flow-control`: yes/no conditions and branching controls.
- `business-model-templates`: Business Model Canvas and Value Proposition Canvas.
- `data-viz-dbs-sticky`: chart components for dashboards and data stories.

## Use from the CLI

List and search local libraries:

```sh
excalidraw-codex library list
excalidraw-codex library search "wireframe"
excalidraw-codex library select "mobile onboarding flow"
```

Search the official public directory without changing local files:

```sh
excalidraw-codex library remote-search "kanban"
```

Install a public library only after choosing one:

```sh
excalidraw-codex library install moochin/simple-characters.excalidrawlib --id simple-characters
```

Use `--dry-run` first when you want to preview the registry entry.

## Notes

Libraries are building blocks, not templates that must be forced into every scene. A plain Excalidraw diagram is often better than a busy one. Installed items should remain editable Excalidraw elements.
