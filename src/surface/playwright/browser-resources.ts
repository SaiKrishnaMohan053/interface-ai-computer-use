import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

export interface BrowserResources {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  close(): Promise<void>;
}

/**
 * Resource factory for the future Session Manager.
 * Ownership decisions do not belong here.
 */
export async function createBrowserResources(
  options: { headed?: boolean; timeoutMs?: number } = {},
): Promise<BrowserResources> {
  const timeout = options.timeoutMs ?? 10_000;

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('Invalid browser timeout');
  }

  const browser = await chromium.launch({
    headless: !options.headed,
    timeout,
  });

  try {
    const context = await browser.newContext({
      acceptDownloads: false,
    });

    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(timeout);

    const page = await context.newPage();

    return {
      browser,
      context,
      page,
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Diagnostic tracing is ONLY for isolated synthetic fixtures.
 *
 * Playwright may persist raw action metadata internally.
 * The declaration below is a caller precondition, not a sanitizer.
 * Never enable this helper for credentials or real customer data.
 */
export async function startSyntheticTrace(
  context: BrowserContext,
  declaration: { dataClassification: 'synthetic-fixture-only' },
): Promise<{
  stop(path: string): Promise<void>;
  discard(): Promise<void>;
}> {
  if (declaration.dataClassification !== 'synthetic-fixture-only') {
    throw new Error('Tracing requires a synthetic fixture');
  }

  await context.tracing.start({
    screenshots: false,
    snapshots: false,
    sources: false,
  });

  return {
    stop: (path) => context.tracing.stop({ path }),
    discard: () => context.tracing.stop(),
  };
}
