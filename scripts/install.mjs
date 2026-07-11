import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadInstallReceipt, saveInstallReceipt } from "./install_receipt.mjs";
import {
  configuredSkillProviders,
  DEFAULT_AGENT_SYNC_CONFIG,
  physicalPath,
} from "./provider_config.mjs";
import { verifySkillDependencies } from "./verify_skill_dependencies.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(repoRoot, "skills");
const defaultTarget = path.join(os.homedir(), ".agents", "skills");
const localAgentSyncBin = path.join(repoRoot, "node_modules", ".bin", "agent-sync");
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const usage = `Usage:
  install.mjs [options]

Options:
  --skill <name>     Skill to install. Defaults to all folders under skills/.
  --target <path>    Skills directory. Defaults to $HOME/.agents/skills.
  --replace          Replace an existing installed skill.
  --update           Replace one skill and run agent-sync for it.
  --sync-providers   Run agent-sync after installing selected skills.
  --agent-sync-bin <path>
                     agent-sync executable. Defaults to the local dependency, then PATH.
  --agent-sync-config <path>
                     Config used to validate and record provider destinations.
  --agent-sync-provider <flag>
                     Provider flag for agent-sync. Repeatable. Defaults to --all-providers.
  --help             Show this help.
`;

function parseArgs(argv) {
  const options = {
    skill: null,
    target: defaultTarget,
    replace: false,
    update: false,
    syncProviders: false,
    agentSyncBin: null,
    agentSyncConfig: DEFAULT_AGENT_SYNC_CONFIG,
    agentSyncConfigExplicit: false,
    agentSyncProviderFlags: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--skill") {
      options.skill = requireValue(argv, ++index, arg);
    } else if (arg === "--target") {
      options.target = requireValue(argv, ++index, arg);
    } else if (arg === "--replace") {
      options.replace = true;
    } else if (arg === "--update") {
      options.update = true;
      options.replace = true;
      options.syncProviders = true;
    } else if (arg === "--sync-providers") {
      options.syncProviders = true;
    } else if (arg === "--agent-sync-bin") {
      options.agentSyncBin = requireValue(argv, ++index, arg);
    } else if (arg === "--agent-sync-config") {
      options.agentSyncConfig = requireValue(argv, ++index, arg);
      options.agentSyncConfigExplicit = true;
    } else if (arg === "--agent-sync-provider") {
      options.agentSyncProviderFlags.push(requireValue(argv, ++index, arg, { allowFlagValue: true }));
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }

  if (options.skill) validateSkillName(options.skill);
  if (options.update && !options.skill) {
    throw new Error("--update requires --skill <name> so provider sync stays narrowly scoped.");
  }
  if (options.agentSyncConfigExplicit && !options.syncProviders) {
    throw new Error("--agent-sync-config requires --sync-providers or --update.");
  }

  options.target = path.resolve(expandHome(options.target));
  options.agentSyncBin = expandHome(options.agentSyncBin || defaultAgentSyncBin());
  options.agentSyncConfig = path.resolve(expandHome(options.agentSyncConfig));
  if (options.agentSyncProviderFlags.length === 0) {
    options.agentSyncProviderFlags = ["--all-providers"];
  }
  for (const flag of options.agentSyncProviderFlags) {
    if (!flag.startsWith("--")) {
      throw new Error(`Invalid --agent-sync-provider ${flag}. Expected a flag beginning with --.`);
    }
  }
  options.target = validateTarget(options.target);
  options.targetIdentity = readTargetIdentity(options.target);
  return options;
}

function requireValue(argv, index, flag, { allowFlagValue = false } = {}) {
  const value = argv[index];
  if (!value || (!allowFlagValue && value.startsWith("--"))) {
    throw new Error(`Missing value for ${flag}.\n\n${usage}`);
  }
  return value;
}

function expandHome(value) {
  const homeDir = os.homedir();
  if (value === "$HOME" || value === "${HOME}") return homeDir;
  if (value === "~") return homeDir;
  if (value.startsWith("$HOME/")) return path.join(homeDir, value.slice("$HOME/".length));
  if (value.startsWith("${HOME}/")) return path.join(homeDir, value.slice("${HOME}/".length));
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

function defaultAgentSyncBin() {
  return fs.existsSync(localAgentSyncBin) ? localAgentSyncBin : "agent-sync";
}

function isValidSkillName(name) {
  return skillNamePattern.test(name);
}

function validateSkillName(name) {
  if (!isValidSkillName(name)) {
    throw new Error(
      `Invalid skill name ${name}. Use lowercase letters, digits, and hyphens only.`,
    );
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function validateTarget(target) {
  if (target === path.parse(target).root) {
    throw new Error("Refusing to install skills directly into the filesystem root.");
  }

  if (target === os.homedir()) {
    throw new Error("Refusing to install skills directly into the home directory.");
  }

  const targetStats = fs.lstatSync(target, { throwIfNoEntry: false });
  if (targetStats?.isSymbolicLink() && !fs.existsSync(target)) {
    throw new Error(`Refusing to use a broken symlink as the install target: ${target}`);
  }
  if (targetStats && !fs.statSync(target).isDirectory()) {
    throw new Error(`Expected the install target to be a directory: ${target}`);
  }

  const physicalTarget = physicalPath(target);
  const physicalSkillsRoot = physicalPath(skillsRoot);
  if (pathsOverlap(physicalTarget, physicalSkillsRoot)) {
    throw new Error(
      `Refusing to install into a target that overlaps this repository's skill sources: ${target}`,
    );
  }

  return physicalTarget;
}

function pathsOverlap(left, right) {
  return left === right || isInside(left, right) || isInside(right, left);
}

function validateInstallPaths(source, destination, target) {
  if (!isInside(skillsRoot, source)) {
    throw new Error(`Refusing to install from outside this repo's skills directory: ${source}`);
  }

  if (!isInside(target, destination)) {
    throw new Error(`Refusing to install outside the target directory: ${destination}`);
  }

  const relativeToSource = path.relative(source, destination);
  const relativeToDestination = path.relative(destination, source);
  const samePath = relativeToSource === "";
  const destinationInsideSource =
    Boolean(relativeToSource) &&
    !relativeToSource.startsWith("..") &&
    !path.isAbsolute(relativeToSource);
  const sourceInsideDestination =
    Boolean(relativeToDestination) &&
    !relativeToDestination.startsWith("..") &&
    !path.isAbsolute(relativeToDestination);

  if (samePath || destinationInsideSource || sourceInsideDestination) {
    throw new Error("Refusing to install where source and destination overlap.");
  }
}

function installableSkillNames() {
  if (!fs.existsSync(skillsRoot)) {
    throw new Error(`No skills directory found at ${skillsRoot}.`);
  }

  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(isValidSkillName)
    .filter((name) => fs.existsSync(path.join(skillsRoot, name, "SKILL.md")))
    .sort();
}

function installSkill(name, options) {
  validateSkillName(name);
  const source = path.join(skillsRoot, name);
  const destination = path.join(options.target, name);
  validateInstallPaths(source, destination, options.target);

  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new Error(`No skill named ${name} found at ${source}.`);
  }

  fs.mkdirSync(options.target, { recursive: true });
  options.targetIdentity = assertTargetIdentity(options.target, options.targetIdentity);

  const existingDestination = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existingDestination) {
    if (
      existingDestination.isSymbolicLink() &&
      physicalPath(resolvedLinkTarget(destination)) === physicalPath(source)
    ) {
      console.log(`${name}: already linked -> ${destination}`);
      return;
    }
    if (!options.replace) {
      throw new Error(
        `${destination} already exists. Remove it first or rerun with --replace.`,
      );
    }
    options.targetIdentity = assertTargetIdentity(options.target, options.targetIdentity);
    const currentDestination = fs.lstatSync(destination, { throwIfNoEntry: false });
    if (
      !currentDestination ||
      currentDestination.dev !== existingDestination.dev ||
      currentDestination.ino !== existingDestination.ino
    ) {
      throw new Error(`Refusing to replace an entry that changed during install: ${destination}`);
    }
    removeExistingDestination(destination, existingDestination);
  }

  options.targetIdentity = assertTargetIdentity(options.target, options.targetIdentity);
  fs.symlinkSync(source, destination, "dir");

  console.log(`${name}: symlink -> ${destination}`);
}

function resolvedLinkTarget(linkPath) {
  return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
}

function readTargetIdentity(target) {
  const stats = fs.lstatSync(target, { throwIfNoEntry: false });
  return stats ? { device: stats.dev, inode: stats.ino } : null;
}

function assertTargetIdentity(target, expectedIdentity) {
  const stats = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stats?.isDirectory() || stats.isSymbolicLink() || physicalPath(target) !== target) {
    throw new Error(`Refusing to use an install target that changed after validation: ${target}`);
  }
  if (
    expectedIdentity &&
    (stats.dev !== expectedIdentity.device || stats.ino !== expectedIdentity.inode)
  ) {
    throw new Error(`Refusing to use a replaced install target: ${target}`);
  }
  return expectedIdentity || { device: stats.dev, inode: stats.ino };
}

function removeExistingDestination(destination, stats) {
  if (stats.isSymbolicLink()) {
    fs.unlinkSync(destination);
    return;
  }

  fs.rmSync(destination, { recursive: true, force: true });
}

function syncProviderSkills(skillNames, options) {
  const args = [...options.agentSyncProviderFlags];
  for (const skillName of skillNames) {
    args.push("--skill", skillName);
  }

  console.log(`agent-sync: ${options.agentSyncBin} ${args.join(" ")}`);
  const result = spawnSync(options.agentSyncBin, args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`Failed to run agent-sync: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`agent-sync exited with status ${result.status}.`);
  }
}

function recordProviderDestinations(skillNames, options, receipt, layout) {
  for (const name of skillNames) {
    const installation = receipt.skills[name];
    const destinations = new Set(installation.providerDestinations || []);
    const expectedTargets = new Set([
      path.join(skillsRoot, name),
      path.join(physicalPath(skillsRoot), name),
      path.join(options.target, name),
      path.join(physicalPath(options.target), name),
    ]);

    for (const provider of layout.providers) {
      const providerEntry = path.join(provider.destinationDir, name);
      const stats = fs.lstatSync(providerEntry, { throwIfNoEntry: false });
      if (
        stats?.isSymbolicLink() &&
        expectedTargets.has(resolvedLinkTarget(providerEntry))
      ) {
        destinations.add(physicalPath(provider.destinationDir));
      }
    }

    installation.providerDestinations = [...destinations].sort();
  }
  saveInstallReceipt(options.target, receipt);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const names = options.skill ? [options.skill] : installableSkillNames();

  if (names.length === 0) {
    throw new Error("No installable skill folders found under skills/.");
  }

  const providerLayout = options.syncProviders
    ? await configuredSkillProviders({
        configPath: options.agentSyncConfig,
        sourceDir: options.target,
      })
    : null;
  if (providerLayout && !providerLayout.matchedSource) {
    throw new Error(
      `The install target is not a skills source in ${options.agentSyncConfig}; refusing to sync unrelated provider directories: ${options.target}`,
    );
  }

  verifySkillDependencies(names, { quiet: true });
  const receipt = loadInstallReceipt(options.target);

  for (const name of names) {
    installSkill(name, options);
    const previousDestinations = receipt.skills[name]?.providerDestinations || [];
    receipt.skills[name] = {
      source: path.join(skillsRoot, name),
      providerDestinations: previousDestinations,
    };
    saveInstallReceipt(options.target, receipt);
  }

  if (options.syncProviders) {
    syncProviderSkills(names, options);
    recordProviderDestinations(names, options, receipt, providerLayout);
  }
}

try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
