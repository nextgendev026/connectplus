import { expect, test, type Page } from "@playwright/test";

/**
 * The app ships a service worker — it is a PWA — and a worker installed by an
 * earlier test will happily serve a stale shell into the next one. That shows up
 * as a second, hidden copy of the composer after a hydration mismatch, which is
 * a fact about the throwaway environment rather than about the studio. These
 * specs drive a live page with no backend; the worker has no business in it.
 */
test.use({ serviceWorkers: "block" });

/**
 * The Brain Pilot, end to end — the review half.
 *
 * The pilot answers with operations rather than prose, and every operation is
 * now shown as a diff before it can reach the draft. That is a promise about
 * *behaviour* (nothing lands unreviewed, and what lands is exactly what the diff
 * showed), so it is checked in a browser rather than in a unit test of the
 * applier alone.
 *
 * Hermetic, like `studio-checks.spec.ts`: the only database this project has is
 * the live production one, so every `/api/**` call is fulfilled inside the
 * browser — a signed-in session, no database, no provider. The two pilot replies
 * below are the whole model, which is what makes the assertions exact.
 */

const DRAFT =
  "The market in Kibera burned down last month and the traders are still waiting. We spoke to three vendors who lost everything.";
/** The selected passage, and the replacement the pilot proposes for it. */
const OPENING = "The market in Kibera burned down last month";
const REWRITE = "The county has pledged to rebuild the market before the long rains.";
const HEADLINE = "County Pledges Market Rebuild Before Rains";
/** Everything after the selection: it must survive every splice untouched. */
const TAIL = DRAFT.slice(DRAFT.indexOf(OPENING) + OPENING.length);

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

/** The outline the forged article is planned from. */
const OUTLINE = JSON.stringify({
  title: "Kibera traders wait on a rebuild promise",
  metaDescription: "Three months after the fire, the county's pledge has not broken ground.",
  hook: "Open with the vendor who lost everything.",
  sections: [
    { heading: "What happened", goal: "The fire and the loss." },
    { heading: "What was promised", goal: "The county's pledge and its date." },
    { heading: "What happens next", goal: "The timeline riders should watch." },
  ],
  faq: ["When will the market reopen?"],
  tags: ["kibera", "nairobi"],
});

const FAQ_BLOCK =
  "**When will the market reopen?**\n\nNo date has been set, and the county has not published a timeline.";

interface StubOptions {
  /** The ops the pilot "model" returns. Defaults to a body edit plus a headline. */
  ops?: { kind: string; text: string; find?: string }[];
  /** The conversational line shown above the diff. */
  reply?: string;
}

/** Fulfil every API call in the browser so no request can reach a real backend. */
async function stubApi(page: Page, options: StubOptions = {}) {
  const ops = options.ops ?? [
    { kind: "replace-selection", text: REWRITE },
    { kind: "set-title", text: HEADLINE },
  ];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/api/auth/session") return route.fulfill({ json: SESSION });

    if (path === "/api/ai/studio") {
      const body = (request.postDataJSON() ?? {}) as { action?: string; promptKind?: string; prompt?: string };
      if (body.action === "pilot") {
        return route.fulfill({
          json: { action: "pilot", text: options.reply ?? "Recast the opening for pace.", ops },
        });
      }

      // The Article Forge asks for one part at a time. Every part here reads
      // finished, so the spec is testing the finishing rules rather than the
      // repair loop (which `article-forge.test.ts` covers with a cut fake).
      if (body.action === "compose") {
        if (body.promptKind === "article-outline") {
          return route.fulfill({ json: { action: "compose", text: OUTLINE } });
        }
        const prompt = String(body.prompt ?? "");
        const text = /Answer these reader questions/i.test(prompt)
          ? FAQ_BLOCK
          : "The traders rebuilt what they could and started selling again on the roadside.";
        return route.fulfill({ json: { action: "compose", text } });
      }

      if (body.action === "learn") {
        // The learning path writes to the database, which this spec deliberately
        // does not have. The composer must not care.
        return route.fulfill({ json: { action: "learn", text: "ok" } });
      }
      // The live checker runs on a debounce while the writer types. An empty
      // suggestion list keeps the marks out of this spec's way — the inline fix
      // card has a spec of its own.
      return route.fulfill({
        json: {
          action: body.action ?? "inspect",
          text: "",
          suggestions: [],
          meta: { score: 100, grade: "A", tone: "Neutral", counts: {} },
        },
      });
    }

    if (path === "/api/upload") {
      return route.fulfill({ json: { url: "/uploads/e2e/inline-drop.webp" } });
    }

    if (method !== "GET") {
      // Autosave and publish are answered with a success so nothing bounces the
      // page to sign-in mid-test, and nothing is persisted.
      return route.fulfill({ json: { post: { id: "e2e-stub", slug: "e2e-stub" } } });
    }

    return route.fulfill({ json: { posts: [] } });
  });
}

// Role locators rather than placeholder ones: the accessible name comes from the
// placeholder either way, and role locators address the *visible* node — which
// matters because a hydration mismatch can leave an unreachable twin in the DOM
// that a placeholder query would count.
const editor = (page: Page) => page.getByRole("textbox", { name: /^Start writing your story/ });
const headline = (page: Page) => page.getByRole("textbox", { name: "Your story title..." });
const review = (page: Page) => page.locator('[aria-label="Proposed edits"]');

/**
 * The copilot — one panel, in the sidebar.
 *
 * There is no longer an assistant inside the composer: the quick edits, the
 * Article Forge and the SEO audit are a single surface here, and every edit it
 * proposes still lands in the composer's review panel.
 *
 * `:visible` because the sidebar is rendered twice on a phone — the hidden
 * desktop column and the open drawer — and only one of them is ever on screen.
 */
const copilot = (page: Page) => page.locator("[data-copilot]:visible");

/** On a phone the sidebar is a drawer; this is the button that opens it. */
const copilotOpener = (page: Page) => page.locator("[data-copilot-open]");

/**
 * Select the opening passage the way a writer does.
 *
 * A real drag is not reproducible in CI (the exact pixel a drag ends on depends
 * on font metrics and the browser's text layout), and the behaviour under test
 * is what the app does *with* a selection, not how the browser made it. The
 * `mouseup`/`keyup` pair is what React's select-event plugin listens for, so the
 * component sees a genuine selection event — the pilot measures the range at
 * click time, so "selected" here means what the app itself will read.
 */
async function selectOpening(page: Page) {
  await editor(page).evaluate((el, needle) => {
    const textarea = el as HTMLTextAreaElement;
    const start = textarea.value.indexOf(needle);
    textarea.focus();
    textarea.setSelectionRange(start, start + needle.length);
    textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
  }, OPENING);
  await expect(copilot(page)).toBeVisible();
}

/**
 * Write the draft, then wait for the composer to hold it.
 *
 * The page restores a draft backup from `localStorage` and the composer is a
 * controlled textarea, so text written before React hydrates is wiped by the
 * first render — which looks exactly like "the pilot never answered".
 */
async function writeDraft(page: Page) {
  const hydrated = page.waitForResponse((r) => r.url().includes("mine=true"));
  await page.goto("/studio");
  await hydrated;
  await dismissConsent(page);
  await editor(page).fill(DRAFT);
  await expect(editor(page)).toHaveValue(DRAFT);
}

/**
 * Answer the cookie banner, as a returning writer already has.
 *
 * It is a fixed strip across the bottom of the viewport — the same band the
 * inline pilot bar and the fix card occupy on a phone — so leaving it up would
 * make every mobile assertion a test of the banner rather than of the composer.
 */
async function dismissConsent(page: Page) {
  const essential = page.getByRole("button", { name: "Essential only" });
  // Waited for rather than sniffed: the banner mounts a beat after the page
  // does, so an `isVisible()` check taken too early silently returns false and
  // leaves the banner up for the rest of the spec.
  const appeared = await essential
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) await essential.click();
}

test("shows the proposed change as a diff and applies only the edits that are kept", async ({ page }) => {
  await stubApi(page);
  await writeDraft(page);
  await selectOpening(page);

  await copilot(page).getByRole("button", { name: "Improve", exact: true }).click();

  // Nothing was applied yet — the reply is staged, not written.
  await expect(review(page)).toBeVisible();
  await expect(editor(page)).toHaveValue(DRAFT);
  await expect(headline(page)).toHaveValue("");

  // Two edits, each labelled with the field it touches.
  await expect(review(page).getByText("Rewrite the selected passage")).toBeVisible();
  await expect(review(page).getByText("Set the headline")).toBeVisible();

  // The body edit is shown as a diff, not as the finished sentence: what the
  // rewrite drops is struck through and what it adds is highlighted, so the
  // writer reads the change instead of inferring it from a re-worded draft.
  // The diff is word-level, so the shared words of the two sentences ("The",
  // "market") stay plain and the assertion is about the words that differ.
  await expect(review(page).locator("span.line-through")).toContainText("Kibera");
  await expect(review(page)).toContainText("pledged to rebuild");

  // Keep the body edit only. The headline edit is untouched, so it must not land.
  await review(page).getByRole("button", { name: "Keep", exact: true }).first().click();

  await expect(editor(page)).toHaveValue(`${REWRITE}${TAIL}`);
  await expect(headline(page)).toHaveValue("");
  // "Exact range" means the head and tail survive: the edit is a splice.
  expect(TAIL).toBe(DRAFT.slice(DRAFT.indexOf(OPENING) + OPENING.length));

  // The surviving edit is re-diffed against the draft it will actually change.
  await expect(review(page).getByRole("button", { name: "Keep", exact: true })).toHaveCount(1);
  await review(page).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(headline(page)).toHaveValue(HEADLINE);
  // The panel closes once every edit has been decided.
  await expect(review(page)).toHaveCount(0);

  // One undo rewinds the whole reply, back to the draft as it was written —
  // not one step of it, which would leave a state the writer never wrote.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor(page)).toHaveValue(DRAFT);
  await expect(headline(page)).toHaveValue("");
});

/**
 * The stale-reply guard.
 *
 * This is the failure the whole review panel exists to prevent, and it was live
 * until now: the ops are applied against the draft the *request* was made from,
 * so anything the writer typed while the panel was open was replaced — and
 * because undo captured that same old snapshot, the newer paragraph was gone
 * with no way back to it.
 *
 * The spec asserts the three things that make the fix real rather than a
 * message: the refusal is enforced (not merely displayed), the writer can still
 * choose to apply, and once they do, undo returns them to their own text.
 */
test("refuses a reply written against a draft that has since moved, and undo still reaches the newer text", async ({ page }) => {
  await stubApi(page);
  await writeDraft(page);
  await selectOpening(page);
  await copilot(page).getByRole("button", { name: "Improve", exact: true }).click();
  await expect(review(page)).toBeVisible();

  // The writer keeps writing after the request went out. This is the ordinary
  // case, not an exotic one: the panel sits under the editor and a model reply
  // takes seconds.
  const LATER = `${DRAFT} A second paragraph, typed while the pilot was thinking.`;
  await editor(page).fill(LATER);
  await expect(editor(page)).toHaveValue(LATER);

  // The panel says so, in the writer's terms, before they read the diffs.
  await expect(review(page).getByText(/may be out of date/i)).toBeVisible();
  await expect(review(page)).toContainText("body");

  // And the refusal is enforced: Keep does not land it.
  await review(page).getByRole("button", { name: "Keep", exact: true }).first().click();
  await expect(editor(page)).toHaveValue(LATER);
  await expect(review(page)).toBeVisible();

  // The writer can still say yes. Doing so accepts that the reply is applied to
  // the text it was written for — which is why the warning has to be honest.
  await review(page).getByRole("button", { name: /apply against the current draft/i }).click();
  await review(page).getByRole("button", { name: "Keep", exact: true }).first().click();
  await expect(editor(page)).toHaveValue(`${REWRITE}${TAIL}`);

  // The point of the whole exercise: their own paragraph is recoverable. One
  // undo must reach LATER, not the pre-reply draft — an undo that returned to
  // DRAFT would destroy the newer work it was supposed to protect.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor(page)).toHaveValue(LATER);
});

test("an in-sync reply applies without a conflict and needs no confirmation", async ({ page }) => {
  await stubApi(page);
  await writeDraft(page);
  await selectOpening(page);
  await copilot(page).getByRole("button", { name: "Improve", exact: true }).click();
  await expect(review(page)).toBeVisible();

  // Nothing typed since the request, so the warning must be absent. A guard that
  // fires when nothing relevant changed is one the writer learns to click past,
  // which would defeat it on the one occasion it matters.
  await expect(review(page).getByText(/may be out of date/i)).toHaveCount(0);

  await review(page).getByRole("button", { name: "Keep", exact: true }).first().click();
  await expect(editor(page)).toHaveValue(`${REWRITE}${TAIL}`);
});

test("discarding an edit leaves the draft and the fields exactly as they were", async ({ page }) => {
  await stubApi(page);
  await writeDraft(page);
  await selectOpening(page);

  await copilot(page).getByRole("button", { name: "Tighten", exact: true }).click();
  await expect(review(page)).toBeVisible();

  await review(page).getByRole("button", { name: "Discard all" }).click();

  await expect(review(page)).toHaveCount(0);
  await expect(editor(page)).toHaveValue(DRAFT);
  await expect(headline(page)).toHaveValue("");
});

test("an edit the draft can no longer satisfy is shown as unapplicable", async ({ page }) => {
  // The model quotes a phrase that is not in the draft — the shape a reply takes
  // when the passage it was written against has already been edited away.
  await stubApi(page, { ops: [{ kind: "fix", find: "the traders are already rebuilding", text: "traders rebuilt" }] });
  await writeDraft(page);
  await selectOpening(page);

  await copilot(page).getByRole("button", { name: "Fix", exact: true }).click();

  const panel = review(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("cannot apply")).toBeVisible();
  // The one action left is to dismiss it: Keep is disabled rather than silently
  // doing nothing.
  await expect(panel.getByRole("button", { name: "Keep", exact: true })).toBeDisabled();
  await expect(editor(page)).toHaveValue(DRAFT);
});

test("a dropped image lands as markdown at the caret", async ({ page }) => {
  await stubApi(page);
  await writeDraft(page);

  // Put the caret mid-draft: the insertion point has to be where the writer left
  // it, not wherever focus drifted while the upload was in flight.
  const caret = DRAFT.indexOf(" and the traders") + 1;
  await editor(page).evaluate((el, at) => {
    const textarea = el as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(at, at);
    textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, caret);

  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "market-ribbon.png", { type: "image/png" }));
    return dt;
  });

  // Dispatched on the textarea and allowed to bubble: the composer's wrapper is
  // the element that handles the drop, and bubbling is how a real drop reaches
  // it from wherever inside the editor the writer let go.
  await editor(page).dispatchEvent("dragover", { dataTransfer });
  await editor(page).dispatchEvent("drop", { dataTransfer });

  const expected = `${DRAFT.slice(0, caret)}\n\n![market ribbon](/uploads/e2e/inline-drop.webp)\n\n${DRAFT.slice(caret)}`;
  await expect(editor(page)).toHaveValue(expected);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 320, height: 757 } });

  test("the copilot opens from the tools drawer and still reviews its edits", async ({ page }) => {
    await stubApi(page);
    await writeDraft(page);

    // At this width the sidebar is a drawer, so the copilot has to be opened
    // before it can be used. The trigger sits above the fixed bottom navigation,
    // which is the band the old floating bar used to slide under.
    const opener = copilotOpener(page);
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(copilot(page)).toBeVisible();

    const place = await copilot(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(place.width, "the drawer must hold the panel").toBeGreaterThan(200);

    await selectOpening(page);
    await copilot(page).getByRole("button", { name: "Improve", exact: true }).click();
    await expect(review(page)).toBeVisible();
  });
});

test("writes a whole article and hands it over for review, section by section", async ({ page }) => {
  await stubApi(page);

  // An empty composer: the request is a commission, not an edit.
  const hydrated = page.waitForResponse((r) => r.url().includes("mine=true"));
  await page.goto("/studio");
  await hydrated;
  await dismissConsent(page);

  await copilot(page).getByRole("textbox", { name: "Article topic" }).fill("the Kibera market fire");
  await copilot(page).getByRole("button", { name: "Write the full article" }).click();

  // The forge plans, then writes every part: the summary only exists once the
  // whole piece has been assembled.
  await expect(copilot(page).getByText(/words · \d+ sections/)).toBeVisible({ timeout: 20_000 });
  await copilot(page).getByRole("button", { name: "Review before it lands" }).click();

  // Four ops, reviewed individually: the body, the headline, the excerpt, the tags.
  const panel = review(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Rewrite the whole draft")).toBeVisible();
  await expect(panel.getByText("Set the headline")).toBeVisible();
  await expect(panel.getByText("Set the excerpt")).toBeVisible();
  await expect(panel.getByText("Add tags")).toBeVisible();
  // Nothing has been written into the composer yet.
  await expect(editor(page)).toHaveValue("");

  await panel.getByRole("button", { name: /^Keep all/ }).click();

  const article = await editor(page).inputValue();
  // Every planned section is present, including the FAQ the forge writes last…
  for (const heading of ["What happened", "What was promised", "What happens next", "Frequently asked questions"]) {
    expect(article, `missing section: ${heading}`).toContain(`## ${heading}`);
  }
  // …the piece is titled, and it finishes on a full stop rather than mid-air.
  expect(article).toContain("# Kibera traders wait on a rebuild promise");
  expect(article.trim().endsWith(".")).toBe(true);
  await expect(headline(page)).toHaveValue("Kibera traders wait on a rebuild promise");
  await expect(page.getByRole("textbox", { name: /brief summary/i })).toHaveValue(
    "Three months after the fire, the county's pledge has not broken ground."
  );

  // The tags landed too, and the sidebar's tag panel shows them.
  await page.getByRole("button", { name: "SEO & Tags" }).click();
  await expect(page.getByText("#kibera")).toBeVisible();
});
