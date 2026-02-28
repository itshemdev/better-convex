import { describe, expect, it } from 'vitest';
import {
  AUTH_COVERAGE_DEFINITIONS,
  AUTH_LIVE_PROBE_IDS,
  createStaticProbeResult,
} from '../../example/convex/functions/authDemo.coverage';

describe('auth demo runtime probe policy', () => {
  it('keeps live probes focused on executable anonymous/link flows', () => {
    expect(AUTH_LIVE_PROBE_IDS.has('anonymous-sign-in')).toBe(true);
    expect(AUTH_LIVE_PROBE_IDS.has('anonymous-flag')).toBe(true);
    expect(AUTH_LIVE_PROBE_IDS.has('anonymous-email-domain')).toBe(true);
    expect(AUTH_LIVE_PROBE_IDS.has('anonymous-generate-name')).toBe(true);
    expect(AUTH_LIVE_PROBE_IDS.has('link-account-non-anonymous')).toBe(true);
    expect(AUTH_LIVE_PROBE_IDS.has('on-link-account-bio-migration')).toBe(true);
    expect(AUTH_LIVE_PROBE_IDS.has('linked-source-anonymous-deleted')).toBe(
      true
    );
  });

  it('returns deterministic static probe envelopes', () => {
    const staticSupportedDefinition = AUTH_COVERAGE_DEFINITIONS.find(
      (entry) => entry.id === 'disable-delete-anonymous-user-option'
    );
    const staticFailureDefinition = AUTH_COVERAGE_DEFINITIONS.find(
      (entry) => entry.id === 'delete-anonymous-endpoint'
    );

    expect(staticSupportedDefinition).toBeDefined();
    expect(staticFailureDefinition).toBeDefined();

    const staticSupportedProbe = createStaticProbeResult(
      staticSupportedDefinition!
    );
    const staticFailureProbe = createStaticProbeResult(
      staticFailureDefinition!
    );

    expect(staticSupportedProbe.ok).toBe(true);
    expect(staticSupportedProbe.error).toBeNull();

    expect(staticFailureProbe.ok).toBe(false);
    expect(staticFailureProbe.error).toBeTruthy();
    expect(staticFailureProbe.errorCode).toBe('NOT_AVAILABLE');
  });
});
