# Codex Excalidraw

[English](README.md) | 简体中文

面向 Codex 和 Claude Code 的本地 Excalidraw 工作台、CLI 和 Agent Skill。

这个项目不是为了取代 Mermaid，而是给 Agent 一个轻量的可编辑画布能力：生成 `.excalidraw` 源文件、导出 PNG/SVG、打开本地浏览器工作台，并在用户手动修改画布后读回改动，继续协作。

## 你会得到什么

- 一个 Vite + React + TypeScript 的 Excalidraw 本地工作台。
- 一个名为 `excalidraw-codex` 的 CLI。
- 一个可移植的 `excalidraw-diagram` Skill，适用于 Codex 和 Claude Code。
- 基于 `@excalidraw/mermaid-to-excalidraw` 的 Mermaid 转 Excalidraw 能力。
- 面向架构图、产品草图、页面流、低保真原型和实施计划的自然语言模板。
- 读回、检查、diff、patch、polish、QA、快照和导出的命令。
- 可选的 Excalidraw 公共 Library 注册表，用于 wireframe、emoji 标记、决策控件、商业画布和数据可视化组件。

## 内部组织方式

- `Expression Plan`：把用户 brief 转成语言、意图、视觉组织方式、阅读路径、文案密度和 library 使用意图。
- `Diagram Recipes`：把表达计划转成可编辑 Excalidraw primitives，优先使用分组的 shape + text，而不是隐藏 label。
- `Generation Workflow`：统一 CLI 和 HTTP 的生成行为，包括 brief 生成、library 选择、polish、预览和保存。
- `Scene Workspace`：负责本地 scene 文件、snapshot、preview 元数据和 artifacts 路径。
- `Quality / Export`：让 QA 与浏览器渲染 PNG/SVG 导出尽量贴近真实 Excalidraw 渲染路径。

## 环境要求

- macOS、Linux 或 Windows，并有较新的 shell 环境。
- Node.js 20+；推荐 Node 22 LTS。
- npm。

安装脚本会安装核心依赖：

```sh
npm install react react-dom @excalidraw/excalidraw @excalidraw/mermaid-to-excalidraw
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
excalidraw-codex serve
excalidraw-codex plan brief.txt --json
excalidraw-codex from-mermaid diagram.md --scene architecture.excalidraw
excalidraw-codex from-brief brief.txt --scene product-map.excalidraw --preview
excalidraw-codex validate product-map.excalidraw
excalidraw-codex qa product-map.excalidraw
excalidraw-codex export product-map.excalidraw --format all --require-qa
excalidraw-codex inspect product-map.excalidraw --from latest
excalidraw-codex snapshot product-map.excalidraw --label before-edit
excalidraw-codex gallery-refresh --all
```

`serve` 默认使用 production build，因此可以安全地从其他项目目录启动。只有在开发这个工作台本身时，才使用 `excalidraw-codex serve --dev`。

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

## Agent 使用方式

安装并重启后，可以自然地让 Codex 或 Claude Code 画图：

```text
用 Excalidraw 画一个可编辑的产品架构图。
```

Skill 会指导 Agent：

- 先判断表达策略；
- 对复杂 brief 先使用 `excalidraw-codex plan`，把意图、视觉组织方式、阅读路径、语言、文案密度和 library 使用意图显式化；
- 只在结构天然适合 Mermaid 时使用 Mermaid；
- 生成可编辑的 `.excalidraw` 文件；
- 先读取 `excalidraw-codex config`，并返回真实配置的 `artifactsDir`；
- 把 recipes 和 libraries 当作可选视觉积木，而不是僵硬模板或强制装饰；
- 执行 validate 和 QA，但不把每个 warning 都变成僵硬的自动排版；
- 导出 PNG/SVG 预览；
- 打开本地浏览器工作台让用户编辑；
- 在用户编辑后，通过 inspect 或 diff 读回画布，再继续协作。

画布文字默认跟随用户当前对话语言。用户用中文交流时，图里的标题、节点、注释和 UI 文案默认使用中文；用户用英文交流时，则默认使用英文。产品名、API 名、文件名和代码标识符保留原文。

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
  "installedFrom": "/path/to/Codex-Excalidraw",
  "cli": "excalidraw-codex"
}
```

也可以用环境变量覆盖路径：

```sh
export EXCALIDRAW_CODEX_HOME=~/Codex-Excalidraw
export EXCALIDRAW_CODEX_ARTIFACTS_DIR=~/Codex-Excalidraw/artifacts/excalidraw
export EXCALIDRAW_CODEX_CONFIG_DIR=~/.codex-excalidraw
```

## 项目结构

```text
bin/                         CLI 入口
server/                      本地 API、场景读写、QA、导出和 libraries
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
npm run dev
```

默认本地地址：

```text
http://127.0.0.1:3000/
```

如果 3000 端口被占用，服务会切换到 3001，并打印实际 URL。

## 隐私说明

仓库不应该包含本机用户路径、私有规划文档、构建产物、`node_modules` 或生成图。运行文件会通过 `.gitignore` 和 `~/.codex-excalidraw/config.json` 保持在本地。
