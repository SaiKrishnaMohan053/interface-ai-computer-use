import { describe, expect, it } from 'vitest';

import {
  MODEL_CONTEXT_REDACTED_VALUE,
  agentObservationSchema,
  projectObservationForAgent,
} from '../../src/discovery/index.js';

import { REDACTED_VALUE, sanitizeForPersistence } from '../../src/security/index.js';

import type { SurfaceObservation } from '../../src/surface/index.js';

const API_KEY = 'sk-test-projector-secret-123456';

const ACCESS_TOKEN = 'access-token-projector-secret';

const COOKIE = 'session=projector-cookie-secret';

function surfaceObservation(): SurfaceObservation {
  return {
    sessionId: 'session-internal-1',
    surfaceId: 'surface-internal-1',
    observationId: 'observation-7',
    capturedAt: '2026-09-15T12:00:00.000Z',

    location: {
      kind: 'web',
      url:
        `https://user:password@bank.test/member/member-alex-001` +
        `?token=${ACCESS_TOKEN}&view=accounts#private-fragment`,
      title: 'Alex Morgan Accounts',
    },

    visibleText: [
      'Alex Morgan',
      'Accounts',
      'Savings',
      'Current Balance',
      '$12,840.50',
      `API key: ${API_KEY}`,
      `Cookie: ${COOKIE}`,
    ].join('\n'),

    controls: [
      {
        controlId: 'search-control',
        kind: 'button',
        name: 'Search',
        role: 'button',
        visible: true,
        enabled: true,
        bounds: {
          x: 10,
          y: 20,
          width: 100,
          height: 32,
        },
      },

      {
        controlId: 'password-control',
        kind: 'text_input',
        name: 'Password',
        role: 'textbox',
        visible: true,
        enabled: true,
        bounds: {
          x: 10,
          y: 60,
          width: 200,
          height: 32,
        },
        inputType: 'password',
        value: 'password-value-must-not-leak',
        readOnly: false,
      },

      {
        controlId: 'accounts-control',
        kind: 'link',
        name: 'Accounts',
        role: 'link',
        visible: true,
        enabled: true,
        bounds: {
          x: 10,
          y: 100,
          width: 100,
          height: 32,
        },
        destination: `/accounts?access_token=${ACCESS_TOKEN}` + '&tab=savings#private',
      },

      {
        controlId: 'hidden-control',
        kind: 'button',
        name: 'Hidden internal action',
        role: 'button',
        visible: false,
        enabled: true,
        bounds: null,
      },
    ],

    dialogs: [
      {
        kind: 'surface',
        dialogId: 'dialog-1',
        presentation: 'modal',
        title: 'Service Notice',
        text: 'Review this notice before continuing',
        controlIds: ['search-control', 'unknown-control'],
      },

      {
        kind: 'native',
        dialogId: 'native-dialog-1',
        type: 'prompt',
        message: 'Confirm safe navigation',
        defaultValue: `api_key=${API_KEY}`,
      },
    ],

    loading: 'complete',

    truncated: {
      visibleText: false,
      controls: false,
    },
  };
}

function project() {
  /*
   * These extra properties simulate accidental
   * implementation details on an untrusted runtime
   * observation.
   */
  const observation = surfaceObservation() as SurfaceObservation & {
    readonly cookies: string;
    readonly authorization: string;
    readonly browserContext: object;
    readonly page: object;
    readonly locator: object;
    readonly rawDom: string;
  };

  Object.assign(observation, {
    cookies: COOKIE,
    authorization: `Bearer ${ACCESS_TOKEN}`,
    browserContext: {
      internal: true,
    },
    page: {
      internal: true,
    },
    locator: {
      internal: true,
    },
    rawDom: '<html>unfiltered DOM</html>',
  });

  return projectObservationForAgent({
    goal: 'Look up Alex Morgan and return their current savings balance.',

    step: 7,
    observation,

    extractedValues: {
      memberId: 'member-alex-001',
      savingsBalance: '$12,840.50',
      accessToken: ACCESS_TOKEN,
    },

    contextHints: {
      frames: ['Top-level document'],
      regions: ['Accounts table'],
    },

    controlContexts: {
      'search-control': 'Member search form',
      'accounts-control': 'Member navigation',
    },
  });
}

describe('discovery observation projector', () => {
  it('projects a surface observation into a valid model observation', () => {
    const observation = project();

    expect(() => agentObservationSchema.parse(observation)).not.toThrow();

    expect(observation).toMatchObject({
      goal: 'Look up Alex Morgan and return their current savings balance.',
      step: 7,
      observationId: 'observation-7',

      location: {
        kind: 'web',
        title: 'Alex Morgan Accounts',
      },

      loading: 'complete',

      contextHints: {
        frames: ['Top-level document'],
        regions: ['Accounts table'],
      },
    });
  });

  it('does not expose browser handles, raw DOM, scope IDs, or control IDs', () => {
    const serialized = JSON.stringify(project());

    expect(serialized).not.toContain('session-internal-1');

    expect(serialized).not.toContain('surface-internal-1');

    expect(serialized).not.toContain('browserContext');

    expect(serialized).not.toContain('locator');

    expect(serialized).not.toContain('rawDom');

    expect(serialized).not.toContain('controlId');

    expect(serialized).not.toContain('unfiltered DOM');
  });

  it('removes cookies and tokens from every projected model field', () => {
    const observation = project();
    const serialized = JSON.stringify(observation);

    expect(serialized).not.toContain(API_KEY);

    expect(serialized).not.toContain(ACCESS_TOKEN);

    expect(serialized).not.toContain(COOKIE);

    expect(serialized).not.toContain('user:password@');

    expect(serialized).not.toContain('private-fragment');

    expect(serialized).not.toContain('accessToken');

    expect(serialized).toContain(MODEL_CONTEXT_REDACTED_VALUE);

    expect(observation.location).toEqual({
      kind: 'web',
      url: 'https://bank.test/member/member-alex-001?view=accounts',
      title: 'Alex Morgan Accounts',
    });
  });

  it('preserves visible semantic controls without implementation details', () => {
    const observation = project();

    expect(observation.controls).toEqual([
      {
        kind: 'button',
        role: 'button',
        accessibleName: 'Search',
        label: null,
        visibleText: 'Search',
        enabled: true,
        context: 'Member search form',
      },

      {
        kind: 'text_input',
        role: 'textbox',
        accessibleName: 'Password',
        label: 'Password',
        visibleText: null,
        enabled: true,
        context: null,
        inputType: 'password',
        value: null,
        readOnly: false,
      },

      {
        kind: 'link',
        role: 'link',
        accessibleName: 'Accounts',
        label: null,
        visibleText: 'Accounts',
        enabled: true,
        context: 'Member navigation',
        destination: '/accounts?tab=savings',
      },
    ]);
  });

  it('preserves dialogs while translating internal control IDs to names', () => {
    expect(project().dialogs).toEqual([
      {
        kind: 'surface',
        dialogId: 'dialog-1',
        presentation: 'modal',
        title: 'Service Notice',
        text: 'Review this notice before continuing',
        controlNames: ['Search'],
      },

      {
        kind: 'native',
        dialogId: 'native-dialog-1',
        type: 'prompt',
        message: 'Confirm safe navigation',
        defaultValue: `api_key=${MODEL_CONTEXT_REDACTED_VALUE}`,
      },
    ]);
  });

  it('preserves useful fake banking text required to solve the goal', () => {
    const observation = project();

    expect(observation.visibleTextSummary).toContain('Alex Morgan');

    expect(observation.visibleTextSummary).toContain('Savings');

    expect(observation.visibleTextSummary).toContain('Current Balance');

    expect(observation.visibleTextSummary).toContain('$12,840.50');

    expect(observation.extractedValues).toEqual({
      memberId: 'member-alex-001',
      savingsBalance: '$12,840.50',
    });
  });

  it('keeps model-required fake member data while persistence applies its stricter policy', () => {
    const modelObservation = project();

    const persisted = sanitizeForPersistence({
      memberId: 'member-alex-001',

      location: '/member/member-alex-001/accounts',

      savingsBalance: '$12,840.50',
    });

    expect(modelObservation.extractedValues.memberId).toBe('member-alex-001');

    expect(modelObservation.location.kind).toBe('web');

    expect(modelObservation.location.kind === 'web' && modelObservation.location.url).toContain(
      '/member/member-alex-001',
    );

    expect(persisted.value).toEqual({
      memberId: REDACTED_VALUE,
      location: `/member/${REDACTED_VALUE}/accounts`,
      savingsBalance: '$12,840.50',
    });
  });
});
