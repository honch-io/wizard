import { getUI } from '@ui';

/** Print the "needs a TTY" error and exit. Used when no `--ci` flag and no TTY. */
export function failNonInteractive(): void {
  getUI().intro('Honch Wizard');
  getUI().log.error(
    'This installer requires an interactive terminal (TTY) to run.\n' +
      'It appears you are running in a non-interactive environment.\n' +
      'Please run the wizard in an interactive terminal, e.g.:\n\n' +
      '  npx -y @honch/wizard <your-honch-token>',
  );
  process.exit(1);
}
