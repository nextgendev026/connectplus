import { expect, test, type Page } from "@playwright/test";
import { runWritingChecks } from "../../src/lib/writing-checks";

/**
 * The composer's inline checks, end to end — Grammarly's shape: a flagged range
 * is underlined *in the text*, and a fix lands on exactly that range.
 *
 * Hermetic on purpose. The only database this project has is the live Supabase
 * project (see `.freebuff/run.md`: there is no local Postgres, and the Vercel
 * build applies migrations to production), so "signing in for real" here would
 * mean either production credentials in CI or a junk draft written to the real
 * posts table. Instead every `/api/**` call is fulfilled inside the browser:
 * that is the throwaway environment — a signed-in session, no database, no
 * provider, no network. `runWritingChecks` is imported directly so the marks and
 * offsets under test are the real ones the copilot produces, not fixtures.
 */

const DRAFT =
  "We recieve the seperate report and it definately needs review before we publish it.";
/** The same draft after applying only the "recieve" fix. */
const AFTER_ONE_FIX =
  "We receive the seperate report and it definately needs review before we publish it.";
const TARGET = { original: "recieve", replacement: "receive" };

const SESSION = {
  user: {
    id: "e2e-user",
    name: "E2E Writer",
    email: "e2e@example.test",
    username: "e2e-writer",
    role: "user",
    emailVerified: "2026-01-01T00:00:00.000Z",
  },
  expires: "2099-01-01T00:00:00.000Z",
};

/** Fulfil every API call in the browser so no request can reach a real backend. */
async function stubApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/session") return route.fulfill({ json: SESSION });

    if (path === "/api/ai/studio") {
      const body = (request.postDataJSON() ?? {}) as { action?: string; content?: string };
      if (body.action !== "inspect") return route.fulfill({ json: { action: body.action, text: "" } });
      const check = runWritingChecks(body.content ?? "");
      // The same payload shape `POST /api/ai/studio` returns for `inspect`.
      return route.fulfill({
        json: {
          action: "inspect",
          text: `${check.suggestions.length} suggestions`,
          suggestions: check.suggestions,
          meta: { score: check.score, grade: check.grade, tone: check.tone.label, counts: check.counts },
        },
      });
    }

    // Writes are answered with a success so the composer's autosave cannot bounce
    // the page to /auth/signin mid-test. Nothing is persisted — this route never
    // leaves the browser, so no draft can reach a database.
    if (request.method() !== "GET") {
      return route.fulfill({ json: { post: { id: "e2e-stub", slug: "e2e-stub" } } });
    }

    return route.fulfill({ json: { posts: [] } });
  });
}

test("underlines a flawed draft and applies a fix to its exact range", async ({ page }) => {
  await stubApi(page);

  // Wait for the studio's mount effect before typing. The composer is a
  // controlled textarea, so anything written before React hydrates is wiped by
  // the first render — which looks exactly like "the checks never ran".
  const hydrated = page.waitForResponse((r) => r.url().includes("mine=true"));
  await page.goto("/studio");
  await hydrated;

  const editor = page.getByPlaceholder(/^Start writing your story/);
  await editor.fill(DRAFT);

  const marks = page.locator("[data-check-id]");
  await expect(marks.first()).toBeVisible();

  // The flagged ranges are the real ones the copilot produced for this draft.
  const flagged = await marks.allTextContents();
  expect(flagged).toContain(TARGET.original);
  expect(flagged).toContain("seperate");
  expect(flagged).toContain("definately");

  // The mirror must carry the textarea's text byte for byte, or every underline
  // drifts off its word further down the draft.
  await expect(editor).toHaveValue(DRAFT);
  expect(await page.locator("[data-checked-editor-mirror]").textContent()).toBe(DRAFT);

  // The underline is actually drawn, not merely described in the DOM.
  const target = marks.filter({ hasText: new RegExp(`^${TARGET.original}$`) });
  await expect(target).toHaveCount(1);
  await expect(target).toHaveCSS("text-decoration-line", "underline");

  await target.click();
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card).toContainText(TARGET.original);
  await expect(card).toContainText(TARGET.replacement);
  await card.getByRole("button", { name: "Apply fix" }).click();

  await expect(editor).toHaveValue(AFTER_ONE_FIX);

  // "Exact range" means the head and tail survive untouched: the fix is a splice
  // into the draft, not a re-render of it.
  const start = DRAFT.indexOf(TARGET.original);
  expect(AFTER_ONE_FIX.slice(0, start)).toBe(DRAFT.slice(0, start));
  expect(AFTER_ONE_FIX.slice(start + TARGET.replacement.length)).toBe(
    DRAFT.slice(start + TARGET.original.length)
  );

  // ...and the mirror tracked the edit, so the marks that survive stay aligned.
  expect(await page.locator("[data-checked-editor-mirror]").textContent()).toBe(AFTER_ONE_FIX);

  // The debounce re-checks the corrected draft: the fixed word is no longer
  // flagged, the other two still are (their offsets shifted, and still land).
  await expect(marks.filter({ hasText: /^recieve$/ })).toHaveCount(0);
  await expect(marks.filter({ hasText: /^seperate$/ })).toHaveCount(1);

  // The autosave was stubbed to success, so nothing redirected to sign-in.
  await expect(page).toHaveURL(/\/studio$/);
});
