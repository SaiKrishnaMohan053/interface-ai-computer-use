import { describe, expect, it } from 'vitest';

import {
  DiscoveryCliUsageError,
  parseDiscoverCommandOptions,
} from '../../src/cli/discover-options.js';

describe('Discovery CLI options', () => {
  it('parses a connected headed discovery run', () => {
    expect(
      parseDiscoverCommandOptions([
        '--goal',
        'Look up the Savings balance',
        '--target',
        'http://127.0.0.1:3000/member-search',
        '--headed',
        '--synthetic-screenshots',
        '--max-steps',
        '12',
        '--timeout-ms',
        '45000',
      ]),
    ).toEqual({
      kind: 'run',
      options: {
        goal: 'Look up the Savings balance',
        target: 'http://127.0.0.1:3000/member-search',
        application: 'Demo Credit Union',
        headed: true,
        syntheticScreenshots: true,
        evidenceRoot: 'evidence',
        maxSteps: 12,
        timeoutMs: 45_000,
      },
    });
  });

  it('starts the bundled demo when target is omitted', () => {
    expect(parseDiscoverCommandOptions(['--goal', 'Read the balance'])).toMatchObject({
      kind: 'run',
      options: {
        goal: 'Read the balance',
        headed: false,
        syntheticScreenshots: false,
      },
    });
  });

  it('supports help without requiring a goal', () => {
    expect(parseDiscoverCommandOptions(['--help'])).toEqual({ kind: 'help' });
  });

  it('rejects missing goals and unknown options', () => {
    expect(() => parseDiscoverCommandOptions([])).toThrow(DiscoveryCliUsageError);
    expect(() => parseDiscoverCommandOptions(['--goal', 'Read', '--unknown'])).toThrow(
      'Unsupported option',
    );
  });

  it('rejects credential-bearing and non-HTTP targets', () => {
    expect(() =>
      parseDiscoverCommandOptions([
        '--goal',
        'Read',
        '--target',
        'https://user:secret@bank.test/member-search',
      ]),
    ).toThrow('without credentials');

    expect(() =>
      parseDiscoverCommandOptions(['--goal', 'Read', '--target', 'file:///tmp/demo']),
    ).toThrow('HTTP(S)');
  });

  it('rejects invalid limits', () => {
    expect(() => parseDiscoverCommandOptions(['--goal', 'Read', '--max-steps', '0'])).toThrow(
      'positive integer',
    );
  });
});
