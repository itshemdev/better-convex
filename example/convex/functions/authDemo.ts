import { eq } from 'better-convex/orm';
import { z } from 'zod';
import type { MutationCtx } from '../functions/generated/server';
import type { AuthCtx } from '../lib/crpc';
import { authMutation, authQuery } from '../lib/crpc';
import {
  AUTH_DEMO_ANON_EMAIL_DOMAIN,
  AUTH_DEMO_ANON_NAME_PREFIX,
} from '../shared/auth-anonymous-demo';
import {
  AUTH_COVERAGE_DEFINITIONS,
  AUTH_LIVE_PROBE_IDS,
  type AuthCoverageDefinition,
  type AuthCoverageExpectation,
  type AuthCoverageId,
  type AuthCoverageProbeResult,
  type AuthCoverageStatus,
  createStaticProbeResult,
} from './authDemo.coverage';
import { userTable } from './schema';

type ProbeResult = AuthCoverageProbeResult;

type AuthCoverageEntry = AuthCoverageDefinition & {
  probe: ProbeResult;
};

type AuthCoverageSnapshot = {
  generatedAt: string;
  entries: AuthCoverageEntry[];
  summary: Record<AuthCoverageStatus, number>;
  validated: number;
  total: number;
};

type DemoSignals = {
  ip: string;
  userAgent: string;
};

type DemoMutationCtx = AuthCtx<MutationCtx>;

type AnonymousSignInFlow = {
  token: string;
  session: {
    id: string;
    userId: string;
    ipAddress: string | null;
    userAgent: string | null;
  };
  user: {
    id: string;
    email: string;
    name: string;
    isAnonymous: boolean;
    bio: string | null;
  };
  signals: DemoSignals;
};

type LinkFlow = {
  sourceAnonymousUserId: string;
  sourceAnonymousBio: string;
  linkedUser: {
    id: string;
    email: string;
    name: string;
    isAnonymous: boolean;
    bio: string | null;
  };
  sourceDeleted: boolean;
  linkedToken: string | null;
};

const COVERAGE_IDS = AUTH_COVERAGE_DEFINITIONS.map((entry) => entry.id) as [
  AuthCoverageId,
  ...AuthCoverageId[],
];

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function randomSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDemoSignals(): DemoSignals {
  const suffix = Math.floor(Math.random() * 200) + 20;
  return {
    ip: `198.51.100.${suffix}`,
    userAgent: `better-convex-auth-demo/${randomSuffix()}`,
  };
}

function createHeaders(signals: DemoSignals, token?: string): Headers {
  const headers = new Headers({
    'user-agent': signals.userAgent,
    'x-forwarded-for': signals.ip,
  });

  if (token) {
    const encodedToken = encodeURIComponent(token);
    headers.set('authorization', `Bearer ${token}`);
    headers.set(
      'cookie',
      `better-auth.session_token=${encodedToken}; __Secure-better-auth.session_token=${encodedToken}`
    );
  }

  return headers;
}

function buildSummary(
  entries: AuthCoverageEntry[]
): Record<AuthCoverageStatus, number> {
  return entries.reduce(
    (acc, entry) => {
      acc[entry.status] = (acc[entry.status] ?? 0) + 1;
      return acc;
    },
    {
      supported: 0,
      partial: 0,
      blocked: 0,
      missing: 0,
    } as Record<AuthCoverageStatus, number>
  );
}

function matchesExpectation(
  expectation: AuthCoverageExpectation,
  probe: ProbeResult
): boolean {
  if (expectation === 'failure') {
    return !probe.ok;
  }
  return probe.ok;
}

async function runProbe(probe: () => Promise<unknown>): Promise<ProbeResult> {
  const startedAt = Date.now();

  try {
    const value = await probe();
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      error: null,
      errorCode: null,
      value,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: asErrorMessage(error),
      errorCode: 'PROBE_FAILED',
    };
  }
}

async function createAnonymousSignInFlow(
  ctx: DemoMutationCtx
): Promise<AnonymousSignInFlow> {
  const signals = createDemoSignals();
  const signInResult = await ctx.auth.api.signInAnonymous({
    headers: createHeaders(signals),
  });

  const token = signInResult?.token;
  if (!token) {
    throw new Error('Anonymous sign-in did not return a session token.');
  }

  const session = await ctx.orm.query.session.findFirst({
    where: { token },
  });

  if (!session) {
    throw new Error('Anonymous sign-in did not persist a session row.');
  }

  const user = await ctx.orm.query.user.findFirst({
    where: { id: session.userId },
  });

  if (!user) {
    throw new Error('Anonymous sign-in did not persist a user row.');
  }

  return {
    token,
    session: {
      id: session.id,
      userId: session.userId,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isAnonymous: user.isAnonymous === true,
      bio: user.bio ?? null,
    },
    signals,
  };
}

async function createAnonymousLinkFlow(
  ctx: DemoMutationCtx
): Promise<LinkFlow> {
  const anonymous = await createAnonymousSignInFlow(ctx);
  const sourceAnonymousBio = `anon-bio-${randomSuffix()}`;

  await ctx.orm
    .update(userTable)
    .set({ bio: sourceAnonymousBio })
    .where(eq(userTable.id, anonymous.user.id));

  const linkEmail = `anon-link-${randomSuffix()}@example.com`;
  const signUpResult = await ctx.auth.api.signUpEmail({
    body: {
      name: `Linked User ${randomSuffix()}`,
      email: linkEmail,
      password: `DemoPassword!${Math.floor(Math.random() * 99_999)}Aa`,
    },
    headers: createHeaders(anonymous.signals, anonymous.token),
  });

  const linkedUserId = signUpResult?.user?.id;
  if (!linkedUserId) {
    throw new Error('Email sign-up did not return a linked user.');
  }

  const linkedUser = await ctx.orm.query.user.findFirst({
    where: { id: linkedUserId },
  });

  if (!linkedUser) {
    throw new Error('Linked user was not found in storage.');
  }

  const sourceAfter = await ctx.orm.query.user.findFirst({
    where: { id: anonymous.user.id },
  });

  return {
    sourceAnonymousUserId: anonymous.user.id,
    sourceAnonymousBio,
    linkedToken: signUpResult?.token ?? null,
    linkedUser: {
      id: linkedUser.id,
      email: linkedUser.email,
      name: linkedUser.name,
      isAnonymous: linkedUser.isAnonymous === true,
      bio: linkedUser.bio ?? null,
    },
    sourceDeleted: sourceAfter === null,
  };
}

function buildLiveProbes(ctx: DemoMutationCtx) {
  return {
    'anonymous-sign-in': async () => {
      const flow = await createAnonymousSignInFlow(ctx);
      return {
        tokenPresent: flow.token.length > 0,
        sessionId: flow.session.id,
        userId: flow.user.id,
        ipAddress: flow.session.ipAddress,
        userAgent: flow.session.userAgent,
      };
    },
    'anonymous-flag': async () => {
      const flow = await createAnonymousSignInFlow(ctx);
      if (!flow.user.isAnonymous) {
        throw new Error(
          'Expected anonymous user to be marked isAnonymous=true.'
        );
      }
      return {
        isAnonymous: flow.user.isAnonymous,
        userId: flow.user.id,
      };
    },
    'anonymous-email-domain': async () => {
      const flow = await createAnonymousSignInFlow(ctx);
      if (!flow.user.email.endsWith(`@${AUTH_DEMO_ANON_EMAIL_DOMAIN}`)) {
        throw new Error(
          `Expected anonymous email domain @${AUTH_DEMO_ANON_EMAIL_DOMAIN}, got ${flow.user.email}`
        );
      }
      return {
        email: flow.user.email,
        expectedDomain: AUTH_DEMO_ANON_EMAIL_DOMAIN,
      };
    },
    'anonymous-generate-name': async () => {
      const flow = await createAnonymousSignInFlow(ctx);
      if (!flow.user.name.startsWith(AUTH_DEMO_ANON_NAME_PREFIX)) {
        throw new Error(
          `Expected generated name to start with ${AUTH_DEMO_ANON_NAME_PREFIX}`
        );
      }
      return {
        name: flow.user.name,
        expectedPrefix: AUTH_DEMO_ANON_NAME_PREFIX,
      };
    },
    'link-account-non-anonymous': async () => {
      const flow = await createAnonymousLinkFlow(ctx);
      if (flow.linkedUser.isAnonymous) {
        throw new Error('Expected linked user to be non-anonymous.');
      }
      return {
        linkedUserId: flow.linkedUser.id,
        linkedEmail: flow.linkedUser.email,
        linkedIsAnonymous: flow.linkedUser.isAnonymous,
      };
    },
    'on-link-account-bio-migration': async () => {
      const flow = await createAnonymousLinkFlow(ctx);
      if (flow.linkedUser.bio !== flow.sourceAnonymousBio) {
        throw new Error('Expected onLinkAccount to migrate anonymous bio.');
      }
      return {
        sourceAnonymousUserId: flow.sourceAnonymousUserId,
        migratedBio: flow.linkedUser.bio,
      };
    },
    'linked-source-anonymous-deleted': async () => {
      const flow = await createAnonymousLinkFlow(ctx);
      if (!flow.sourceDeleted) {
        throw new Error(
          'Expected source anonymous user to be deleted after linking.'
        );
      }
      return {
        sourceAnonymousUserId: flow.sourceAnonymousUserId,
        sourceDeleted: flow.sourceDeleted,
      };
    },
  } satisfies Record<
    Exclude<
      AuthCoverageId,
      | 'delete-anonymous-endpoint'
      | 'disable-delete-anonymous-user-option'
      | 'generate-random-email-precedence'
    >,
    () => Promise<unknown>
  >;
}

function runScenarioImpl(ctx: DemoMutationCtx) {
  const liveProbes = buildLiveProbes(ctx);

  return async (id: AuthCoverageId): Promise<AuthCoverageEntry> => {
    const definition = AUTH_COVERAGE_DEFINITIONS.find(
      (entry) => entry.id === id
    );
    if (!definition) {
      throw new Error(`Unknown auth coverage id: ${id}`);
    }

    if (!AUTH_LIVE_PROBE_IDS.has(id)) {
      return {
        ...definition,
        probe: createStaticProbeResult(definition),
      };
    }

    const liveProbe = liveProbes[id as keyof typeof liveProbes];
    if (!liveProbe) {
      throw new Error(`Missing live probe implementation for ${id}`);
    }

    const probe = await runProbe(liveProbe);
    return {
      ...definition,
      probe,
    };
  };
}

export const getSnapshot = authQuery.query(async () => {
  const entries = AUTH_COVERAGE_DEFINITIONS.map((entry) => ({
    ...entry,
    probe: {
      ok: false,
      elapsedMs: 0,
      error: null,
      errorCode: null,
    } satisfies ProbeResult,
  }));

  return {
    generatedAt: new Date().toISOString(),
    entries,
    summary: buildSummary(entries),
    validated: 0,
    total: entries.length,
  } satisfies AuthCoverageSnapshot;
});

export const getAuthState = authQuery.query(async ({ ctx }) => {
  const session = await ctx.orm.query.session.findFirst({
    where: { userId: ctx.userId },
  });

  return {
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      isAnonymous: ctx.user.isAnonymous ?? null,
      bio: ctx.user.bio ?? null,
    },
    session: session
      ? {
          id: session.id,
          tokenPreview: session.token.slice(0, 10),
          ipAddress: session.ipAddress ?? null,
          userAgent: session.userAgent ?? null,
        }
      : null,
  };
});

export const runScenario = authMutation
  .input(
    z.object({
      id: z.enum(COVERAGE_IDS),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const execute = runScenarioImpl(ctx);
    const entry = await execute(input.id);

    return {
      generatedAt: new Date().toISOString(),
      entry,
      matched: matchesExpectation(entry.expectation, entry.probe),
    };
  });

export const runCoverage = authMutation.mutation(async ({ ctx }) => {
  const execute = runScenarioImpl(ctx);

  const entries = await Promise.all(
    AUTH_COVERAGE_DEFINITIONS.map(async (definition) => execute(definition.id))
  );

  const validated = entries.filter((entry) =>
    matchesExpectation(entry.expectation, entry.probe)
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    entries,
    summary: buildSummary(entries),
    validated,
    total: entries.length,
  } satisfies AuthCoverageSnapshot;
});
