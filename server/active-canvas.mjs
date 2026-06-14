import { normalizeSceneName } from "./scene-workspace.mjs";

let activeCanvas = null;

export function setActiveCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  activeCanvas = {
    scene,
    source: input.source || "workbench",
    clientId: input.clientId || undefined,
    updatedAt: new Date().toISOString()
  };
  return getActiveCanvas();
}

export function getActiveCanvas() {
  return activeCanvas
    ? {
        ok: true,
        active: true,
        ...activeCanvas
      }
    : {
        ok: true,
        active: false,
        scene: null
      };
}

export function clearActiveCanvas(scene) {
  if (!activeCanvas) return getActiveCanvas();
  if (!scene || normalizeSceneName(scene) === activeCanvas.scene) {
    activeCanvas = null;
  }
  return getActiveCanvas();
}
