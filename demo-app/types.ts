export type PermissionState = 'ALLOWED' | 'DENIED';

export type SessionState = 'ACTIVE' | 'EXPIRED';

export type ScenarioState =
  'normal' | 'slow' | 'permission-denied' | 'session-expired' | 'dialog' | 'app-error';

export interface Member {
  readonly id: string;
  readonly displayName: string;
  readonly permission: PermissionState;
}

export interface Account {
  readonly id: string;
  readonly memberId: string;
  readonly type: 'Checking' | 'Savings';
  readonly currentBalanceCents: number;
  readonly currency: 'USD';
  readonly status: 'Open' | 'Closed';
}

export interface SubAccount {
  readonly memberId: string;
  readonly parentAccountId: string;
  readonly nickname: string;
  readonly type: 'Savings';
  readonly status: 'DRAFT';
}

export type MemberSearchResult =
  | { readonly kind: 'found'; readonly member: Member }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'invalid_input' };
