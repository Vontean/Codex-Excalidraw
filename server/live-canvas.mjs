import { normalizeSceneName } from "./scene-workspace.mjs";

const liveScenes = new Map();

function activeElementCount(scene) {
  return Array.isArray(scene?.elements)
    ? scene.elements.filter((element) => element && !element.isDeleted).length
    : 0;
}

function compactLiveEntry(name, entry, options = {}) {
  return {
    ok: true,
    scene: normalizeSceneName(name),
    live: true,
    updatedAt: entry.updatedAt,
    revision: entry.revision,
    clientId: entry.clientId,
    activeElementCount: entry.activeElementCount,
    source: entry.source,
    sceneData: options.includeScene ? entry.scene : undefined
  };
}

export function updateLiveScene(name, scene, options = {}) {
  const sceneName = normalizeSceneName(name);
  const entry = {
    scene,
    updatedAt: new Date().toISOString(),
    revision: String(options.revision || Date.now()),
    clientId: options.clientId || "workbench",
    source: options.source || "workbench",
    activeElementCount: activeElementCount(scene)
  };
  liveScenes.set(sceneName, entry);
  return compactLiveEntry(sceneName, entry);
}

export function getLiveScene(name, options = {}) {
  const sceneName = normalizeSceneName(name);
  const entry = liveScenes.get(sceneName);
  if (!entry) return null;
  return compactLiveEntry(sceneName, entry, options);
}

export function listLiveScenes() {
  return [...liveScenes.entries()].map(([name, entry]) => compactLiveEntry(name, entry));
}

export function clearLiveScene(name) {
  const sceneName = normalizeSceneName(name);
  return liveScenes.delete(sceneName);
}
