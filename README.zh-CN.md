# Codex Excalidraw

[English](README.md) | 简体中文

面向 Codex 和 Claude Code 的本地 Excalidraw 工作台、MCP 画布桥、CLI 和 Agent Skill。

这个项目不是为了取代 Mermaid，而是给 Agent 一个能“看见并改动画布”的 Excalidraw 协作能力：读取当前 scene、批量 patch 画布、导出 PNG/SVG、打开本地浏览器工作台，并在用户手动修改画布后读回改动，继续协作。

## 你会得到什么

- 一个 Vite + React + TypeScript 的 Excalidraw 本地工作台。
- 一个轻量 MCP server，让 Codex / Claude Code 能读写当前 Excalidraw 画布。
- 一个名为 `excalidraw-codex` 的 CLI。
- 一个可移植的 `excalidraw-diagram` Skill，适用于 Codex 和 Claude Code。
- 基于 `@excalidraw/mermaid-to-excalidraw` 的 Mermaid 转 Excalidraw 能力。
- 用于读取画布上下文、批量修改、插入 library、读回用户编辑、快照和导出的画布工具。
- 当 MCP 不可用或只需要快速草稿时，保留 Mermaid 和自然语言 brief 的 fallback 能力。
- 可选的 Excalidraw 公共 Library 注册表，用于 wireframe、emoji 标记、决策控件、商业画布和数据可视化组件。

## 内部组织方式

- `Canvas Bridge`：新的核心 Agent Interface，负责打开场景、读取紧凑画布上下文、批量 patch、插入 library、快照、inspect 和导出。
- `MCP Server`：把 Canvas Bridge 暴露给 Codex / Claude Code，成为 Agent 的“眼睛和手”。
- `CLI`：负责确定性的安装、启动工作台、配置路径、library 安装 / 搜索、校验、导出和 fallback 命令。
- `Scene Workspace`：负责本地 scene 文件、snapshot、preview 元数据和 artifacts 路径。
- `Quality / Export`：让 QA 与浏览器渲染 PNG/SVG 导出尽量贴近真实 Excalidraw 渲染路径。
- `Legacy Draft Recipes`：保留 Mermaid 和 brief-to-scene 草稿能力，但不再作为默认创作路径。

## 环境要求

- macOS、Linux 或 Windows，并有较新的 shell 环境。
- Node.js 20+；推荐 Node 22 LTS。
- npm。

安装脚本会安装核心依赖：

```sh
npm install react react-dom @excalidraw/excalidraw @excalidraw/mermaid-to-excalidraw @modelcontextprotocol/sdk
```

## 安装

克隆仓库，然后运行 setup：

```sh
git clone https://github.com/Vontean/Codex-Excalidraw.git
cd Codex-Excalidraw
npm run setup
```

setup 脚本会：

- 安装 npm 依赖；
- 安装 Playwright Chromium，用于浏览器渲染导出；
- 构建本地工作台；
- 通过 `npm link` 在本机链接 `excalidraw-codex` CLI；
- 写入本地运行配置到 `~/.codex-excalidraw/config.json`；
- 将 `excalidraw-diagram` Skill 安装到 Codex 和 Claude Code 的 skill 目录。

安装完成后，请重启 Codex 或 Claude Code，让新的 Skill 被加载。

### 安装选项

只安装到 Codex：

```sh
npm run setup -- --agents codex
```

只安装到 Claude Code：

```sh
npm run setup -- --agents claude
```

指定不同的工作目录或产物目录：

```sh
npm run setup -- --workspace ~/Codex-Excalidraw --artifacts ~/Codex-Excalidraw/artifacts/excalidraw
```

跳过可选步骤：

```sh
npm run setup -- --skip-playwright
npm run setup -- --skip-link
```

安装过程中同时运行构建和烟测：

```sh
npm run setup -- --verify
```

## 启动工作台

启动本地服务：

```sh
excalidraw-codex serve
```

打开：

```text
http://127.0.0.1:3000/
```

打开指定场景：

```sh
excalidraw-codex open my-diagram.excalidraw
```

## CLI

常用命令：

```sh
excalidraw-codex config
excalidraw-codex doctor
excalidraw-codex serve
excalidraw-codex mcp-config
excalidraw-codex mcp
excalidraw-codex from-mermaid diagram.md --scene architecture.excalidraw
excalidraw-codex validate product-map.excalidraw
excalidraw-codex qa product-map.excalidraw
excalidraw-codex export product-map.excalidraw --format all --require-qa
excalidraw-codex share product-map.excalidraw --dry-run
excalidraw-codex inspect product-map.excalidraw --from latest
excalidraw-codex snapshot product-map.excalidraw --label before-edit --keep 80
excalidraw-codex gallery-refresh --all
```

`serve` 默认使用 production build，因此可以安全地从其他项目目录启动。启动前它会检查 `dist/`，如果工作台构建产物缺失，或比源文件旧，会自动重新构建。只有在开发这个工作台本身时，才使用 `excalidraw-codex serve --dev`。

MCP 命令：

```sh
excalidraw-codex mcp-config --json
excalidraw-codex mcp
```

`mcp-config` 用来输出可配置到 Codex / Claude Code 的 MCP 片段。`mcp` 会启动 stdio MCP server，通常由 Agent 客户端启动，不需要用户手动长期开着。

公开 MCP workflow 工具：

- 绘图指南：`read_diagram_guide`。
- 会话 / 读回：`open_or_create_canvas`、`get_canvas_context`。
- 绘制 / 更新：`create_view`、`apply_canvas_patch`。
- Review / checkpoint：`review_canvas`、`snapshot_canvas`、`restore_snapshot`。
- 收尾：`export_canvas`、`export_to_excalidraw_url`。
- 结构转换：`create_from_mermaid`，只在来源天然适合 Mermaid 时使用。

MCP surface 会刻意保持小，只暴露真实 workflow，而不是几十个低层编辑 helper。`create_view` 会把 `cameraUpdate` 伪元素转换成工作台视口。可选的 `reveal: true` 是分阶段 HTTP live 更新，适合演示和分步讲解；它不等于真正的 MCP partial streaming。

`share` / `export_to_excalidraw_url` 是显式外部分享动作。它会先在本地加密 scene payload，然后只有在被明确调用时才上传到 Excalidraw JSON store。使用 `--dry-run` 可以只验证 payload 生成，不上传。

路径语义：

- `--scene <name.excalidraw>` 表示配置的工作台 `artifactsDir` 里的场景名。
- `--out ./path/to/file.excalidraw` 表示真实文件路径。
- `validate`、`read`、`inspect`、`qa`、`export` 等读取类命令会尊重绝对路径或相对路径。
- shell 里打开带 `?` 的浏览器 URL 时请加引号，例如：`"http://127.0.0.1:3000/?scene=product-map.excalidraw"`。

Library 命令：

```sh
excalidraw-codex library list
excalidraw-codex library search "wireframe"
excalidraw-codex library select "mobile onboarding flow"
excalidraw-codex library remote-search "kanban"
excalidraw-codex library install <official-id-or-source>
```

Library 搜索是只读操作。只有当用户明确指定要安装某个公共 Library 时，Agent 才应该执行安装。

已安装到 registry 的 libraries 会在工作台启动时自动注入 Excalidraw 自带的 Library 面板。安装新 library 后，刷新或重启工作台即可在浏览器画布里使用对应组件。

## Agent 使用方式

安装并重启后，可以自然地让 Codex 或 Claude Code 画图：

```text
用 Excalidraw 画一个可编辑的产品架构图。
```

Skill 会指导 Agent：

- 先读取 `excalidraw-codex config` 和 `excalidraw-codex mcp-config`；
- 默认使用 MCP 画布桥进行绘制和读回；
- 先打开或创建画布，读取绘图指南、读取当前 live 画布上下文，再用 workflow 工具语义化绘制，避免盲目整张重生成；
- 对复杂图、低保真界面或视觉质量敏感的图，使用 `review_canvas` 回看之后再判断是否完成；它会一次返回临时检查 PNG、结构上下文、QA 和 review 原则；
- 在 LLM 层判断表达策略：意图、visual model、阅读路径、语言、文案密度和形状 / 组件语言；
- 根据用户意图和任务复杂度决定 live-first 节奏，而不是固定套用骨架 / 区域 / 泳道 / 模块流程；
- 简单需求保持快速；复杂且需要参与感的图，在最终回答之前把可评审阶段同步到浏览器；
- 只在结构天然适合 Mermaid 时使用 Mermaid；
- 把 recipes 和 libraries 当作可选视觉积木，而不是僵硬模板或强制装饰；
- 执行 validate 和 QA，但不把每个 warning 都变成僵硬的自动排版；
- 在最终确认时导出 PNG/SVG 预览；
- 打开本地浏览器工作台让用户编辑；
- 在用户编辑后，通过 inspect 或 diff 读回画布，再继续协作。

画布文字默认跟随用户当前对话语言。用户用中文交流时，图里的标题、节点、注释和 UI 文案默认使用中文；用户用英文交流时，则默认使用英文。产品名、API 名、文件名和代码标识符保留原文。

Live canvas 行为：

- 浏览器工作台会把当前画布同步到本地服务，作为 live draft。
- MCP 工具会优先读取 live draft；没有 live draft 时再读取保存后的 `.excalidraw` 文件。
- patch、export、snapshot 会先把 live draft materialize 到文件，避免用户未保存的编辑被丢掉。
- MCP 写入场景后，浏览器工作台会优先通过 SSE 接收 live 更新，并用轮询作为 fallback。
- `open_or_create_canvas` 会返回 `readiness.browserReady`，也可以通过 `waitForSubscriberMs` 等待浏览器订阅目标 scene；这是第一次可见 live 写入前的安全握手。
- MCP 写入工具默认只更新当前 live 画布，不刷新画廊缩略图。
- 最终确认时使用 `export_canvas` 导出 PNG/SVG 并刷新画廊缩略图；只有明确需要中途缩略图时才传 `refreshPreview: true`。
- live 写入使用服务端 revision。如果检测到 stale write，调用方应该先读最新 live canvas 再继续。
- live-first 不是每画一个元素都停一下，而是在复杂任务里把完成的有意义阶段及时显示到浏览器中。
- Agent 的中途进度更新应该描述用户能看到的画面进展，除非用户主动询问，否则不要暴露内部协议、schema、revision 等技术机制。
- 手动 Save 仍然是用户可见的显式持久化动作，主要用于保存浏览器里的手动编辑。

## 运行配置

setup 脚本会写入：

```text
~/.codex-excalidraw/config.json
```

示例：

```json
{
  "workspaceRoot": "/path/to/Codex-Excalidraw",
  "artifactsDir": "/path/to/Codex-Excalidraw/artifacts/excalidraw",
  "defaultFontFamily": "Nunito",
  "snapshotRetentionLimit": 80,
  "installedFrom": "/path/to/Codex-Excalidraw",
  "cli": "excalidraw-codex",
  "mcp": {
    "command": "excalidraw-codex",
    "args": ["mcp"]
  }
}
```

也可以用环境变量覆盖路径：

```sh
export EXCALIDRAW_CODEX_HOME=~/Codex-Excalidraw
export EXCALIDRAW_CODEX_ARTIFACTS_DIR=~/Codex-Excalidraw/artifacts/excalidraw
export EXCALIDRAW_CODEX_CONFIG_DIR=~/.codex-excalidraw
export EXCALIDRAW_CODEX_FONT=Nunito
export EXCALIDRAW_CODEX_SNAPSHOT_LIMIT=80
export EXCALIDRAW_CODEX_SHARE_ENDPOINT=https://json.excalidraw.com/api/v2/post/
```

`EXCALIDRAW_CODEX_FONT` 控制生成图里的文字字体，以及工作台空白画布的默认字体。默认是 `Nunito`，比 Virgil 更适合中英文混排。支持的名称包括 `Nunito`、`Excalifont`、`Virgil`、`Helvetica`、`Cascadia`、`Lilita One`、`Comic Shanns`、`Liberation Sans`。

Snapshot 是 Agent 反复编辑时的安全网。默认每个 scene 保留最近 `80` 个 snapshot，创建新 snapshot 后会自动清理更旧的文件。设置 `EXCALIDRAW_CODEX_SNAPSHOT_LIMIT=0` 或 `"snapshotRetentionLimit": 0` 可以关闭自动清理；也可以用 `excalidraw-codex snapshot <scene> --keep <count>` 临时覆盖。

## 项目结构

```text
bin/                         CLI 入口
mcp/                         暴露画布工具的 MCP server
server/                      Canvas Bridge、本地 API、场景读写、QA、导出和 libraries
src/                         Vite React Excalidraw 工作台
skills/excalidraw-diagram/   可移植的 Codex / Claude Code Skill
libraries/                   可选 Excalidraw Library 注册表
scripts/install.mjs          setup 脚本
artifacts/excalidraw/        本地生成场景，已被 git 忽略
dist/                        构建产物，已被 git 忽略
```

## 开发

```sh
npm install
npm run build
excalidraw-codex doctor
npm run test:mcp
npm run test:live
npm run verify
npm run dev
```

`test:mcp` 用来验证 MCP 工具面；`test:live` 会打开真实浏览器，验证 workbench / live / MCP 的双向同步。`verify` 会运行生产构建和两个烟测。

`excalidraw-codex doctor` 也会检查 production build 产物、MCP 工具面、本地分享 payload 加密 dry-run，以及当前 `3000` 端口服务的能力声明。如果构建缺失或过期，可以运行 `npm run build` 或 `excalidraw-codex serve` 重新构建。如果旧工作台进程还在运行，doctor 会列出缺失能力，提示你重启共享工作台，而不是悄悄复用不兼容服务。

默认本地地址：

```text
http://127.0.0.1:3000/
```

3000 是共享工作台端口。如果它已经在运行 Excalidraw Codex，新的 session 应该直接复用，而不是继续打开 3001/3002。如果 3000 被其他进程占用且健康检查失败，再停止那个进程，或临时手动指定其他端口。

## 隐私说明

仓库不应该包含本机用户路径、私有规划文档、构建产物、`node_modules` 或生成图。运行文件会通过 `.gitignore` 和 `~/.codex-excalidraw/config.json` 保持在本地。
