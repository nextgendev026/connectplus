/**
 * Branch staging for agent-authored code changes.
 *
 * The agent never writes to the branch a human is working on. It writes to
 * `ai-patch-staging`, validates there, and either commits there or throws the
 * whole workspace away. The point is that "the agent made a mess" and "the
 * repository is fine" can both be true at once.
 *
 * The dangerous part of that is generic to any tool that switches branches: it
 * happens inside a working tree a human shares. `git checkout` over someone's
 * uncommitted work does not error, it carries the changes across or refuses with
 * a message nobody reads — so the first guard here is a refusal to start at all
 * unless the tree is clean. That makes this tool unusable in the middle of a
 * human's edit session, which is the correct trade: an unavailable agent is
 * better than a lost afternoon of someone's work.
 */

import simpleGit, { type SimpleGit } from "simple-git";
import { GuardrailError } from "./guardrails";

/** The one branch the agent is ever allowed to create or delete. */
export const STAGING_BRANCH = "ai-patch-staging";

const git: SimpleGit = simpleGit({ baseDir: process.cwd(), maxConcurrentProcesses: 1 });

export interface StagingSession {
  /** The branch to return to, and the parent of the staging branch. */
  base: string;
  /** The commit the staging branch was created from — the rollback target. */
  baseCommit: string;
  branch: string;
}

async function dirtyPaths(): Promise<string[]> {
  // `--porcelain` is stable across git versions and locale settings, unlike the
  // human-readable status this deliberately does not parse.
  const status = await git.status();
  return status.files.map((f) => f.path);
}

/**
 * Open a staging branch, or refuse.
 *
 * @throws GuardrailError when the tree is dirty, the repository is in a detached
 *   or mid-merge state, or the base branch cannot be determined. All three are
 *   refusals rather than recoveries: there is no safe automatic answer to "this
 *   repo is halfway through something".
 */
export async function beginStaging(): Promise<StagingSession> {
  const inside = await git.checkIsRepo().catch(() => false);
  if (!inside) {
    throw new GuardrailError("Not inside a git repository, so changes cannot be staged.", "path_denied");
  }

  const status = await git.status();
  if (status.conflicted.length > 0) {
    throw new GuardrailError(
      `Repository has unresolved merge conflicts (${status.conflicted.join(", ")}). Resolve them first.`,
      "path_denied",
    );
  }

  const dirty = await dirtyPaths();
  // Our own staging branch is exempt: re-running after a failed validation leaves
  // the tree dirty with the very change being retried.
  if (status.current !== STAGING_BRANCH && dirty.length > 0) {
    throw new GuardrailError(
      `The working tree has ${dirty.length} uncommitted change(s) ` +
        `(${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", …" : ""}). ` +
        "The agent will not switch branches over work that is not its own — " +
        "commit or stash it first.",
      "path_denied",
    );
  }

  const base = status.current ?? "main";
  const baseCommit = (await git.revparse([base])).trim();

  if (base !== STAGING_BRANCH) {
    const branches = await git.branchLocal();
    if (branches.all.includes(STAGING_BRANCH)) {
      // A leftover branch from an interrupted run must not carry its old commits
      // into the new attempt, so it is moved to the base rather than reused.
      await git.checkout(["-B", STAGING_BRANCH, baseCommit]);
    } else {
      await git.checkoutBranch(STAGING_BRANCH, baseCommit);
    }
  }

  return { base, baseCommit, branch: STAGING_BRANCH };
}

/** Stage and commit on the staging branch, and report the resulting commit. */
export async function commitStaging(
  session: StagingSession,
  message: string,
  paths: string[],
): Promise<{ commit: string }> {
  const status = await git.status();
  if (status.current !== session.branch) {
    throw new GuardrailError(
      `Expected to be on ${session.branch} but found ${status.current ?? "a detached HEAD"}.`,
      "path_denied",
    );
  }
  if (status.files.length === 0) {
    throw new GuardrailError("Nothing to commit — the patch made no changes.", "path_denied");
  }

  // Explicit paths rather than `-A`: the agent stages what it wrote, and never
  // sweeps up a file a human happened to leave lying around.
  await git.add(paths.filter(Boolean));

  const result = await git.commit(message);
  return { commit: result.commit };
}

/**
 * Discard the attempt and return to the base branch.
 *
 * The reset is what makes the rollback real: `git checkout` will happily carry
 * modified files onto the base branch, so the written files are discarded *while
 * still on the staging branch* and only then is the branch switched and deleted.
 * Doing it the other way round leaves the agent's half-finished edit sitting in a
 * human's working tree.
 */
export async function rollbackStaging(session: StagingSession): Promise<string[]> {
  const notes: string[] = [];
  const status = await git.status();

  if (status.current === session.branch) {
    await git.reset(["--hard", session.baseCommit]);
    notes.push(`Discarded changes and reset ${session.branch} to ${session.baseCommit.slice(0, 8)}.`);
  }

  await git.checkout(session.base);
  notes.push(`Returned to ${session.base}.`);

  const branches = await git.branchLocal();
  if (branches.all.includes(STAGING_BRANCH)) {
    await git.deleteLocalBranch(STAGING_BRANCH, true);
    notes.push(`Deleted ${STAGING_BRANCH}.`);
  }

  return notes;
}

/** Read-only facts about the working tree, for the diagnostics tool and the UI. */
export async function repositoryState(): Promise<{
  branch: string | null;
  dirty: string[];
  lastCommit: string;
}> {
  const status = await git.status();
  const log = await git.log({ maxCount: 1 });
  return {
    branch: status.current,
    dirty: status.files.map((f) => f.path),
    lastCommit: log.latest ? `${log.latest.hash.slice(0, 8)} ${log.latest.message}` : "none",
  };
}
