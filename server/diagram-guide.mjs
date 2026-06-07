const GUIDES = {
  workflow: {
    title: "Canvas-aware drawing workflow",
    useWhen: "Before creating or substantially editing a diagram.",
    principles: [
      "Read the current canvas context before editing. Treat the canvas as shared state, not an output file.",
      "Plan the visual metaphor in natural language, then draw through create_view, batch_create_elements, or semantic patches depending on the needed control.",
      "For expressive first passes, create_view with compact elements and cameraUpdate/checkpoint is often closer to direct canvas drawing than template generation.",
      "Keep create_view reveal/progressive mode off by default for speed. Turn it on only when the user benefits from watching the drawing evolve, such as demos, teaching, complex walkthroughs, or step-by-step explanations.",
      "After each meaningful region, inspect context or screenshot before continuing.",
      "Use deterministic layout helpers as assistants only after the visual idea is clear.",
      "Keep one user-facing workflow: create, read, patch, review, export."
    ],
    antiPatterns: [
      "Generating a whole dense scene blindly and hoping QA fixes it.",
      "Making one MCP call per primitive for normal drawing work.",
      "Shrinking text to compensate for poor composition.",
      "Treating every QA warning as a reason to rigidly re-layout the canvas."
    ]
  },
  layout: {
    title: "Readable Excalidraw layout",
    useWhen: "When placing sections, nodes, callouts, flows, or low-fidelity screens.",
    principles: [
      "Use generous whitespace before adding detail. If content feels crowded, increase spacing or split the section.",
      "Match element size to copy length. Long connector labels need longer routes or external annotations.",
      "Align by reading path, not by mathematical symmetry alone.",
      "Use containers for conceptual boundaries and groups for movable units.",
      "Prefer 2-4 strong regions over many same-sized boxes.",
      "Do not put centered labels on large background zones; use a standalone heading near the top-left of the zone so it does not overlap child elements.",
      "Route cross-zone arrows around the perimeter or through clear lanes. Avoid long diagonals through unrelated nodes.",
      "When using arrow labels, keep them short and provide enough route length; otherwise move the explanation into a nearby annotation."
    ],
    defaults: {
      titleFontSize: "36-48",
      sectionTitleFontSize: "24-32",
      nodeLabelFontSize: "18-24",
      annotationFontSize: "15-18",
      minimumNodeGap: 80,
      comfortableSectionGap: 120,
      connectorLabelClearance: "label width + at least 48px"
    },
    antiPatterns: [
      "Fixed-width arrows with variable-length labels.",
      "Containers touching their children.",
      "Multiple unrelated reading paths crossing the same center line.",
      "Large prose paragraphs inside nodes.",
      "Background zone rectangles with bound labels centered over their child content.",
      "Cross-zone arrows that cut through unrelated cards or screens."
    ]
  },
  "visual-language": {
    title: "Shape and component language",
    useWhen: "When choosing how to express the user's idea visually.",
    principles: [
      "Use rectangles/cards for stable concepts, sticky notes for exploratory ideas, frames for screens, and sections for boundaries.",
      "Use arrows for causality, sequence, or dependency. Use simple lines for grouping or annotation only.",
      "Use color to separate meaning families, not as decoration. Keep contrast readable.",
      "Use installed libraries when a reusable component communicates faster than primitive shapes.",
      "Prefer recognisable UI frames for product workflows and low-fidelity prototypes.",
      "Use cameraUpdate/checkpoint-style drawing to frame what the user should inspect; use reveal mode sparingly when the process itself is part of the value.",
      "Prefer bound connectors for structural relationships, but mark annotation lines as annotation/guide roles when they are intentionally unbound."
    ],
    libraryHints: [
      "Basic UX/wireframing elements: product screens and UI primitives.",
      "Decision flow control: branches, decisions, yes/no logic, gating.",
      "Business Model Templates: strategy and business model boards.",
      "Data Viz: chart-like summaries and metric stories.",
      "Emojis: lightweight sentiment, user state, or playful accent."
    ],
    antiPatterns: [
      "Using all available libraries in one scene.",
      "Using color without semantic consistency.",
      "Adding illustration when the user needs structure.",
      "Using every connector label slot just because the data model allows it."
    ]
  },
  text: {
    title: "Canvas copywriting",
    useWhen: "When writing labels, section headings, UI copy, or annotations.",
    principles: [
      "Follow the user's current language for canvas text.",
      "Use short labels for elements and reserve explanation for nearby annotations.",
      "Keep headings concrete: name the thing or decision, not the act of describing it.",
      "Preserve product names, API names, filenames, and code identifiers unless asked to translate.",
      "Use the configured default font; Nunito is the default for mixed Chinese/English diagrams.",
      "Estimate text width before choosing box width. If a label is long, widen the element or split the idea instead of shrinking the font.",
      "Do not paste the user brief into the canvas. Rewrite it into labels, sections, and annotations."
    ],
    antiPatterns: [
      "Pasting the user's entire brief as a title.",
      "Mixing Chinese with Virgil when Chinese readability matters.",
      "Using long sentence labels on narrow arrows."
    ]
  },
  review: {
    title: "Canvas review checklist",
    useWhen: "After a meaningful drawing pass or before export.",
    principles: [
      "Check whether the diagram answers the user's actual question before fixing aesthetics.",
      "Check hierarchy: title, regions, primary nodes, annotations.",
      "Check readability: text fit, route clearance, overlaps, and reading direction.",
      "Check editability: grouped units, visible text elements, meaningful ids or roles where useful.",
      "Use describe_scene for structure and get_canvas_screenshot for visual quality; they answer different questions.",
      "If the screenshot shows truncation, overlap, or arrow crossings, stop and make a targeted fix before adding more.",
      "If the first pass is good, make at most one targeted automatic repair unless the user asks for polish.",
      "Snapshot or checkpoint before risky changes so user edits can be restored."
    ],
    antiPatterns: [
      "Rebuilding the whole canvas when a small patch would preserve user intent.",
      "Calling the canvas done after JSON validation but before visual review.",
      "Letting layout helpers flatten an expressive composition."
    ]
  }
};

export function readDiagramGuide(input = {}) {
  const topic = String(input.topic || "workflow").trim().toLowerCase();
  if (topic === "all") {
    return {
      ok: true,
      topics: Object.keys(GUIDES),
      guides: GUIDES
    };
  }
  const guide = GUIDES[topic] || GUIDES.workflow;
  return {
    ok: true,
    topic: GUIDES[topic] ? topic : "workflow",
    topics: Object.keys(GUIDES),
    guide
  };
}
