import { describe, expect, it } from 'vitest';
import { evaluateScenario } from '../../demo-app/scenario-controller.js';
import type { Member } from '../../demo-app/types.js';

const allowedMember: Member = {
  id: '12345',
  displayName: 'Alex Morgan',
  permission: 'ALLOWED',
};

const deniedMember: Member = {
  id: '99999',
  displayName: 'Jordan Taylor',
  permission: 'DENIED',
};

function evaluate(path: string, cookieHeader = '', member: Member | undefined = undefined) {
  return evaluateScenario({
    url: new URL(path, 'http://127.0.0.1:3000'),
    cookieHeader,
    member,
  });
}

describe('demo scenario controller', () => {
  it('defaults to a normal active session', () => {
    expect(evaluate('/member-search')).toMatchObject({
      kind: 'proceed',
      context: {
        scenario: 'normal',
        session: 'ACTIVE',
      },
    });
  });

  it('selects a scenario and preserves the requested search', () => {
    const result = evaluate('/member-search?scenario=slow&memberName=Alex+Morgan');

    expect(result).toMatchObject({
      kind: 'redirect',
      location: '/member-search?memberName=Alex+Morgan',
      context: { scenario: 'slow' },
    });

    expect(result.cookies).toContain('demo_scenario=slow; Path=/; HttpOnly; SameSite=Strict');
  });

  it('rejects unknown and repeated scenario selections', () => {
    for (const path of [
      '/member-search?scenario=unknown',
      '/member-search?scenario=slow&scenario=normal',
    ]) {
      expect(evaluate(path)).toMatchObject({
        kind: 'blocked',
        status: 400,
        code: 'INVALID_INPUT',
      });
    }
  });

  it('resets even when the previous session was expired', () => {
    const result = evaluate(
      '/member-search?scenario=normal&__demo_ready=1&__demo_continue=1',
      'demo_scenario=session-expired; demo_dialog_ack=1',
    );

    expect(result).toMatchObject({
      kind: 'redirect',
      location: '/member-search',
      context: {
        scenario: 'normal',
        session: 'ACTIVE',
      },
    });

    expect(result.cookies).toContain(
      'demo_dialog_ack=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    );
  });

  it('returns a loading page followed by completion for the same request', () => {
    const first = evaluate('/member/12345/accounts', 'demo_scenario=slow', allowedMember);

    expect(first.kind).toBe('loading');

    if (first.kind !== 'loading') {
      throw new Error('Expected loading decision');
    }

    expect(first.refreshSeconds).toBe(1);

    expect(evaluate(first.continueUrl, 'demo_scenario=slow', allowedMember).kind).toBe('proceed');

    expect(evaluate('/member/12345', 'demo_scenario=slow', allowedMember).kind).toBe('loading');
  });

  it('permits search but blocks member access in the permission scenario', () => {
    expect(evaluate('/member-search', 'demo_scenario=permission-denied').kind).toBe('proceed');

    expect(
      evaluate('/member/12345/accounts', 'demo_scenario=permission-denied', allowedMember),
    ).toMatchObject({
      kind: 'blocked',
      status: 403,
      code: 'PERMISSION_DENIED',
    });
  });

  it('does not bypass member permissions through dialog acknowledgment', () => {
    expect(
      evaluate(
        '/member/99999/accounts?__demo_continue=1',
        'demo_scenario=dialog; demo_dialog_ack=1',
        deniedMember,
      ),
    ).toMatchObject({
      kind: 'blocked',
      code: 'PERMISSION_DENIED',
    });
  });

  it('blocks requests when the banking session is expired', () => {
    expect(evaluate('/member/12345', 'demo_scenario=session-expired', allowedMember)).toMatchObject(
      {
        kind: 'blocked',
        status: 401,
        code: 'SESSION_EXPIRED',
        context: { session: 'EXPIRED' },
      },
    );
  });

  it('returns an explicit injected application error', () => {
    expect(evaluate('/member-search', 'demo_scenario=app-error')).toMatchObject({
      kind: 'blocked',
      status: 503,
      code: 'APPLICATION_ERROR',
    });
  });

  it('acknowledges the interstitial and preserves the destination', () => {
    const first = evaluate('/member/12345/accounts', 'demo_scenario=dialog', allowedMember);

    expect(first.kind).toBe('interstitial');

    if (first.kind !== 'interstitial') {
      throw new Error('Expected interstitial decision');
    }

    const continued = evaluate(first.continueUrl, 'demo_scenario=dialog', allowedMember);

    expect(continued).toMatchObject({
      kind: 'redirect',
      location: '/member/12345/accounts',
    });

    expect(continued.cookies).toContain('demo_dialog_ack=1; Path=/; HttpOnly; SameSite=Strict');

    expect(
      evaluate('/member/12345/accounts', 'demo_scenario=dialog; demo_dialog_ack=1', allowedMember)
        .kind,
    ).toBe('proceed');
  });

  it('does not share scenario state between independent cookie contexts', () => {
    expect(evaluate('/member-search', 'demo_scenario=session-expired').kind).toBe('blocked');

    expect(evaluate('/member-search').kind).toBe('proceed');
  });
});
