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

  it('preserves the exact BrowserContext, Page, navigation state, and human mutation across REPLAY -> HUMAN -> REPLAY', async () => {
    session = await SessionManager.create({
      sessionId: 'session-human-live-browser',
      headed: process.env.HEADED === '1',
    });

    session.activate();
    session.acquireOwnership('REPLAY');

    const replayAccessBefore = session.access('REPLAY');

    await replayAccessBefore.page.setContent(`
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

    /*
     * Establish deterministic REPLAY-owned state before handoff.
     */
    await replayAccessBefore.page.locator('#nickname').fill('Emergency Savings');
    await replayAccessBefore.page.locator('#opening-amount').fill('250.00');

    const browserBefore = replayAccessBefore.browser;
    const contextBefore = replayAccessBefore.context;
    const pageBefore = replayAccessBefore.page;
    const urlBefore = pageBefore.url();

    const nicknameBefore = await pageBefore.locator('#nickname').inputValue();
    const amountBefore = await pageBefore.locator('#opening-amount').inputValue();

    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),
    });

    const registry = new LiveInterventionRegistry();
    const controller = new InterventionController(manager, registry);

    const coordinatedContext = {
      runId: 'run-human-live-browser',
      mode: 'REPLAY',
      sessionManager: session,
    } as unknown as CoordinatedRunContext<unknown>;

    const intervention = await controller.createAndPause({
      id: 'intervention-human-live-browser',
      context: coordinatedContext,
      source: 'REPLAY',
      capabilityId: 'prepare_new_savings_subaccount',
      capabilityVersion: '1.0.0',
      stepId: 'review-final-submit',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final account creation requires a human operator.',
      observedState: 'Review screen is open with reversible form fields already populated.',
      evidenceRefs: [],
    });

    expect(intervention.status).toBe('WAITING_FOR_HUMAN');
    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('REPLAY');
    expect(registry.get(intervention.id)).toBe(coordinatedContext);

    /*
     * Paused REPLAY cannot keep using automation access.
     */
    expect(() => session!.access('REPLAY')).toThrow(SessionManagerError);

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
     * 5.37 identity continuity:
     * HUMAN receives the exact browser, context, and page that REPLAY was using.
     */
    expect(humanAccess.browser).toBe(browserBefore);
    expect(humanAccess.context).toBe(contextBefore);
    expect(humanAccess.page).toBe(pageBefore);

    /*
     * Navigation and pre-handoff form state survive control transfer.
     */
    expect(humanAccess.page.url()).toBe(urlBefore);
    expect(await humanAccess.page.locator('#nickname').inputValue()).toBe(nicknameBefore);
    expect(await humanAccess.page.locator('#opening-amount').inputValue()).toBe(amountBefore);

    /*
     * Simulate real operator work in the existing live page.
     */
    await controller.markHumanWorkInProgress(intervention.id);

    await humanAccess.page.locator('#nickname').fill('Human Confirmed Savings');

    await humanAccess.page.evaluate(() => {
      document.body.dataset.humanAction = 'confirmed';
    });

    await controller.recordManualAction({
      interventionId: intervention.id,
      operatorId: 'operator-test',
      summary: 'Human updated the review state before returning control to REPLAY.',
    });

    /*
     * The original pre-handoff Page reference sees the mutation immediately,
     * proving HUMAN did not operate a replacement page.
     */
    expect(await pageBefore.locator('#nickname').inputValue()).toBe('Human Confirmed Savings');
    expect(await pageBefore.evaluate(() => document.body.dataset.humanAction)).toBe('confirmed');

    const resolved = await controller.resumeAutomation({
      interventionId: intervention.id,
      context: coordinatedContext,
      operatorId: 'operator-test',
    });

    expect(resolved.status).toBe('RESOLVED');
    expect(session.state).toBe('ACTIVE');
    expect(session.owner).toBe('REPLAY');

    /*
     * 5.37 resume continuity:
     * REPLAY regains access to the exact same live BrowserContext and Page.
     */
    const replayAccessAfter = session.access('REPLAY');

    expect(replayAccessAfter.browser).toBe(browserBefore);
    expect(replayAccessAfter.context).toBe(contextBefore);
    expect(replayAccessAfter.page).toBe(pageBefore);
    expect(replayAccessAfter.page.url()).toBe(urlBefore);

    /*
     * Human mutations are still present after ownership returns to REPLAY.
     */
    expect(await replayAccessAfter.page.locator('#nickname').inputValue()).toBe(
      'Human Confirmed Savings',
    );

    expect(await replayAccessAfter.page.evaluate(() => document.body.dataset.humanAction)).toBe(
      'confirmed',
    );

    expect(await replayAccessAfter.page.locator('#opening-amount').inputValue()).toBe(amountBefore);

    expect(pageBefore.isClosed()).toBe(false);
    expect(contextBefore.pages()).toContain(pageBefore);
    expect(contextBefore.pages()).toHaveLength(1);

    const stored = await manager.get(intervention.id);

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.action_performed',
      'human.resume_requested',
      'human.control_released',
      'automation.control_restored',
    ]);
  });
});
