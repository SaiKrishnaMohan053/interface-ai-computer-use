import type { Member, ScenarioState, SessionState } from './types.js';

const SCENARIO_COOKIE = 'demo_scenario';
const DIALOG_COOKIE = 'demo_dialog_ack';
const READY_PARAM = '__demo_ready';
const CONTINUE_PARAM = '__demo_continue';

const scenarios: readonly ScenarioState[] = [
  'normal',
  'slow',
  'permission-denied',
  'session-expired',
  'dialog',
  'app-error',
];

export interface ScenarioContext {
  readonly scenario: ScenarioState;
  readonly session: SessionState;
}

export type ScenarioDecision = {
  readonly context: ScenarioContext;
  readonly cookies: readonly string[];
} & (
  | { readonly kind: 'proceed' }
  | {
      readonly kind: 'redirect';
      readonly location: string;
    }
  | {
      readonly kind: 'loading';
      readonly refreshSeconds: number;
      readonly continueUrl: string;
    }
  | {
      readonly kind: 'interstitial';
      readonly continueUrl: string;
    }
  | {
      readonly kind: 'blocked';
      readonly status: number;
      readonly code: string;
      readonly message: string;
    }
);

interface ScenarioInput {
  readonly url: URL;
  readonly cookieHeader: string;
  readonly member: Member | undefined;
}

function isScenario(value: string): value is ScenarioState {
  return scenarios.some((scenario) => scenario === value);
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}

function cookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict`;
}

function clearDialogCookie(): string {
  return `${DIALOG_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function localUrl(url: URL): string {
  return `${url.pathname}${url.search}`;
}

export function evaluateScenario(input: ScenarioInput): ScenarioDecision {
  const savedScenario = readCookie(input.cookieHeader, SCENARIO_COOKIE);
  const scenario =
    savedScenario !== undefined && isScenario(savedScenario) ? savedScenario : 'normal';

  const context: ScenarioContext = {
    scenario,
    session: scenario === 'session-expired' ? 'EXPIRED' : 'ACTIVE',
  };

  const base = { context, cookies: [] as readonly string[] };
  const selections = input.url.searchParams.getAll('scenario');

  if (selections.length > 0) {
    const selected = selections[0];

    if (selections.length !== 1 || selected === undefined || !isScenario(selected)) {
      return {
        ...base,
        kind: 'blocked',
        status: 400,
        code: 'INVALID_INPUT',
        message: 'Choose a supported demo scenario.',
      };
    }

    const destination = new URL(input.url);
    destination.searchParams.delete('scenario');
    destination.searchParams.delete(READY_PARAM);
    destination.searchParams.delete(CONTINUE_PARAM);

    return {
      context: {
        scenario: selected,
        session: selected === 'session-expired' ? 'EXPIRED' : 'ACTIVE',
      },
      cookies: [cookie(SCENARIO_COOKIE, selected), clearDialogCookie()],
      kind: 'redirect',
      location: localUrl(destination),
    };
  }

  if (context.session === 'EXPIRED') {
    return {
      ...base,
      kind: 'blocked',
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'The demo banking session has expired.',
    };
  }

  if (scenario === 'app-error') {
    return {
      ...base,
      kind: 'blocked',
      status: 503,
      code: 'APPLICATION_ERROR',
      message: 'The demo banking application is temporarily unavailable.',
    };
  }

  if (
    input.member !== undefined &&
    (input.member.permission === 'DENIED' || scenario === 'permission-denied')
  ) {
    return {
      ...base,
      kind: 'blocked',
      status: 403,
      code: 'PERMISSION_DENIED',
      message: 'Access to this member is restricted.',
    };
  }

  if (scenario === 'dialog') {
    const acknowledged = readCookie(input.cookieHeader, DIALOG_COOKIE) === '1';

    if (!acknowledged) {
      if (input.url.searchParams.get(CONTINUE_PARAM) === '1') {
        const destination = new URL(input.url);
        destination.searchParams.delete(CONTINUE_PARAM);

        return {
          ...base,
          cookies: [cookie(DIALOG_COOKIE, '1')],
          kind: 'redirect',
          location: localUrl(destination),
        };
      }

      const destination = new URL(input.url);
      destination.searchParams.set(CONTINUE_PARAM, '1');

      return {
        ...base,
        kind: 'interstitial',
        continueUrl: localUrl(destination),
      };
    }
  }

  if (scenario === 'slow' && input.url.searchParams.get(READY_PARAM) !== '1') {
    const destination = new URL(input.url);
    destination.searchParams.set(READY_PARAM, '1');

    return {
      ...base,
      kind: 'loading',
      refreshSeconds: 1,
      continueUrl: localUrl(destination),
    };
  }

  return { ...base, kind: 'proceed' };
}
