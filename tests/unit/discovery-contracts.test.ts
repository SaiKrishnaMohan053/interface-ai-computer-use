import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISCOVERY_MAX_STEPS,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  discoveryRequestSchema,
  parseDiscoveryRequest,
  resolveDiscoveryRunConfig,
} from '../../src/discovery/index.js';

const validRequest = {
  goal: 'Look up Alex Morgan and return their current savings balance.',

  target: {
    entryUrl: 'http://127.0.0.1:3000/member-search?scenario=normal',

    application: 'Fictional Banking Admin',
  },
};

describe('discovery contracts', () => {
  it('accepts a minimal discovery request', () => {
    expect(parseDiscoveryRequest(validRequest)).toEqual(validRequest);
  });

  it('resolves default run limits', () => {
    const request = parseDiscoveryRequest(validRequest);

    expect(resolveDiscoveryRunConfig(request)).toEqual({
      maxSteps: DEFAULT_DISCOVERY_MAX_STEPS,

      timeoutMs: DEFAULT_DISCOVERY_TIMEOUT_MS,
    });
  });

  it('accepts JSON parameters and limit overrides', () => {
    const request = parseDiscoveryRequest({
      ...validRequest,

      parameters: {
        memberName: 'Alex Morgan',

        requestedAccount: 'Savings',

        includeClosedAccounts: false,
      },

      limits: {
        maxSteps: 12,
        timeoutMs: 90_000,
      },
    });

    expect(resolveDiscoveryRunConfig(request)).toEqual({
      maxSteps: 12,
      timeoutMs: 90_000,
    });
  });

  it('rejects an empty goal', () => {
    expect(
      discoveryRequestSchema.safeParse({
        ...validRequest,
        goal: '   ',
      }).success,
    ).toBe(false);
  });

  it.each([
    'ftp://127.0.0.1/member-search',
    'file:///member-search',
    'http://operator:secret@127.0.0.1/member-search',
    'not-a-url',
  ])('rejects unsafe or invalid entry URL %s', (entryUrl) => {
    expect(
      discoveryRequestSchema.safeParse({
        ...validRequest,

        target: {
          ...validRequest.target,
          entryUrl,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown request fields', () => {
    expect(
      discoveryRequestSchema.safeParse({
        ...validRequest,
        hardCodedWorkflow: ['search', 'open accounts', 'read balance'],
      }).success,
    ).toBe(false);
  });

  it('rejects non-JSON parameter values', () => {
    expect(
      discoveryRequestSchema.safeParse({
        ...validRequest,

        parameters: {
          unsafeCallback: () => undefined,
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      maxSteps: 0,
      timeoutMs: 90_000,
    },
    {
      maxSteps: 101,
      timeoutMs: 90_000,
    },
    {
      maxSteps: 10,
      timeoutMs: 999,
    },
    {
      maxSteps: 10,
      timeoutMs: 15 * 60_000 + 1,
    },
  ])('rejects invalid discovery limits', (limits) => {
    expect(
      discoveryRequestSchema.safeParse({
        ...validRequest,
        limits,
      }).success,
    ).toBe(false);
  });
});
