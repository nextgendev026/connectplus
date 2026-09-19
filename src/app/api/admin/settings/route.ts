import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAllSettings,
  getSettings,
  updateSettings,
  settingDef,
} from "@/lib/settings";
import { analyticsIdProblem, sanitizeIntegrationHtml } from "@/lib/integration-scripts";

/**
 * Settings that inject code into every page.
 *
 * These are the only keys that can turn a settings write into stored XSS, so
 * they are gated to SUPER_ADMIN and sanitized before they are ever stored — see
 * lib/integration-scripts for what survives.
 */
const CODE_INJECTION_KEYS = new Set(["headScripts", "chatWidgetScript"]);

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getAllSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Error loading settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const updates = (body?.updates ?? {}) as Record<string, string>;

    // Guard: only allow catalog keys (prevents arbitrary row creation).
    const validUpdates: Record<string, string> = {};
    for (const [key, value] of Object.entries(updates)) {
      const def = settingDef(key);
      if (!def) continue;
      validUpdates[key] = typeof value === "string" ? value : String(value ?? "");
    }

    // Code-injection settings are SUPER_ADMIN-only, so a compromised ordinary
    // admin account cannot plant a script on every page of the site.
    const injectionKeys = Object.keys(validUpdates).filter((key) => CODE_INJECTION_KEYS.has(key));
    if (injectionKeys.length > 0 && role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: `Only a super admin may change ${injectionKeys.join(", ")}.` },
        { status: 403 }
      );
    }

    // Sanitize snippets before storing. Anything that would have executed
    // attacker-chosen code (inline JavaScript, unknown hosts, event handlers) is
    // rejected outright rather than quietly dropped, so the operator is told why.
    for (const key of injectionKeys) {
      const raw = validUpdates[key] ?? "";
      if (!raw.trim()) continue;
      const { blocked } = sanitizeIntegrationHtml(raw);
      if (blocked.length > 0) {
        return NextResponse.json(
          {
            error: `The ${key} snippet was rejected: ${blocked.join("; ")}. Use the analytics provider selector for standard tags, or host a script on an allowlisted domain.`,
          },
          { status: 400 }
        );
      }
    }

    /*
     * The self-healing envelope grants the brain permission to *mutate*
     * production, so it gets the same bar as a code-injection setting: only a
     * super admin may move it, and only to a value the repair layer understands.
     * An unrecognised value reads as `observe` at runtime, but rejecting it here
     * means a typo is explained rather than silently downgraded.
     */
    if (validUpdates.brainSelfHeal !== undefined) {
      if (role !== "SUPER_ADMIN") {
        return NextResponse.json(
          { error: "Only a super admin may change the self-healing envelope." },
          { status: 403 }
        );
      }
      const mode = validUpdates.brainSelfHeal.trim().toLowerCase();
      if (!["off", "observe", "enforce"].includes(mode)) {
        return NextResponse.json(
          { error: "Self-healing must be one of: off, observe, enforce." },
          { status: 400 }
        );
      }
      validUpdates.brainSelfHeal = mode;
    }

    // A malformed measurement id produces no snippet at all, which reads as
    // "analytics is on but silent" — the failure mode this console exists to
    // avoid. Reject it at the point of entry instead.
    if (validUpdates.analyticsId !== undefined || validUpdates.analyticsProvider !== undefined) {
      const current = await getSettings(false).catch(() => null);
      const provider = validUpdates.analyticsProvider ?? current?.analyticsProvider ?? "none";
      const id = validUpdates.analyticsId ?? current?.analyticsId ?? "";
      const problem = analyticsIdProblem(provider, id);
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
    }

    const count = await updateSettings(validUpdates);
    const settings = await getAllSettings();
    return NextResponse.json({
      ok: true,
      updated: count,
      settings,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}