# Codex Excalidraw

[English](README.md) | 简体中文

让 Codex / Claude Code 在你本地浏览器里的 Excalidraw 画布上和你一起画图。你可以边看边改，也可以让 Agent 读回你手动改过的画布继续画。最后拿到的是可编辑的 `.excalidraw` 源文件，以及 PNG / SVG 导出图。

它默认是 local-first：画布文件、快照和导出文件都留在你的机器上。只有你明确运行分享命令时，才会生成外部 Excalidraw 分享链接。

这个仓库包含四个部分：

- 浏览器工作台：`http://127.0.0.1:3000/`；
- `excalidraw-codex` CLI：负责安装、启动、导出、快照、QA 和 library 管理；
- MCP server：让 Agent 能读取和修改当前画布；
- 可选的 `excalidraw-diagram` Skill：给 Codex 和 Claude Code 一套画图工作流。

## 适合什么场景

当图需要持续修改，或者你希望边看边让 Agent 调整画布时，用它会比一次性生成图片舒服很多。

常见场景：

- 系统架构图、模块关系图、技术解释图；
- 产品流程、页面地图、低保真界面草图；
- 流程图、决策树、操作路径；
- 白板式讨论、证据板、概念地图；
- 想从 Mermaid 起步，但最终需要 Excalidraw 可编辑画布。

如果你只需要一段放进 Markdown 的静态 Mermaid，直接用 Mermaid 就好。这个项目主要解决“画布需要被看见、被编辑、被继续协作”的问题。

## 快速开始

环境要求：

- Node.js 20 或更新版本，推荐 Node 22 LTS。
- npm。
- macOS、Linux 或 Windows 终端环境。

安装：

```sh
git clone https://github.com/Vontean/Codex-Excalidraw.git
cd Codex-Excalidraw
npm run setup
```

setup 会安装依赖、安装用于导出的 Playwright Chromium、构建工作台、链接 `excalidraw-codex` CLI、写入 `~/.codex-excalidraw/config.json`，并在检测到 Codex 或 Claude Code 的 skill 目录时安装 `excalidraw-diagram`。

安装完成后，重启 Codex 或 Claude Code，让新的 Skill 和 MCP 配置生效。

启动工作台：

```sh
excalidraw-codex serve
```

打开：

```text
http://127.0.0.1:3000/
```

然后直接让 Agent 画图：

```text
用 Excalidraw 画一个可编辑的系统架构图。
```

生成的画布默认保存在：

```text
artifacts/excalidraw/
```

## 工作流是什么样的

1. 打开或复用本地浏览器工作台。
2. 让 Codex 或 Claude Code 使用 Excalidraw 画图。
3. Agent 创建画布、读取当前内容，然后按有意义的阶段修改，而不是盲目重写整个文件。
4. 你可以在浏览器里手动改。Agent 能读回这些改动，再继续往下画。
5. 收尾时导出 `.excalidraw`、PNG、SVG，或一次导出全部。

这里最重要的是“读回”。Agent 不是只生成一次文件就结束，而是能看见当前画布，并从最新版本继续。

## 常用命令

```sh
excalidraw-codex config
excalidraw-codex doctor
excalidraw-codex serve
excalidraw-codex open product-map.excalidraw
excalidraw-codex validate product-map.excalidraw
excalidraw-codex qa product-map.excalidraw
excalidraw-codex export product-map.excalidraw --format all
excalidraw-codex snapshot product-map.excalidraw --label before-edit
excalidraw-codex restore product-map.excalidraw --from latest
```

当来源本来就适合 Mermaid 时，可以转换成 Excalidraw：

```sh
excalidraw-codex from-mermaid diagram.md --scene architecture.excalidraw
```

从文字 brief 生成一个草稿：

```sh
excalidraw-codex from-brief brief.txt --scene product-flow.excalidraw
```

只有在你确实需要外部分享链接时才运行：

```sh
excalidraw-codex share product-map.excalidraw --dry-run
```

不带 `--dry-run` 时，`share` 会把加密后的 payload 上传到 Excalidraw 的 JSON store。普通编辑、MCP 绘图、导出、快照和本地文件都留在本机。

## Agent 和 MCP 配置

大多数情况下，`npm run setup` 已经够用。它会在可用时安装 Skill，并写好 MCP 配置片段。

如果需要手动配置 Agent，可以输出配置片段：

```sh
excalidraw-codex mcp-config --json
```

MCP server 命令是：

```sh
excalidraw-codex mcp
```

MCP 工具刻意保持在工作流层级：打开画布、读取上下文、创建或修改视图、回看结果、创建快照、恢复快照、导出，以及从 Mermaid 创建画布。

## 安装选项

只安装到 Codex：

```sh
npm run setup -- --agents codex
```

只安装到 Claude Code：

```sh
npm run setup -- --agents claude
```

指定场景和导出文件的保存位置：

```sh
npm run setup -- --workspace ~/Codex-Excalidraw --artifacts ~/Codex-Excalidraw/artifacts/excalidraw
```

跳过可选步骤：

```sh
npm run setup -- --skip-playwright
npm run setup -- --skip-link
```

安装时运行烟测：

```sh
npm run setup -- --verify
```

## Libraries

仓库自带一个可选的 Excalidraw library registry，里面有 wireframe、决策控件、商业画布和数据可视化组件。

搜索本地 libraries：

```sh
excalidraw-codex library list
excalidraw-codex library search "wireframe"
excalidraw-codex library select "mobile onboarding flow"
```

只有在你选定某个公共 library 后再安装：

```sh
excalidraw-codex library remote-search "kanban"
excalidraw-codex library install <official-id-or-source>
```

已安装的 libraries 会在工作台启动时加载到 Excalidraw 的 Library 面板。

## 配置

setup 会写入本地配置：

```text
~/.codex-excalidraw/config.json
```

常用环境变量：

```sh
export EXCALIDRAW_CODEX_HOME=~/Codex-Excalidraw
export EXCALIDRAW_CODEX_ARTIFACTS_DIR=~/Codex-Excalidraw/artifacts/excalidraw
export EXCALIDRAW_CODEX_CONFIG_DIR=~/.codex-excalidraw
export EXCALIDRAW_CODEX_FONT=Nunito
export EXCALIDRAW_CODEX_CANVAS_BACKGROUND="#f8f9fa"
export EXCALIDRAW_CODEX_SNAPSHOT_LIMIT=80
```

## 开发

```sh
npm install
npm run build
npm run test:mcp
npm run test:live
npm run verify
npm run dev
```

`npm run verify` 会运行生产构建、MCP 烟测和 live-browser 烟测。

## 仓库卫生

这个仓库应该发布工具本身，不应该提交本地工作状态。

不要提交：

- `artifacts/excalidraw/` 下生成的画布和导出图；
- `dist/` 和 `node_modules/`；
- 本地 `.env` 文件；
- `AGENTS.md`、`CLAUDE.md` 等本地 Agent 指令；
- 私有笔记、草稿、计划文档或讨论记录。

## License

MIT
