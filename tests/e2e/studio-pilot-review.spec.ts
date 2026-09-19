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
 * The inline assist widget — the copilot, in the composer.
 *
 * Addressed by its own label because the sidebar carries quick-edit buttons
 * with the same names, so "Improve" on its own is ambiguous — scoping to the
 * panel is what makes these clicks test the composer's assistant rather than
 * the sidebar's.
 */
const copilot = (page: Page) => page.locator('[aria-label="Copilot panel"]');

/** The widget's collapsible header, which is the part that sticks on a phone. */
const copilotHeader = (page: Page) => page.locator("[data-copilot-header]");

/**
 * Select the opening passage the way a writer does.
 *
 * A real drag is not reproducible in CI (the exact pixel a drag ends on depends
 * on font metrics and the browser's text layout), and the behaviour under test
 * is what the app does *with* a selection, not how the browser made it. The
 * `mouseup`/`keyup` pair is what React's select-event plugin listens for, so the
 * component sees a genuine selection event, and the assertion below proves the
 * bar actually appeared rather than assuming it.
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

  test("the copilot stays in reach above the bottom navigation", async ({ page }) => {
    await stubApi(page);
    await writeDraft(page);
    await selectOpening(page);

    // The widget's header row is sticky inside the editor, and the bottom nav is
    // fixed across the viewport at a higher z-index. Pinned to the editor's
    // bottom corner the row sat inside the nav's strip and every control's centre
    // hit a nav label — picking "Improve" used to navigate Home.
    //
    // The worst case is the bottom of the page, where the sticky row rests at its
    // offset and has nowhere left to move. That is where it is measured: clear of
    // the nav, and the topmost element at its own centre (which is what a tap
    // resolves to). Polled, because the app shows a full-screen boot screen for
    // its first ~1.4s on any hard load and everything is behind it until then.
    // Wait out the boot screen rather than racing it: for its first ~1.4s it is
    // the topmost element on the page and every hit test lands on it.
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll("div")).some((d) => String(d.className).includes("z-[80]"))
    );
    // Scroll until sticky is actually holding the row: past this point the row's
    // natural position would be off the bottom of the screen, so it rests at its
    // offset. This is the instant the old bar slid under the nav — the
    // document's very bottom is no test at all, because there the widget has long
    // since scrolled past the top of the screen.
    await page.evaluate(() => {
      const el = document.querySelector("[data-copilot-header]");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      window.scrollBy(0, Math.round(rect.bottom - window.innerHeight + 160));
    });
    await page.waitForTimeout(250);

    const place = await copilotHeader(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
      return {
        isSelf: hit === el || el.contains(hit as Node),
        clearOfNav: nav ? rect.bottom <= nav.getBoundingClientRect().top : true,
        hitText: (hit?.textContent ?? "").trim().slice(0, 24),
      };
    });

    expect(place.hitText, "what the tap would hit").toContain("Copilot");
    expect(place.isSelf, `the header must not be covered (hit: "${place.hitText}")`).toBe(true);
    expect(place.clearOfNav, "the header must sit above the bottom navigation").toBe(true);

    // ...and the panel it opens is usable from there.
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

  await copilot(page).getByRole("button", { name: "Write" }).click();
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

  // The tags landed too, and the SEO tab acknowledges them.
  await copilot(page).getByRole("button", { name: "SEO" }).click();
  await expect(copilot(page).getByText("kibera", { exact: true })).toBeVisible();
});
