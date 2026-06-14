import {
  createExpressionPlan,
  listExpressionTemplates
} from "./expression-plan.mjs";
import { defaultCanvasBackgroundColor, defaultFontFamily } from "./config.mjs";

const SCENE_SOURCE = "https://codex.local/excalidraw-codex";

const PALETTES = {
  architecture: {
    canvas: defaultCanvasBackgroundColor,
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
    canvas: defaultCanvasBackgroundColor,
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
    canvas: defaultCanvasBackgroundColor,
    title: "#111827",
    sectionStroke: "#d4d4d4",
    sectionFill: "#fafafa",
    block: "#f5f5f5",
    muted: "#e5e5e5",
    accent: "#e0f2fe",
    ink: "#1e1e1e"
  },
  plan: {
    canvas: defaultCanvasBackgroundColor,
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

function visualTextWidth(value, fontSize = 20) {
  const text = String(value || "");
  const wideCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const narrowCount = Math.max(0, text.length - wideCount);
  return Math.ceil(wideCount * fontSize + narrowCount * fontSize * 0.62);
}

function splitBriefLines(brief) {
  return String(brief || "")
    .split(/\n|。|；|;/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 24);
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
    customData: {
      codexRole: base.role,
      codexTemplate: base.template,
      codexKind: base.kind
    }
  };
}

function textElement(base) {
  return {
    id: base.id,
    type: "text",
    groupIds: base.groupIds || [],
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height || Math.ceil((base.fontSize || 20) * 1.35),
    text: compactText(base.text, base.maxTextLength || 72),
    fontSize: base.fontSize || 20,
    fontFamily: Number(base.fontFamily || defaultFontFamily),
    strokeColor: base.strokeColor || "#1e1e1e",
    backgroundColor: "transparent",
    textAlign: base.textAlign || "center",
    verticalAlign: base.verticalAlign || "middle",
    roughness: 1,
    customData: {
      codexRole: base.role,
      codexTemplate: base.template,
      codexKind: "label",
      labelFor: base.labelFor
    }
  };
}

function labelPosition({ x, y, width, height, fontSize = 20, padding = 16 }) {
  const labelHeight = Math.ceil(fontSize * 1.45);
  return {
    x: x + padding,
    y: y + Math.max(8, Math.round((height - labelHeight) / 2)),
    width: Math.max(20, width - padding * 2),
    height: labelHeight
  };
}

function labeledBox(base) {
  const groupId = base.groupId || `group-${base.id}`;
  const groupIds = [...new Set([...(base.groupIds || []), groupId])];
  const shape = element({
    ...base,
    groupIds,
    text: undefined
  });
  const label = textElement({
    id: `${base.id}-label`,
    role: `${base.role || "shape"}-label`,
    template: base.template,
    groupIds,
    text: base.text,
    fontSize: base.fontSize || 20,
    textAlign: base.textAlign,
    strokeColor: base.textColor || base.strokeColor || "#1e1e1e",
    maxTextLength: base.maxTextLength || base.maxLabelLength || 72,
    labelFor: base.id,
    ...labelPosition({
      x: base.x,
      y: base.y,
      width: base.width,
      height: base.height,
      fontSize: base.fontSize || 20,
      padding: base.padding || 16
    })
  });
  return {
    shape,
    label,
    elements: base.text ? [shape, label] : [shape]
  };
}

function section({ id, title, x, y, width, height, palette, template }) {
  const groupId = `group-${id}`;
  const fontSize = String(title || "").length > 14 ? 18 : 20;
  const shape = element({
    id,
    role: "section",
    template,
    groupIds: [groupId],
    x,
    y,
    width,
    height,
    backgroundColor: palette.sectionFill,
    strokeColor: palette.sectionStroke
  });
  const label = textElement({
    id: `${id}-label`,
    role: "section-label",
    template,
    groupIds: [groupId],
    x: x + 22,
    y: y + 18,
    width: width - 44,
    height: 30,
    text: title,
    fontSize,
    textAlign: "left",
    strokeColor: palette.title || palette.ink,
    labelFor: id
  });
  return [shape, label];
}

function card({ id, text, x, y, width = 220, height = 74, fill, palette, role = "card", template }) {
  return labeledBox({
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
    strokeColor: palette.ink,
    maxTextLength: 56
  });
}

function sticky({ id, text, x, y, fill, palette, template }) {
  return labeledBox({
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
    strokeColor: palette.ink,
    maxTextLength: 64
  });
}

function badge({ id, text, x, y, fill, palette, template }) {
  const fontSize = 18;
  const width = Math.min(280, Math.max(150, visualTextWidth(text, fontSize) + 48));
  return labeledBox({
    id,
    role: "badge",
    template,
    x,
    y,
    width,
    height: 42,
    text,
    fontSize,
    textAlign: "left",
    backgroundColor: fill,
    strokeColor: palette.ink,
    maxTextLength: 36
  });
}

function pageCard({ id, title, x, y, width = 250, height = 170, fill, palette, template }) {
  const groupId = `group-${id}`;
  const frame = element({
    id,
    role: "page-card",
    template,
    groupIds: [groupId],
    x,
    y,
    width,
    height,
    backgroundColor: fill,
    strokeColor: palette.ink
  });
  const titleText = textElement({
    id: `${id}-label`,
    role: "page-card-label",
    template,
    groupIds: [groupId],
    x: x + 18,
    y: y + 16,
    width: width - 36,
    height: 28,
    text: title,
    fontSize: 21,
    textAlign: "left",
    strokeColor: palette.ink,
    maxTextLength: 56,
    labelFor: id
  });
  return [
    frame,
    titleText,
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
  const connector = {
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
    customData: {
      codexRole: "connector",
      codexTemplate: template
    }
  };
  if (!label) return [connector];
  const labelWidth = Math.max(64, Math.min(160, compactText(label, 42).length * 9));
  return [
    connector,
    textElement({
      id: `${id}-label`,
      role: "connector-label",
      template,
      x: x + Math.round(width / 2) - Math.round(labelWidth / 2),
      y: y + Math.round(height / 2) - 28,
      width: labelWidth,
      height: 24,
      text: label,
      fontSize: 16,
      maxTextLength: 42,
      strokeColor: "#475569",
      labelFor: id
    })
  ];
}

function arrowBetween({ id, from, to, template, label }) {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;
  const horizontalGap = to.x - (from.x + from.width);
  const reverseGap = from.x - (to.x + to.width);
  const verticalGap = to.y - (from.y + from.height);
  const upwardGap = from.y - (to.y + to.height);

  if (horizontalGap >= 24) {
    return arrow({
      id,
      from: from.id,
      to: to.id,
      x: from.x + from.width,
      y: fromCenterY,
      width: horizontalGap,
      height: toCenterY - fromCenterY,
      template,
      label
    });
  }
  if (reverseGap >= 24) {
    return arrow({
      id,
      from: from.id,
      to: to.id,
      x: from.x,
      y: fromCenterY,
      width: -reverseGap,
      height: toCenterY - fromCenterY,
      template,
      label
    });
  }
  if (verticalGap >= 24) {
    return arrow({
      id,
      from: from.id,
      to: to.id,
      x: fromCenterX,
      y: from.y + from.height,
      width: toCenterX - fromCenterX,
      height: verticalGap,
      template,
      label
    });
  }
  if (upwardGap >= 24) {
    return arrow({
      id,
      from: from.id,
      to: to.id,
      x: fromCenterX,
      y: from.y,
      width: toCenterX - fromCenterX,
      height: -upwardGap,
      template,
      label
    });
  }
  return arrow({
    id,
    from: from.id,
    to: to.id,
    x: fromCenterX,
    y: fromCenterY,
    width: toCenterX - fromCenterX,
    height: toCenterY - fromCenterY,
    template,
    label
  });
}

function titleBlock(title, subtitle, palette, template) {
  return [
    textElement({
      id: "title",
      role: "title",
      template,
      x: 40,
      y: 28,
      width: 1120,
      height: 48,
      text: title,
      fontSize: 30,
      textAlign: "left",
      strokeColor: palette.title || palette.ink,
      maxTextLength: 72
    }),
    textElement({
      id: "subtitle",
      role: "subtitle",
      template,
      x: 44,
      y: 78,
      width: 1040,
      height: 38,
      text: subtitle,
      fontSize: 18,
      textAlign: "left",
      strokeColor: "#475569",
      maxTextLength: 96
    })
  ];
}

function sectionItems(lines, defaults) {
  const items = lines.length ? lines : defaults;
  return items.slice(0, Math.max(3, defaults.length));
}

function spacing(parsed, key, fallback) {
  return Number(parsed.plan?.layout?.spacing?.[key] || fallback);
}

function nodeMax(parsed, fallback = 48) {
  return Number(parsed.plan?.layout?.textPolicy?.nodeMax || fallback);
}

function visualSubtitle(parsed, fallbackEn, fallbackZh) {
  const value = String(parsed.plan?.visualOrganization || "").trim();
  if (parsed.plan.language === "zh") {
    return /[\u3400-\u9fff]/.test(value) ? value : fallbackZh;
  }
  return value || fallbackEn;
}

function localizedTemplateTitle(plan) {
  const zhTitles = {
    architecture: "架构图",
    "product-board": "产品构想图",
    "page-flow": "页面流程图",
    wireframe: "低保真原型图",
    "annotated-ui-map": "功能导览图",
    "implementation-plan": "实施计划图"
  };
  const enTitles = {
    architecture: "Architecture Map",
    "product-board": "Product Concept Board",
    "page-flow": "Page Flow",
    wireframe: "Low-Fidelity Wireframe",
    "annotated-ui-map": "Annotated UI Guide",
    "implementation-plan": "Implementation Plan"
  };
  return plan.language === "zh" ? zhTitles[plan.template] || "图解" : enTitles[plan.template] || "Codex Diagram";
}

function extractSubject(text, language) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (language === "zh") {
    const cleaned = value.replace(/^(请|帮我|给我|给一个|画一个|生成一个|做一个|用\s*Excalidraw\s*)/, "");
    const match = cleaned.match(/^(.{2,28}?(?:App|应用|系统|平台|工具|产品|工作台|插件|软件))/i);
    return match?.[1]?.trim();
  }
  const match = value.match(/(?:for|about)\s+(.{3,42}?)(?:\s+(?:app|product|system|platform|workflow|tool))?/i);
  return match?.[1]?.trim();
}

function deriveTitle(input, lines, plan) {
  const explicitTitle = typeof input === "object" ? input.title : undefined;
  const titleMax = plan.layout?.textPolicy?.titleMax || 56;
  if (explicitTitle) return compactText(explicitTitle, titleMax);
  const candidate = lines[0] || "Codex diagram";
  const tooLong = candidate.length > 34 || visualTextWidth(candidate, 30) > 980;
  if (!tooLong) return compactText(candidate, titleMax);
  const subject = extractSubject(candidate, plan.language);
  const templateTitle = localizedTemplateTitle(plan);
  return compactText(subject ? `${subject} ${templateTitle}` : templateTitle, titleMax);
}

function architectureTemplate(parsed) {
  const palette = PALETTES.architecture;
  const template = "architecture";
  const defaults = ["User / Client", "API Gateway", "Core Service", "Worker", "Database", "Observability"];
  const items = sectionItems(parsed.lines, defaults);
  const gap = spacing(parsed, "sectionGap", 64);
  const sectionWidth = 225;
  const sectionStep = sectionWidth + gap;
  const sections = [
    ["Client / External", palette.client],
    ["Edge / Gateway", palette.edge],
    ["Application Services", palette.app],
    ["Async / Workers", palette.async],
    ["Data / Storage", palette.data],
    ["Ops / Observability", palette.ops]
  ];
  const elements = titleBlock(parsed.title, visualSubtitle(parsed, "Layered system map with explicit boundaries and flow.", "分层系统图：边界、模块和流向清晰可读。"), palette, template);
  const cards = [];
  sections.forEach(([label, fill], index) => {
    const x = 40 + index * sectionStep;
    elements.push(...section({ id: `section-${slug(label)}`, title: label, x, y: 140, width: sectionWidth, height: 270, palette, template }));
    const cardId = `node-${index + 1}-${slug(items[index] || label)}`;
    const node = card({ id: cardId, text: compactText(items[index] || label, nodeMax(parsed)), x: x + 18, y: 230, width: 188, height: 78, fill, palette, template, role: "service-card" });
    elements.push(...node.elements);
    cards.push(node.shape);
  });
  for (let index = 0; index < cards.length - 1; index += 1) {
    elements.push(...arrow({
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
  elements.push(...badge({ id: "risk-badge", text: "Risks / Unknowns", x: 40, y: 450, fill: palette.risk, palette, template }).elements);
  return elements;
}

function productBoardTemplate(parsed) {
  const palette = PALETTES.product;
  const template = "product-board";
  const defaults = ["User problem", "Core jobs", "Product modules", "Differentiators", "Open questions", "Next experiments"];
  const items = sectionItems(parsed.lines, defaults);
  const gap = spacing(parsed, "sectionGap", 64);
  const sectionWidth = 450;
  const sectionHeight = 210;
  const sections = [
    ["Problem", palette.primary],
    ["Users / Jobs", palette.secondary],
    ["Solution Modules", palette.accent],
    ["Open Questions", palette.question]
  ];
  const elements = titleBlock(parsed.title, visualSubtitle(parsed, "Concept board for product exploration and narrowing.", "产品构想看板：问题、用户、方案和开放问题。"), palette, template);
  sections.forEach(([label], index) => {
    const x = 40 + (index % 2) * (sectionWidth + gap);
    const y = 145 + Math.floor(index / 2) * (sectionHeight + gap);
    elements.push(...section({ id: `section-${slug(label)}`, title: label, x, y, width: sectionWidth, height: sectionHeight, palette, template }));
    elements.push(...sticky({ id: `sticky-${index * 2 + 1}`, text: compactText(items[index * 2] || label, nodeMax(parsed)), x: x + 24, y: y + 74, fill: sections[index][1], palette, template }).elements);
    elements.push(...sticky({ id: `sticky-${index * 2 + 2}`, text: compactText(items[index * 2 + 1] || "Refine with user edits", nodeMax(parsed)), x: x + 232, y: y + 74, fill: "#ffffff", palette, template }).elements);
  });
  return elements;
}

function pageFlowTemplate(parsed) {
  const palette = PALETTES.wireframe;
  const template = "page-flow";
  const defaults = ["Entry", "Dashboard", "Detail", "Settings", "Success", "Error / Empty"];
  const items = sectionItems(parsed.lines, defaults);
  const gap = spacing(parsed, "cardGap", 64);
  const cardWidth = 250;
  const rowGap = gap + 190;
  const elements = titleBlock(parsed.title, visualSubtitle(parsed, "Navigation map with page cards and labeled transitions.", "页面关系图：页面卡片和跳转路径。"), palette, template);
  const positions = [
    [40, 160],
    [40 + cardWidth + gap, 160],
    [40 + (cardWidth + gap) * 2, 160],
    [40 + cardWidth + gap, 160 + rowGap],
    [40 + (cardWidth + gap) * 2, 160 + rowGap],
    [40 + cardWidth + gap, 160 + rowGap * 2]
  ];
  const pages = items.slice(0, 6).map((item, index) => {
    const [x, y] = positions[index];
    const id = `page-${index + 1}-${slug(item)}`;
    elements.push(...pageCard({ id, title: compactText(item, nodeMax(parsed)), x, y, width: cardWidth, fill: index === 0 ? palette.accent : "#ffffff", palette, template }));
    return { id, x, y, width: cardWidth, height: 170 };
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
    elements.push(...arrowBetween({
      id: `route-${fromIndex + 1}-${toIndex + 1}`,
      from,
      to,
      label,
      template
    }));
  }
  return elements;
}

function wireframeTemplate(parsed) {
  const palette = PALETTES.wireframe;
  const template = "wireframe";
  const gap = spacing(parsed, "sectionGap", 72);
  const elements = titleBlock(parsed.title, visualSubtitle(parsed, "Low-fidelity product layout with reusable page blocks.", "低保真页面布局：结构优先，方便继续编辑。"), palette, template);
  elements.push(...section({ id: "section-desktop", title: "Desktop", x: 40, y: 140, width: 620, height: 430, palette, template }));
  elements.push(...section({ id: "section-mobile", title: "Mobile", x: 660 + gap, y: 140, width: 320, height: 430, palette, template }));
  elements.push(...pageCard({ id: "desktop-shell", title: compactText(parsed.lines[0] || "Primary screen", nodeMax(parsed)), x: 78, y: 220, width: 540, height: 300, fill: "#ffffff", palette, template }));
  elements.push(element({ id: "desktop-sidebar", role: "wireframe-block", template, x: 108, y: 320, width: 112, height: 160, backgroundColor: palette.block, strokeColor: "#737373" }));
  elements.push(element({ id: "desktop-content", role: "wireframe-block", template, x: 246, y: 320, width: 330, height: 160, backgroundColor: palette.accent, strokeColor: "#737373" }));
  elements.push(...pageCard({ id: "mobile-shell", title: compactText(parsed.lines[1] || "Mobile variant", nodeMax(parsed)), x: 728 + gap, y: 220, width: 185, height: 300, fill: "#ffffff", palette, template }));
  elements.push(...sticky({ id: "wireframe-note", text: compactText(parsed.lines[2] || "Keep layout editable and low fidelity", nodeMax(parsed, 64)), x: 1020 + gap, y: 222, fill: "#fef3c7", palette, template }).elements);
  return elements;
}

function uiGuideText(parsed, en, zh) {
  return parsed.plan.language === "zh" ? zh : en;
}

function numberedMarker({ id, number, x, y, palette, template }) {
  const groupId = `group-${id}`;
  return [
    element({
      id,
      type: "ellipse",
      role: "callout-marker",
      template,
      groupIds: [groupId],
      x,
      y,
      width: 34,
      height: 34,
      backgroundColor: "#111827",
      strokeColor: "#111827"
    }),
    textElement({
      id: `${id}-label`,
      role: "callout-marker-label",
      template,
      groupIds: [groupId],
      x: x + 7,
      y: y + 4,
      width: 20,
      height: 24,
      text: String(number),
      fontSize: 18,
      textAlign: "center",
      strokeColor: "#ffffff",
      labelFor: id
    })
  ];
}

function guideArrow({ id, x, y, width, height, template }) {
  return {
    id,
    type: "arrow",
    groupIds: [],
    x,
    y,
    width,
    height,
    strokeWidth: 2,
    strokeColor: "#64748b",
    backgroundColor: "transparent",
    fillStyle: "solid",
    roughness: 1,
    points: [
      [0, 0],
      [Math.round(width / 2), Math.round(height / 2)],
      [width, height]
    ],
    roundness: { type: 2 },
    customData: {
      codexRole: "guide-arrow",
      codexTemplate: template
    }
  };
}

function annotatedUiMapTemplate(parsed) {
  const palette = PALETTES.wireframe;
  const template = "annotated-ui-map";
  const title = visualSubtitle(parsed, "Annotated product interface map", "产品界面功能导览图");
  const elements = titleBlock(parsed.title, title, palette, template);
  const labels = [
    parsed.lines[0] || uiGuideText(parsed, "Entry state and navigation", "入口状态与导航"),
    parsed.lines[1] || uiGuideText(parsed, "Primary action area", "核心操作区域"),
    parsed.lines[2] || uiGuideText(parsed, "Personalized learning content", "个性化内容区"),
    parsed.lines[3] || uiGuideText(parsed, "Progress and feedback", "进度与反馈"),
    parsed.lines[4] || uiGuideText(parsed, "Codex follow-up edits", "后续协作调整")
  ];

  elements.push(...section({
    id: "section-interface",
    title: uiGuideText(parsed, "Main interface", "主界面"),
    x: 40,
    y: 140,
    width: 690,
    height: 560,
    palette,
    template
  }));
  elements.push(...section({
    id: "section-notes",
    title: uiGuideText(parsed, "Feature notes", "功能标注"),
    x: 790,
    y: 140,
    width: 520,
    height: 560,
    palette,
    template
  }));

  elements.push(...pageCard({
    id: "guided-screen",
    title: uiGuideText(parsed, "Product screen", "产品页面"),
    x: 120,
    y: 205,
    width: 520,
    height: 430,
    fill: "#ffffff",
    palette,
    template
  }));
  const screenGroupIds = ["group-guided-screen"];
  elements.push(element({ id: "ui-topbar", role: "wireframe-block", template, groupIds: screenGroupIds, x: 155, y: 292, width: 450, height: 42, backgroundColor: palette.muted, strokeColor: "#737373" }));
  elements.push(element({ id: "ui-hero", role: "wireframe-block", template, groupIds: screenGroupIds, x: 155, y: 360, width: 450, height: 92, backgroundColor: palette.accent, strokeColor: "#737373" }));
  elements.push(element({ id: "ui-list-left", role: "wireframe-block", template, groupIds: screenGroupIds, x: 155, y: 480, width: 210, height: 104, backgroundColor: palette.block, strokeColor: "#737373" }));
  elements.push(element({ id: "ui-list-right", role: "wireframe-block", template, groupIds: screenGroupIds, x: 395, y: 480, width: 210, height: 104, backgroundColor: "#ffffff", strokeColor: "#737373" }));

  const markerPositions = [
    [625, 286, -58, 24],
    [625, 390, -54, 18],
    [625, 502, -44, 26],
    [336, 612, 42, -38],
    [560, 612, 36, -34]
  ];
  const noteY = [220, 310, 400, 490, 580];
  labels.forEach((label, index) => {
    const [mx, my, arrowWidth, arrowHeight] = markerPositions[index];
    elements.push(...numberedMarker({ id: `callout-${index + 1}`, number: index + 1, x: mx, y: my, palette, template }));
    elements.push(guideArrow({ id: `guide-arrow-${index + 1}`, x: mx, y: my + 17, width: arrowWidth, height: arrowHeight, template }));
    elements.push(...sticky({
      id: `feature-note-${index + 1}`,
      text: compactText(label, nodeMax(parsed, 72)),
      x: 835,
      y: noteY[index],
      fill: index % 2 === 0 ? "#e0f2fe" : "#fef3c7",
      palette,
      template
    }).elements);
  });
  return elements;
}

function implementationPlanTemplate(parsed) {
  const palette = PALETTES.plan;
  const template = "implementation-plan";
  const defaults = ["Scope", "Architecture", "Build", "Integrate", "Verify", "Ship"];
  const items = sectionItems(parsed.lines, defaults).slice(0, 6);
  const gap = spacing(parsed, "cardGap", 52);
  const cardWidth = 190;
  const elements = titleBlock(parsed.title, visualSubtitle(parsed, "Execution map with milestones, risks, and verification.", "实施计划图：里程碑、风险和验收路径。"), palette, template);
  const cards = items.map((item, index) => {
    const fill = index < 2 ? palette.decision : index < 4 ? palette.build : palette.verify;
    const node = card({
      id: `milestone-${index + 1}-${slug(item)}`,
      text: compactText(item, nodeMax(parsed)),
      x: 50 + index * (cardWidth + gap),
      y: 210,
      width: cardWidth,
      height: 80,
      fill,
      palette,
      role: "milestone",
      template
    });
    elements.push(...node.elements);
    return node.shape;
  });
  for (let index = 0; index < cards.length - 1; index += 1) {
    elements.push(...arrow({
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
  elements.push(...sticky({ id: "risk-1", text: parsed.lines[6] || "Unknown dependency", x: 80, y: 440, fill: palette.risk, palette, template }).elements);
  elements.push(...sticky({ id: "risk-2", text: parsed.lines[7] || "Verification gap", x: 300, y: 440, fill: "#ffffff", palette, template }).elements);
  elements.push(...section({ id: "section-verification", title: "Verification", x: 720, y: 370, width: 610, height: 180, palette, template }));
  elements.push(...sticky({ id: "verify-1", text: "Build passes", x: 750, y: 440, fill: palette.verify, palette, template }).elements);
  elements.push(...sticky({ id: "verify-2", text: "Browser check", x: 970, y: 440, fill: "#ffffff", palette, template }).elements);
  return elements;
}

function parseBrief(input = {}) {
  const brief = typeof input === "string" ? input : input.brief || input.prompt || "";
  const plan = createExpressionPlan(input);
  const allLines = splitBriefLines(brief);
  const title = deriveTitle(input, allLines, plan);
  const usedFirstLineAsTitle =
    allLines[0] &&
    (title === compactText(allLines[0], plan.layout?.textPolicy?.titleMax || 56) || allLines[0].length > 34);
  const lines = usedFirstLineAsTitle ? allLines.slice(1) : allLines;
  return {
    brief,
    title,
    lines,
    plan,
    requestedTemplate: typeof input === "object" ? input.template : undefined
  };
}

export function listBriefTemplates() {
  return listExpressionTemplates();
}

export function generateSceneFromBrief(input = {}) {
  const parsed = parseBrief(input);
  const template = parsed.plan.template;
  const palette = template === "architecture"
    ? PALETTES.architecture
    : template === "implementation-plan"
      ? PALETTES.plan
      : template === "product-board"
        ? PALETTES.product
        : PALETTES.wireframe;
  const builders = {
    architecture: architectureTemplate,
    "product-board": productBoardTemplate,
    "page-flow": pageFlowTemplate,
    wireframe: wireframeTemplate,
    "annotated-ui-map": annotatedUiMapTemplate,
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
        viewBackgroundColor: palette.canvas,
        currentItemFontFamily: defaultFontFamily,
        codex: {
          generator: "from-brief",
          template,
          expressionPlan: parsed.plan,
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
