const GUIDES = {
  workflow: {
    title: "Intent-first live canvas workflow",
    useWhen: "Before creating or substantially editing a shared Excalidraw canvas.",
    principles: [
      "Read current canvas context first. Treat the canvas as shared live state, not a final output file.",
      "Interpret the user's intent before choosing shapes: what should the diagram explain, compare, decide, prototype, teach, or explore?",
      "Choose a visual model and drawing rhythm from that intent, then choose the canvas operation.",
      "Use open_or_create_canvas, get_canvas_context, create_view, apply_canvas_patch, review_canvas, snapshot/restore, and export_canvas as the public workflow.",
      "Use open_or_create_canvas with waitForSubscriberMs as the first lightweight workbench handshake. If readiness.browserReady is true for the target scene, skip browser navigation and heavy doctor checks.",
      "When using the browser, open_or_create_canvas must create or load the scene before navigating the In-App Browser to its URL.",
      "Before the first user-visible write, use open_or_create_canvas with waitForSubscriberMs after navigation and wait for readiness.browserReady when participation matters.",
      "Run doctor only for missing tools, unreachable or incompatible server state, export failures, or live writes that do not appear in the workbench.",
      "Use create_view for expressive first passes or complete views. Use apply_canvas_patch for meaningful follow-up changes after reading context.",
      "Keep cameraUpdate, delete, and restoreCheckpoint pseudo-elements inside create_view. Do not send them through apply_canvas_patch add operations.",
      "Canvas writing tools should keep stage updates live-only by default. Refresh the gallery preview only when explicitly requested or by calling export_canvas for the final artifact.",
      "For simple diagrams, one well-shaped pass is fine. For complex participatory diagrams, push browser-visible checkpoints when a meaningful stage is complete.",
      "Use reveal only when the user benefits from watching progress. Reveal is staged HTTP workbench update, not true token streaming.",
      "Review after a meaningful user-facing pass, then continue from live edits or finalize."
    ],
    antiPatterns: [
      "Forcing every request into sections, lanes, modules, or box-and-arrow structure.",
      "Generating a dense whole scene blindly and hoping QA fixes it.",
      "Making one MCP call per primitive for normal drawing work.",
      "Shrinking text to compensate for poor composition.",
      "Treating every QA warning as a reason to rigidly re-layout the canvas."
    ]
  },
  "visual-strategy": {
    title: "Intent-first visual strategy",
    useWhen: "When deciding what kind of diagram to draw.",
    principles: [
      "If the user asks about sequence or procedure, consider a flow, timeline, recipe, or storyboard.",
      "If the user asks about choices, tradeoffs, or branching, consider a decision tree, option map, or tension field.",
      "If the user asks about system structure, consider an architecture map, layered system, topology, or dependency map.",
      "If the user asks about relationships or concepts, consider a concept map, constellation, matrix, or annotated landscape.",
      "If the user asks about proof, research, or reasoning, consider an evidence board, claim/support map, or comparison spread.",
      "If the user asks about product behavior, consider UI sketches, screen flow, state map, or journey storyboard.",
      "If no standard form fits, make a freeform whiteboard explanation with the fewest strong visual decisions that carry the idea."
    ],
    antiPatterns: [
      "Choosing rectangles before choosing the visual model.",
      "Using the same card grid for architecture, product journey, proof, and brainstorming tasks.",
      "Adding modules or containers just because the tool can draw them.",
      "Letting a template override the user's actual question."
    ]
  },
  "live-collaboration": {
    title: "Live-first collaboration",
    useWhen: "When the user wants to watch, steer, co-edit, explore, teach, or correct the drawing early.",
    principles: [
      "Open or create the workbench canvas early and return the browser URL when the user will participate.",
      "If the user already has the matching workbench scene open, confirm browserReady through open_or_create_canvas instead of initializing browser automation, navigating, or reloading.",
      "Show progress at reviewable stages where feedback is useful. The cadence comes from task complexity and the chosen visual strategy, not from a fixed skeleton/region/lane recipe.",
      "For complex multi-stage drawings, push each completed stage as a visible canvas result before continuing: rough structure, major groups, relationships, annotations, and final polish are typical stage boundaries.",
      "Do not pause after every primitive or add artificial delays by default. A small flowchart can finish in one pass; a complex architecture, product journey, or UI map should appear in visible increments before the final answer.",
      "Read the live canvas before every substantial continuation; user edits are source-of-truth signals.",
      "Snapshot before risky redraws, imports, restores, or exploratory branches.",
      "Use baseRevision-aware writes when available so stale agent edits do not overwrite newer browser edits.",
      "If a live conflict appears, read current context again and continue from the latest canvas instead of forcing the previous patch.",
      "Use review_canvas at most once near the end for most medium diagrams; it creates a temporary review image, not the gallery preview.",
      "Export only when the user or task says the artifact is ready."
    ],
    antiPatterns: [
      "Treating the browser as a final reveal surface only.",
      "Continuing from an old file after the user edited the live canvas.",
      "Claiming true streaming when the implementation is staged HTTP reveal.",
      "Overwriting user changes to preserve an earlier generated plan."
    ]
  },
  layout: {
    title: "Readable Excalidraw composition",
    useWhen: "When placing text, connectors, zones, frames, or freeform marks after choosing the visual model.",
    principles: [
      "Use generous whitespace before adding detail. If content feels crowded, increase spacing or split the idea.",
      "Match element size to copy length. Long connector labels need longer routes or external annotations.",
      "Align by reading path and narrative emphasis, not by mathematical symmetry alone.",
      "Use containers only when conceptual boundaries are part of the explanation.",
      "Prefer a few strong visual groupings over many same-sized boxes.",
      "Do not put centered labels on large background zones; use a standalone heading near the top-left of the zone.",
      "Route cross-area connectors around the perimeter or through clear paths. Avoid long diagonals through unrelated content.",
      "When using arrow labels, keep them short; otherwise move the explanation into a nearby annotation."
    ],
    defaults: {
      titleFontSize: "36-48",
      areaTitleFontSize: "24-32",
      primaryLabelFontSize: "18-24",
      annotationFontSize: "15-18",
      comfortableGap: 80,
      broadGroupGap: 120,
      connectorLabelClearance: "label width + at least 48px"
    },
    antiPatterns: [
      "Fixed-width arrows with variable-length labels.",
      "Containers touching their children.",
      "Multiple unrelated reading paths crossing the same center line.",
      "Large prose paragraphs inside nodes.",
      "Background zones with labels centered over child content.",
      "Connectors that cut through unrelated cards, screens, or annotations."
    ]
  },
  "visual-language": {
    title: "Shape and component language",
    useWhen: "When choosing visual vocabulary after the strategy is clear.",
    principles: [
      "Use rectangles/cards for stable entities only when entity comparison or containment is the right model.",
      "Use sticky notes for exploratory ideas, frames for screens, marks for emphasis, and annotations for explanation.",
      "Use arrows for causality, sequence, or dependency. Use simple lines for grouping or annotation only.",
      "Use color to separate meaning families, not as decoration. Keep contrast readable.",
      "Use installed libraries only when a reusable component communicates faster than primitives.",
      "Use cameraUpdate/checkpoint-style drawing to frame what the user should inspect.",
      "Prefer bound connectors for structural relationships; mark annotation lines as annotation/guide roles when intentionally unbound.",
      "Use the configured default canvas background unless the user explicitly asks for another background."
    ],
    libraryHints: [
      "Basic UX/wireframing elements for product screens and UI primitives.",
      "Decision flow controls for branches, gates, and yes/no logic.",
      "Business model templates for strategy boards.",
      "Data visualization components for metric stories.",
      "Small icons or emojis only when they clarify state, sentiment, or category."
    ],
    antiPatterns: [
      "Using all available libraries in one scene.",
      "Using color without semantic consistency.",
      "Adding illustration when the user needs structure.",
      "Filling every connector label slot just because it exists."
    ]
  },
  text: {
    title: "Canvas copywriting",
    useWhen: "When writing labels, headings, UI copy, or annotations.",
    principles: [
      "Follow the user's current language for canvas text.",
      "Use short labels for elements and reserve explanation for nearby annotations.",
      "Keep headings concrete: name the thing, decision, state, or area.",
      "Preserve product names, API names, filenames, and code identifiers unless asked to translate.",
      "Use the configured default font; Nunito is the default for mixed Chinese/English diagrams.",
      "Estimate text width before choosing element width. If a label is long, widen the element or split the idea.",
      "Do not paste the user brief into the canvas. Rewrite it into labels, groups, and annotations."
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
      "Check visual strategy: does the form fit the intent, or did it collapse into default boxes?",
      "Check hierarchy: title, primary path, secondary context, annotations.",
      "Check readability: text fit, route clearance, overlaps, and reading direction.",
      "Check editability: grouped units, visible text elements, meaningful ids or roles where useful.",
      "Inspect the screenshot for visual quality and the context for structure; neither replaces the other.",
      "If the screenshot shows truncation, overlap, or confusing crossings, make a targeted fix before adding more.",
      "If the first pass is good, stop instead of over-polishing."
    ],
    antiPatterns: [
      "Rebuilding the whole canvas when a small patch would preserve user intent.",
      "Calling the canvas done after JSON validation but before visual review.",
      "Letting layout helpers flatten an expressive composition.",
      "Changing the visual model without first checking whether the user edited the live canvas."
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
