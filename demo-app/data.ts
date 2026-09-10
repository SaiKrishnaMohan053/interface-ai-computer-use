import type { Account, Member, MemberSearchResult } from './types.js';

export const members: readonly Member[] = [
  {
    id: '12345',
    displayName: 'Alex Morgan',
    permission: 'ALLOWED',
  },
  {
    id: '99999',
    displayName: 'Jordan Taylor',
    permission: 'DENIED',
  },
  {
    id: '20001',
    displayName: 'Sam Lee',
    permission: 'ALLOWED',
  },
  {
    id: '20002',
    displayName: 'Sam Lee',
    permission: 'ALLOWED',
  },
];

export const accounts: readonly Account[] = [
  {
    id: 'CHK-1001',
    memberId: '12345',
    type: 'Checking',
    currentBalanceCents: 245075,
    currency: 'USD',
    status: 'Open',
  },
  {
    id: 'SAV-2001',
    memberId: '12345',
    type: 'Savings',
    currentBalanceCents: 1284050,
    currency: 'USD',
    status: 'Open',
  },
];

function normalizeName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function searchMemberByName(input: string): MemberSearchResult {
  if (input.length > 100) {
    return { kind: 'invalid_input' };
  }

  const normalized = normalizeName(input);

  if (normalized.length === 0) {
    return { kind: 'invalid_input' };
  }

  const matches = members.filter((member) => normalizeName(member.displayName) === normalized);

  if (matches.length > 1) {
    return { kind: 'ambiguous' };
  }

  const member = matches[0];

  if (member === undefined) {
    return { kind: 'not_found' };
  }

  return { kind: 'found', member };
}

export function findMember(memberId: string): Member | undefined {
  return members.find((member) => member.id === memberId);
}

export function getMemberAccounts(memberId: string): readonly Account[] {
  return accounts.filter((account) => account.memberId === memberId);
}

export function formatBalance(account: Account): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: account.currency,
  }).format(account.currentBalanceCents / 100);
}
