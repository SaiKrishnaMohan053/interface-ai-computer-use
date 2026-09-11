import { describe, expect, it } from 'vitest';

import {
  MODEL_CONTEXT_REDACTED_VALUE,
  projectObservationForAgent,
  sanitizeModelContextValue,
} from '../../src/discovery/index.js';

import { REDACTED_VALUE, sanitizeForPersistence } from '../../src/security/index.js';

import type { SurfaceObservation } from '../../src/surface/index.js';

const surfaceObservation = {
  sessionId: 'session-secret',
  surfaceId: 'surface-secret',
  observationId: 'observation-4',
  capturedAt: '2026-09-11T15:00:00.000Z',

  location: {
    kind: 'web',
    url: 'https://bank.test/member/alex?scenario=normal&access_token=secret-token',
    title: 'Alex Morgan Accounts',
  },

  visibleText: `
    Alex Morgan
    Alex Morgan
    Accounts

    Account Type
    Current Balance
    Savings
    $12,840.50
  `,

  controls: [
    {
      controlId: 'control-0',
      name: 'Savings',
      role: 'link',
      visible: true,
      enabled: true,
      bounds: {
        x: 100,
        y: 200,
        width: 120,
        height: 40,
      },
      kind: 'link',
      destination: 'https://bank.test/member/alex/savings?token=link-secret',
    },
    {
      controlId: 'control-1',
      name: 'Password',
      role: 'textbox',
      visible: true,
      enabled: true,
      bounds: null,
      kind: 'text_input',
      inputType: 'password',
      value: 'must-not-be-exposed',
      readOnly: false,
    },
    {
      controlId: 'control-hidden',
      name: 'Hidden Admin Action',
      role: 'button',
      visible: false,
      enabled: true,
      bounds: null,
      kind: 'button',
    },
  ],

  dialogs: [
    {
      kind: 'surface',
      dialogId: 'service-notice',
      presentation: 'interstitial',
      title: 'Service Notice',
      text: 'Please continue to view the requested account.',
      controlIds: ['control-0'],
    },
  ],

  loading: 'complete',

  truncated: {
    visibleText: false,
    controls: false,
  },
} satisfies SurfaceObservation;

describe('observation projector', () => {
  it('projects a surface observation through an explicit allowlist', () => {
    const result = projectObservationForAgent({
      goal: "Read Alex Morgan's Savings balance",
      step: 4,
      observation: surfaceObservation,
      extractedValues: {
        memberId: 'alex',
        savingsBalance: '$12,840.50',
      },
      contextHints: {
        frames: ['Top-level document'],
        regions: ['Accounts table'],
      },
      controlContexts: {
        'control-0': 'Accounts table row for Savings',
      },
    });

    expect(result.visibleTextSummary).toContain('Alex Morgan');
    expect(result.visibleTextSummary).toContain('$12,840.50');
    expect(result.extractedValues).toEqual({
      memberId: 'alex',
      savingsBalance: '$12,840.50',
    });

    expect(result.controls).toHaveLength(2);
    expect(result.controls[0]).toMatchObject({
      kind: 'link',
      accessibleName: 'Savings',
      context: 'Accounts table row for Savings',
    });

    expect(result.controls[1]).toMatchObject({
      kind: 'text_input',
      value: null,
    });
  });

  it('never exposes surface scope, bounds, or control IDs', () => {
    const result = projectObservationForAgent({
      goal: 'Read the balance',
      step: 1,
      observation: surfaceObservation,
    });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('surface-secret');
    expect(serialized).not.toContain('control-0');
    expect(serialized).not.toContain('"bounds"');
    expect(serialized).not.toContain('"sessionId"');
    expect(serialized).not.toContain('"surfaceId"');
  });

  it('removes secrets from URLs and extracted model context', () => {
    const result = projectObservationForAgent({
      goal: 'Read the account',
      step: 2,
      observation: surfaceObservation,
      extractedValues: {
        memberId: 'alex',
        savingsBalance: '$12,840.50',
        accessToken: 'extracted-secret-token',
        details: {
          authorization: 'Bearer nested-secret',
          accountType: 'Savings',
        },
      },
    });

    const serialized = JSON.stringify(result);

    expect(result.location.kind).toBe('web');

    if (result.location.kind === 'web') {
      expect(result.location.url).toContain('scenario=normal');
      expect(result.location.url).not.toContain('access_token');
      expect(result.location.url).not.toContain('secret-token');
    }

    expect(serialized).not.toContain('extracted-secret-token');
    expect(serialized).not.toContain('nested-secret');
    expect(serialized).toContain('$12,840.50');
    expect(serialized).toContain('Alex Morgan');
  });

  it('includes dialogs without exposing their internal control IDs', () => {
    const result = projectObservationForAgent({
      goal: 'Continue through the service notice',
      step: 3,
      observation: surfaceObservation,
    });

    expect(result.dialogs).toEqual([
      {
        kind: 'surface',
        dialogId: 'service-notice',
        presentation: 'interstitial',
        title: 'Service Notice',
        text: 'Please continue to view the requested account.',
        controlNames: ['Savings'],
      },
    ]);

    expect(JSON.stringify(result.dialogs)).not.toContain('control-0');
  });

  it('compacts visible text while preserving table content', () => {
    const result = projectObservationForAgent({
      goal: 'Read the balance',
      step: 4,
      observation: surfaceObservation,
    });

    expect(result.visibleTextSummary).toBe(
      ['Alex Morgan', 'Accounts', 'Account Type', 'Current Balance', 'Savings', '$12,840.50'].join(
        '\n',
      ),
    );
  });

  it('sanitizes recent action, condition, and error context', () => {
    const result = projectObservationForAgent({
      goal: 'Read the account',
      step: 5,
      observation: surfaceObservation,

      recentAction: {
        status: 'success',
        actionKind: 'click',
        summary: 'Opened Savings with authorization: Bearer action-secret',
        output: {
          savingsBalance: '$12,840.50',
          token: 'output-secret',
        },
      },

      recentCondition: {
        status: 'passed',
        conditionKind: 'text_present',
        summary: 'Savings balance is visible',
      },

      recentError: {
        code: 'TRANSIENT_ERROR',
        message: 'cookie=session-secret-value',
        recoverable: true,
      },
    });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('action-secret');
    expect(serialized).not.toContain('output-secret');
    expect(serialized).not.toContain('session-secret-value');
    expect(serialized).toContain(MODEL_CONTEXT_REDACTED_VALUE);
    expect(serialized).toContain('$12,840.50');
  });

  it('keeps model-context and persistence policies distinct', () => {
    const source = {
      memberId: 'alex',
      savingsBalance: '$12,840.50',
    };

    expect(sanitizeModelContextValue(source)).toEqual(source);

    expect(sanitizeForPersistence(source).value).toEqual({
      memberId: REDACTED_VALUE,
      savingsBalance: '$12,840.50',
    });
  });

  it('discloses projector-level truncation', () => {
    const result = projectObservationForAgent({
      goal: 'Read the account',
      step: 6,
      observation: surfaceObservation,
      policy: {
        maxVisibleTextLength: 20,
        maxControls: 1,
      },
    });

    expect(result.visibleTextSummary.length).toBeLessThanOrEqual(20);
    expect(result.controls).toHaveLength(1);
    expect(result.truncated).toEqual({
      visibleText: true,
      controls: true,
    });
  });
});
