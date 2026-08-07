/**
 * Close-on-done GitHub issue integration.
 *
 * `done` closes a task's linked issue through the local `gh` CLI. This lives
 * in the CLI layer (not a Store backend): the issue link is an ordinary task
 * link, so every backend inherits the behavior for free. The close is
 * fail-soft by contract - the done-transition is the primary act and has
 * already succeeded before any close is attempted; callers report a failed
 * close loudly instead of failing the command.
 */

import { execFile } from "node:child_process";

/** Result of one attempted issue close, surfaced in `done` output. */
export interface IssueCloseOutcome {
  url: string;
  closed: boolean;
  error?: string;
}

/** gh close reasons: completed by default, not planned for a dropped close. */
export type IssueCloseReason = "completed" | "not planned";

/** Closes one issue; rejects with a human-readable Error on failure. */
export type IssueCloser = (
  url: string,
  comment: string | undefined,
  reason: IssueCloseReason,
) => Promise<void>;

const GH_TIMEOUT_MS = 30_000;

/** The production closer: `gh issue close <url> --reason <reason>`. */
export const ghIssueCloser: IssueCloser = (url, comment, reason) =>
  new Promise((resolve, reject) => {
    const args = ["issue", "close", url, "--reason", reason];
    if (comment !== undefined) args.push("--comment", comment);
    execFile("gh", args, { timeout: GH_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (!err) return resolve();
      const detail =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "gh CLI not found on PATH"
          : stderr.split("\n")[0].trim() || err.message;
      reject(new Error(detail));
    });
  });

/** Attempt every close, never throwing; each failure becomes an outcome. */
export async function closeIssues(
  urls: string[],
  closer: IssueCloser,
  comment: string | undefined,
  reason: IssueCloseReason,
): Promise<IssueCloseOutcome[]> {
  const outcomes: IssueCloseOutcome[] = [];
  for (const url of urls) {
    try {
      await closer(url, comment, reason);
      outcomes.push({ url, closed: true });
    } catch (err) {
      outcomes.push({
        url,
        closed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}
