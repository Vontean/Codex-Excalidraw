import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { browserChannel, browserExecutablePath } from "./config.mjs";

export const BROWSER_EXECUTABLE_ENV = "EXCALIDRAW_CODEX_BROWSER_EXECUTABLE";
export const BROWSER_CHANNEL_ENV = "EXCALIDRAW_CODEX_BROWSER_CHANNEL";

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

async function exists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function systemBrowserCandidates() {
  if (process.platform === "darwin") {
    return [
      { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { name: "Chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
      { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" }
    ];
  }

  if (process.platform === "win32") {
    const prefixes = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA
    ].filter(Boolean);
    return prefixes.flatMap((prefix) => [
      { name: "Google Chrome", path: path.join(prefix, "Google", "Chrome", "Application", "chrome.exe") },
      { name: "Microsoft Edge", path: path.join(prefix, "Microsoft", "Edge", "Application", "msedge.exe") }
    ]);
  }

  return [
    { name: "Google Chrome", path: "/usr/bin/google-chrome" },
    { name: "Google Chrome Stable", path: "/usr/bin/google-chrome-stable" },
    { name: "Chromium", path: "/usr/bin/chromium" },
    { name: "Chromium Browser", path: "/usr/bin/chromium-browser" },
    { name: "Microsoft Edge", path: "/usr/bin/microsoft-edge" }
  ];
}

export async function findBrowserRuntime() {
  const configuredExecutable = expandHome(browserExecutablePath);
  if (configuredExecutable && await exists(configuredExecutable)) {
    return {
      available: true,
      source: "configured-executable",
      executablePath: configuredExecutable,
      label: `configured browser executable (${configuredExecutable})`
    };
  }

  if (browserChannel) {
    return {
      available: true,
      source: "configured-channel",
      channel: browserChannel,
      label: `configured Playwright browser channel (${browserChannel})`
    };
  }

  try {
    const playwrightExecutable = chromium.executablePath();
    if (await exists(playwrightExecutable)) {
      return {
        available: true,
        source: "playwright-cache",
        executablePath: playwrightExecutable,
        label: `Playwright browser cache (${playwrightExecutable})`
      };
    }
  } catch {
    // If Playwright cannot compute its expected path, continue to system browsers.
  }

  for (const candidate of systemBrowserCandidates()) {
    if (await exists(candidate.path)) {
      return {
        available: true,
        source: "system-browser",
        name: candidate.name,
        executablePath: candidate.path,
        label: `${candidate.name} (${candidate.path})`
      };
    }
  }

  return {
    available: false,
    source: "missing",
    label: "no Playwright Chromium cache or system Chrome/Chromium browser found"
  };
}

export async function getBrowserRuntimeStatus() {
  return findBrowserRuntime();
}

export async function launchRenderBrowser(options = {}) {
  const runtime = await findBrowserRuntime();
  if (!runtime.available) {
    throw new Error([
      "No browser runtime is available for Excalidraw rendering.",
      `Set ${BROWSER_EXECUTABLE_ENV}=/path/to/chrome, set ${BROWSER_CHANNEL_ENV}=chrome, install Chrome/Chromium, or run: npx playwright install chromium`
    ].join(" "));
  }

  const launchOptions = { ...options };
  if (runtime.channel) {
    launchOptions.channel = runtime.channel;
  } else if (runtime.executablePath) {
    launchOptions.executablePath = runtime.executablePath;
  }

  return chromium.launch(launchOptions);
}
