import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { COMMAND_ALLOWLIST, RISK } from "@/lib/ai/guardrails";
import { TOOL_RISK } from "@/lib/ai/tools";
import { agentTarget } from "@/lib/ai/agent-loop";
import { repositoryState } from "@/lib/ai/git-staging";
import { calibrateWeights } from "@/lib/ai/sports-tools";
import {
  INTENT_CLASSIFIER_VERSION,
  MUTATING_INTENTS,
  RECORD_INTENTS,
} from "@/lib/neural-intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/neural/agent   → what the intelligence pipeline actually is
 * POST /api/admin/neural/agent   { action: "calibrate", market } → run a calibration
 *
 * The console's read/write surface for the pipeline itself.
 *
 * Everything it reports is *read from the running system* rather than described:
 * the tool registry comes from the same object the loop dispatches through, the
 * allowlist from the same array the sandbox enforces, and the calibration from the
 * same table the model reads. A status panel that keeps its own copy of the truth is
 * a status panel that goes stale the first time someone edits the source.
 *
 * GET is admin-visible (anyone running the console may see how it works). POST is
 * Super Admin only, because a calibration changes what every future prediction is
 * built from.
 */
async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "ADMIN" && role !== "SUPER_ADMIN")) return null;
  return session;
}

const CALIBRATION_BOUNDS = {
  sportsRecencyWeight: [0.5, 1.5],
  sportsGoalExpectationFactor: [0.7, 1.3],
} as const;

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  // Every read is individually tolerant: one unavailable subsystem must not blank
  // the whole panel, because "the panel is empty" and "the database is down" would
  // then look identical to the operator.
  const [settings, repo, settled, target] = await Promise.all([
    prisma.platformSetting
      .findMany({ where: { key: { in: ["sportsRecencyWeight", "sportsGoalExpectationFactor"] } } })
      .catch(() => [] as Array<{ key: string; value: string; updatedAt: Date }>),
    repositoryState().catch(() => null),
    prisma.sportsPrediction
      .groupBy({
        by: ["market", "status"],
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ market: string; status: string; _count: { _all: number } }>),
    // Resolved through the platform's provider layer, so this panel reports the
    // gateway that will actually serve a request rather than an environment variable.
    agentTarget().catch(() => null),
  ]);

  const setting = (key: keyof typeof CALIBRATION_BOUNDS) => {
    const row = settings.find((s) => s.key === key);
    const numeric = Number(row?.value);
    return {
      key,
      value: Number.isFinite(numeric) ? numeric : 1,
      bounds: CALIBRATION_BOUNDS[key],
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      /** True when the value is at a bound, which means the loop wants to go further. */
      saturated: Number.isFinite(numeric)
        ? numeric <= CALIBRATION_BOUNDS[key][0] || numeric >= CALIBRATION_BOUNDS[key][1]
        : false,
    };
  };

  return NextResponse.json({
    runtime: {
      modelConfigured: Boolean(target),
      provider: target?.provider ?? "builtin",
      model: target?.model ?? null,
      gateway: target?.baseUrl ?? null,
      autonomy: "bounded",
      note: target
        ? `The tool loop is armed on ${target.provider} (${target.model}). High-risk calls still stop for approval.`
        : "No model gateway is configured — the provider resolves to `builtin`. The agent's tools are registered but the loop cannot run; the reasoning console still answers from the platform's own records.",
    },
    tools: Object.entries(TOOL_RISK).map(([name, profile]) => ({
      name,
      tier: profile.tier,
      requiresApproval: profile.requiresApproval,
      blastRadius: profile.blastRadius,
    })),
    guardrails: {
      shell: "never — commands are spawned with an argument array, so metacharacters cannot be interpreted",
      commandAllowlist: COMMAND_ALLOWLIST,
      allowlistSize: COMMAND_ALLOWLIST.length,
      approval: {
        scheme: "HMAC-SHA256 over actor + tool + argument hash + expiry",
        ttlSeconds: 300,
        // Reported as a boolean, never the secret. An operator needs to know the
        // gate *can* close, not what the key is.
        secretConfigured: Boolean(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET),
        boundToArguments: true,
        singleUse: false,
        note: "A token is valid for one tool with one exact argument hash, for one admin, for five minutes.",
      },
      riskTiers: {
        low: RISK.low.blastRadius,
        medium: RISK.medium.blastRadius,
        high: RISK.high.blastRadius,
      },
    },
    routing: {
      classifierVersion: INTENT_CLASSIFIER_VERSION,
      recordIntents: RECORD_INTENTS,
      mutatingIntents: MUTATING_INTENTS,
      note: "Record intents are answered from the platform's own records and never routed to the model; that is why a hive report cannot be hallucinated.",
    },
    repository: repo
      ? { branch: repo.branch, dirty: repo.dirty, lastCommit: repo.lastCommit, clean: repo.dirty.length === 0 }
      : { unavailable: true, reason: "git is not reachable from this runtime" },
    calibration: {
      sportsRecencyWeight: setting("sportsRecencyWeight"),
      sportsGoalExpectationFactor: setting("sportsGoalExpectationFactor"),
    },
    predictionLedger: settled.map((row) => ({
      market: row.market,
      status: row.status,
      count: row._count._all,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Super Admin access required", reason: "A calibration changes what every future prediction is built from." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string; market?: string };

  if (body.action !== "calibrate") {
    return NextResponse.json({ error: `Unknown action "${body.action ?? ""}"` }, { status: 400 });
  }

  const market = (body.market ?? "").trim();
  if (!market) return NextResponse.json({ error: "A market is required, e.g. 1X2" }, { status: 400 });

  const result = await calibrateWeights({ market });
  // 200 either way: a refusal for an insufficient sample is a successful, correct
  // answer, and returning an error status would train the UI to show it as a failure.
  return NextResponse.json({ result });
}
