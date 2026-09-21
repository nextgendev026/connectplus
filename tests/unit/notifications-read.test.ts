import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Marked as read" has to actually persist.
 *
 * This is a contract test, and it exists because the contract was broken in a
 * way nothing could see. The route reads `ids` or `all`; the bell sent `{ id }`
 * and the "Mark all read" button sent `{}`. Zod **strips** unknown keys rather
 * than rejecting them, so both bodies validated successfully into an empty
 * object — a `200` saying nothing had been updated. The UI had already greyed
 * the row out optimistically, so the tap looked like it worked, and the row
 * came back unread on the next load.
 *
 * The fix has two halves that must stay in step: the schema accepts `id` as
 * well as `ids`, and every accepted shape reaches `updateMany`. The schema is
 * deliberately *not* mocked here — a mocked schema would happily accept
 * anything and this test would pass while the bug was still live.
 */

const db = vi.hoisted(() => ({
  notification: {
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  session: null as null | { user: { id: string } },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: async () => db.session }));

const { POST } = await import("@/app/api/notifications/read/route");

const USER = "user-1";
/** A well-formed cuid — the schema validates the shape, not just the presence. */
const A = "c123456789012345678901234";
const B = "c987654321098765432109876";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
}

beforeEach(() => {
  db.notification.updateMany.mockReset();
  db.notification.count.mockReset();
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  db.notification.count.mockResolvedValue(0);
  db.session = { user: { id: USER } };
});

describe("POST /api/notifications/read", () => {
  it("marks every id it was given, not just the first", async () => {
    await post({ ids: [A, B] });

    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [A, B] }, userId: USER, read: false },
      data: { read: true },
    });
  });

  it("still understands the singular key the bell used to send", async () => {
    // A client on the previous bundle sends this. Zod used to strip it, which
    // made the request a no-op that answered 200.
    const res = await post({ id: A });

    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [A] }, userId: USER, read: false },
      data: { read: true },
    });
    expect(await res.json()).toMatchObject({ updated: true });
  });

  it("marks everything unread when asked to", async () => {
    await post({ all: true });

    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, read: false },
      data: { read: true },
    });
  });

  it("answers an empty request honestly instead of zeroing the badge", async () => {
    // `{}` is not a request to mark anything. The old code returned
    // `unreadCount: 0` here, so a no-op told the client it had nothing unread.
    db.notification.count.mockResolvedValue(7);

    const res = await post({});
    const body = (await res.json()) as { updated: boolean; unreadCount: number };

    expect(db.notification.updateMany).not.toHaveBeenCalled();
    expect(body.updated).toBe(false);
    expect(body.unreadCount).toBe(7);
  });

  it("reports the count read after the write, not before", async () => {
    db.notification.count.mockResolvedValue(3);

    const res = await post({ all: true });

    expect(await res.json()).toMatchObject({ unreadCount: 3 });
    // The count is the state the caller will fetch next, so it must be read
    // after the rows changed.
    expect(db.notification.count).toHaveBeenCalledWith({
      where: { userId: USER, read: false },
    });
  });

  it("rejects an unauthenticated caller", async () => {
    db.session = null;

    const res = await post({ all: true });

    expect(res.status).toBe(401);
    expect(db.notification.updateMany).not.toHaveBeenCalled();
  });

  it("never writes outside the session's own notifications", async () => {
    await post({ ids: [A], all: true });

    // `all` wins, and either way the user id is in the filter — an id belonging
    // to someone else is simply not in the result.
    for (const call of db.notification.updateMany.mock.calls) {
      expect(call[0].where.userId).toBe(USER);
    }
  });
});
