const TEMPLATE_REGISTRY = [
  {
    id: "architecture",
    name: "Layered System Architecture",
    intent: "explain",
    organization: "layered system map",
    readingPath: "left-to-right",
    componentLanguage: ["sections", "service cards", "connectors", "risk badge"],
    keywords: ["architecture", "system", "service", "api", "database", "worker", "queue", "架构", "系统", "服务", "数据库", "队列"]
  },
  {
    id: "product-board",
    name: "Product Concept Board",
    intent: "explore",
    organization: "concept board",
    readingPath: "grouped board scan",
    componentLanguage: ["sections", "sticky notes", "question cards"],
    keywords: ["product", "idea", "concept", "用户", "产品", "构想", "发散", "需求"]
  },
  {
    id: "page-flow",
    name: "Page Flow / Navigation Map",
    intent: "navigate",
    organization: "page relationship map",
    readingPath: "entry to outcome",
    componentLanguage: ["page cards", "screen frames", "labeled connectors"],
    keywords: ["page", "flow", "navigation", "route", "screen", "onboarding", "页面", "跳转", "导航", "路由", "流程"]
  },
  {
    id: "wireframe",
    name: "Low-Fidelity Wireframe Set",
    intent: "prototype",
    organization: "low-fidelity screen grid",
    readingPath: "screen by screen",
    componentLanguage: ["device frames", "content blocks", "annotations"],
    keywords: ["wireframe", "prototype", "layout", "ui", "mockup", "低保真", "原型", "布局", "界面"]
  },
  {
    id: "annotated-ui-map",
    name: "Annotated UI Guide Map",
    intent: "explain-ui",
    organization: "annotated product interface map",
    readingPath: "screen overview to numbered feature notes",
    componentLanguage: ["screen frame", "numbered callouts", "feature notes", "guide arrows"],
    keywords: ["annotated", "guide", "tour", "walkthrough", "feature map", "ui guide", "功能导览", "产品导览", "界面说明", "功能说明", "标注", "讲解"]
  },
  {
    id: "implementation-plan",
    name: "Implementation Plan Map",
    intent: "plan",
    organization: "execution map",
    readingPath: "milestone sequence",
    componentLanguage: ["milestone cards", "risk section", "verification section"],
    keywords: ["implementation", "milestone", "plan", "risk", "verify", "开发", "实施", "计划", "风险", "验收"]
  }
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTemplate(template, text) {
  const lower = normalizeText(text);
  return template.keywords.reduce((count, keyword) => count + (lower.includes(String(keyword).toLowerCase()) ? 1 : 0), 0);
}

function includesAny(text, keywords) {
  const lower = normalizeText(text);
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
}

function chooseTemplate(brief, requested) {
  if (requested && requested !== "auto") {
    const matched = TEMPLATE_REGISTRY.find((template) => template.id === requested);
    if (matched) return matched;
  }

  if (includesAny(brief, ["page flow", "navigation map", "onboarding", "跳转", "页面流", "流程图"])) {
    return TEMPLATE_REGISTRY.find((template) => template.id === "page-flow");
  }
  if (includesAny(brief, ["annotated", "guide", "tour", "walkthrough", "feature map", "ui guide", "功能导览", "产品导览", "界面说明", "功能说明", "标注", "讲解"])) {
    return TEMPLATE_REGISTRY.find((template) => template.id === "annotated-ui-map");
  }
  if (includesAny(brief, ["wireframe", "prototype", "mockup", "low fidelity", "low-fidelity", "低保真", "原型", "页面布局", "界面布局"])) {
    return TEMPLATE_REGISTRY.find((template) => template.id === "wireframe");
  }

  let best = TEMPLATE_REGISTRY[0];
  let bestScore = 0;
  for (const template of TEMPLATE_REGISTRY) {
    const score = scoreTemplate(template, brief);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return best;
}

function detectLanguage(text) {
  const value = String(text || "");
  const chineseCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (value.match(/[a-z]/gi) || []).length;
  const chinesePunctuationCount = (value.match(/[，。；：？！、]/g) || []).length;
  const hasChineseIntentPhrase = /(?:架构|流程|页面|用户|产品|生成|画|图|说明|总结|使用场景|价值|能力|低保真|原型)/.test(value);
  if (chineseCount >= 2 && (chinesePunctuationCount > 0 || hasChineseIntentPhrase)) return "zh";
  if (chineseCount >= 4) return "zh";
  if (chineseCount >= 2 && chineseCount >= latinCount * 0.2) return "zh";
  return "en";
}

function estimateCopyDensity(brief, lineCount) {
  const length = String(brief || "").length;
  if (lineCount >= 10 || length >= 900) return "loose";
  if (lineCount <= 4 && length <= 280) return "compact";
  return "normal";
}

function layoutFor(templateId, density) {
  const densityGap = {
    compact: 40,
    normal: 64,
    loose: 88
  }[density] || 64;
  const presets = {
    architecture: { sectionGap: densityGap, cardGap: Math.max(32, densityGap - 16), connectorLabelClearance: 56 },
    "product-board": { sectionGap: densityGap, cardGap: Math.max(28, densityGap - 24), connectorLabelClearance: 48 },
    "page-flow": { sectionGap: densityGap + 12, cardGap: densityGap, connectorLabelClearance: 72 },
    wireframe: { sectionGap: densityGap + 8, cardGap: Math.max(28, densityGap - 20), connectorLabelClearance: 48 },
    "annotated-ui-map": { sectionGap: densityGap + 10, cardGap: Math.max(36, densityGap - 12), connectorLabelClearance: 60 },
    "implementation-plan": { sectionGap: densityGap, cardGap: Math.max(36, densityGap - 12), connectorLabelClearance: 56 }
  };
  return {
    density,
    spacing: presets[templateId] || presets.architecture,
    textPolicy: {
      titleMax: density === "compact" ? 44 : 56,
      nodeMax: density === "loose" ? 64 : 48,
      annotationMax: density === "loose" ? 88 : 68
    }
  };
}

function normalizePlanOverride(value) {
  if (!value || typeof value !== "object") return {};
  return value;
}

export function listExpressionTemplates() {
  return TEMPLATE_REGISTRY.map(({ id, name, intent, organization, readingPath, componentLanguage, keywords }) => ({
    id,
    name,
    intent,
    organization,
    readingPath,
    componentLanguage,
    keywords
  }));
}

export function createExpressionPlan(input = {}) {
  const brief = typeof input === "string" ? input : input.brief || input.prompt || "";
  const title = typeof input === "object" ? input.title : undefined;
  const requestedTemplate = typeof input === "object" ? input.template : undefined;
  const override = normalizePlanOverride(typeof input === "object" ? input.expressionPlan || input.plan : undefined);
  const combinedText = `${title || ""}\n${brief}`;
  const lines = String(brief || "")
    .split(/\n|。|；|;/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected = chooseTemplate(combinedText, override.template || requestedTemplate);
  const density = override.copyDensity || estimateCopyDensity(brief, lines.length);
  const layout = {
    ...layoutFor(selected.id, density),
    ...(override.layout || {})
  };
  return {
    version: 1,
    language: override.language || detectLanguage(combinedText),
    intent: override.intent || selected.intent,
    template: selected.id,
    templateName: selected.name,
    visualOrganization: override.visualOrganization || selected.organization,
    readingPath: override.readingPath || selected.readingPath,
    componentLanguage: override.componentLanguage || selected.componentLanguage,
    copyDensity: density,
    tone: override.tone || (selected.intent === "prototype" ? "low-fidelity product" : "clear collaborative whiteboard"),
    libraryIntent: override.libraryIntent || {
      mode: "assistive",
      useWhen: "Use public libraries only when they add recognizable UX, data-viz, decision, emoji, or business-model components.",
      avoidWhen: "Avoid installing or inserting libraries just to decorate a diagram."
    },
    qualityTarget: override.qualityTarget || {
      clarity: "primary",
      editableSource: true,
      avoidRigidTemplateFeel: true,
      maxAutomaticRepairs: 1
    },
    layout,
    decisions: [
      `template:${selected.id}`,
      `intent:${selected.intent}`,
      `density:${density}`,
      `organization:${selected.organization}`
    ]
  };
}
