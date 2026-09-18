import { describe, expect, it } from 'vitest';

import { capabilityCompatibilitySchema } from '../../src/artifact/index.js';

describe('artifact compatibility metadata', () => {
  it('describes reusable application and vendor compatibility', () => {
    expect(
      capabilityCompatibilitySchema.parse({
        application: 'demo-bank',
        vendorFamily: 'demo-core',
        surfaceKind: 'web',
        supportedVersionRange: '1.x',
      }),
    ).toEqual({
      application: 'demo-bank',
      vendorFamily: 'demo-core',
      surfaceKind: 'web',
      supportedVersionRange: '1.x',
    });
  });

  it('allows an optional compatibility variant', () => {
    expect(
      capabilityCompatibilitySchema.parse({
        application: 'demo-bank',
        vendorFamily: 'demo-core',
        surfaceKind: 'web',
        supportedVersionRange: '1.x',
        variant: 'classic-navigation',
      }),
    ).toEqual({
      application: 'demo-bank',
      vendorFamily: 'demo-core',
      surfaceKind: 'web',
      supportedVersionRange: '1.x',
      variant: 'classic-navigation',
    });
  });

  it('does not require a tenant identifier', () => {
    const compatibility = capabilityCompatibilitySchema.parse({
      application: 'demo-bank',
      vendorFamily: 'demo-core',
      surfaceKind: 'web',
      supportedVersionRange: '1.x',
    });

    expect(compatibility).not.toHaveProperty('tenantId');
    expect(compatibility).not.toHaveProperty('bankId');
    expect(compatibility).not.toHaveProperty('customerId');
  });

  it('rejects tenant-specific compatibility fields', () => {
    expect(
      capabilityCompatibilitySchema.safeParse({
        application: 'demo-bank',
        vendorFamily: 'demo-core',
        surfaceKind: 'web',
        supportedVersionRange: '1.x',
        tenantId: 'specific-bank-A',
      }).success,
    ).toBe(false);
  });

  it('rejects deployment-specific runtime fields', () => {
    expect(
      capabilityCompatibilitySchema.safeParse({
        application: 'demo-bank',
        surfaceKind: 'web',
        baseUrl: 'https://bank-a.example.com',
        sessionId: 'session-123',
      }).success,
    ).toBe(false);
  });

  it('supports both declared surface kinds', () => {
    expect(
      capabilityCompatibilitySchema.safeParse({
        application: 'demo-bank',
        surfaceKind: 'web',
      }).success,
    ).toBe(true);

    expect(
      capabilityCompatibilitySchema.safeParse({
        application: 'legacy-desktop-core',
        surfaceKind: 'application',
      }).success,
    ).toBe(true);
  });

  it('rejects adapter-specific surface names', () => {
    expect(
      capabilityCompatibilitySchema.safeParse({
        application: 'demo-bank',
        surfaceKind: 'playwright',
      }).success,
    ).toBe(false);
  });
});
