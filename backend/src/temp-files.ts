import { rm } from "node:fs/promises";
import { safeError, type Logger } from "./observability.js";

type RemoveDir = (dir: string) => Promise<void>;

const removeRecursively: RemoveDir = (dir) =>
  rm(dir, { recursive: true, force: true });

/**
 * Best-effort temp cleanup. A failure here must never replace or hide the
 * request's real outcome, so it is logged and swallowed.
 */
export async function discardTempDir(
  dir: string,
  logger: Logger,
  remove: RemoveDir = removeRecursively,
): Promise<void> {
  try {
    await remove(dir);
  } catch (error) {
    logger.warn("temp_cleanup_failed", { dir, ...safeError(error) });
  }
}
