/**
 * Open a URL in the user's default browser, cross-platform.
 *
 * Intentionally dependency-free (the `opn`/`open` packages add a transitive
 * tree and aren't reliably installed here). Best-effort: if spawning the
 * opener fails we swallow the error — the caller always also prints the URL so
 * the user can open it manually (and headless/SSH sessions rely on that path).
 */
import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  let command: string;
  let args: string[];

  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      // `start` is a cmd builtin; the empty "" is the (ignored) window title.
      command = 'cmd';
      args = ['/c', 'start', '""', url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }

  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    });
    // Don't let a missing opener (e.g. no xdg-open) crash the process.
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Ignore — the URL is printed for manual opening.
  }
}
