import { chromium } from "playwright";
import { defaultFontFamily } from "./config.mjs";

const SCENE_SOURCE = "https://codex.local/excalidraw-codex";

function normalizeFontOnElement(element) {
  const next = { ...element };
  if (next.type === "text") {
    next.fontFamily = defaultFontFamily;
  }
  if (next.label && typeof next.label === "object") {
    next.label = {
      ...next.label,
      fontFamily: next.label.fontFamily || defaultFontFamily
    };
  }
  return next;
}

export function createSceneFromElements(elements = [], files = {}, options = {}) {
  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements: elements.map(normalizeFontOnElement),
    appState: {
      viewBackgroundColor: options.backgroundColor || "#ffffff",
      gridSize: null,
      currentItemFontFamily: defaultFontFamily,
      codex: {
        ...(options.codex || {}),
        defaultFontFamily
      }
    },
    files
  };
}

export async function convertMermaidToScene(definition, options = {}) {
  if (!String(definition || "").trim()) {
    throw new Error("Mermaid definition is empty.");
  }

  const baseUrl = options.baseUrl || "http://127.0.0.1:3000/";
  const fontSize = Number(options.fontSize || 24);
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.goto(`${baseUrl.replace(/\/$/, "")}/mermaid.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__convertMermaidToExcalidraw__), null, {
      timeout: 30000
    });
    const parsed = await page.evaluate(
      async ({ source, size }) => window.__convertMermaidToExcalidraw__(source, size),
      { source: definition, size: fontSize }
    );
    return createSceneFromElements(parsed.elements, parsed.files ?? {}, {
      backgroundColor: options.backgroundColor,
      codex: {
        generator: "from-mermaid",
        elementsKind: "skeleton",
        mermaidDefinition: definition,
        fontSize
      }
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
