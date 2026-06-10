import type { Arguments } from 'yargs';
import { runWizard } from '@lib/runners';
import { honchIntegrationConfig } from '@lib/programs/honch-integration/index';

/** Default flow: run the honch-integration program through the TUI. */
export function runInteractive(argv: Arguments): void {
  runWizard(honchIntegrationConfig, argv);
}
