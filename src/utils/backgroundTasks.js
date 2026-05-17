/** Keeps background promises alive until they settle (helps on some hosts after HTTP response). */
const pending = new Set();

/**
 * Run work after the current request without blocking the response.
 * @param {string} label
 * @param {() => void | Promise<void>} fn
 */
export function runInBackground(label, fn) {
  const task = Promise.resolve()
    .then(fn)
    .then(() => {
      // eslint-disable-next-line no-console
      console.info(`[background] ${label} completed`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[background] ${label} failed`, err);
    })
    .finally(() => {
      pending.delete(task);
    });
  pending.add(task);
}

export function pendingBackgroundTaskCount() {
  return pending.size;
}
