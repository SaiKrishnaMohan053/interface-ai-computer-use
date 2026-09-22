import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

import { SessionManager, SessionManagerError } from '../../src/session/index.js';

describe('human operation of the same live browser', () => {
  let session: SessionManager | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('lets HUMAN operate the exact same BrowserContext, Page, navigation state, form state, and live session', async () => {
    session = await SessionManager.create({
      sessionId: 'session-human-live-browser',
      headed: process.env.HEADED === '1',
    });

    session.activate();
    session.acquireOwnership('DISCOVERY');

    const automationAccess = session.access('DISCOVERY');

    await automationAccess.page.setContent(`
      <!doctype html>
      <html>
        <body>
          <h1>Review savings sub-account</h1>
          <form>
            <label>
              Nickname
              <input
                id="nickname"
                name="nickname"
                value=""
              />
            </label>

            <label>
              Opening amount
              <input
                id="opening-amount"
                name="opening-amount"
                value=""
              />
            </label>

            <button
              id="final-submit"
              type="button"
            >
              Create account
            </button>
          </form>
        </body>
      </html>
    `);

    await automationAccess.page.locator('#nickname').fill('Emergency Savings');

    await automationAccess.page.locator('#opening-amount').fill('250.00');

    const browserBefore = automationAccess.browser;

    const contextBefore = automationAccess.context;

    const pageBefore = automationAccess.page;

    const urlBefore = pageBefore.url();

    const nicknameBefore = await pageBefore.locator('#nickname').inputValue();

    const amountBefore = await pageBefore.locator('#opening-amount').inputValue();

    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const coordinatedContext = {
      runId: 'run-human-live-browser',
      mode: 'DISCOVERY',
      sessionManager: session,
    } as unknown as CoordinatedRunContext<unknown>;

    const intervention = await controller.createAndPause({
      id: 'intervention-human-live-browser',
      context: coordinatedContext,
      source: 'DISCOVERY',
      goal: 'Prepare a new savings sub-account and stop before the irreversible final submit',
      stepId: 'review-final-submit',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final account creation requires a human operator',
      observedState: 'Review screen is open with reversible form fields already populated',
      evidenceRefs: [],
    });

    expect(intervention.status).toBe('WAITING_FOR_HUMAN');

    expect(session.state).toBe('PAUSED');

    expect(session.owner).toBe('DISCOVERY');

    expect(registry.get(intervention.id)).toBe(coordinatedContext);

    expect(() => session!.access('DISCOVERY')).toThrow(SessionManagerError);

    await controller.acquireHumanControl({
      interventionId: intervention.id,
      context: coordinatedContext,
      acquisitionId: 'acquisition-human-live-browser',
      operatorId: 'operator-test',
    });

    expect(session.state).toBe('PAUSED');

    expect(session.owner).toBe('HUMAN');

    const humanAccess = session.access('HUMAN');

    /*
     * Identity continuity:
     * absolutely no replacement browser, context, or page.
     */
    expect(humanAccess.browser).toBe(browserBefore);

    expect(humanAccess.context).toBe(contextBefore);

    expect(humanAccess.page).toBe(pageBefore);

    /*
     * Navigation continuity:
     * the human receives the page exactly where automation stopped.
     */
    expect(humanAccess.page.url()).toBe(urlBefore);

    /*
     * Form continuity:
     * reversible automation work remains present after handoff.
     */
    expect(await humanAccess.page.locator('#nickname').inputValue()).toBe(nicknameBefore);

    expect(await humanAccess.page.locator('#opening-amount').inputValue()).toBe(amountBefore);

    /*
     * Real human-side browser action.
     *
     * This intentionally uses HUMAN-authorized access to the
     * already-live page. No replay, navigation reset, or new
     * BrowserContext/Page is created.
     */
    await humanAccess.page.locator('#nickname').fill('Human Confirmed Savings');

    await humanAccess.page.evaluate(() => {
      document.body.dataset.humanAction = 'confirmed';
    });

    /*
     * The original automation-held page reference immediately
     * sees the human mutation because it is literally the same Page.
     */
    expect(await pageBefore.locator('#nickname').inputValue()).toBe('Human Confirmed Savings');

    expect(await pageBefore.evaluate(() => document.body.dataset.humanAction)).toBe('confirmed');

    expect(pageBefore.isClosed()).toBe(false);

    expect(contextBefore.pages()).toContain(pageBefore);

    expect(contextBefore.pages()).toHaveLength(1);
  });
});
