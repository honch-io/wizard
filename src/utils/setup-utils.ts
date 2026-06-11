import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { withProgress } from '../telemetry';
import { debug, logToFile } from './debug';
import type { PackageJson } from './package-json';
import {
  type PackageManager,
  detectAllPackageManagers,
  NPM as npm,
} from './package-manager';
import type { CloudRegion, WizardRunOptions } from './types';
import { getDeclaredVersion } from './package-json';
import { DUMMY_PROJECT_API_KEY, ISSUES_URL } from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';

// OAuth/provisioning were removed in the Honch fork. These shims keep the
// (now-dead) login/signup helpers below compiling without resurrecting the
// deleted modules; they are never reached — getOrAskForProjectData uses the
// bearer-token flow. TODO: delete the dead helpers and these shims.
const getOAuthScopesForProgram = (
  _programId?: unknown,
): readonly string[] => [];
import { analytics } from './analytics';
import { getUI } from '@ui';
import { PlatformClient } from '@lib/platform/client';
import {
  getCloudUrlFromRegion,
  getHostFromRegion,
  detectRegionFromToken,
} from './urls';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const performOAuthFlow = (_opts?: any): Promise<any> => {
  throw new Error('OAuth was removed in the Honch wizard fork.');
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const provisionNewAccount = (..._args: any[]): Promise<any> => {
  throw new Error('Signup provisioning was removed in the Honch wizard fork.');
};
import { fetchUserData, fetchProjectData, type ApiUser } from '@lib/api';
import { versionSatisfiesRange } from './semver';
import { wizardAbort } from './wizard-abort';

interface ProjectData {
  projectApiKey: string;
  accessToken: string;
  host: string;
  distinctId: string;
  projectId: number;
  /**
   * Optional `role_at_organization` from `/api/users/@me/`. Drives the
   * role-tailored prompt suggestions on the McpSuggestedPromptsScreen. Null
   * for signup flows (no role picked yet) and older accounts.
   */
  roleAtOrganization?: string | null;
  /**
   * Full user payload from `/api/users/@me/`. Carried through so
   * `getOrAskForProjectData` can forward it to the session as
   * `session.apiUser`. Null when the request failed or the CI key
   * lacked permissions.
   */
  user?: ApiUser | null;
}

export interface CliSetupConfig {
  filename: string;
  name: string;
  gitignore: boolean;

  likelyAlreadyHasAuthToken(contents: string): boolean;
  tokenContent(authToken: string): string;

  likelyAlreadyHasOrgAndProject(contents: string): boolean;
  orgAndProjContent(org: string, project: string): string;

  likelyAlreadyHasUrl?(contents: string): boolean;
  urlContent?(url: string): string;
}

export interface CliSetupConfigContent {
  authToken: string;
  org?: string;
  project?: string;
  url?: string;
}

/** @deprecated Use wizardAbort() directly for new code. */
export async function abort(message?: string, status?: number): Promise<never> {
  return wizardAbort({ message, exitCode: status });
}

export function isInGitRepo(): boolean {
  try {
    childProcess.execSync('git rev-parse --show-toplevel', {
      stdio: 'ignore',
    });
  } catch {
    return false;
  }
  return true;
}

const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mail.com',
  'protonmail.com',
  'proton.me',
  'live.com',
  'aol.com',
  'yandex.com',
  'zoho.com',
  'gmx.com',
  'fastmail.com',
]);

function parseGitRemote(): { org: string; repo: string } | null {
  try {
    const url = childProcess
      .execSync('git remote get-url origin', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString()
      .trim();
    // git@github.com:acme-corp/my-app.git or https://github.com/acme-corp/my-app.git
    const match = url.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (match) return { org: match[1], repo: match[2] };
  } catch {
    // not in a git repo or no remote
  }
  return null;
}

export function detectOrgAndProject(email: string): {
  orgName: string | undefined;
  projectName: string | undefined;
} {
  const remote = parseGitRemote();

  // Project name: git repo name > directory name
  const projectName = remote?.repo || basename(process.cwd()) || undefined;

  // Org name: git remote org > email domain (skip freemail)
  let orgName: string | undefined;
  if (remote?.org) {
    orgName = remote.org;
  } else {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && !FREEMAIL_DOMAINS.has(domain)) {
      orgName = domain.split('.')[0];
    }
  }

  return { orgName, projectName };
}

export function getUncommittedOrUntrackedFiles(): string[] {
  let gitStatus: string;
  try {
    gitStatus = childProcess
      .execSync('git status --porcelain=v1', {
        // we only care about stdout
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString();
  } catch {
    return [];
  }

  const result: string[] = [];
  for (const rawLine of gitStatus.split(os.EOL)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^\S+\s+(\S+)/.exec(line);
    result.push(`- ${match?.[1]}`);
  }
  return result;
}

export async function isReact19Installed({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  try {
    const packageJson = await tryGetPackageJson({ installDir });
    if (!packageJson) return false;
    const reactVersion = getDeclaredVersion('react', packageJson);

    if (!reactVersion) {
      return false;
    }

    return versionSatisfiesRange({
      version: reactVersion,
      acceptableVersions: '>=19.0.0',
      canBeLatest: true,
    });
  } catch {
    return false;
  }
}

/**
 * Installs or updates a package with the user's package manager.
 *
 * IMPORTANT: This function modifies the `package.json`! Be sure to re-read
 * it if you make additional modifications to it after calling this function!
 */
export async function installPackage({
  packageName,
  alreadyInstalled,
  packageNameDisplayLabel,
  packageManager,
  integration,
  installDir,
}: {
  packageName: string;
  alreadyInstalled: boolean;
  packageNameDisplayLabel?: string;
  packageManager?: PackageManager;
  integration?: string;
  installDir: string;
}): Promise<{ packageManager?: PackageManager }> {
  return withProgress('install-package', async () => {
    const sdkInstallSpinner = getUI().spinner();

    const pkgManager =
      packageManager || (await getPackageManager({ installDir }));

    const isReact19 = await isReact19Installed({ installDir });
    const legacyPeerDepsFlag =
      isReact19 && pkgManager.name === 'npm' ? '--legacy-peer-deps' : '';

    sdkInstallSpinner.start(
      `${alreadyInstalled ? 'Updating' : 'Installing'} ${
        packageNameDisplayLabel ?? packageName
      } with ${pkgManager.label}.`,
    );

    const execAsync = promisify(childProcess.exec);
    const installCommand =
      `${pkgManager.installCommand} ${packageName} ${pkgManager.flags} ${legacyPeerDepsFlag}`.trim();

    try {
      await execAsync(installCommand, { cwd: installDir });
    } catch (e) {
      const { stdout = '', stderr = '' } = (e ?? {}) as {
        stdout?: string;
        stderr?: string;
      };
      fs.writeFileSync(
        join(
          process.cwd(),
          `honch-wizard-installation-error-${Date.now()}.log`,
        ),
        JSON.stringify({ stdout, stderr }),
        { encoding: 'utf8' },
      );
      sdkInstallSpinner.stop('Installation failed.');
      getUI().log.error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Encountered the following error during installation:\n\n${e}\n\nThe wizard has created a \`honch-wizard-installation-error-*.log\` file. If you think this issue is caused by the Honch wizard, create an issue on GitHub and include the log file's content:\n${ISSUES_URL}`,
      );
      await abort();
    }

    sdkInstallSpinner.stop(
      `${alreadyInstalled ? 'Updated' : 'Installed'} ${
        packageNameDisplayLabel ?? packageName
      } with ${pkgManager.label}.`,
    );

    analytics.wizardCapture('package installed', {
      package_name: packageName,
      package_manager: pkgManager.name,
      integration,
    });

    return { packageManager: pkgManager };
  });
}

/**
 * Get package.json or abort the wizard if not found.
 * Only use where package.json is required (e.g., package install, overrides).
 * For detection/version-checks, use tryGetPackageJson() instead.
 */
export async function getPackageDotJson({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<PackageJson> {
  const pkgPath = join(installDir, 'package.json');

  let raw: string;
  try {
    raw = await fs.promises.readFile(pkgPath, 'utf8');
  } catch {
    getUI().log.error(
      'Could not find package.json. Make sure to run the wizard in the root of your app!',
    );
    await abort();
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as PackageJson | null;
    return parsed ?? {};
  } catch {
    getUI().log.error(
      `Unable to parse your package.json. Make sure it has a valid format!`,
    );
    await abort();
    return {};
  }
}

/**
 * Try to get package.json, returning null if it doesn't exist.
 * Use this for detection purposes where missing package.json is expected (e.g., Python projects).
 */
export async function tryGetPackageJson({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<PackageJson | null> {
  try {
    const packageJsonFileContents = await fs.promises.readFile(
      join(installDir, 'package.json'),
      'utf8',
    );
    return JSON.parse(packageJsonFileContents) as PackageJson;
  } catch {
    return null;
  }
}

export async function updatePackageDotJson(
  packageDotJson: PackageJson,
  { installDir }: Pick<WizardRunOptions, 'installDir'>,
): Promise<void> {
  const pkgPath = join(installDir, 'package.json');
  const serialized = JSON.stringify(packageDotJson, null, 2);

  try {
    await fs.promises.writeFile(pkgPath, serialized, {
      encoding: 'utf8',
      flag: 'w',
    });
    return;
  } catch {
    getUI().log.error(`Unable to update your package.json.`);
    await abort();
  }
}

/**
 * Detect and return the package manager. Pure — no prompts.
 * Falls back to first detected or npm if ambiguous.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getPackageManager(
  options: Pick<WizardRunOptions, 'installDir'> & { ci?: boolean },
): Promise<PackageManager> {
  const detectedPackageManagers = detectAllPackageManagers({
    installDir: options.installDir,
  });

  if (detectedPackageManagers.length >= 1) {
    const selected = detectedPackageManagers[0];
    analytics.setTag('package-manager', selected.name);
    return selected;
  }

  // No package manager detected — default to npm
  analytics.setTag('package-manager', npm.name);
  return npm;
}

export function isUsingTypeScript({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): boolean {
  try {
    fs.accessSync(join(installDir, 'tsconfig.json'));
    return true;
  } catch {
    return false;
  }
}

function normalizeHonchBearerToken(token?: string): string | undefined {
  const normalized = token?.replace(/\s+/g, '');
  return normalized && normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve everything an agent run needs from a single Honch bearer token:
 *   1. mint a short-lived wizard token for the LLM proxy
 *   2. list the user's projects and pick one (its honch_ capture key)
 *
 * No login, no prompts on the happy path. The raw bearer is used only here
 * (to mint + list); only the minted wizard token leaves as `accessToken`.
 */
export async function getOrAskForProjectData(options: {
  token?: string;
  apiBaseUrl: string;
  captureHost: string;
  project?: string;
}): Promise<{
  host: string;
  apiBaseUrl: string;
  projectApiKey: string;
  accessToken: string;
  projectId: string;
  projectName: string;
  cloudRegion: CloudRegion;
  roleAtOrganization: string | null;
  user: ApiUser | null;
}> {
  const bearer = normalizeHonchBearerToken(options.token);
  if (!bearer) {
    getUI().log.error(
      'No Honch token found. Run `honch login` to sign in (it saves your token for future runs), or pass it as the first argument, --token <bearer>, or HONCH_WIZARD_TOKEN.',
    );
    await abort();
    throw new Error('unreachable');
  }
  if (bearer.startsWith('honch_')) {
    getUI().log.error(
      'The value passed as <token> looks like a Honch project capture key. The wizard needs your Honch dashboard bearer token; it will resolve the honch_ project key itself.',
    );
    await abort(
      'Pass a Honch dashboard bearer token, not the honch_ project capture key.',
    );
    throw new Error('unreachable');
  }
  if (options.token !== bearer) {
    logToFile('[setup-utils] removed whitespace from pasted Honch token');
  }

  const client = new PlatformClient(options.apiBaseUrl);
  logToFile(
    `[setup-utils] resolving Honch project data via ${options.apiBaseUrl}`,
  );

  // Mint the short-lived wizard token that authenticates the agent's LLM
  // calls through the proxy. Requires the normal user bearer.
  let wizardToken: string;
  try {
    ({ accessToken: wizardToken } = await withProgress('login', () =>
      client.createWizardToken(bearer),
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A rejected bearer (commonly an expired saved login) — point the user at
    // `honch login` rather than surfacing a raw HTTP 401/403.
    if (/HTTP 401|HTTP 403/.test(message)) {
      getUI().log.error(
        'Your Honch login was rejected (it may have expired). Run `honch login` to sign in again.',
      );
      await abort();
      throw new Error('unreachable');
    }
    throw error;
  }
  logToFile('[setup-utils] minted wizard token');

  // List projects to resolve the capture key. The backend rejects the wizard
  // token on this route, so the raw user bearer is required here.
  const projects = await client.listProjects(bearer);
  logToFile(`[setup-utils] listed ${projects.length} Honch project(s)`);
  if (projects.length === 0) {
    getUI().log.error(
      `No Honch projects found for this account.\nCreate one in the dashboard, then re-run the wizard.\n${ISSUES_URL}`,
    );
    await abort();
    throw new Error('unreachable');
  }

  const selected = selectProject(projects, options.project);
  logToFile(`[setup-utils] selected Honch project ${selected.id}`);
  analytics.setTag('project-id', selected.id);

  if (!selected.apiKey) {
    getUI().log.warn(
      `Project "${selected.name}" did not return a capture key; using a placeholder ("${DUMMY_PROJECT_API_KEY}") for you to replace.`,
    );
  }

  return {
    host: options.captureHost,
    apiBaseUrl: options.apiBaseUrl,
    projectApiKey: selected.apiKey || DUMMY_PROJECT_API_KEY,
    accessToken: wizardToken,
    projectId: selected.id,
    projectName: selected.name,
    cloudRegion: 'us',
    roleAtOrganization: null,
    user: null,
  };
}

/**
 * Pick the project to install into: `--project` match (by id or name), else
 * the only project, else the first (logged so the choice is visible).
 */
function selectProject(
  projects: import('@lib/platform/client').ProjectResponse[],
  override?: string,
): import('@lib/platform/client').ProjectResponse {
  if (override) {
    const match = projects.find(
      (p) => p.id === override || p.name === override,
    );
    if (match) return match;
    getUI().log.warn(
      `Project "${override}" not found; falling back to "${projects[0].name}".`,
    );
  } else if (projects.length > 1) {
    getUI().log.info(
      `Using project "${projects[0].name}". Pass --project <id|name> to choose another.`,
    );
  }
  return projects[0];
}

async function askForWizardLogin(options: {
  signup: boolean;
  email?: string;
  region?: CloudRegion;
  /** Used to pick the right scope set via `getOAuthScopesForProgram`.
   *  Omitted → default `WIZARD_OAUTH_SCOPES`. */
  programId?: ProgramId | null;
}): Promise<ProjectData & { cloudRegion: CloudRegion }> {
  if (options.signup) {
    return askForProvisioningSignup(options.email, options.region);
  }

  const tokenResponse = await performOAuthFlow({
    scopes: [...getOAuthScopesForProgram(options.programId)],
    signup: false,
  });

  const projectId = tokenResponse.scoped_teams?.[0];

  if (projectId === undefined) {
    const error = new Error(
      'No project access granted. Please authorize with project-level access.',
    );
    analytics.captureException(error, {
      step: 'wizard_login',
      has_scoped_teams: !!tokenResponse.scoped_teams,
    });
    getUI().log.error(error.message);
    await abort();
  }

  const cloudRegion = await detectRegionFromToken(tokenResponse.access_token);
  const cloudUrl = getCloudUrlFromRegion(cloudRegion);
  const host = getHostFromRegion(cloudRegion);

  const projectData = await fetchProjectData(
    tokenResponse.access_token,
    projectId,
    cloudUrl,
  );
  const userData = await fetchUserData(tokenResponse.access_token, cloudUrl);

  const data = {
    accessToken: tokenResponse.access_token,
    projectApiKey: projectData.api_token,
    host,
    distinctId: userData.distinct_id,
    projectId: projectId,
    cloudRegion,
    roleAtOrganization: userData.role_at_organization ?? null,
    user: userData,
  };

  getUI().log.success('Login complete.');
  analytics.setTag('opened-wizard-link', true);
  analytics.setDistinctId(data.distinctId);

  return data;
}

async function askForProvisioningSignup(
  email?: string,
  region?: CloudRegion,
): Promise<ProjectData & { cloudRegion: CloudRegion }> {
  if (!email || !email.includes('@')) {
    getUI().log.error(
      'Email is required for signup. Use --email your@email.com with --signup.',
    );
    await abort();
    throw new Error('unreachable');
  }

  const spinner = getUI().spinner();
  spinner.start('Creating your Honch account...');

  try {
    const provisionRegion = (region ?? 'us').toUpperCase() as 'US' | 'EU';
    const { orgName, projectName } = detectOrgAndProject(email);
    const result = await provisionNewAccount(email, '', provisionRegion, {
      orgName,
      projectName,
    });

    spinner.stop('Account created!');
    getUI().log.success('Welcome to Honch!');

    const host = result.host;
    const cloudRegion: CloudRegion = host.includes('eu.') ? 'eu' : 'us';

    analytics.setTag('provisioning-signup', true);

    return {
      accessToken: result.accessToken,
      projectApiKey: result.projectApiKey,
      host,
      distinctId: email,
      projectId: parseInt(result.projectId, 10) || 0,
      cloudRegion,
    };
  } catch (error) {
    spinner.stop('Account creation failed.');
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('already associated')) {
      getUI().log.info(
        'This email already has a Honch account. Switching to login flow...',
      );
      return askForWizardLogin({ signup: false });
    }

    getUI().log.error(`Failed to create account: ${message}`);
    analytics.captureException(
      error instanceof Error ? error : new Error(message),
      { step: 'provisioning_signup' },
    );
    await abort();
    throw error;
  }
}

/**
 * Creates a new config file with the given filepath and codeSnippet.
 */
export async function createNewConfigFile(
  filepath: string,
  codeSnippet: string,
  { installDir }: Pick<WizardRunOptions, 'installDir'>,
  moreInformation?: string,
): Promise<boolean> {
  if (!isAbsolute(filepath)) {
    debug(`createNewConfigFile: filepath is not absolute: ${filepath}`);
    return false;
  }

  const prettyFilename = relative(installDir, filepath);

  try {
    await fs.promises.writeFile(filepath, codeSnippet);

    getUI().log.success(`Added new ${prettyFilename} file.`);

    if (moreInformation) {
      getUI().log.info(moreInformation);
    }

    return true;
  } catch (e) {
    debug(e);
    getUI().log.warn(
      `Could not create a new ${prettyFilename} file. Please create one manually and follow the instructions below.`,
    );
  }

  return false;
}
