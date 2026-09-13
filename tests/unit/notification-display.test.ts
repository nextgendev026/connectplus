import { describe, expect, it } from "vitest";
import {
  describeNotification,
  notificationHref,
  notificationKind,
} from "../../src/lib/notification-display";

/**
 * Notification presentation contract.
 *
 * The bug this locks down: the bell applied its social template to every type,
 * so a sports alert — which has no actor — rendered as "Someone kick-off soon".
 * Any future type must therefore be classified explicitly rather than falling
 * through to the social copy.
 */

describe("notificationKind", () => {
  it("classifies sports alerts by their prefix", () => {
    expect(notificationKind("SPORTS_LIVE")).toBe("sports");
    expect(notificationKind("SPORTS_KICKOFF")).toBe("sports");
    expect(notificationKind("SPORTS_PICK_SETTLED")).toBe("sports");
  });

  it("classifies the social types", () => {
    expect(notificationKind("FOLLOW")).toBe("follow");
    expect(notificationKind("COMMENT")).toBe("comment");
    expect(notificationKind("REPLY")).toBe("reply");
    expect(notificationKind("MODERATION_APPROVED")).toBe("moderation");
    expect(notificationKind("POST_PUBLISHED")).toBe("publish");
  });

  it("treats an unknown type as a system message rather than a follow", () => {
    expect(notificationKind("SOMETHING_NEW")).toBe("system");
    expect(notificationKind("")).toBe("system");
  });
});

describe("describeNotification", () => {
  it("never invents an actor for a sports alert", () => {
    const view = describeNotification({
      type: "SPORTS_LIVE",
      title: "Goal or kick-off — it's live",
      message: "Gor Mahia 1-0 AFC Leopards (34') · Kenyan Premier League",
    });

    expect(view.headline).toBe("Goal or kick-off — it's live");
    expect(view.body).toContain("Gor Mahia 1-0 AFC Leopards");
    expect(view.headline).not.toContain("Someone");
    expect(view.body).not.toContain("Someone");
  });

  it("points a sports alert at the board, not the home page", () => {
    expect(notificationHref({ type: "SPORTS_FINAL" })).toBe("/sports");
    expect(describeNotification({ type: "SPORTS_FINAL" }).href).toBe("/sports");
  });

  it("falls back to a usable body when a sports alert has no message", () => {
    const view = describeNotification({ type: "SPORTS_KICKOFF" });
    expect(view.headline).toBe("Match update");
    expect(view.body.length).toBeGreaterThan(0);
  });

  it("names the actor and the story for a social notification", () => {
    const view = describeNotification({
      type: "COMMENT",
      message: "Someone commented on your story.",
      actor: { name: "Wanjiru", username: "wanjiru" },
      post: { slug: "harvest-report", title: "Harvest report" },
    });

    expect(view.headline).toBe("Wanjiru");
    // The server writes the actor's line, so it must not be repeated twice.
    expect(view.body).toContain("commented on your story.");
    expect(view.body).toContain("Harvest report");
  });

  it("does not double the actor when the stored message names them", () => {
    const view = describeNotification({
      type: "FOLLOW",
      message: "Wanjiru started following you.",
      actor: { name: "Wanjiru", username: "wanjiru" },
    });
    expect(view.body).toBe("started following you.");
  });

  it("uses the username when the actor has no display name", () => {
    const view = describeNotification({
      type: "REPLY",
      actor: { name: null, username: "otieno" },
    });
    expect(view.headline).toBe("@otieno");
  });

  it("routes a post notification to the article", () => {
    expect(
      notificationHref({ type: "POST_PUBLISHED", post: { slug: "the-story" } })
    ).toBe("/article/the-story");
  });

  it("routes a profile-only notification to the actor's profile", () => {
    expect(notificationHref({ type: "FOLLOW", actor: { username: "wanjiru" } })).toBe(
      "/profile/wanjiru"
    );
  });

  it("degrades to the notifications list when nothing identifies a target", () => {
    expect(notificationHref({ type: "SYSTEM_TEST" })).toBe("/");
  });
});
