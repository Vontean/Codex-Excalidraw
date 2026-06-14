import express from "express";
import { createServer as createHttpServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { generateSceneFromBrief, listBriefTemplates } from "./brief-templates.mjs";
import { createExpressionPlan } from "./expression-plan.mjs";
import { runBriefGenerationWorkflow } from "./generation-workflow.mjs";
import { createSceneFileOperations } from "./scene-file-operations.mjs";
import {
  artifactsDir,
  defaultCanvasBackgroundColor,
  defaultFontFamily,
  defaultFontFamilyName,
  getRuntimeConfig,
  packageRoot as projectRoot,
  snapshotsDir
} from "./config.mjs";
import {
  createSnapshot,
  deleteScene,
  ensureArtifactsDir,
  listScenes,
  listSnapshots,
  normalizeSceneName,
  readScene,
  renameScene,
  resolveSnapshotPath,
  restoreSnapshot,
  scenePath,
  writeScene
} from "./scene-workspace.mjs";
import {
  inspectRegisteredLibrary,
  librariesDir,
  listInstalledLibraryItems,
  listLibraryRegistry,
  searchLibraryRegistry,
  selectLibrariesForBrief,
  validateLibraryRegistry
} from "./library-registry.mjs";
import {
  clearLiveScene,
  getLiveScene,
  getLiveSceneStatus,
  listLiveScenes,
  subscribeLiveScene,
  updateLiveScene
} from "./live-canvas.mjs";
import { exportSceneToExcalidrawUrl } from "./excalidraw-share.mjs";
import {
  clearActiveCanvas,
  getActiveCanvas,
  setActiveCanvas
} from "./active-canvas.mjs";

export { artifactsDir, defaultFontFamily, defaultFontFamilyName, getRuntimeConfig, projectRoot, snapshotsDir };

const SERVER_NAME = "excalidraw-codex";
const SERVER_VERSION = "0.1.0";
const SERVER_CAPABILITIES = {
  workbench: true,
  canvasBridge: true,
  mcpCanvasBridge: true,
  mcpWorkflowTools: true,
  createViewProtocol: true,
  progressiveReveal: true,
  mcpMermaidConversion: true,
  liveCanvas: true,
  liveCanvasRevisions: true,
  liveCanvasSse: true,
  bidirectionalLiveBridge: true,
  libraries: true,
  browserExport: true,
  excalidrawUrlExport: true,
  snapshots: true,
  snapshotRetention: true,
  visualReview: true
};

const REQUIRED_SERVER_CAPABILITIES = [
  "canvasBridge",
  "mcpCanvasBridge",
  "mcpWorkflowTools",
  "createViewProtocol",
  "progressiveReveal",
  "mcpMermaidConversion",
  "liveCanvas",
  "liveCanvasRevisions",
  "liveCanvasSse",
  "bidirectionalLiveBridge",
  "libraries",
  "browserExport",
  "excalidrawUrlExport",
  "snapshots",
  "snapshotRetention",
  "visualReview"
];

function healthPayload() {
  return {
    ok: true,
    name: SERVER_NAME,
    version: SERVER_VERSION,
    artifactsDir,
    defaultFontFamily,
    defaultFontFamilyName,
    defaultCanvasBackgroundColor,
    capabilities: SERVER_CAPABILITIES,
    requiredCapabilities: REQUIRED_SERVER_CAPABILITIES
  };
}

function isCompatibleHealth(health) {
  return Boolean(
    health?.ok &&
      health.name === SERVER_NAME &&
      missingServerCapabilities(health).length === 0
  );
}

function missingServerCapabilities(health) {
  return REQUIRED_SERVER_CAPABILITIES.filter((capability) => !health?.capabilities?.[capability]);
}

function activeElements(scene) {
  return Array.isArray(scene?.elements)
    ? scene.elements.filter((element) => element && !element.isDeleted)
    : [];
}

function roundNumber(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : undefined;
}

function truncateText(value, length = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function elementText(element) {
  if (typeof element?.text === "string" && element.text.trim()) {
    return element.text.trim();
  }
  if (typeof element?.label?.text === "string" && element.label.text.trim()) {
    return element.label.text.trim();
  }
  if (typeof element?.customData?.label === "string" && element.customData.label.trim()) {
    return element.customData.label.trim();
  }
  return "";
}

function elementLabel(element) {
  const text = elementText(element);
  if (text) return truncateText(text, 72);
  return `${element?.type || "element"}:${String(element?.id || "").slice(0, 8)}`;
}

function elementBounds(element) {
  const x = Number(element?.x || 0);
  const y = Number(element?.y || 0);
  const width = Number(element?.width || 0);
  const height = Number(element?.height || 0);
  const right = x + width;
  const bottom = y + height;
  return {
    x: Math.min(x, right),
    y: Math.min(y, bottom),
    width: Math.abs(width),
    height: Math.abs(height),
    right: Math.max(x, right),
    bottom: Math.max(y, bottom)
  };
}

function sceneBounds(elements) {
  if (!elements.length) {
    return null;
  }
  const bounds = elements.map(elementBounds);
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.right));
  const maxY = Math.max(...bounds.map((bound) => bound.bottom));
  return {
    x: roundNumber(minX),
    y: roundNumber(minY),
    width: roundNumber(maxX - minX),
    height: roundNumber(maxY - minY)
  };
}

function compactElement(element) {
  return {
    id: element.id,
    type: element.type,
    text: elementText(element) || undefined,
    x: roundNumber(element.x),
    y: roundNumber(element.y),
    width: roundNumber(element.width),
    height: roundNumber(element.height),
    groupIds: Array.isArray(element.groupIds) && element.groupIds.length ? element.groupIds : undefined,
    from: connectionStartId(element),
    to: connectionEndId(element)
  };
}

function connectionStartId(element) {
  return element?.startBinding?.elementId || element?.start?.id;
}

function connectionEndId(element) {
  return element?.endBinding?.elementId || element?.end?.id;
}

function summarizeGroups(elements) {
  const groups = new Map();
  for (const element of elements) {
    for (const groupId of element.groupIds || []) {
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(element);
    }
  }
  return [...groups.entries()].map(([id, groupElements]) => ({
    id,
    elementCount: groupElements.length,
    labels: groupElements.map(elementLabel).filter(Boolean).slice(0, 8)
  }));
}

function summarizeConnections(elements) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return elements
    .filter((element) => element.type === "arrow" || element.type === "line")
    .map((element) => {
      const startId = connectionStartId(element);
      const endId = connectionEndId(element);
      const from = byId.get(startId);
      const to = byId.get(endId);
      return {
        id: element.id,
        type: element.type,
        from: from ? elementLabel(from) : startId,
        to: to ? elementLabel(to) : endId,
        bound: Boolean(from && to)
      };
    });
}

function summarizeRegions(elements) {
  const textElements = elements.filter((element) => elementText(element));
  return elements
    .filter((element) => element.type === "frame" || (element.type === "rectangle" && Number(element.width) > 160 && Number(element.height) > 90))
    .map((element) => {
      const bounds = elementBounds(element);
      const labels = textElements
        .filter((textElement) => {
          if (textElement.id === element.id) return false;
          const textBounds = elementBounds(textElement);
          const centerX = textBounds.x + textBounds.width / 2;
          const centerY = textBounds.y + textBounds.height / 2;
          return centerX >= bounds.x && centerX <= bounds.right && centerY >= bounds.y && centerY <= bounds.bottom;
        })
        .map(elementLabel)
        .slice(0, 6);
      return {
        id: element.id,
        type: element.type,
        label: labels[0] || elementLabel(element),
        x: roundNumber(element.x),
        y: roundNumber(element.y),
        width: roundNumber(element.width),
        height: roundNumber(element.height),
        contents: labels
      };
    })
    .slice(0, 16);
}

function overlapRatio(first, second) {
  const xOverlap = Math.max(0, Math.min(first.right, second.right) - Math.max(first.x, second.x));
  const yOverlap = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.y, second.y));
  const area = xOverlap * yOverlap;
  const smaller = Math.min(first.width * first.height, second.width * second.height);
  return smaller > 0 ? area / smaller : 0;
}

function containsBounds(container, item, padding = 2) {
  return (
    item.x >= container.x - padding &&
    item.y >= container.y - padding &&
    item.right <= container.right + padding &&
    item.bottom <= container.bottom + padding
  );
}

function isContainerElement(element) {
  return element?.type === "frame" || ["section", "page-card", "wireframe-detail"].includes(element?.customData?.codexRole);
}

function isStructuralContainment(first, second) {
  const firstBounds = elementBounds(first);
  const secondBounds = elementBounds(second);
  if (isContainerElement(first) && containsBounds(firstBounds, secondBounds, 8)) return true;
  if (isContainerElement(second) && containsBounds(secondBounds, firstBounds, 8)) return true;
  if ((first.groupIds || []).some((groupId) => (second.groupIds || []).includes(groupId))) return true;
  if (first.containerId === second.id || second.containerId === first.id) return true;
  if (isTextInsideVisualHost(first, second, firstBounds, secondBounds)) return true;
  return false;
}

function isTextInsideVisualHost(first, second, firstBounds = elementBounds(first), secondBounds = elementBounds(second)) {
  const text = first?.type === "text" ? first : second?.type === "text" ? second : null;
  const host = text === first ? second : first;
  const textBounds = text === first ? firstBounds : secondBounds;
  const hostBounds = host === first ? firstBounds : secondBounds;
  if (!text || !host || ["text", "arrow", "line", "freedraw"].includes(host.type)) return false;
  if (text.containerId && text.containerId !== host.id) return false;
  if (text.customData?.labelFor && text.customData.labelFor !== host.id) return false;
  return containsBounds(hostBounds, textBounds, 12);
}

function detectPolishIssues(scene, elements) {
  const codex = scene?.appState?.codex;
  if (!codex) return [];
  const requiresPolish =
    codex.requirePolish !== false &&
    elements.length > 8 &&
    Boolean(codex.generator || codex.template || codex.brief || codex.elementsKind);
  if (!requiresPolish) return [];

  if (!codex.lastPolish?.polishedAt) {
    return [
      {
        type: "missing-polish",
        severity: "warning",
        message: "Codex-generated scenes should run the polish pass before QA/export."
      }
    ];
  }

  const polishedAt = Date.parse(codex.lastPolish.polishedAt);
  const latestElementUpdate = Math.max(0, ...elements.map((element) => Number(element.updated || 0)).filter(Boolean));
  if (Number.isFinite(polishedAt) && latestElementUpdate > polishedAt + 2000) {
    return [
      {
        type: "stale-polish",
        severity: "warning",
        message: "The scene has element changes newer than the last polish pass."
      }
    ];
  }
  return [];
}

function connectorLabelClearanceIssues(elements) {
  const issues = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const connector of elements.filter(isConnectorElement)) {
    const label = elementText(connector);
    if (!label) continue;
    const from = byId.get(connectionStartId(connector));
    const to = byId.get(connectionEndId(connector));
    if (!from || !to) continue;

    const fromBounds = elementBounds(from);
    const toBounds = elementBounds(to);
    const fromCenter = elementCenter(from);
    const toCenter = elementCenter(to);
    const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y);
    if (!horizontal) continue;

    const gap =
      fromCenter.x <= toCenter.x
        ? toBounds.x - fromBounds.right
        : fromBounds.x - toBounds.right;
    const requiredGap = connectorLabelWidth(connector) + 32;
    if (gap < requiredGap) {
      issues.push({
        type: "connector-label-clearance",
        severity: "warning",
        elementId: connector.id,
        label: truncateText(label, 60),
        message: `Connector label needs about ${roundNumber(requiredGap)}px of horizontal space; current gap is ${roundNumber(Math.max(0, gap))}px.`
      });
    }
  }
  return issues;
}

function spanOverlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function connectorRouteCrossingIssues(elements) {
  const issues = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const connector of elements.filter(isConnectorElement)) {
    const startId = connectionStartId(connector);
    const endId = connectionEndId(connector);
    if (!startId || !endId) continue;
    const bounds = elementBounds(connector);
    const horizontal = bounds.width > Math.max(24, bounds.height * 3);
    const vertical = bounds.height > Math.max(24, bounds.width * 3);
    if (!horizontal && !vertical) continue;

    for (const candidate of elements) {
      if (candidate.id === startId || candidate.id === endId) continue;
      if (candidate.id === connector.id || isConnectorElement(candidate) || isContainerLike(candidate)) continue;
      if (candidate.customData?.labelFor === connector.id) continue;
      if ((candidate.groupIds || []).some((groupId) => (connector.groupIds || []).includes(groupId))) continue;
      const candidateBounds = elementBounds(candidate);
      if (horizontal) {
        const lineY = bounds.y + bounds.height / 2;
        const overlap = spanOverlap(bounds.x, bounds.right, candidateBounds.x, candidateBounds.right);
        if (lineY > candidateBounds.y + 8 && lineY < candidateBounds.bottom - 8 && overlap > Math.min(80, candidateBounds.width * 0.4)) {
          issues.push({
            type: "connector-crosses-element",
            severity: "warning",
            elementId: connector.id,
            crossedElementId: candidate.id,
            labels: [elementLabel(connector), elementLabel(candidate)],
            message: `Connector crosses another element: ${elementLabel(candidate)}.`
          });
        }
      } else if (vertical) {
        const lineX = bounds.x + bounds.width / 2;
        const overlap = spanOverlap(bounds.y, bounds.bottom, candidateBounds.y, candidateBounds.bottom);
        if (lineX > candidateBounds.x + 8 && lineX < candidateBounds.right - 8 && overlap > Math.min(80, candidateBounds.height * 0.4)) {
          issues.push({
            type: "connector-crosses-element",
            severity: "warning",
            elementId: connector.id,
            crossedElementId: candidate.id,
            labels: [elementLabel(connector), elementLabel(candidate)],
            message: `Connector crosses another element: ${elementLabel(candidate)}.`
          });
        }
      }
      if (issues.length >= 12) return issues;
    }
  }
  return issues;
}

function detectLayoutIssues(elements, options = {}) {
  const issues = [];
  if (!elements.length) {
    issues.push({ type: "empty-scene", message: "Scene has no active elements." });
    return issues;
  }

  issues.push(...detectPolishIssues(options.scene, elements));
  issues.push(...connectorLabelClearanceIssues(elements));
  issues.push(...connectorRouteCrossingIssues(elements));

  for (const element of elements.filter((item) => item.type === "text" && elementText(item))) {
    const text = elementText(element);
    const fontSize = Number(element.fontSize || 20);
    const estimatedWidth = textWidthEstimate(text, fontSize);
    const estimatedHeight = textHeightEstimate(text, fontSize);
    if (Number(element.width) > 0 && estimatedWidth > Number(element.width) * 1.35) {
      issues.push({
        type: "possible-text-clipping",
        severity: "error",
        elementId: element.id,
        label: truncateText(text, 60),
        message: "Text may be wider than its box."
      });
    }
    if (Number(element.height) > 0 && estimatedHeight > Number(element.height) * 1.5) {
      issues.push({
        type: "possible-text-clipping",
        severity: "error",
        elementId: element.id,
        label: truncateText(text, 60),
        message: "Text may be taller than its box."
      });
    }
  }

  for (const element of elements.filter((item) => item.type === "arrow" || item.type === "line")) {
    if (!connectionStartId(element) || !connectionEndId(element)) {
      if (element?.customData?.codexRole === "guide-arrow" || element?.customData?.codexRole === "annotation-line") continue;
      issues.push({
        type: "unbound-connector",
        severity: "warning",
        elementId: element.id,
        message: "Connector is not bound at both ends; this may be intentional for annotation or guide lines."
      });
    }
  }

  const candidates = elements.filter((element) => !["arrow", "line", "freedraw"].includes(element.type));
  for (let index = 0; index < candidates.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
      const first = candidates[index];
      const second = candidates[otherIndex];
      if (isStructuralContainment(first, second)) continue;
      const firstBounds = elementBounds(first);
      const secondBounds = elementBounds(second);
      const ratio = overlapRatio(firstBounds, secondBounds);
      if (ratio > 0.82) {
        issues.push({
          type: "possible-overlap",
          severity: "error",
          elementIds: [first.id, second.id],
          labels: [elementLabel(first), elementLabel(second)],
          message: "Two elements almost completely overlap."
        });
      }
      if (issues.length >= 12) return issues;
    }
  }

  return issues;
}

function qaIssueSeverity(issue) {
  if (issue?.severity) return issue.severity;
  if (["empty-scene", "possible-text-clipping", "unbound-connector", "possible-overlap"].includes(issue?.type)) {
    return "error";
  }
  return "warning";
}

function cloneScene(scene) {
  return JSON.parse(JSON.stringify(scene));
}

function randomId(prefix = "codex") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-6)}`;
}

function markElementChanged(element) {
  if (typeof element.version === "number") {
    element.version += 1;
  } else {
    element.version = 1;
  }
  element.versionNonce = Math.floor(Math.random() * 2_147_483_647);
  element.updated = Date.now();
  return element;
}

function setElementText(element, text) {
  const nextText = String(text ?? "");
  if (typeof element.text === "string" || element.type === "text") {
    element.text = nextText;
    element.originalText = nextText;
    return markElementChanged(element);
  }
  if (element.label && typeof element.label === "object") {
    element.label.text = nextText;
    return markElementChanged(element);
  }
  element.label = {
    ...(element.label || {}),
    text: nextText,
    fontSize: element.fontSize || 24
  };
  return markElementChanged(element);
}

function updateElementPosition(element, operation) {
  if (Number.isFinite(Number(operation.x))) {
    element.x = Number(operation.x);
  }
  if (Number.isFinite(Number(operation.y))) {
    element.y = Number(operation.y);
  }
  if (Number.isFinite(Number(operation.dx))) {
    element.x = Number(element.x || 0) + Number(operation.dx);
  }
  if (Number.isFinite(Number(operation.dy))) {
    element.y = Number(element.y || 0) + Number(operation.dy);
  }
  return markElementChanged(element);
}

function resizeElement(element, operation) {
  if (Number.isFinite(Number(operation.width))) {
    element.width = Math.max(1, Number(operation.width));
  }
  if (Number.isFinite(Number(operation.height))) {
    element.height = Math.max(1, Number(operation.height));
  }
  if (Number.isFinite(Number(operation.dw))) {
    element.width = Math.max(1, Number(element.width || 0) + Number(operation.dw));
  }
  if (Number.isFinite(Number(operation.dh))) {
    element.height = Math.max(1, Number(element.height || 0) + Number(operation.dh));
  }
  return markElementChanged(element);
}

function applyProps(element, props = {}) {
  const blocked = new Set(["id", "type", "isDeleted"]);
  for (const [key, value] of Object.entries(props || {})) {
    if (!blocked.has(key)) {
      element[key] = value;
    }
  }
  return markElementChanged(element);
}

function selectorIds(selector) {
  if (!selector) return [];
  if (typeof selector === "string") return [selector];
  if (Array.isArray(selector)) return selector;
  if (selector.id) return [selector.id];
  if (Array.isArray(selector.ids)) return selector.ids;
  return [];
}

function selectElements(scene, selector = {}) {
  const elements = activeElements(scene);
  if (selector === "all" || selector?.all) {
    return elements;
  }

  const ids = new Set(selectorIds(selector).map(String));
  if (ids.size) {
    return elements.filter((element) => ids.has(String(element.id)));
  }

  return elements.filter((element) => {
    if (selector.type && element.type !== selector.type) return false;
    if (selector.groupId && !(element.groupIds || []).includes(selector.groupId)) return false;
    if (selector.text && elementText(element) !== selector.text) return false;
    if (selector.textIncludes && !elementText(element).includes(selector.textIncludes)) return false;
    return Boolean(selector.type || selector.groupId || selector.text || selector.textIncludes);
  });
}

function requireSelection(scene, selector, operationName) {
  const selected = selectElements(scene, selector);
  if (!selected.length) {
    throw new Error(`${operationName} did not match any active elements.`);
  }
  return selected;
}

function defaultElement(input = {}) {
  const type = input.type || "rectangle";
  const element = {
    id: input.id || randomId(type),
    type,
    groupIds: Array.isArray(input.groupIds) ? input.groupIds : [],
    x: Number(input.x || 0),
    y: Number(input.y || 0),
    width: Number(input.width || (type === "text" ? 180 : 220)),
    height: Number(input.height || (type === "text" ? 36 : 80)),
    angle: Number(input.angle || 0),
    strokeColor: input.strokeColor || "#1e1e1e",
    backgroundColor: input.backgroundColor || "transparent",
    fillStyle: input.fillStyle || "hachure",
    strokeWidth: Number(input.strokeWidth || 2),
    strokeStyle: input.strokeStyle || "solid",
    roughness: Number(input.roughness || 1),
    opacity: Number(input.opacity || 100),
    seed: Number(input.seed || Math.floor(Math.random() * 2_147_483_647)),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_147_483_647),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: input.link || null,
    locked: Boolean(input.locked)
  };

  if (type === "text") {
    element.text = String(input.text || "");
    element.originalText = element.text;
    element.fontSize = Number(input.fontSize || 24);
    element.fontFamily = Number(input.fontFamily || defaultFontFamily);
    element.textAlign = input.textAlign || "left";
    element.verticalAlign = input.verticalAlign || "top";
    element.containerId = input.containerId || null;
    element.lineHeight = Number(input.lineHeight || 1.25);
  } else if (input.text || input.label) {
    element.label = {
      text: String(input.text || input.label || ""),
      fontSize: Number(input.fontSize || 24),
      fontFamily: Number(input.fontFamily || defaultFontFamily),
      groupIds: []
    };
  }

  return {
    ...element,
    ...input,
    id: input.id || element.id,
    type
  };
}

function createConnector(scene, operation) {
  const elements = activeElements(scene);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const fromId = operation.from || operation.start || operation.source;
  const toId = operation.to || operation.end || operation.targetId;
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to) {
    throw new Error(`connect requires existing from/to element ids.`);
  }
  const fromBounds = elementBounds(from);
  const toBounds = elementBounds(to);
  const startX = fromBounds.right;
  const startY = fromBounds.y + fromBounds.height / 2;
  const endX = toBounds.x;
  const endY = toBounds.y + toBounds.height / 2;
  return {
    id: operation.id || randomId("arrow"),
    type: "arrow",
    groupIds: [],
    x: startX,
    y: startY,
    width: endX - startX,
    height: endY - startY,
    angle: 0,
    strokeColor: operation.strokeColor || "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: Number(operation.strokeWidth || 2),
    strokeStyle: operation.strokeStyle || "solid",
    roughness: Number(operation.roughness || 1),
    opacity: 100,
    points: [
      [0, 0],
      [Math.round((endX - startX) / 2), Math.round((endY - startY) / 2)],
      [endX - startX, endY - startY]
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: 8 },
    endBinding: { elementId: to.id, focus: 0, gap: 8 },
    start: { id: from.id },
    end: { id: to.id },
    endArrowhead: operation.endArrowhead || "arrow",
    startArrowhead: operation.startArrowhead || null,
    label: operation.text || operation.label
      ? {
          text: String(operation.text || operation.label?.text || operation.label),
          fontSize: Number(operation.fontSize || operation.label?.fontSize || 16),
          fontFamily: Number(operation.fontFamily || operation.label?.fontFamily || defaultFontFamily),
          groupIds: []
        }
      : undefined,
    seed: Math.floor(Math.random() * 2_147_483_647),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_147_483_647),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: operation.customData || undefined
  };
}

function connectorGeometry(from, to) {
  const fromBounds = elementBounds(from);
  const toBounds = elementBounds(to);
  const fromCenter = {
    x: fromBounds.x + fromBounds.width / 2,
    y: fromBounds.y + fromBounds.height / 2
  };
  const toCenter = {
    x: toBounds.x + toBounds.width / 2,
    y: toBounds.y + toBounds.height / 2
  };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const useHorizontalSides = Math.abs(dx) >= Math.abs(dy);
  let startX;
  let startY;
  let endX;
  let endY;
  if (useHorizontalSides) {
    startX = dx >= 0 ? fromBounds.right : fromBounds.x;
    startY = fromCenter.y;
    endX = dx >= 0 ? toBounds.x : toBounds.right;
    endY = toCenter.y;
  } else {
    startX = fromCenter.x;
    startY = dy >= 0 ? fromBounds.bottom : fromBounds.y;
    endX = toCenter.x;
    endY = dy >= 0 ? toBounds.y : toBounds.bottom;
  }
  return {
    x: startX,
    y: startY,
    width: endX - startX,
    height: endY - startY,
    points: [
      [0, 0],
      [Math.round((endX - startX) / 2), Math.round((endY - startY) / 2)],
      [endX - startX, endY - startY]
    ]
  };
}

function elementRole(element) {
  return element?.customData?.codexRole || "";
}

function elementKind(element) {
  return element?.customData?.codexKind || "";
}

function isConnectorElement(element) {
  return element?.type === "arrow" || element?.type === "line";
}

function refreshConnectorGeometry(scene) {
  const elements = activeElements(scene);
  const byId = new Map(elements.map((element) => [element.id, element]));
  let changed = 0;
  for (const element of elements) {
    if (element.type !== "arrow" && element.type !== "line") continue;
    const from = byId.get(connectionStartId(element));
    const to = byId.get(connectionEndId(element));
    if (!from || !to) continue;
    const geometry = connectorGeometry(from, to);
    element.x = geometry.x;
    element.y = geometry.y;
    element.width = geometry.width;
    element.height = geometry.height;
    element.points = geometry.points;
    markElementChanged(element);
    changed += 1;
  }
  return changed;
}

function normalizePatchPlan(plan) {
  const operations = Array.isArray(plan) ? plan : plan?.ops || plan?.operations;
  if (!Array.isArray(operations) || !operations.length) {
    throw new Error("Patch plan must contain a non-empty ops array.");
  }
  return operations;
}

const RESERVED_PATCH_ELEMENT_TYPES = new Set(["cameraUpdate", "restoreCheckpoint", "delete"]);

function assertPatchAddElement(element = {}) {
  if (RESERVED_PATCH_ELEMENT_TYPES.has(element.type)) {
    throw new Error(
      `Pseudo element type "${element.type}" is only supported in create_view elements, not apply_canvas_patch add operations.`
    );
  }
}

function applyPatchPlan(scene, plan, options = {}) {
  const nextScene = cloneScene(scene);
  const operations = normalizePatchPlan(plan);
  const report = [];

  for (const operation of operations) {
    const op = operation.op || operation.type;
    if (!op) {
      throw new Error("Patch operation is missing op.");
    }

    if (op === "add") {
      const elementsToAdd = operation.elements || [operation.element || operation];
      for (const element of elementsToAdd) {
        assertPatchAddElement(element);
      }
      const added = elementsToAdd.map((element) => defaultElement(element));
      nextScene.elements.push(...added);
      report.push({ op, added: added.map(compactElement) });
      continue;
    }

    if (op === "connect") {
      const connector = createConnector(nextScene, operation);
      nextScene.elements.push(connector);
      report.push({ op, added: [compactElement(connector)] });
      continue;
    }

    const selected = requireSelection(nextScene, operation.target || operation.selector || operation.id, op);

    if (op === "set-text" || op === "rename") {
      for (const element of selected) {
        setElementText(element, operation.text);
      }
      report.push({ op, matched: selected.map(compactElement) });
      continue;
    }

    if (op === "move") {
      for (const element of selected) {
        updateElementPosition(element, operation);
      }
      report.push({ op, matched: selected.map(compactElement) });
      continue;
    }

    if (op === "resize") {
      for (const element of selected) {
        resizeElement(element, operation);
      }
      report.push({ op, matched: selected.map(compactElement) });
      continue;
    }

    if (op === "update") {
      for (const element of selected) {
        if (operation.text !== undefined) setElementText(element, operation.text);
        if (operation.props) applyProps(element, operation.props);
        if (operation.x !== undefined || operation.y !== undefined || operation.dx !== undefined || operation.dy !== undefined) updateElementPosition(element, operation);
        if (operation.width !== undefined || operation.height !== undefined || operation.dw !== undefined || operation.dh !== undefined) resizeElement(element, operation);
      }
      report.push({ op, matched: selected.map(compactElement) });
      continue;
    }

    if (op === "delete") {
      for (const element of selected) {
        element.isDeleted = true;
        markElementChanged(element);
      }
      report.push({ op, deleted: selected.map(compactElement) });
      continue;
    }

    if (op === "group") {
      const groupId = operation.groupId || randomId("group");
      for (const element of selected) {
        element.groupIds = [...new Set([...(element.groupIds || []), groupId])];
        markElementChanged(element);
      }
      report.push({ op, groupId, matched: selected.map(compactElement) });
      continue;
    }

    if (op === "ungroup") {
      const removeGroupId = operation.groupId;
      for (const element of selected) {
        element.groupIds = removeGroupId ? (element.groupIds || []).filter((id) => id !== removeGroupId) : [];
        markElementChanged(element);
      }
      report.push({ op, matched: selected.map(compactElement) });
      continue;
    }

    throw new Error(`Unsupported patch op: ${op}`);
  }

  const refreshedConnectors = options.refreshConnectors === false ? 0 : refreshConnectorGeometry(nextScene);
  if (refreshedConnectors) {
    report.push({ op: "refresh-connectors", matched: refreshedConnectors });
  }

  return {
    scene: nextScene,
    report,
    summary: {
      applied: report.length,
      dryRun: Boolean(options.dryRun)
    }
  };
}

function densityDefaults(density = "normal") {
  if (density === "compact") {
    return {
      itemGap: 78,
      labelPadding: 48,
      labelMaxGrow: 72,
      connectorLabelOffset: 12,
      containerPadding: 28,
      containerGap: 40,
      containerRowGap: 28,
      annotationGap: 28,
      rowTolerance: 72
    };
  }
  if (density === "loose") {
    return {
      itemGap: 140,
      labelPadding: 72,
      labelMaxGrow: 128,
      connectorLabelOffset: 18,
      containerPadding: 44,
      containerGap: 64,
      containerRowGap: 40,
      annotationGap: 44,
      rowTolerance: 88
    };
  }
  return {
    itemGap: 108,
    labelPadding: 60,
    labelMaxGrow: 96,
    connectorLabelOffset: 14,
    containerPadding: 36,
    containerGap: 52,
    containerRowGap: 32,
    annotationGap: 36,
    rowTolerance: 80
  };
}

function textWidthEstimate(text, fontSize = 16) {
  const size = Number(fontSize || 16);
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  return Math.max(
    0,
    ...lines.map((line) =>
      Array.from(line).reduce((width, character) => {
        if (/\s/u.test(character)) return width + size * 0.33;
        if (/[\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u.test(character)) {
          return width + size;
        }
        if (/[A-Z0-9]/u.test(character)) return width + size * 0.66;
        if (/[.,:;|/\\()[\]{}'"]/u.test(character)) return width + size * 0.38;
        return width + size * 0.56;
      }, 0)
    )
  );
}

function textHeightEstimate(text, fontSize = 16) {
  const lineCount = String(text || "").replace(/\r\n/g, "\n").split("\n").length;
  return lineCount * Number(fontSize || 16) * 1.25;
}

function connectorLabelWidth(connector) {
  const text = elementText(connector);
  if (!text) return 0;
  const fontSize = connector?.label?.fontSize || connector?.fontSize || 16;
  return textWidthEstimate(text, fontSize);
}

function elementCenter(element) {
  const bounds = elementBounds(element);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}

function moveElementBy(element, dx, dy) {
  if (!dx && !dy) return;
  element.x = Number(element.x || 0) + dx;
  element.y = Number(element.y || 0) + dy;
  markElementChanged(element);
}

function groupBounds(elements) {
  return sceneBounds(elements) || { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
}

function isContainerRole(role) {
  return ["section", "frame", "container"].includes(role);
}

function isContainerLike(element) {
  return element?.type === "frame" || isContainerRole(elementRole(element));
}

function isAnnotationLike(element) {
  const role = elementRole(element);
  if (["title", "subtitle", "section-label", "text-label"].includes(role)) return true;
  if (element?.type === "text" && !(element.groupIds || []).length) return true;
  return false;
}

function isGlobalAnnotation(element) {
  return ["title", "subtitle"].includes(elementRole(element));
}

function isSectionHeading(element) {
  return elementRole(element) === "section-label";
}

function isDetailLike(element) {
  const role = elementRole(element);
  return ["wireframe-detail", "badge"].includes(role);
}

function isPrimaryLayoutElement(element) {
  if (!element || element.isDeleted) return false;
  if (isConnectorElement(element) || isContainerLike(element) || isAnnotationLike(element)) return false;
  if (isDetailLike(element) && !(element.groupIds || []).length) return false;
  return true;
}

function collectGroups(elements) {
  const groups = new Map();
  for (const element of elements) {
    for (const groupId of element.groupIds || []) {
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(element);
    }
  }
  return [...groups.entries()].map(([id, groupElements]) => ({
    id,
    elements: groupElements,
    bounds: groupBounds(groupElements),
    primaryElements: groupElements.filter(isPrimaryLayoutElement)
  }));
}

function createLayoutUnits(elements) {
  const groups = collectGroups(elements).filter((group) => group.primaryElements.length);
  const groupedIds = new Set(groups.flatMap((group) => group.elements.map((element) => element.id)));
  const units = groups.map((group) => {
    return {
      id: group.id,
      kind: "group",
      elements: group.elements,
      primaryIds: new Set(group.elements.map((element) => element.id)),
      bounds: group.bounds
    };
  });
  for (const element of elements) {
    if (groupedIds.has(element.id) || !isPrimaryLayoutElement(element)) continue;
    const bounds = elementBounds(element);
    units.push({
      id: element.id,
      kind: "element",
      elements: [element],
      primaryIds: new Set([element.id]),
      bounds
    });
  }
  return units.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
}

function clusterRows(items, tolerance) {
  const rows = [];
  const sorted = [...items].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  for (const item of sorted) {
    const center = {
      x: item.bounds.x + item.bounds.width / 2,
      y: item.bounds.y + item.bounds.height / 2
    };
    const row = rows.find((candidate) => Math.abs(candidate.centerY - center.y) <= tolerance);
    if (row) {
      row.items.push(item);
      row.centerY = row.items.reduce((sum, rowItem) => sum + rowItem.bounds.y + rowItem.bounds.height / 2, 0) / row.items.length;
    } else {
      rows.push({ centerY: center.y, items: [item] });
    }
  }
  return rows;
}

function connectorBetweenUnits(connectors, first, second) {
  return connectors.find((connector) => {
    const start = connectionStartId(connector);
    const end = connectionEndId(connector);
    return (first.primaryIds.has(start) && second.primaryIds.has(end)) || (first.primaryIds.has(end) && second.primaryIds.has(start));
  });
}

function distributeLayoutRows(elements, options = {}) {
  const units = createLayoutUnits(elements);
  const connectors = elements.filter(isConnectorElement);
  const rows = clusterRows(units, Number(options.rowTolerance || 80));
  const reports = [];
  for (const row of rows) {
    const sorted = [...row.items].sort((a, b) => a.bounds.x - b.bounds.x);
    if (sorted.length < 2) continue;
    let cursor = Math.min(...sorted.map((unit) => unit.bounds.x));
    let moved = 0;
    sorted.forEach((unit, index) => {
      if (index > 0) {
        const previous = sorted[index - 1];
        const connector = connectorBetweenUnits(connectors, previous, unit);
        const labelGap = connector ? connectorLabelWidth(connector) + Number(options.labelPadding || 60) : 0;
        cursor += Math.max(Number(options.gap || 108), labelGap);
      }
      const dx = cursor - unit.bounds.x;
      if (dx) {
        for (const element of unit.elements) {
          moveElementBy(element, dx, 0);
        }
        moved += 1;
      }
      cursor += unit.bounds.width;
    });
    reports.push({
      mode: "polish-row-spacing",
      gap: Number(options.gap || 108),
      moved,
      matched: sorted.map((unit) => ({
        id: unit.id,
        kind: unit.kind,
        x: roundNumber(unit.bounds.x),
        y: roundNumber(unit.bounds.y),
        width: roundNumber(unit.bounds.width),
        height: roundNumber(unit.bounds.height)
      }))
    });
  }
  return reports;
}

function captureContainerMembership(elements) {
  const containers = elements.filter(isContainerLike);
  return containers.map((container) => {
    const bounds = elementBounds(container);
    const childIds = elements
      .filter((candidate) => candidate.id !== container.id && !candidate.isDeleted && !isGlobalAnnotation(candidate) && !isContainerLike(candidate) && !isConnectorElement(candidate))
      .filter((candidate) => {
        const center = elementCenter(candidate);
        return center.x >= bounds.x && center.x <= bounds.right && center.y >= bounds.y && center.y <= bounds.bottom;
      })
      .map((candidate) => candidate.id);
    return {
      containerId: container.id,
      childIds
    };
  });
}

function compactBounds(bounds) {
  return {
    x: roundNumber(bounds.x),
    y: roundNumber(bounds.y),
    width: roundNumber(bounds.width),
    height: roundNumber(bounds.height)
  };
}

function rowBounds(row) {
  return sceneBounds(row.items.map((item) => item.element || item.elements?.[0]).filter(Boolean));
}

function moveElementsBy(elements, dx, dy) {
  for (const element of elements) {
    moveElementBy(element, dx, dy);
  }
}

function labelTargetId(element) {
  return typeof element?.customData?.labelFor === "string" ? element.customData.labelFor : "";
}

function isRecipeLabel(element) {
  return element?.type === "text" && Boolean(labelTargetId(element));
}

function setElementFrame(element, frame) {
  let changed = false;
  for (const key of ["x", "y", "width", "height"]) {
    const next = Number(frame[key]);
    if (Number.isFinite(next) && Math.round(Number(element[key] || 0)) !== Math.round(next)) {
      element[key] = next;
      changed = true;
    }
  }
  if (changed) markElementChanged(element);
  return changed;
}

function labelFrameForTarget(label, target, options = {}) {
  const role = elementRole(label);
  const targetBounds = elementBounds(target);
  const fontSize = Number(label.fontSize || 20);
  const labelHeight = Math.max(Number(label.height || 0), Math.ceil(fontSize * 1.45));
  if (isConnectorElement(target)) {
    const center = elementCenter(target);
    const targetIsVertical = targetBounds.height > Math.max(24, targetBounds.width * 3);
    const targetIsHorizontal = targetBounds.width > Math.max(24, targetBounds.height * 3);
    const offset = Number(options.connectorLabelOffset || 14);
    if (targetIsVertical) {
      return {
        x: center.x + offset,
        y: center.y - labelHeight / 2,
        width: Math.max(Number(label.width || 0), textWidthEstimate(elementText(label), fontSize) + 18),
        height: labelHeight
      };
    }
    if (targetIsHorizontal) {
      const width = Math.max(Number(label.width || 0), textWidthEstimate(elementText(label), fontSize) + 18);
      return {
        x: center.x - width / 2,
        y: center.y - labelHeight - offset,
        width,
        height: labelHeight
      };
    }
    const width = Math.max(Number(label.width || 0), textWidthEstimate(elementText(label), fontSize) + 18);
    return {
      x: center.x + offset,
      y: center.y - labelHeight / 2,
      width,
      height: labelHeight
    };
  }

  if (role === "section-label") {
    return {
      x: targetBounds.x + 22,
      y: targetBounds.y + 18,
      width: Math.max(24, targetBounds.width - 44),
      height: labelHeight
    };
  }
  if (role === "page-card-label") {
    return {
      x: targetBounds.x + 18,
      y: targetBounds.y + 16,
      width: Math.max(24, targetBounds.width - 36),
      height: labelHeight
    };
  }

  const padding = role === "badge-label" ? 18 : 16;
  return {
    x: targetBounds.x + padding,
    y: targetBounds.y + Math.max(8, Math.round((targetBounds.height - labelHeight) / 2)),
    width: Math.max(24, targetBounds.width - padding * 2),
    height: labelHeight
  };
}

function resizeLabelTargets(elements, options = {}) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  let adjusted = 0;
  const maxGrow = Number(options.maxGrow || 96);
  for (const label of elements.filter(isRecipeLabel)) {
    const target = byId.get(labelTargetId(label));
    if (!target || isConnectorElement(target)) continue;
    const role = elementRole(label);
    if (!["badge-label", "sticky-label", "service-card-label", "milestone-label"].includes(role)) continue;
    const fontSize = Number(label.fontSize || 20);
    const desiredLabelWidth = textWidthEstimate(elementText(label), fontSize) + 24;
    const padding = role === "badge-label" ? 18 : 16;
    const desiredTargetWidth = desiredLabelWidth + padding * 2;
    const currentWidth = Number(target.width || 0);
    const nextWidth = Math.min(currentWidth + maxGrow, Math.max(currentWidth, desiredTargetWidth));
    if (nextWidth > currentWidth + 1) {
      target.width = nextWidth;
      markElementChanged(target);
      adjusted += 1;
    }
  }
  return adjusted ? [{ mode: "polish-label-target-size", matched: adjusted }] : [];
}

function alignRecipeLabels(elements, options = {}) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  let moved = 0;
  for (const label of elements.filter(isRecipeLabel)) {
    const target = byId.get(labelTargetId(label));
    if (!target) continue;
    const frame = labelFrameForTarget(label, target, options);
    if (setElementFrame(label, frame)) moved += 1;
  }
  return moved ? [{ mode: "polish-recipe-labels", matched: moved }] : [];
}

function supplementalAnnotationRows(children, primaryBounds, tolerance) {
  const candidates = children
    .filter((element) => !isPrimaryLayoutElement(element))
    .filter((element) => !isSectionHeading(element) && !isGlobalAnnotation(element))
    .filter((element) => isDetailLike(element) || elementRole(element) === "text-label")
    .filter((element) => {
      const center = elementCenter(element);
      return center.y >= primaryBounds.y + primaryBounds.height / 2;
    })
    .map((element) => ({
      id: element.id,
      kind: "annotation",
      element,
      bounds: elementBounds(element)
    }));
  return clusterRows(candidates, tolerance);
}

function spaceContainerAnnotations(elements, memberships, options = {}) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const gap = Number(options.gap || 36);
  const reports = [];
  for (const membership of memberships) {
    const children = membership.childIds.map((id) => byId.get(id)).filter(Boolean);
    const primaryChildren = children.filter(isPrimaryLayoutElement);
    if (!primaryChildren.length) continue;
    const primaryBounds = sceneBounds(primaryChildren);
    if (!primaryBounds) continue;
    const annotationRows = supplementalAnnotationRows(children, primaryBounds, Number(options.rowTolerance || 80));
    if (!annotationRows.length) continue;
    let cursorY = primaryBounds.y + primaryBounds.height + gap;
    let moved = 0;
    for (const row of annotationRows.sort((a, b) => a.centerY - b.centerY)) {
      const bounds = rowBounds(row);
      if (!bounds) continue;
      const dy = Math.max(0, cursorY - bounds.y);
      if (dy) {
        moveElementsBy(row.items.map((item) => item.element), 0, dy);
        moved += row.items.length;
      }
      cursorY = Math.max(bounds.y + dy + bounds.height + gap / 2, cursorY);
    }
    if (moved) {
      reports.push({
        mode: "polish-annotation-spacing",
        containerId: membership.containerId,
        moved
      });
    }
  }
  return reports;
}

function resizeContainersToMembership(elements, memberships, options = {}) {
  const padding = Number(options.padding || 36);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const reports = [];
  for (const membership of memberships) {
    const container = byId.get(membership.containerId);
    if (!container || !membership.childIds.length) continue;
    const children = membership.childIds.map((id) => byId.get(id)).filter(Boolean);
    const bounds = sceneBounds(children);
    if (!bounds) continue;
    const nextX = bounds.x - padding;
    const nextY = bounds.y - padding;
    const nextWidth = bounds.width + padding * 2;
    const nextHeight = bounds.height + padding * 2;
    if (nextX !== container.x || nextY !== container.y || nextWidth !== container.width || nextHeight !== container.height) {
      container.x = nextX;
      container.y = nextY;
      container.width = nextWidth;
      container.height = nextHeight;
      markElementChanged(container);
      reports.push({
        mode: "polish-container-bounds",
        container: compactElement(container),
        childCount: children.length
      });
    }
  }
  return reports;
}

function moveContainerWithMembership(container, membership, byId, dx, dy) {
  if (!dx && !dy) return 0;
  moveElementBy(container, dx, dy);
  let moved = 1;
  for (const childId of membership?.childIds || []) {
    const child = byId.get(childId);
    if (!child) continue;
    moveElementBy(child, dx, dy);
    moved += 1;
  }
  return moved;
}

function stackTopLevelContainers(elements, memberships, options = {}) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const membershipByContainer = new Map(memberships.map((membership) => [membership.containerId, membership]));
  const containerCandidates = elements.filter((element) => isContainerLike(element) && !(element.groupIds || []).length);
  const containers = containerCandidates
    .filter((element) => {
      const bounds = elementBounds(element);
      const center = elementCenter(element);
      return !containerCandidates.some((candidate) => {
        if (candidate.id === element.id) return false;
        const candidateBounds = elementBounds(candidate);
        const isLargerContainer =
          candidateBounds.width * candidateBounds.height > bounds.width * bounds.height * 1.2;
        return isLargerContainer && center.x >= candidateBounds.x && center.x <= candidateBounds.right && center.y >= candidateBounds.y && center.y <= candidateBounds.bottom;
      });
    })
    .sort((a, b) => elementBounds(a).y - elementBounds(b).y || elementBounds(a).x - elementBounds(b).x);
  if (!containers.length) return [];

  const globalBounds = sceneBounds(elements.filter(isGlobalAnnotation));
  const topGap = Number(options.topGap || options.gap || 52);
  const containerGap = Number(options.gap || 52);
  let cursorY = globalBounds ? globalBounds.y + globalBounds.height + topGap : elementBounds(containers[0]).y;
  const reports = [];

  for (const container of containers) {
    const bounds = elementBounds(container);
    const dy = Math.max(0, cursorY - bounds.y);
    if (dy) {
      const moved = moveContainerWithMembership(container, membershipByContainer.get(container.id), byId, 0, dy);
      reports.push({
        mode: "polish-container-stack",
        containerId: container.id,
        moved,
        dy: roundNumber(dy)
      });
    }
    const updated = elementBounds(container);
    cursorY = updated.bottom + containerGap;
  }
  return reports;
}

function topLevelContainers(elements) {
  const containerCandidates = elements.filter((element) => isContainerLike(element));
  return containerCandidates.filter((element) => {
    const bounds = elementBounds(element);
    const center = elementCenter(element);
    return !containerCandidates.some((candidate) => {
      if (candidate.id === element.id) return false;
      const candidateBounds = elementBounds(candidate);
      const isLargerContainer =
        candidateBounds.width * candidateBounds.height > bounds.width * bounds.height * 1.2;
      return isLargerContainer && center.x >= candidateBounds.x && center.x <= candidateBounds.right && center.y >= candidateBounds.y && center.y <= candidateBounds.bottom;
    });
  });
}

function distributeTopLevelContainerRows(elements, memberships, options = {}) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const membershipByContainer = new Map(memberships.map((membership) => [membership.containerId, membership]));
  const containers = topLevelContainers(elements);
  const rows = clusterRows(
    containers.map((container) => ({
      id: container.id,
      element: container,
      bounds: elementBounds(container)
    })),
    Number(options.rowTolerance || 96)
  );
  const gap = Number(options.gap || 32);
  const reports = [];
  for (const row of rows) {
    const sorted = [...row.items].sort((a, b) => a.bounds.x - b.bounds.x);
    if (sorted.length < 2) continue;
    let cursorX = Math.min(...sorted.map((item) => item.bounds.x));
    let moved = 0;
    for (const item of sorted) {
      const dx = Math.max(0, cursorX - item.bounds.x);
      if (dx) {
        moved += moveContainerWithMembership(item.element, membershipByContainer.get(item.element.id), byId, dx, 0);
      }
      const updated = elementBounds(item.element);
      cursorX = updated.right + gap;
    }
    if (moved) {
      reports.push({
        mode: "polish-container-row-spacing",
        moved,
        gap,
        matched: sorted.map((item) => item.id)
      });
    }
  }
  return reports;
}

function applyPolishPlan(scene, plan = {}, options = {}) {
  const nextScene = cloneScene(scene);
  const defaults = densityDefaults(plan.density || "normal");
  const report = [];
  const initialMemberships = captureContainerMembership(activeElements(nextScene));

  report.push(
    ...resizeLabelTargets(activeElements(nextScene), {
      maxGrow: Number(plan.labelMaxGrow ?? defaults.labelMaxGrow ?? 96)
    })
  );

  report.push(
    ...spaceContainerAnnotations(activeElements(nextScene), initialMemberships, {
      gap: Number(plan.annotationGap ?? defaults.annotationGap),
      rowTolerance: Number(plan.rowTolerance ?? defaults.rowTolerance)
    })
  );

  report.push(
    ...resizeContainersToMembership(activeElements(nextScene), initialMemberships, {
      padding: Number(plan.containerPadding ?? defaults.containerPadding)
    })
  );

  report.push(
    ...stackTopLevelContainers(activeElements(nextScene), initialMemberships, {
      gap: Number(plan.containerGap ?? defaults.containerGap),
      topGap: Number(plan.titleGap ?? plan.containerGap ?? defaults.containerGap)
    })
  );

  report.push(
    ...distributeLayoutRows(activeElements(nextScene), {
      gap: Number(plan.itemGap ?? defaults.itemGap),
      labelPadding: Number(plan.labelPadding ?? defaults.labelPadding),
      rowTolerance: Number(plan.rowTolerance ?? defaults.rowTolerance)
    })
  );

  const refreshedConnectors = options.refreshConnectors === false ? 0 : refreshConnectorGeometry(nextScene);
  if (refreshedConnectors) {
    report.push({ mode: "refresh-connectors", matched: refreshedConnectors });
  }

  report.push(
    ...resizeContainersToMembership(activeElements(nextScene), initialMemberships, {
      padding: Number(plan.containerPadding ?? defaults.containerPadding)
    })
  );

  const containerRowSpacing = distributeTopLevelContainerRows(activeElements(nextScene), initialMemberships, {
    gap: Number(plan.containerRowGap ?? defaults.containerRowGap ?? 32),
    rowTolerance: Number(plan.rowTolerance ?? defaults.rowTolerance)
  });
  report.push(...containerRowSpacing);
  if (containerRowSpacing.length && options.refreshConnectors !== false) {
    const refreshedAfterContainers = refreshConnectorGeometry(nextScene);
    if (refreshedAfterContainers) {
      report.push({ mode: "refresh-connectors-after-container-spacing", matched: refreshedAfterContainers });
    }
  }

  report.push(
    ...alignRecipeLabels(activeElements(nextScene), {
      connectorLabelOffset: Number(plan.connectorLabelOffset ?? defaults.connectorLabelOffset ?? 14)
    })
  );

  nextScene.appState = {
    ...(nextScene.appState || {}),
    codex: {
      ...(nextScene.appState?.codex || {}),
      lastPolish: {
        density: plan.density || "normal",
        polishedAt: new Date().toISOString(),
        reportCount: report.length,
        principles: ["unit-spacing", "label-aware-connectors", "container-fit", "container-stack", "annotation-spacing", "grouped-label-fit"]
      }
    }
  };

  return {
    scene: nextScene,
    report,
    summary: {
      applied: report.length,
      dryRun: Boolean(options.dryRun),
      density: plan.density || "normal"
    }
  };
}

function legacyRoleMatchesSection(sectionElement, candidate) {
  const center = elementCenter(candidate);
  const bounds = elementBounds(sectionElement);
  return center.x >= bounds.x && center.x <= bounds.right && center.y >= bounds.y && center.y <= bounds.bottom;
}

function selectableLayoutElements(scene, selector) {
  const selected = selector ? selectElements(scene, selector) : activeElements(scene);
  return selected.filter((element) => !["arrow", "line"].includes(element.type));
}

function applyLayoutPlan(scene, plan = {}, options = {}) {
  const nextScene = cloneScene(scene);
  const mode = plan.mode || "align";
  const selected = selectableLayoutElements(nextScene, plan.target || plan.selector);
  if (selected.length < 2) {
    throw new Error("Layout requires at least two non-connector elements.");
  }

  const report = [];
  if (mode === "align") {
    const align = plan.align || plan.to || "middle";
    const bounds = sceneBounds(selected);
    for (const element of selected) {
      const item = elementBounds(element);
      if (align === "left") element.x = bounds.x;
      if (align === "right") element.x = bounds.x + bounds.width - item.width;
      if (align === "center") element.x = bounds.x + bounds.width / 2 - item.width / 2;
      if (align === "top") element.y = bounds.y;
      if (align === "bottom") element.y = bounds.y + bounds.height - item.height;
      if (align === "middle") element.y = bounds.y + bounds.height / 2 - item.height / 2;
      markElementChanged(element);
    }
    report.push({ mode, align, matched: selected.map(compactElement) });
  } else if (mode === "distribute") {
    const axis = plan.axis || "x";
    const gap = Number(plan.gap ?? 48);
    const sorted = [...selected].sort((a, b) => Number(a[axis === "y" ? "y" : "x"] || 0) - Number(b[axis === "y" ? "y" : "x"] || 0));
    let cursor = Number(sorted[0][axis === "y" ? "y" : "x"] || 0);
    for (const element of sorted) {
      if (axis === "y") {
        element.y = cursor;
        cursor += Number(element.height || 0) + gap;
      } else {
        element.x = cursor;
        cursor += Number(element.width || 0) + gap;
      }
      markElementChanged(element);
    }
    report.push({ mode, axis, gap, matched: sorted.map(compactElement) });
  } else if (mode === "grid") {
    const columns = Math.max(1, Number(plan.columns || 3));
    const gapX = Number(plan.gapX ?? plan.gap ?? 48);
    const gapY = Number(plan.gapY ?? plan.gap ?? 48);
    const sorted = [...selected].sort((a, b) => Number(a.y || 0) - Number(b.y || 0) || Number(a.x || 0) - Number(b.x || 0));
    const originX = Number(plan.x ?? Math.min(...sorted.map((element) => Number(element.x || 0))));
    const originY = Number(plan.y ?? Math.min(...sorted.map((element) => Number(element.y || 0))));
    const maxWidth = Math.max(...sorted.map((element) => Number(element.width || 0)));
    const maxHeight = Math.max(...sorted.map((element) => Number(element.height || 0)));
    sorted.forEach((element, index) => {
      element.x = originX + (index % columns) * (maxWidth + gapX);
      element.y = originY + Math.floor(index / columns) * (maxHeight + gapY);
      markElementChanged(element);
    });
    report.push({ mode, columns, matched: sorted.map(compactElement) });
  } else {
    throw new Error(`Unsupported layout mode: ${mode}`);
  }

  const refreshedConnectors = options.refreshConnectors === false ? 0 : refreshConnectorGeometry(nextScene);
  if (refreshedConnectors) {
    report.push({ mode: "refresh-connectors", matched: refreshedConnectors });
  }

  return {
    scene: nextScene,
    report,
    summary: {
      applied: report.length,
      dryRun: Boolean(options.dryRun)
    }
  };
}

function qaScene(scene, options = {}) {
  const elements = activeElements(scene);
  const issues = detectLayoutIssues(elements, { scene }).map((issue) => ({
    severity: qaIssueSeverity(issue),
    ...issue
  }));
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const summary = summarizeScene(scene, options);
  return {
    scene: options.name,
    ok: blockingIssues.length === 0,
    issueCount: issues.length,
    blockingIssueCount: blockingIssues.length,
    warningCount: issues.length - blockingIssues.length,
    issues,
    summary: {
      activeElementCount: summary.scene.activeElementCount,
      bounds: summary.scene.bounds,
      elementsByType: summary.elementsByType,
      textCount: summary.texts.length,
      connectionCount: summary.connections.length
    }
  };
}

const {
  layoutSceneFile,
  patchSceneFile,
  polishSceneFile
} = createSceneFileOperations({
  applyLayoutPlan,
  applyPatchPlan,
  applyPolishPlan,
  createSnapshot,
  diffScenes,
  normalizeSceneName,
  qaScene,
  readScene,
  writeScene
});

function summarizeScene(scene, options = {}) {
  const elements = activeElements(scene);
  const typeCounts = elements.reduce((counts, element) => {
    counts[element.type || "unknown"] = (counts[element.type || "unknown"] || 0) + 1;
    return counts;
  }, {});

  return {
    scene: {
      name: options.name,
      source: scene?.source,
      version: scene?.version,
      elementCount: Array.isArray(scene?.elements) ? scene.elements.length : 0,
      activeElementCount: elements.length,
      bounds: sceneBounds(elements)
    },
    elementsByType: typeCounts,
    texts: elements
      .filter((element) => elementText(element))
      .map((element) => ({
        id: element.id,
        type: element.type,
        text: truncateText(elementText(element), 120),
        x: roundNumber(element.x),
        y: roundNumber(element.y)
      }))
      .slice(0, 80),
    connections: summarizeConnections(elements).slice(0, 80),
    groups: summarizeGroups(elements).slice(0, 40),
    regions: summarizeRegions(elements),
    layoutIssues: detectLayoutIssues(elements, { scene })
  };
}

function connectionSignature(element) {
  return `${connectionStartId(element) || ""}->${connectionEndId(element) || ""}`;
}

function groupSignature(element) {
  return Array.isArray(element.groupIds) ? element.groupIds.join(",") : "";
}

function diffScenes(previousScene, currentScene, options = {}) {
  const previousElements = activeElements(previousScene);
  const currentElements = activeElements(currentScene);
  const previousById = new Map(previousElements.map((element) => [element.id, element]));
  const currentById = new Map(currentElements.map((element) => [element.id, element]));
  const added = currentElements.filter((element) => !previousById.has(element.id)).map(compactElement);
  const removed = previousElements.filter((element) => !currentById.has(element.id)).map(compactElement);
  const modified = [];

  for (const [id, current] of currentById.entries()) {
    const previous = previousById.get(id);
    if (!previous) continue;
    const changes = [];
    const beforeText = elementText(previous);
    const afterText = elementText(current);
    if (beforeText !== afterText) {
      changes.push({ field: "text", before: beforeText, after: afterText });
    }
    if (previous.type !== current.type) {
      changes.push({ field: "type", before: previous.type, after: current.type });
    }
    if (Math.abs(Number(previous.x || 0) - Number(current.x || 0)) > 2 || Math.abs(Number(previous.y || 0) - Number(current.y || 0)) > 2) {
      changes.push({
        field: "position",
        before: { x: roundNumber(previous.x), y: roundNumber(previous.y) },
        after: { x: roundNumber(current.x), y: roundNumber(current.y) }
      });
    }
    if (Math.abs(Number(previous.width || 0) - Number(current.width || 0)) > 2 || Math.abs(Number(previous.height || 0) - Number(current.height || 0)) > 2) {
      changes.push({
        field: "size",
        before: { width: roundNumber(previous.width), height: roundNumber(previous.height) },
        after: { width: roundNumber(current.width), height: roundNumber(current.height) }
      });
    }
    if (connectionSignature(previous) !== connectionSignature(current)) {
      changes.push({
        field: "connection",
        before: connectionSignature(previous),
        after: connectionSignature(current)
      });
    }
    if (groupSignature(previous) !== groupSignature(current)) {
      changes.push({
        field: "groups",
        before: groupSignature(previous),
        after: groupSignature(current)
      });
    }
    if (changes.length) {
      modified.push({
        id,
        type: current.type,
        label: elementLabel(current),
        changes
      });
    }
  }

  return {
    scene: options.name,
    comparedWith: options.comparedWith,
    stats: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      previousActiveElementCount: previousElements.length,
      currentActiveElementCount: currentElements.length
    },
    added,
    removed,
    modified
  };
}

async function diffSceneFromSnapshot(name, reference = "latest") {
  const fileName = normalizeSceneName(name);
  const snapshotPath = await resolveSnapshotPath(fileName, reference);
  const previous = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  const current = await readScene(fileName);
  return diffScenes(previous, current, {
    name: fileName,
    comparedWith: snapshotPath
  });
}

function baseUrlFromRequest(request) {
  return `${request.protocol}://${request.get("host")}/`;
}

function assetVariantSuffix(input) {
  const value = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 48);
  return value ? `.${value}` : "";
}

async function exportSceneAsset(name, options = {}) {
  const fileName = normalizeSceneName(name);
  const format = options.format === "svg" ? "svg" : "png";
  const baseUrl = options.baseUrl || "http://127.0.0.1:3000/";
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(
      `${baseUrl.replace(/\/$/, "")}/export.html?scene=${encodeURIComponent(fileName)}&format=${format}`,
      { waitUntil: "domcontentloaded" }
    );
    await page.waitForFunction(
      () => window.__EXCALIDRAW_EXPORT_RESULT__ || window.__EXCALIDRAW_EXPORT_ERROR__,
      null,
      { timeout: 30000 }
    );
    const error = await page.evaluate(() => window.__EXCALIDRAW_EXPORT_ERROR__);
    if (error) {
      throw new Error(error);
    }
    const result = await page.evaluate(() => window.__EXCALIDRAW_EXPORT_RESULT__);
    const outputName = fileName.replace(/\.excalidraw$/, `${assetVariantSuffix(options.variant)}.${format}`);
    const outputPath = path.join(artifactsDir, outputName);
    if (format === "png") {
      const base64 = result.content.replace(/^data:image\/png;base64,/, "");
      await fs.writeFile(outputPath, Buffer.from(base64, "base64"));
    } else {
      await fs.writeFile(outputPath, result.content, "utf8");
    }
    const stat = await fs.stat(outputPath);
    return {
      scene: fileName,
      format,
      path: outputPath,
      url: `/artifacts/excalidraw/${encodeURIComponent(outputName)}`,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function inferDiffIntent(diff) {
  if (!diff) {
    return ["No prior snapshot was available, so this is a current-state inspection only."];
  }
  const takeaways = [];
  const textChanges = diff.modified.flatMap((item) => item.changes.filter((change) => change.field === "text"));
  const positionChanges = diff.modified.flatMap((item) => item.changes.filter((change) => change.field === "position"));
  const sizeChanges = diff.modified.flatMap((item) => item.changes.filter((change) => change.field === "size"));
  const connectionChanges = diff.modified.flatMap((item) => item.changes.filter((change) => change.field === "connection"));
  const addedConnectors = diff.added.filter((item) => item.type === "arrow" || item.type === "line");
  const addedNodes = diff.added.filter((item) => item.type !== "arrow" && item.type !== "line");

  if (!diff.stats.added && !diff.stats.removed && !diff.stats.modified) {
    takeaways.push("No structural changes compared with the selected snapshot.");
  }
  if (textChanges.length) {
    takeaways.push(`Labels were refined in ${textChanges.length} place${textChanges.length === 1 ? "" : "s"}.`);
  }
  if (addedNodes.length) {
    takeaways.push(`${addedNodes.length} new node${addedNodes.length === 1 ? "" : "s"} were added, likely extending the scope or flow.`);
  }
  if (addedConnectors.length || connectionChanges.length) {
    takeaways.push("Connections changed, so the relationship model or process path may have shifted.");
  }
  if (positionChanges.length || sizeChanges.length) {
    takeaways.push("Layout changed, which may indicate regrouping, prioritization, or a clearer reading order.");
  }
  if (diff.stats.removed) {
    takeaways.push(`${diff.stats.removed} element${diff.stats.removed === 1 ? "" : "s"} were removed, likely simplifying the diagram.`);
  }
  return takeaways;
}

function nextActionsFromInspection(summary, diff) {
  const actions = [];
  if (summary.layoutIssues.length) {
    actions.push("Run qa/layout cleanup before exporting or sharing.");
  }
  if (diff?.stats.added || diff?.stats.modified || diff?.stats.removed) {
    actions.push("Confirm the interpreted change intent, then apply targeted patch/batch edits if needed.");
  } else {
    actions.push("Use the current canvas as the stable source for the next architecture or product step.");
  }
  if (summary.connections.length && summary.texts.length) {
    actions.push("Translate the diagram into an implementation plan, PRD outline, or next diagram iteration.");
  }
  return actions;
}

async function inspectSceneFile(name, options = {}) {
  const fileName = normalizeSceneName(name);
  const scene = await readScene(fileName);
  const summary = summarizeScene(scene, { name: fileName });
  let diff = null;
  let diffError;
  const reference = options.from || "latest";
  try {
    diff = await diffSceneFromSnapshot(fileName, reference);
  } catch (error) {
    diffError = error instanceof Error ? error.message : String(error);
  }
  return {
    scene: fileName,
    inspectedAt: new Date().toISOString(),
    summary,
    diff,
    diffError,
    takeaways: inferDiffIntent(diff),
    nextActions: nextActionsFromInspection(summary, diff)
  };
}

function configureApi(app) {
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (_request, response) => {
    response.json(healthPayload());
  });

  app.get("/api/scenes", async (_request, response, next) => {
    try {
      response.json(await listScenes());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/live-scenes", (_request, response) => {
    response.json({ ok: true, scenes: listLiveScenes() });
  });

  app.get("/api/current-scene", (_request, response) => {
    response.json(getActiveCanvas());
  });

  app.post("/api/current-scene", (request, response, next) => {
    try {
      response.json(setActiveCanvas({
        scene: request.body?.scene || request.body?.name,
        source: request.body?.source || "workbench",
        clientId: request.body?.clientId
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/live-scenes/:name/status", (request, response) => {
    response.json(getLiveSceneStatus(request.params.name, {
      includeScene: request.query.includeScene === "true"
    }));
  });

  app.get("/api/live-scenes/:name", (request, response) => {
    const live = getLiveScene(request.params.name, {
      includeScene: request.query.includeScene === "true"
    });
    if (!live) {
      response.status(404).json({ ok: false, error: `No live scene for ${normalizeSceneName(request.params.name)}` });
      return;
    }
    response.json(live);
  });

  app.get("/api/live-scenes/:name/events", (request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const unsubscribe = subscribeLiveScene(request.params.name, (payload) => {
      const live = getLiveScene(request.params.name, { includeScene: true });
      response.write(`event: live-scene\ndata: ${JSON.stringify(live || payload)}\n\n`);
    });
    response.write(`event: ready\ndata: ${JSON.stringify({
      ...getLiveSceneStatus(request.params.name),
      subscribedAt: new Date().toISOString()
    })}\n\n`);

    request.on("close", unsubscribe);
  });

  app.post("/api/live-scenes/:name", (request, response, next) => {
    try {
      const scene = request.body?.scene || request.body;
      if (!scene || scene.type !== "excalidraw" || !Array.isArray(scene.elements)) {
        throw new Error("Live scene payload must be an Excalidraw scene.");
      }
      const result = updateLiveScene(request.params.name, scene, {
        baseRevision: request.body?.baseRevision,
        revision: request.body?.revision,
        clientId: request.body?.clientId,
        source: request.body?.source || "workbench",
        previewUpdated: Boolean(request.body?.previewUpdated)
      });
      if (result.conflict) {
        response.status(409).json(result);
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/live-scenes/:name", (request, response) => {
    response.json({ ok: true, scene: normalizeSceneName(request.params.name), deleted: clearLiveScene(request.params.name) });
  });

  app.get("/api/templates", (_request, response) => {
    response.json(listBriefTemplates());
  });

  app.post("/api/expression-plan", (request, response, next) => {
    try {
      response.json(createExpressionPlan({
        brief: request.body?.brief || request.body?.prompt || "",
        title: request.body?.title,
        template: request.body?.template || "auto",
        expressionPlan: request.body?.expressionPlan || request.body?.plan
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/libraries", async (request, response, next) => {
    try {
      response.json(await listLibraryRegistry({
        includeStats: request.query.stats === "true"
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/libraries/search", async (request, response, next) => {
    try {
      response.json(await searchLibraryRegistry(request.query.q || "", {
        limit: Number(request.query.limit || 10)
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/libraries/select", async (request, response, next) => {
    try {
      response.json(await selectLibrariesForBrief(request.query.q || request.query.brief || "", {
        limit: Number(request.query.limit || 3)
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/libraries/validate", async (_request, response, next) => {
    try {
      response.json(await validateLibraryRegistry());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/libraries/items", async (_request, response, next) => {
    try {
      response.json({ ok: true, ...(await listInstalledLibraryItems()) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/libraries/:id", async (request, response, next) => {
    try {
      response.json(await inspectRegisteredLibrary(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/from-brief", async (request, response, next) => {
    try {
      const outName = normalizeSceneName(request.body?.out || request.body?.name || "brief-diagram.excalidraw");
      const result = await runBriefGenerationWorkflow({
        brief: request.body?.brief || request.body?.prompt || "",
        title: request.body?.title,
        template: request.body?.template || "auto",
        expressionPlan: request.body?.expressionPlan || request.body?.plan,
        libraries: request.body?.libraries,
        libraryLimit: request.body?.libraryLimit,
        polish: request.body?.polish,
        density: request.body?.density,
        preview: request.body?.preview,
        baseUrl: baseUrlFromRequest(request),
        out: outName,
        polishLabel: "after-api-from-brief"
      }, {
        writeScene,
        polishSceneFile,
        exportSceneAsset
      });
      response.json({
        ok: true,
        name: result.name,
        template: result.template,
        title: result.title,
        elementCount: result.elementCount,
        expressionPlan: result.expressionPlan,
        polished: result.polished,
        preview: result.preview,
        url: `/?scene=${encodeURIComponent(result.name)}`
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scenes/:name", async (request, response, next) => {
    try {
      response.json(await readScene(request.params.name));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/scenes/:name", async (request, response, next) => {
    try {
      const fileName = await writeScene(request.params.name, request.body);
      response.json({ ok: true, name: fileName });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/rename", async (request, response, next) => {
    try {
      const fromName = normalizeSceneName(request.params.name);
      const toName = normalizeSceneName(request.body?.to || request.body?.name);
      const scene = request.body?.scene;
      if (!scene || scene.type !== "excalidraw" || !Array.isArray(scene.elements)) {
        throw new Error("Rename payload must include the current Excalidraw scene.");
      }
      try {
        await fs.access(scenePath(toName));
        const error = new Error(`Scene ${toName} already exists.`);
        error.code = "EEXIST";
        throw error;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await writeScene(fromName, scene);
      response.json({ ok: true, ...(await renameScene(fromName, toName)) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/scenes/:name", async (request, response, next) => {
    try {
      clearActiveCanvas(request.params.name);
      response.json({ ok: true, ...(await deleteScene(request.params.name)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scenes/:name/read", async (request, response, next) => {
    try {
      const fileName = normalizeSceneName(request.params.name);
      response.json(summarizeScene(await readScene(fileName), { name: fileName }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scenes/:name/snapshots", async (request, response, next) => {
    try {
      response.json(await listSnapshots(request.params.name));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/snapshots", async (request, response, next) => {
    try {
      response.json({ ok: true, snapshot: await createSnapshot(request.params.name, request.body || {}) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/restore", async (request, response, next) => {
    try {
      response.json({ ok: true, restore: await restoreSnapshot(request.params.name, request.body?.snapshot || "latest") });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scenes/:name/diff", async (request, response, next) => {
    try {
      response.json(await diffSceneFromSnapshot(request.params.name, request.query.from || "latest"));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scenes/:name/inspect", async (request, response, next) => {
    try {
      response.json(await inspectSceneFile(request.params.name, { from: request.query.from || "latest" }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/patch", async (request, response, next) => {
    try {
      const result = await patchSceneFile(request.params.name, request.body?.plan || request.body, {
        dryRun: Boolean(request.query.dryRun || request.body?.dryRun),
        label: request.body?.label || "before-api-patch",
        snapshot: request.body?.snapshot !== false
      });
      if (!result.dryRun && request.body?.refreshPreview === true) {
        result.preview = await exportSceneAsset(request.params.name, {
          baseUrl: baseUrlFromRequest(request),
          format: "png"
        });
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/layout", async (request, response, next) => {
    try {
      const result = await layoutSceneFile(request.params.name, request.body || {}, {
        dryRun: Boolean(request.query.dryRun || request.body?.dryRun),
        label: request.body?.label || "before-api-layout",
        snapshot: request.body?.snapshot !== false
      });
      if (!result.dryRun && request.body?.refreshPreview === true) {
        result.preview = await exportSceneAsset(request.params.name, {
          baseUrl: baseUrlFromRequest(request),
          format: "png"
        });
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/polish", async (request, response, next) => {
    try {
      const result = await polishSceneFile(request.params.name, request.body || {}, {
        dryRun: Boolean(request.query.dryRun || request.body?.dryRun),
        label: request.body?.label || "before-api-polish",
        snapshot: request.body?.snapshot !== false
      });
      if (!result.dryRun && request.body?.refreshPreview === true) {
        result.preview = await exportSceneAsset(request.params.name, {
          baseUrl: baseUrlFromRequest(request),
          format: "png"
        });
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scenes/:name/qa", async (request, response, next) => {
    try {
      const fileName = normalizeSceneName(request.params.name);
      response.json(qaScene(await readScene(fileName), { name: fileName }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/export", async (request, response, next) => {
    try {
      response.json({
        ok: true,
        export: await exportSceneAsset(request.params.name, {
          baseUrl: baseUrlFromRequest(request),
          format: request.query.format || request.body?.format || "png"
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scenes/:name/share", async (request, response, next) => {
    try {
      response.json({
        ok: true,
        scene: normalizeSceneName(request.params.name),
        share: await exportSceneToExcalidrawUrl(await readScene(request.params.name), {
          dryRun: Boolean(request.query.dryRun || request.body?.dryRun),
          endpoint: request.body?.endpoint,
          includeFiles: request.body?.includeFiles !== false,
          includeDeleted: Boolean(request.body?.includeDeleted),
          includeCustomData: Boolean(request.body?.includeCustomData)
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    const status = error?.code === "ENOENT" ? 404 : error?.code === "EEXIST" ? 409 : 500;
    response.status(status).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function checkExistingServer(host, port) {
  const url = `http://${host}:${port}/`;
  try {
    const response = await fetch(`${url}api/health`);
    if (!response.ok) return null;
    const health = await response.json();
    if (!isCompatibleHealth(health)) return null;
    return {
      host,
      port,
      url,
      reused: true,
      health,
      close: async () => undefined
    };
  } catch {
    return null;
  }
}

export async function startServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const preferredPort = Number(options.port || 3000);
  const fallbackPort = options.fallbackPort === false ? null : Number(options.fallbackPort || 3001);
  const reuseExisting = Boolean(options.reuseExisting);
  const mode = options.mode || process.env.NODE_ENV || "development";
  const app = express();

  await ensureArtifactsDir();
  configureApi(app);
  app.use("/artifacts/excalidraw", express.static(artifactsDir));
  app.use("/libraries", express.static(librariesDir));

  if (mode === "production") {
    const distDir = path.join(projectRoot, "dist");
    app.use(express.static(distDir));
    app.get("*", (request, response) => {
      const html = request.path === "/export.html" ? "export.html" : "index.html";
      response.sendFile(path.join(distDir, html));
    });
  } else {
    const vite = await createViteServer({
      root: projectRoot,
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  const server = createHttpServer(app);
  let selectedPort = preferredPort;
  try {
    await listen(server, host, selectedPort);
  } catch (error) {
    if (error?.code === "EADDRINUSE" && reuseExisting) {
      const existing = await checkExistingServer(host, preferredPort);
      if (existing) return existing;
      if (fallbackPort === null) {
        throw new Error(
          `Port ${preferredPort} is occupied, but it is not a compatible ${SERVER_NAME} server with live canvas capabilities. Stop the old process or choose an explicit temporary port.`
        );
      }
    }
    if (error?.code !== "EADDRINUSE" || fallbackPort === null || preferredPort === fallbackPort) {
      throw error;
    }
    selectedPort = fallbackPort;
    await listen(server, host, selectedPort);
  }

  return {
    host,
    port: selectedPort,
    url: `http://${host}:${selectedPort}/`,
    server,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

export {
  createSnapshot,
  deleteScene,
  diffSceneFromSnapshot,
  diffScenes,
  exportSceneToExcalidrawUrl,
  exportSceneAsset,
  generateSceneFromBrief,
  healthPayload,
  isCompatibleHealth,
  missingServerCapabilities,
  inspectSceneFile,
  listScenes,
  listBriefTemplates,
  listSnapshots,
  normalizeSceneName,
  patchSceneFile,
  polishSceneFile,
  qaScene,
  readScene,
  resolveSnapshotPath,
  restoreSnapshot,
  layoutSceneFile,
  summarizeScene,
  writeScene
};
