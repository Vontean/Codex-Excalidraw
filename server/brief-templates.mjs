const SCENE_SOURCE = "https://codex.local/excalidraw-codex";

const PALETTES = {
  architecture: {
    canvas: "#ffffff",
    title: "#111827",
    sectionStroke: "#cbd5e1",
    sectionFill: "#f8fafc",
    client: "#dbeafe",
    edge: "#ede9fe",
    app: "#dcfce7",
    async: "#fef3c7",
    data: "#e0f2fe",
    ops: "#f1f5f9",
    risk: "#fee2e2",
    ink: "#1e1e1e"
  },
  product: {
    canvas: "#ffffff",
    title: "#111827",
    sectionStroke: "#d6d3d1",
    sectionFill: "#fafaf9",
    primary: "#e0f2fe",
    secondary: "#fef3c7",
    accent: "#dcfce7",
    question: "#fce7f3",
    ink: "#1e1e1e"
  },
  wireframe: {
    canvas: "#ffffff",
    title: "#111827",
    sectionStroke: "#d4d4d4",
    sectionFill: "#fafafa",
    block: "#f5f5f5",
    muted: "#e5e5e5",
    accent: "#e0f2fe",
    ink: "#1e1e1e"
  },
  plan: {
    canvas: "#ffffff",
    title: "#111827",
    sectionStroke: "#d1d5db",
    sectionFill: "#f9fafb",
    build: "#dcfce7",
    decision: "#dbeafe",
    risk: "#fee2e2",
    verify: "#ede9fe",
    ink: "#1e1e1e"
  }
};

const TEMPLATE_REGISTRY = [
  {
    id: "architecture",
    name: "Layered System Architecture",
    keywords: ["architecture", "system", "service", "api", "database", "worker", "queue", "架构", "系统", "服务", "数据库", "队列"]
  },
  {
    id: "product-board",
    name: "Product Concept Board",
    keywords: ["product", "idea", "concept", "用户", "产品", "构想", "发散", "需求"]
  },
  {
    id: "page-flow",
    name: "Page Flow / Navigation Map",
    keywords: ["page", "flow", "navigation", "route", "screen", "页面", "跳转", "导航", "路由", "流程"]
  },
  {
    id: "wireframe",
    name: "Low-Fidelity Wireframe Set",
    keywords: ["wireframe", "prototype", "layout", "ui", "低保真", "原型", "布局", "界面"]
  },
  {
    id: "implementation-plan",
    name: "Implementation Plan Map",
    keywords: ["implementation", "milestone", "plan", "risk", "verify", "开发", "实施", "计划", "风险", "验收"]
  }
];

function slug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "item";
}

function compactText(value, max = 48) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function splitBriefLines(brief) {
  return String(brief || "")
    .split(/\n|。|；|;/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function chooseTemplate(brief, requested) {
  if (requested && requested !== "auto") {
    const matched = TEMPLATE_REGISTRY.find((template) => template.id === requested);
    if (matched) return matched.id;
  }

  const lower = String(brief || "").toLowerCase();
  let best = { id: "architecture", score: 0 };
  for (const template of TEMPLATE_REGISTRY) {
    const score = template.keywords.reduce((count, keyword) => count + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) {
      best = { id: template.id, score };
    }
  }
  return best.id;
}

function element(base) {
  return {
    id: base.id,
    type: base.type || "rectangle",
    groupIds: base.groupIds || [],
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
    strokeWidth: base.strokeWidth ?? 2,
    strokeColor: base.strokeColor || "#1e1e1e",
    backgroundColor: base.backgroundColor || "transparent",
    fillStyle: base.fillStyle || "solid",
    roughness: base.roughness ?? 1,
    label: base.label || base.text
      ? {
          text: compactText(base.label || base.text, base.maxLabelLength || 72),
          fontSize: base.fontSize || 22,
          groupIds: []
        }
      : undefined,
    customData: {
      codexRole: base.role,
      codexTemplate: base.template,
      codexKind: base.kind
    }
  };
}

function section({ id, title, x, y, width, height, palette, template }) {
  return [
    element({
      id,
      role: "section",
      template,
      x,
      y,
      width,
      height,
      text: title,
      fontSize: 24,
      backgroundColor: palette.sectionFill,
      strokeColor: palette.sectionStroke
    })
  ];
}

function card({ id, text, x, y, width = 220, height = 74, fill, palette, role = "card", template }) {
  return element({
    id,
    role,
    template,
    x,
    y,
    width,
    height,
    text,
    fontSize: 21,
    backgroundColor: fill,
    strokeColor: palette.ink
  });
}

function sticky({ id, text, x, y, fill, palette, template }) {
  return element({
    id,
    role: "sticky",
    template,
    x,
    y,
    width: 210,
    height: 92,
    text,
    fontSize: 20,
    backgroundColor: fill,
    strokeColor: palette.ink
  });
}

function badge({ id, text, x, y, fill, palette, template }) {
  return element({
    id,
    role: "badge",
    template,
    x,
    y,
    width: 150,
    height: 42,
    text,
    fontSize: 18,
    backgroundColor: fill,
    strokeColor: palette.ink
  });
}

function pageCard({ id, title, x, y, width = 250, height = 170, fill, palette, template }) {
  const groupId = `group-${id}`;
  return [
    element({
      id,
      role: "page-card",
      template,
      groupIds: [groupId],
      x,
      y,
      width,
      height,
      text: title,
      fontSize: 21,
      backgroundColor: fill,
      strokeColor: palette.ink
    }),
    element({
      id: `${id}-nav`,
      role: "wireframe-detail",
      template,
      groupIds: [groupId],
      x: x + 18,
      y: y + 48,
      width: width - 36,
      height: 22,
      backgroundColor: PALETTES.wireframe.muted,
      strokeColor: "#737373"
    }),
    element({
      id: `${id}-body`,
      role: "wireframe-detail",
      template,
      groupIds: [groupId],
      x: x + 18,
      y: y + 84,
      width: width - 36,
      height: height - 106,
      backgroundColor: "#ffffff",
      strokeColor: "#a3a3a3"
    })
  ];
}

function arrow({ id, from, to, x, y, width, height, template, label }) {
  return {
    id,
    type: "arrow",
    groupIds: [],
    x,
    y,
    width,
    height,
    strokeWidth: 2,
    strokeColor: "#1e1e1e",
    points: [
      [0, 0],
      [Math.round(width / 2), Math.round(height / 2)],
      [width, height]
    ],
    roundness: { type: 2 },
    start: { id: from },
    end: { id: to },
    label: label
      ? {
          text: compactText(label, 32),
          fontSize: 16,
          groupIds: []
        }
      : undefined,
    customData: {
      codexRole: "connector",
      codexTemplate: template
    }
  };
}

function titleBlock(title, subtitle, palette, template) {
  return [
    element({
      id: "title",
      role: "title",
      template,
      x: 40,
      y: 28,
      width: 560,
      height: 48,
      text: title,
      fontSize: 30,
      strokeColor: "#ffffff",
      backgroundColor: "transparent"
    }),
    element({
      id: "subtitle",
      role: "subtitle",
      template,
      x: 44,
      y: 78,
      width: 760,
      height: 38,
      text: subtitle,
      fontSize: 18,
      strokeColor: "#ffffff",
      backgroundColor: "transparent"
    })
  ];
}

function sectionItems(lines, defaults) {
  const items = lines.length ? lines : defaults;
  return items.slice(0, Math.max(3, defaults.length));
}

function architectureTemplate(parsed) {
  const palette = PALETTES.architecture;
  const template = "architecture";
  const defaults = ["User / Client", "API Gateway", "Core Service", "Worker", "Database", "Observability"];
  const items = sectionItems(parsed.lines, defaults);
  const sections = [
    ["Client / External", palette.client],
    ["Edge / Gateway", palette.edge],
    ["Application Services", palette.app],
    ["Async / Workers", palette.async],
    ["Data / Storage", palette.data],
    ["Ops / Observability", palette.ops]
  ];
  const elements = titleBlock(parsed.title, "Layered system map with explicit boundaries and flow.", palette, template);
  const cards = [];
  sections.forEach(([label, fill], index) => {
    const x = 40 + index * 250;
    elements.push(...section({ id: `section-${slug(label)}`, title: label, x, y: 140, width: 225, height: 270, palette, template }));
    const cardId = `node-${index + 1}-${slug(items[index] || label)}`;
    const node = card({ id: cardId, text: items[index] || label, x: x + 18, y: 230, width: 188, height: 78, fill, palette, template, role: "service-card" });
    elements.push(node);
    cards.push(node);
  });
  for (let index = 0; index < cards.length - 1; index += 1) {
    elements.push(arrow({
      id: `flow-${index + 1}`,
      from: cards[index].id,
      to: cards[index + 1].id,
      x: cards[index].x + cards[index].width,
      y: cards[index].y + cards[index].height / 2,
      width: cards[index + 1].x - (cards[index].x + cards[index].width),
      height: 0,
      template
    }));
  }
  elements.push(badge({ id: "risk-badge", text: "Risks / Unknowns", x: 40, y: 450, fill: palette.risk, palette, template }));
  return elements;
}

function productBoardTemplate(parsed) {
  const palette = PALETTES.product;
  const template = "product-board";
  const defaults = ["User problem", "Core jobs", "Product modules", "Differentiators", "Open questions", "Next experiments"];
  const items = sectionItems(parsed.lines, defaults);
  const sections = [
    ["Problem", palette.primary],
    ["Users / Jobs", palette.secondary],
    ["Solution Modules", palette.accent],
    ["Open Questions", palette.question]
  ];
  const elements = titleBlock(parsed.title, "Concept board for product exploration and narrowing.", palette, template);
  sections.forEach(([label], index) => {
    const x = 40 + (index % 2) * 490;
    const y = 145 + Math.floor(index / 2) * 250;
    elements.push(...section({ id: `section-${slug(label)}`, title: label, x, y, width: 450, height: 210, palette, template }));
    elements.push(sticky({ id: `sticky-${index * 2 + 1}`, text: items[index * 2] || label, x: x + 24, y: y + 74, fill: sections[index][1], palette, template }));
    elements.push(sticky({ id: `sticky-${index * 2 + 2}`, text: items[index * 2 + 1] || "Refine with user edits", x: x + 232, y: y + 74, fill: "#ffffff", palette, template }));
  });
  return elements;
}

function pageFlowTemplate(parsed) {
  const palette = PALETTES.wireframe;
  const template = "page-flow";
  const defaults = ["Entry", "Dashboard", "Detail", "Settings", "Success", "Error / Empty"];
  const items = sectionItems(parsed.lines, defaults);
  const elements = titleBlock(parsed.title, "Navigation map with page cards and labeled transitions.", palette, template);
  const positions = [
    [40, 160],
    [360, 160],
    [680, 160],
    [360, 420],
    [680, 420],
    [1000, 420]
  ];
  const pages = items.slice(0, 6).map((item, index) => {
    const [x, y] = positions[index];
    const id = `page-${index + 1}-${slug(item)}`;
    elements.push(...pageCard({ id, title: item, x, y, fill: index === 0 ? palette.accent : "#ffffff", palette, template }));
    return { id, x, y, width: 250, height: 170 };
  });
  const flows = [
    [0, 1, "open"],
    [1, 2, "select"],
    [1, 3, "configure"],
    [2, 4, "complete"],
    [3, 5, "fallback"]
  ];
  for (const [fromIndex, toIndex, label] of flows) {
    const from = pages[fromIndex];
    const to = pages[toIndex];
    if (!from || !to) continue;
    elements.push(arrow({
      id: `route-${fromIndex + 1}-${toIndex + 1}`,
      from: from.id,
      to: to.id,
      x: from.x + from.width,
      y: from.y + from.height / 2,
      width: to.x - (from.x + from.width),
      height: to.y + to.height / 2 - (from.y + from.height / 2),
      label,
      template
    }));
  }
  return elements;
}

function wireframeTemplate(parsed) {
  const palette = PALETTES.wireframe;
  const template = "wireframe";
  const elements = titleBlock(parsed.title, "Low-fidelity product layout with reusable page blocks.", palette, template);
  elements.push(...section({ id: "section-desktop", title: "Desktop", x: 40, y: 140, width: 620, height: 430, palette, template }));
  elements.push(...section({ id: "section-mobile", title: "Mobile", x: 710, y: 140, width: 320, height: 430, palette, template }));
  elements.push(...pageCard({ id: "desktop-shell", title: parsed.lines[0] || "Primary screen", x: 78, y: 220, width: 540, height: 300, fill: "#ffffff", palette, template }));
  elements.push(element({ id: "desktop-sidebar", role: "wireframe-block", template, x: 108, y: 320, width: 112, height: 160, backgroundColor: palette.block, strokeColor: "#737373" }));
  elements.push(element({ id: "desktop-content", role: "wireframe-block", template, x: 246, y: 320, width: 330, height: 160, backgroundColor: palette.accent, strokeColor: "#737373" }));
  elements.push(...pageCard({ id: "mobile-shell", title: parsed.lines[1] || "Mobile variant", x: 778, y: 220, width: 185, height: 300, fill: "#ffffff", palette, template }));
  elements.push(sticky({ id: "wireframe-note", text: parsed.lines[2] || "Keep layout editable and low fidelity", x: 1070, y: 222, fill: "#fef3c7", palette, template }));
  return elements;
}

function implementationPlanTemplate(parsed) {
  const palette = PALETTES.plan;
  const template = "implementation-plan";
  const defaults = ["Scope", "Architecture", "Build", "Integrate", "Verify", "Ship"];
  const items = sectionItems(parsed.lines, defaults).slice(0, 6);
  const elements = titleBlock(parsed.title, "Execution map with milestones, risks, and verification.", palette, template);
  const cards = items.map((item, index) => {
    const fill = index < 2 ? palette.decision : index < 4 ? palette.build : palette.verify;
    const node = card({
      id: `milestone-${index + 1}-${slug(item)}`,
      text: item,
      x: 50 + index * 230,
      y: 210,
      width: 190,
      height: 80,
      fill,
      palette,
      role: "milestone",
      template
    });
    elements.push(node);
    return node;
  });
  for (let index = 0; index < cards.length - 1; index += 1) {
    elements.push(arrow({
      id: `milestone-flow-${index + 1}`,
      from: cards[index].id,
      to: cards[index + 1].id,
      x: cards[index].x + cards[index].width,
      y: cards[index].y + cards[index].height / 2,
      width: cards[index + 1].x - (cards[index].x + cards[index].width),
      height: 0,
      template
    }));
  }
  elements.push(...section({ id: "section-risks", title: "Risks", x: 50, y: 370, width: 610, height: 180, palette, template }));
  elements.push(sticky({ id: "risk-1", text: parsed.lines[6] || "Unknown dependency", x: 80, y: 440, fill: palette.risk, palette, template }));
  elements.push(sticky({ id: "risk-2", text: parsed.lines[7] || "Verification gap", x: 300, y: 440, fill: "#ffffff", palette, template }));
  elements.push(...section({ id: "section-verification", title: "Verification", x: 720, y: 370, width: 610, height: 180, palette, template }));
  elements.push(sticky({ id: "verify-1", text: "Build passes", x: 750, y: 440, fill: palette.verify, palette, template }));
  elements.push(sticky({ id: "verify-2", text: "Browser check", x: 970, y: 440, fill: "#ffffff", palette, template }));
  return elements;
}

function parseBrief(input = {}) {
  const brief = typeof input === "string" ? input : input.brief || input.prompt || "";
  const allLines = splitBriefLines(brief);
  const title = compactText((typeof input === "object" && input.title) || allLines[0] || "Codex diagram", 56);
  const lines = allLines[0] && compactText(allLines[0], 56) === title ? allLines.slice(1) : allLines;
  return {
    brief,
    title,
    lines,
    requestedTemplate: typeof input === "object" ? input.template : undefined
  };
}

export function listBriefTemplates() {
  return TEMPLATE_REGISTRY.map(({ id, name, keywords }) => ({ id, name, keywords }));
}

export function generateSceneFromBrief(input = {}) {
  const parsed = parseBrief(input);
  const template = chooseTemplate(parsed.brief, parsed.requestedTemplate);
  const builders = {
    architecture: architectureTemplate,
    "product-board": productBoardTemplate,
    "page-flow": pageFlowTemplate,
    wireframe: wireframeTemplate,
    "implementation-plan": implementationPlanTemplate
  };
  const elements = builders[template](parsed);
  return {
    scene: {
      type: "excalidraw",
      version: 2,
      source: SCENE_SOURCE,
      elements,
      appState: {
        viewBackgroundColor: "#ffffff",
        currentItemFontFamily: 1,
        codex: {
          generator: "from-brief",
          template,
          elementsKind: "skeleton",
          brief: parsed.brief
        }
      },
      files: {}
    },
    template,
    title: parsed.title,
    elementCount: elements.length
  };
}
