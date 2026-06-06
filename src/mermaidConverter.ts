import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";

declare global {
  interface Window {
    __convertMermaidToExcalidraw__?: (
      definition: string,
      fontSize: number
    ) => Promise<{
      elements: unknown[];
      files?: Record<string, unknown>;
    }>;
  }
}

window.__convertMermaidToExcalidraw__ = async (definition: string, fontSize: number) => {
  const result = await parseMermaidToExcalidraw(definition, {
    themeVariables: {
      fontSize: `${fontSize}px`
    }
  });

  return {
    elements: result.elements as unknown[],
    files: (result.files ?? {}) as Record<string, unknown>
  };
};

document.getElementById("mermaid-root")!.textContent = "Converter ready.";
