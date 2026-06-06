# Excalidraw Library Registry

This folder stores selected public Excalidraw libraries for Codex-assisted drawing.

The raw `.excalidrawlib` files live under `libraries/vendor/`. Metadata and selection rules live in `libraries/registry.json`.

## Use Principles

- Select libraries from the user's drawing intent, not from a fixed template.
- Use libraries as reusable visual language: UI controls, emoji accents, decision nodes, business canvases, or data charts.
- Search is safe and read-only; installation must be explicitly triggered by the user.
- Do not force a library into a scene. A good plain Excalidraw diagram is better than decorative noise.
- Keep every generated result editable. Library components should remain Excalidraw elements.
- Record selected library ids in `appState.codex.libraries` so future read-back can explain the choice.

## Installed Libraries

- `basic-ux-wireframing-elements`: low-fidelity UI and product wireframes.
- `emojis-anumitha-apollo`: playful emotion/status accents.
- `decision-flow-control`: yes/no condition and branching controls.
- `business-model-templates`: Business Model Canvas and Value Proposition Canvas.
- `data-viz-dbs-sticky`: chart components for dashboards and data stories.

## Extending

Search the official public directory without changing local files:

```sh
excalidraw-codex library remote-search "kanban"
```

Install a specific official library only after the user explicitly chooses it:

```sh
excalidraw-codex library install moochin/simple-characters.excalidrawlib --id simple-characters
```

Use `--dry-run` before installation to preview the registry entry.
