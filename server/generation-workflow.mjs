import path from "node:path";
import { artifactsDir } from "./config.mjs";
import { generateSceneFromBrief } from "./brief-templates.mjs";
import { selectLibrariesForBrief } from "./library-registry.mjs";

function shouldUseLibraries(value) {
  if (value === false) return false;
  return String(value || "auto").toLowerCase() !== "none";
}

function compactLibraries(libraries) {
  return libraries.map(({ id, name, score, reasons }) => ({ id, name, score, reasons }));
}

export async function runBriefGenerationWorkflow(input = {}, adapters = {}) {
  const brief = input.brief || input.prompt || "";
  const generated = generateSceneFromBrief({
    brief,
    title: input.title,
    template: input.template || "auto",
    expressionPlan: input.expressionPlan || input.plan
  });
  let selectedLibraries = [];
  if (shouldUseLibraries(input.libraries)) {
    selectedLibraries = await selectLibrariesForBrief(brief, {
      limit: Number(input.libraryLimit || 3)
    });
    generated.scene.appState.codex = {
      ...(generated.scene.appState.codex || {}),
      libraries: compactLibraries(selectedLibraries)
    };
  }

  const requestedName = input.out || input.name || "brief-diagram.excalidraw";
  const fileName = adapters.writeScene
    ? await adapters.writeScene(requestedName, generated.scene)
    : requestedName;

  let polish;
  if (input.polish !== false && adapters.polishSceneFile) {
    polish = await adapters.polishSceneFile(fileName, {
      density: input.density || generated.scene.appState?.codex?.expressionPlan?.copyDensity || "normal"
    }, {
      snapshot: false,
      label: input.polishLabel || "after-from-brief"
    });
  }

  let preview;
  if (input.preview !== false && adapters.exportSceneAsset) {
    preview = await adapters.exportSceneAsset(fileName, {
      baseUrl: input.baseUrl,
      format: input.previewFormat || "png"
    });
  }

  return {
    ok: true,
    name: fileName,
    path: path.join(artifactsDir, fileName),
    template: generated.template,
    title: generated.title,
    elementCount: generated.elementCount,
    expressionPlan: generated.scene.appState?.codex?.expressionPlan,
    polished: Boolean(polish),
    libraries: selectedLibraries,
    preview,
    scene: generated.scene
  };
}
