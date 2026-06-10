import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';
import { IS_PRODUCTION_BUILD } from '@env';
import { toCommandModule, type Command } from './commands/command';

/**
 * Global yargs options applied to every command. These are read from the
 * `HONCH_WIZARD` env prefix as well as flags.
 */
export const GLOBAL_OPTIONS = {
  debug: {
    default: false,
    describe: 'Enable verbose logging\nenv: HONCH_WIZARD_DEBUG',
    type: 'boolean' as const,
  },
  token: {
    describe:
      'Honch platform bearer token. Paste it once and the wizard installs the SDK automatically.\nenv: HONCH_WIZARD_TOKEN',
    type: 'string' as const,
  },
  'api-base-url': {
    describe:
      'Honch platform API base URL (mints the wizard token + lists projects)\nenv: HONCH_WIZARD_API_BASE_URL',
    type: 'string' as const,
  },
  'capture-host': {
    describe:
      'Honch event-ingestion host the installed SDK uploads to\nenv: HONCH_WIZARD_CAPTURE_HOST',
    type: 'string' as const,
  },
  project: {
    describe:
      'Project id or name to install into (defaults to your only/first project)\nenv: HONCH_WIZARD_PROJECT',
    type: 'string' as const,
  },
  'device-model': {
    describe:
      'Device model to stamp on events (firmware targets)\nenv: HONCH_WIZARD_DEVICE_MODEL',
    type: 'string' as const,
  },
  'firmware-version': {
    describe:
      'Firmware version to stamp on events (firmware targets)\nenv: HONCH_WIZARD_FIRMWARE_VERSION',
    type: 'string' as const,
  },
  telemetry: {
    default: true,
    describe:
      'Reserved (no-op). The Honch wizard sends no telemetry.\nenv: HONCH_WIZARD_TELEMETRY',
    type: 'boolean' as const,
    hidden: true,
  },
};

export class Wizard {
  private cli: Argv;

  private constructor() {
    let cli = yargs(hideBin(process.argv))
      .env('HONCH_WIZARD')
      .options(GLOBAL_OPTIONS);

    // CI mode (--ci) is only supported in dev/test. It is left undeclared in
    // published builds (NODE_ENV==='production'), so .strictOptions() rejects
    // it there as an unknown argument — exactly like any other unrecognized
    // flag. init() additionally detects it up front to print a clearer message.
    if (!IS_PRODUCTION_BUILD) {
      cli = cli.option('ci', {
        default: false,
        describe:
          'Enable CI mode for non-interactive execution\nenv: HONCH_WIZARD_CI',
        type: 'boolean',
      });
    }

    this.cli = cli
      .strictOptions()
      // Print the error first (bright red) and the usage below it, instead of
      // yargs' default of burying the message under the full help output.
      .fail((msg, err, parser) => {
        const text = msg || (err && err.message) || 'Invalid arguments';
        process.stderr.write(`\n\x1b[1;91m✖ ${text}\x1b[0m\n\n`);
        parser.showHelp();
        process.exit(1);
      })
      .help()
      .alias('help', 'h')
      .version()
      .alias('version', 'v');
  }

  /** Start a chain; equivalent to `new Wizard().use(...cmds)`. */
  static use(...cmds: Command[]): Wizard {
    return new Wizard().use(...cmds);
  }

  /** Register one or more commands with yargs. */
  use(...cmds: Command[]): this {
    for (const cmd of cmds) {
      this.cli = this.cli.command(toCommandModule(cmd, []));
    }
    return this;
  }

  /** Parse argv and dispatch to the matching registered command. */
  init(): void {
    // In published builds, `--ci` is undeclared, so yargs would reject it as
    // an unknown argument — accurate but unhelpful, since --help doesn't list
    // --ci either and the user has no path forward. HONCH_WIZARD_CI silently
    // no-ops for the same reason (yargs only resolves env vars for declared
    // options). Detect both up front and exit with a message that explains why.
    if (IS_PRODUCTION_BUILD) {
      const args = process.argv.slice(2);
      const argvHasCI = args.some(
        (a) => a === '--ci' || a === '--no-ci' || a.startsWith('--ci='),
      );
      const envHasCI =
        process.env.HONCH_WIZARD_CI != null &&
        process.env.HONCH_WIZARD_CI !== '';
      if (argvHasCI || envHasCI) {
        process.stderr.write(
          `\n\x1b[1;91m✖ CI mode is not currently supported in published builds.\x1b[0m\n\n`,
        );
        process.exit(1);
      }
    }
    void this.cli.wrap(process.stdout.isTTY ? this.cli.terminalWidth() : 80)
      .argv;
  }
}
