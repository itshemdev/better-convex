import { describe, expect, it } from 'vitest';
import {
  createStaticProbeResult,
  RATELIMIT_COVERAGE_DEFINITIONS,
  RATELIMIT_LIVE_PROBE_IDS,
} from '../../example/convex/functions/ratelimitDemo.coverage';

describe('ratelimit demo runtime probe policy', () => {
  it('keeps live probes focused on mutation-safe core checks', () => {
    expect(RATELIMIT_LIVE_PROBE_IDS.has('fixed-window-limit')).toBe(true);
    expect(RATELIMIT_LIVE_PROBE_IDS.has('sliding-window-limit')).toBe(true);
    expect(RATELIMIT_LIVE_PROBE_IDS.has('token-bucket-reserve')).toBe(true);
    expect(RATELIMIT_LIVE_PROBE_IDS.has('get-remaining')).toBe(true);
    expect(RATELIMIT_LIVE_PROBE_IDS.has('deny-list-reason')).toBe(true);
  });

  it('returns deterministic static probe results for non-live rows', () => {
    const supportedDefinition = RATELIMIT_COVERAGE_DEFINITIONS.find(
      (entry) => entry.id === 'dynamic-limit-override'
    );
    const staticSupportedDefinition = RATELIMIT_COVERAGE_DEFINITIONS.find(
      (entry) => entry.id === 'reset-used-tokens'
    );

    expect(supportedDefinition).toBeDefined();
    expect(staticSupportedDefinition).toBeDefined();

    const supportedProbe = createStaticProbeResult(supportedDefinition!);
    const staticSupportedProbe = createStaticProbeResult(
      staticSupportedDefinition!
    );

    expect(supportedProbe.ok).toBe(true);
    expect(supportedProbe.error).toBeNull();
    expect(staticSupportedProbe.ok).toBe(true);
    expect(staticSupportedProbe.error).toBeNull();
  });
});
