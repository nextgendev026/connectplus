import { inngest } from "@/lib/inngest";
import { createLogger } from "@/lib/logger";
import {
  embedAndStoreMessage,
  refreshRollingSummary,
  updateProfileFromTurn,
  SUMMARY_EVERY_N_MESSAGES,
} from "@/lib/agent-memory";
import { prisma } from "@/lib/prisma";
import { recordHeartbeat } from "@/lib/job-heartbeat";

/**
 * Chat memory job.
 *
 * Fired after each general-purpose chat turn (`chat/embed`). Three independent
 * actions, each in its own step so one failing never costs the others:
 *
 *   1. **Embed** the user's message (and the answer) into per-user vector
 *      memory — the same best-effort pgvector write the post-embedding path
 *      uses.
 *   2. **Refresh the rolling profile summary** every 10 user messages.
 *   3. **Infer the language mix** from marker words and store it, so the next
 *      turn's prompt mirrors how the user actually writes.
 *
 * The embedding is the repository's own keyless 384-dim engine, deliberately
 * not `text-embedding-3-small`: this deployment has no OpenAI key, and the
 * vector space, dimension and cosine-search helpers already exist.
 */

const log = createLogger("inngest.chat-embed");

export const chatEmbed = inngest.createFunction(
  {
    id: "chat-embed",
    name: "Embed chat turns & maintain user memory",
    triggers: [{ event: "chat/embed" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ event, step }) => {
    const data = event.data as {
      messageId?: string;
      userMessageId?: string;
      userId?: string;
      userText?: string;
    };
    const { messageId, userMessageId, userId, userText } = data;
    if (!messageId || !userId) return { skipped: "missing ids" };

    await step.run("heartbeat", () => recordHeartbeat("chat-embed"));

    await step.run("embed-user-message", async () => {
      if (!userMessageId) return false;
      const row = await prisma.neuralMessage.findUnique({
        where: { id: userMessageId },
        select: { content: true },
      });
      if (!row) return false;
      return embedAndStoreMessage(userMessageId, row.content);
    });

    await step.run("embed-assistant-message", async () => {
      const row = await prisma.neuralMessage.findUnique({
        where: { id: messageId },
        select: { content: true },
      });
      if (!row) return false;
      return embedAndStoreMessage(messageId, row.content);
    });

    await step.run("update-language-mix", async () => {
      if (!userText) return false;
      await updateProfileFromTurn(userId, userText);
      return true;
    });

    await step.run("maybe-refresh-summary", async () => {
      const count = await prisma.neuralMessage.count({
        where: { userId, role: "user" },
      });
      // Every 10th user message closes a batch; the remainder check makes the
      // trigger self-correcting even if a job run is dropped.
      if (count === 0 || count % SUMMARY_EVERY_N_MESSAGES !== 0) return { refreshed: false, count };
      await refreshRollingSummary(userId);
      return { refreshed: true, count };
    });

    log.info("chat turn embedded", { userId, messageId });
    return { ok: true };
  }
);
