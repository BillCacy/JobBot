import { chromium, type BrowserContext, type Page } from "playwright";
import { BROWSER_PROFILE_DIR } from "../store.js";

let context: BrowserContext | undefined;
const pages = new Map<string, Page>();

/**
 * A real browser install is less likely than Playwright's bundled Chromium to trip sites' extra verification
 * when the user signs in. Edge ships with Windows; JOBBOT_BROWSER_CHANNEL can pick another ("chrome", or "chromium" for bundled).
 */
const CHANNEL = process.env.JOBBOT_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chrome");

async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  // Persistent profile so sign-ins survive restarts; headed so the user can watch and step in.
  const options = {
    headless: process.env.JOBBOT_HEADLESS === "1",
    viewport: { width: 1280, height: 900 },
  };
  try {
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
      ...options,
      ...(CHANNEL === "chromium" ? {} : { channel: CHANNEL }),
    });
  } catch {
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, options);
  }
  context.on("close", () => {
    context = undefined;
    pages.clear();
  });
  return context;
}

function track(key: string, page: Page) {
  pages.set(key, page);
  page.on("close", () => {
    if (pages.get(key) === page) pages.delete(key);
  });
  // "Apply on company site" links often open a new tab; follow it so later scans see the form.
  page.on("popup", (popup) => track(key, popup));
}

/** Opens (or reuses) the tab for a key (an application id or "login:<board>") and navigates it to the URL. */
export async function openPage(key: string, url: string): Promise<Page> {
  let page = pages.get(key);
  if (!page || page.isClosed()) {
    page = await (await getContext()).newPage();
    track(key, page);
  }
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.bringToFront();
  return page;
}

export const openApplicationPage = openPage;

export function getApplicationPage(appId: string): Page {
  const page = pages.get(appId);
  if (!page || page.isClosed()) {
    throw new Error(`No open browser tab for application ${appId}. Call application_prepare again to reopen it.`);
  }
  return page;
}

export async function closePage(key: string) {
  const page = pages.get(key);
  pages.delete(key);
  if (page && !page.isClosed()) await page.close();
}

export const closeApplicationPage = closePage;

/** Loads a URL in a throwaway tab of the shared (signed-in) browser and returns where it ended up. */
export async function probeUrl(url: string): Promise<{ finalUrl: string; title: string }> {
  const page = await (await getContext()).newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return { finalUrl: page.url(), title: await page.title() };
  } finally {
    await page.close();
  }
}

export async function shutdownBrowser() {
  await context?.close().catch(() => {});
}
