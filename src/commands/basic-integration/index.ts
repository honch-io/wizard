import { isNonInteractiveEnvironment } from '@utils/environment';
import { honchIntegrationConfig } from '@lib/programs/honch-integration/index';
import type { Command } from '../command';

export const basicIntegrationCommand: Command = {
  name: ['$0'],
  description: 'Install the Honch SDK into your project',
  options: {
    'install-dir': {
      describe: 'Directory to install Honch in\nenv: HONCH_WIZARD_INSTALL_DIR',
      type: 'string',
    },
  },
  handler: (argv) => {
    // Each mode file is loaded only when its branch is taken.
    void (async () => {
      if (argv.ci) {
        const { runWizardCI } = await import('@lib/runners');
        return runWizardCI(honchIntegrationConfig, argv);
      }
      if (isNonInteractiveEnvironment()) {
        const { failNonInteractive } = await import('./non-interactive');
        return failNonInteractive();
      }
      const { runInteractive } = await import('./interactive');
      runInteractive(argv);
    })();
  },
};
