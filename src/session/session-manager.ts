import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';

import { createBrowserResources } from '../surface/playwright/browser-resources.js';

export type SessionState = 'CREATED' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'FAILED';

export type SessionOwner = 'NONE' | 'DISCOVERY' | 'REPLAY' | 'HUMAN';

export type ActiveSessionOwner = Exclude<SessionOwner, 'NONE'>;

export type SessionFailureReason =
  'BROWSER_DISCONNECTED' | 'CONTEXT_CLOSED' | 'PAGE_CLOSED' | 'SESSION_FAILURE';

export type SessionManagerErrorCode =
  | 'INVALID_SESSION_ID'
  | 'INVALID_STATE'
  | 'INVALID_OWNER'
  | 'OWNERSHIP_CONFLICT'
  | 'OWNERSHIP_MISMATCH'
  | 'HUMAN_CONTROL_ACTIVE'
  | 'RESOURCE_UNAVAILABLE';

export class SessionManagerError extends Error {
  constructor(
    readonly code: SessionManagerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionManagerError';
  }
}

export interface SessionManagerCreateOptions {
  readonly sessionId?: string;
  readonly headed?: boolean;
  readonly timeoutMs?: number;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly state: SessionState;
  readonly owner: SessionOwner;
  readonly failureReason: SessionFailureReason | null;
}

/**
 * A short-lived view of resources owned by SessionManager.
 * Callers must obtain a new view after every state or ownership transition.
 */
export interface SessionAccess {
  readonly sessionId: string;
  readonly owner: ActiveSessionOwner;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * Owns one live browser session and its exclusive actor ownership.
 *
 * PAUSED means automation is paused; browser resources remain alive.
 * Human access is valid only while PAUSED.
 * Discovery and replay access are valid only while ACTIVE.
 */
export class SessionManager {
  readonly sessionId: string;

  private readonly browser: Browser;
  private readonly context: BrowserContext;
  private readonly page: Page;

  private currentState: SessionState = 'CREATED';
  private currentOwner: SessionOwner = 'NONE';
  private currentFailureReason: SessionFailureReason | null = null;

  private closingResources = false;

  private readonly onBrowserDisconnected = () => {
    this.resourceFailed('BROWSER_DISCONNECTED');
  };

  private readonly onContextClosed = () => {
    this.resourceFailed('CONTEXT_CLOSED');
  };

  private readonly onPageClosed = () => {
    this.resourceFailed('PAGE_CLOSED');
  };

  private constructor(sessionId: string, browser: Browser, context: BrowserContext, page: Page) {
    this.sessionId = sessionId;
    this.browser = browser;
    this.context = context;
    this.page = page;

    browser.on('disconnected', this.onBrowserDisconnected);

    context.on('close', this.onContextClosed);

    page.on('close', this.onPageClosed);
  }

  static async create(options: SessionManagerCreateOptions = {}): Promise<SessionManager> {
    const sessionId = options.sessionId ?? randomUUID();

    if (sessionId.trim().length === 0) {
      throw new SessionManagerError('INVALID_SESSION_ID', 'Session ID must not be empty');
    }

    const resources = await createBrowserResources({
      ...(options.headed === undefined ? {} : { headed: options.headed }),

      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });

    return new SessionManager(sessionId, resources.browser, resources.context, resources.page);
  }

  get state(): SessionState {
    return this.currentState;
  }

  get owner(): SessionOwner {
    return this.currentOwner;
  }

  snapshot(): SessionSnapshot {
    return Object.freeze({
      sessionId: this.sessionId,
      state: this.currentState,
      owner: this.currentOwner,
      failureReason: this.currentFailureReason,
    });
  }

  activate(): void {
    this.requireState('CREATED');
    this.requireResources();

    this.currentState = 'ACTIVE';
  }

  pause(requestedBy: SessionOwner): void {
    this.requireState('ACTIVE');
    this.requireOwner(requestedBy);

    this.currentState = 'PAUSED';
  }

  resume(requestedBy: SessionOwner): void {
    this.requireState('PAUSED');
    this.requireOwner(requestedBy);

    if (this.currentOwner === 'HUMAN') {
      throw new SessionManagerError(
        'HUMAN_CONTROL_ACTIVE',
        'Transfer or release human ownership before resuming automation',
      );
    }

    this.requireResources();
    this.currentState = 'ACTIVE';
  }

  acquireOwnership(owner: ActiveSessionOwner): void {
    this.requireUsableState();

    if (this.currentOwner !== 'NONE') {
      throw new SessionManagerError(
        'OWNERSHIP_CONFLICT',
        `Session is already owned by ${this.currentOwner}`,
      );
    }

    if (owner === 'HUMAN' && this.currentState !== 'PAUSED') {
      throw new SessionManagerError('INVALID_STATE', 'Human ownership requires a paused session');
    }

    this.currentOwner = owner;
  }

  transferOwnership(from: ActiveSessionOwner, to: ActiveSessionOwner): void {
    this.requireState('PAUSED');
    this.requireOwner(from);

    if (from === to) {
      throw new SessionManagerError('INVALID_OWNER', 'Ownership transfer requires a new owner');
    }

    this.currentOwner = to;
  }

  releaseOwnership(owner: ActiveSessionOwner): void {
    this.requireUsableState();
    this.requireOwner(owner);

    this.currentOwner = 'NONE';
  }

  /**
   * Returns resources only to the current owner.
   *
   * The future coordinator must obtain access again before every
   * automation operation.
   */
  access(owner: ActiveSessionOwner): SessionAccess {
    this.requireOwner(owner);
    this.requireResources();

    if (owner === 'HUMAN') {
      if (this.currentState !== 'PAUSED') {
        throw new SessionManagerError('INVALID_STATE', 'Human access requires a paused session');
      }
    } else if (this.currentState !== 'ACTIVE') {
      throw new SessionManagerError(
        'INVALID_STATE',
        'Automation access requires an active session',
      );
    }

    return Object.freeze({
      sessionId: this.sessionId,
      owner,
      browser: this.browser,
      context: this.context,
      page: this.page,
    });
  }

  /**
   * Marks a terminal browser/session failure.
   *
   * Human escalation uses pause/transfer rather than FAILED.
   */
  async fail(reason: SessionFailureReason = 'SESSION_FAILURE'): Promise<void> {
    if (this.currentState === 'CLOSED') {
      throw new SessionManagerError('INVALID_STATE', 'A closed session cannot fail');
    }

    if (this.currentState === 'FAILED') {
      return;
    }

    this.currentState = 'FAILED';
    this.currentOwner = 'NONE';
    this.currentFailureReason = reason;

    await this.closeOwnedResources();
  }

  async close(): Promise<void> {
    if (this.currentState === 'CLOSED') {
      return;
    }

    this.currentState = 'CLOSED';
    this.currentOwner = 'NONE';

    await this.closeOwnedResources();
    this.detachResourceListeners();
  }

  private requireState(expected: SessionState): void {
    if (this.currentState !== expected) {
      throw new SessionManagerError(
        'INVALID_STATE',
        `Expected session state ${expected}, received ${this.currentState}`,
      );
    }
  }

  private requireUsableState(): void {
    if (this.currentState !== 'ACTIVE' && this.currentState !== 'PAUSED') {
      throw new SessionManagerError(
        'INVALID_STATE',
        `Session state ${this.currentState} does not accept ownership changes`,
      );
    }
  }

  private requireOwner(expected: SessionOwner): void {
    if (this.currentOwner !== expected) {
      throw new SessionManagerError(
        'OWNERSHIP_MISMATCH',
        `Expected owner ${expected}, received ${this.currentOwner}`,
      );
    }
  }

  private requireResources(): void {
    if (!this.browser.isConnected() || this.context.pages().length === 0 || this.page.isClosed()) {
      throw new SessionManagerError(
        'RESOURCE_UNAVAILABLE',
        'Session browser resources are unavailable',
      );
    }
  }

  private resourceFailed(reason: SessionFailureReason): void {
    if (this.closingResources || this.currentState === 'CLOSED' || this.currentState === 'FAILED') {
      return;
    }

    this.currentState = 'FAILED';
    this.currentOwner = 'NONE';
    this.currentFailureReason = reason;
    this.closingResources = true;

    void this.browser.close().finally(() => {
      this.closingResources = false;
    });
  }

  private async closeOwnedResources(): Promise<void> {
    this.closingResources = true;

    try {
      await this.browser.close();
    } finally {
      this.closingResources = false;
    }
  }

  private detachResourceListeners(): void {
    this.browser.off('disconnected', this.onBrowserDisconnected);

    this.context.off('close', this.onContextClosed);

    this.page.off('close', this.onPageClosed);
  }
}
