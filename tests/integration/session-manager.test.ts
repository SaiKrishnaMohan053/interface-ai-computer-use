import { afterEach, describe, expect, it } from 'vitest';

import { SessionManager, SessionManagerError } from '../../src/session/index.js';

describe('SessionManager', () => {
  let session: SessionManager | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  async function create(): Promise<SessionManager> {
    session = await SessionManager.create({
      sessionId: 'session-test',
      headed: process.env.HEADED === '1',
    });

    return session;
  }

  function expectSessionError(operation: () => unknown, code: SessionManagerError['code']): void {
    try {
      operation();
      throw new Error('Expected operation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionManagerError);
      expect(error).toMatchObject({ code });
    }
  }

  it('creates and owns one isolated browser context and page', async () => {
    const manager = await create();

    expect(manager.snapshot()).toEqual({
      sessionId: 'session-test',
      state: 'CREATED',
      owner: 'NONE',
      failureReason: null,
    });

    expectSessionError(() => manager.access('DISCOVERY'), 'OWNERSHIP_MISMATCH');
  });

  it('activates, acquires and releases exclusive ownership', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('DISCOVERY');

    expect(manager.state).toBe('ACTIVE');
    expect(manager.owner).toBe('DISCOVERY');
    expect(manager.access('DISCOVERY').page.isClosed()).toBe(false);

    expectSessionError(() => manager.acquireOwnership('REPLAY'), 'OWNERSHIP_CONFLICT');

    expectSessionError(() => manager.releaseOwnership('REPLAY'), 'OWNERSHIP_MISMATCH');

    manager.releaseOwnership('DISCOVERY');
    expect(manager.owner).toBe('NONE');

    manager.acquireOwnership('REPLAY');
    expect(manager.owner).toBe('REPLAY');
  });

  it('rejects invalid state transitions', async () => {
    const manager = await create();

    expectSessionError(() => manager.pause('NONE'), 'INVALID_STATE');

    expectSessionError(() => manager.acquireOwnership('DISCOVERY'), 'INVALID_STATE');

    manager.activate();

    expectSessionError(() => manager.activate(), 'INVALID_STATE');

    expectSessionError(() => manager.resume('NONE'), 'INVALID_STATE');

    expectSessionError(() => manager.acquireOwnership('HUMAN'), 'INVALID_STATE');
  });

  it('preserves the same BrowserContext and Page across pause and resume', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('DISCOVERY');

    const before = manager.access('DISCOVERY');

    await before.context.addCookies([
      {
        name: 'session-marker',
        value: 'preserved',
        url: 'http://example.test',
      },
    ]);

    manager.pause('DISCOVERY');

    expect(manager.state).toBe('PAUSED');

    expectSessionError(() => manager.access('DISCOVERY'), 'INVALID_STATE');

    manager.resume('DISCOVERY');

    const after = manager.access('DISCOVERY');

    expect(after.browser).toBe(before.browser);
    expect(after.context).toBe(before.context);
    expect(after.page).toBe(before.page);

    expect(await after.context.cookies('http://example.test')).toContainEqual(
      expect.objectContaining({
        name: 'session-marker',
        value: 'preserved',
      }),
    );
  });

  it('transfers paused ownership to a human and back to automation', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('DISCOVERY');

    const originalPage = manager.access('DISCOVERY').page;

    expectSessionError(() => manager.transferOwnership('DISCOVERY', 'HUMAN'), 'INVALID_STATE');

    manager.pause('DISCOVERY');
    manager.transferOwnership('DISCOVERY', 'HUMAN');

    expect(manager.snapshot()).toMatchObject({
      state: 'PAUSED',
      owner: 'HUMAN',
    });

    expect(manager.access('HUMAN').page).toBe(originalPage);

    expectSessionError(() => manager.access('DISCOVERY'), 'OWNERSHIP_MISMATCH');

    expectSessionError(() => manager.resume('HUMAN'), 'HUMAN_CONTROL_ACTIVE');

    manager.transferOwnership('HUMAN', 'REPLAY');

    manager.resume('REPLAY');

    expect(manager.state).toBe('ACTIVE');
    expect(manager.owner).toBe('REPLAY');
    expect(manager.access('REPLAY').page).toBe(originalPage);
  });

  it('keeps the same live page paused while transferring control to HUMAN', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('DISCOVERY');

    const automationAccess = manager.access('DISCOVERY');
    const originalContext = automationAccess.context;
    const originalPage = automationAccess.page;
    const originalUrl = originalPage.url();

    manager.pause('DISCOVERY');

    expect(manager.snapshot()).toMatchObject({
      state: 'PAUSED',
      owner: 'DISCOVERY',
    });

    expect(originalPage.isClosed()).toBe(false);
    expect(originalPage.url()).toBe(originalUrl);

    manager.transferOwnership('DISCOVERY', 'HUMAN');

    expect(manager.snapshot()).toMatchObject({
      state: 'PAUSED',
      owner: 'HUMAN',
    });

    const humanAccess = manager.access('HUMAN');

    expect(humanAccess.context).toBe(originalContext);
    expect(humanAccess.page).toBe(originalPage);
    expect(humanAccess.page.url()).toBe(originalUrl);

    expectSessionError(() => manager.access('DISCOVERY'), 'OWNERSHIP_MISMATCH');

    expectSessionError(() => manager.access('REPLAY'), 'OWNERSHIP_MISMATCH');
  });

  it('can release and reacquire ownership while paused', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('DISCOVERY');
    manager.pause('DISCOVERY');
    manager.releaseOwnership('DISCOVERY');

    expect(manager.owner).toBe('NONE');

    manager.acquireOwnership('HUMAN');

    expect(manager.owner).toBe('HUMAN');
    expect(manager.access('HUMAN').context).toBeDefined();
  });

  it('closes resources and releases ownership idempotently', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('REPLAY');

    const page = manager.access('REPLAY').page;

    await manager.close();
    await manager.close();

    expect(manager.snapshot()).toMatchObject({
      state: 'CLOSED',
      owner: 'NONE',
    });

    expect(page.isClosed()).toBe(true);

    expectSessionError(() => manager.access('REPLAY'), 'OWNERSHIP_MISMATCH');
  });

  it('marks an explicit terminal failure and closes resources', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('DISCOVERY');

    const page = manager.access('DISCOVERY').page;

    await manager.fail('SESSION_FAILURE');

    expect(manager.snapshot()).toEqual({
      sessionId: 'session-test',
      state: 'FAILED',
      owner: 'NONE',
      failureReason: 'SESSION_FAILURE',
    });

    expect(page.isClosed()).toBe(true);

    expectSessionError(() => manager.activate(), 'INVALID_STATE');
  });

  it('moves to FAILED when its page closes unexpectedly', async () => {
    const manager = await create();

    manager.activate();
    manager.acquireOwnership('DISCOVERY');

    const page = manager.access('DISCOVERY').page;

    await page.close();

    expect(manager.snapshot()).toEqual({
      sessionId: 'session-test',
      state: 'FAILED',
      owner: 'NONE',
      failureReason: 'PAGE_CLOSED',
    });
  });
});
