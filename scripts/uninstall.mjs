import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadInstallReceipt, saveInstallReceipt } from "./install_receipt.mjs";
import {
  configuredSkillProviders,
  DEFAULT_AGENT_SYNC_CONFIG,
  physicalPath,
} from "./provider_config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(repoRoot, "skills");
const defaultTarget = path.join(os.homedir(), ".agents", "skills");
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const usage = `Usage:
  uninstall.mjs --skill <name[,name...]> [--skill <name[,name...]> ...] [options]
  uninstall.mjs --all [options]

Options:
  --skill <name[,name...]> Skill names to uninstall. Comma-separated and repeatable.
  --all                    Uninstall all skills owned by this repository.
  --target <path>          Skills directory. Defaults to $HOME/.agents/skills.
  --remove-provider-links  Also unlink ownership-verified provider links.
  --agent-sync-config <path>
                           agent-sync config used to discover provider targets.
  --dry-run                Show the complete removal plan without changing files.
  --help                   Show this help.
`;

function parseArgs(argv) {
  const options = {
    skills: [],
    all: false,
    target: defaultTarget,
    removeProviderLinks: false,
    agentSyncConfig: DEFAULT_AGENT_SYNC_CONFIG,
    agentSyncConfigExplicit: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--skill") {
      const value = requireValue(argv, ++index, arg);
      options.skills.push(...parseSkillNames(value));
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--target") {
      options.target = requireValue(argv, ++index, arg);
    } else if (arg === "--remove-provider-links") {
      options.removeProviderLinks = true;
    } else if (arg === "--agent-sync-config") {
      options.agentSyncConfig = requireValue(argv, ++index, arg);
      options.agentSyncConfigExplicit = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }

  options.skills = [...new Set(options.skills)];

  if (!options.all && options.skills.length === 0) {
    throw new Error(`Choose at least one --skill <name> or pass --all.\n\n${usage}`);
  }
  if (options.all && options.skills.length > 0) {
    throw new Error("--all cannot be combined with --skill.");
  }
  if (options.agentSyncConfigExplicit && !options.removeProviderLinks) {
    throw new Error("--agent-sync-config requires --remove-provider-links.");
  }

  options.targetConfigured = path.resolve(expandHome(options.target));
  options.agentSyncConfig = path.resolve(expandHome(options.agentSyncConfig));
  options.targetPhysical = validateTarget(options.targetConfigured, "uninstall target");
  options.target = options.targetPhysical;
  options.targetIdentity = readTargetIdentity(options.target);
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
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

function validateSkillName(name) {
  if (!skillNamePattern.test(name)) {
    throw new Error(
      `Invalid skill name ${name}. Use lowercase letters, digits, and hyphens only.`,
    );
  }
}

function parseSkillNames(value) {
  const names = value.split(",").map((name) => name.trim());
  if (names.some((name) => name === "")) {
    throw new Error(`Invalid --skill value ${value}: empty skill name.`);
  }
  for (const name of names) validateSkillName(name);
  return names;
}

function validateTarget(target, label) {
  if (target === path.parse(target).root) {
    throw new Error(`Refusing to use the filesystem root as a ${label}.`);
  }
  if (target === os.homedir()) {
    throw new Error(`Refusing to use the home directory as a ${label}.`);
  }

  const targetStats = fs.lstatSync(target, { throwIfNoEntry: false });
  if (targetStats?.isSymbolicLink() && !fs.existsSync(target)) {
    throw new Error(`Refusing to use a broken symlink as a ${label}: ${target}`);
  }
  if (targetStats && !fs.statSync(target).isDirectory()) {
    throw new Error(`Expected ${label} to be a directory: ${target}`);
  }

  const physicalTarget = physicalPath(target);
  if (pathsOverlap(physicalTarget, physicalPath(skillsRoot))) {
    throw new Error(
      `Refusing to uninstall from a target that overlaps this repository's skill sources: ${target}`,
    );
  }
  return physicalTarget;
}

function pathsOverlap(left, right) {
  return left === right || isInside(left, right) || isInside(right, left);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function validateDestination(target, destination) {
  if (!isInside(target, destination)) {
    throw new Error(`Refusing to uninstall outside the target directory: ${destination}`);
  }
}

function primaryExpectedTargets(name, receiptEntry) {
  const targets = new Set([
    path.join(skillsRoot, name),
    path.join(physicalPath(skillsRoot), name),
  ]);
  if (receiptEntry?.source) {
    targets.add(receiptEntry.source);
    targets.add(physicalPath(receiptEntry.source));
  }
  return targets;
}

function ownedPrimarySymlinkNames(target, receipt) {
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  return entries
    .map((entry) => entry.name)
    .filter((name) => skillNamePattern.test(name))
    .filter((name) => isOwnedPrimaryLink(name, target, receipt.skills[name]));
}

function isOwnedPrimaryLink(name, target, receiptEntry) {
  const destination = path.join(target, name);
  const stats = fs.lstatSync(destination, { throwIfNoEntry: false });
  return (
    stats?.isSymbolicLink() &&
    primaryExpectedTargets(name, receiptEntry).has(resolvedLinkTarget(destination))
  );
}

function selectedSkillNames(options, receipt, configuredProviders) {
  if (!options.all) return options.skills;
  return [
    ...new Set([
      ...Object.keys(receipt.skills),
      ...ownedPrimarySymlinkNames(options.target, receipt),
      ...ownedProviderSymlinkNames(configuredProviders, options, receipt),
    ]),
  ].sort();
}

function preflightPrimary(name, options, receiptEntry) {
  const destination = path.join(options.target, name);
  validateDestination(options.target, destination);
  const stats = fs.lstatSync(destination, { throwIfNoEntry: false });

  if (!stats) {
    return {
      type: "missing",
      role: "primary",
      name,
      path: destination,
      targetPhysical: options.targetPhysical,
      targetIdentity: options.targetIdentity,
    };
  }
  if (!stats.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-symlink skill entry: ${destination}`);
  }

  const linkTarget = fs.readlinkSync(destination);
  const resolvedTarget = path.resolve(path.dirname(destination), linkTarget);
  if (!primaryExpectedTargets(name, receiptEntry).has(resolvedTarget)) {
    throw new Error(
      `Refusing to unlink ${destination}: it points outside this repository's recorded skill source.`,
    );
  }

  return removalAction("primary", name, destination, stats, {
    linkTarget,
    targetPhysical: options.targetPhysical,
    targetIdentity: options.targetIdentity,
  });
}

async function providerTargets(options, receipt) {
  const layout = await configuredSkillProviders({
    configPath: options.agentSyncConfig,
    sourceDir: options.targetConfigured,
  });
  const targetsByPhysicalPath = new Map();

  function addTarget(configuredTarget, sourcePaths = []) {
    const targetPhysical = validateTarget(configuredTarget, "provider target");
    if (pathsOverlap(targetPhysical, options.targetPhysical)) {
      throw new Error(`Provider target overlaps the uninstall target: ${configuredTarget}`);
    }

    const existing = targetsByPhysicalPath.get(targetPhysical);
    if (existing) {
      for (const sourcePath of sourcePaths) existing.sourcePaths.add(sourcePath);
      return;
    }
    targetsByPhysicalPath.set(targetPhysical, {
      target: targetPhysical,
      targetPhysical,
      targetIdentity: readTargetIdentity(targetPhysical),
      sourcePaths: new Set(sourcePaths),
    });
  }

  for (const provider of layout.providers) {
    addTarget(provider.destinationDir, [
      provider.sourceDir,
      physicalPath(provider.sourceDir),
    ]);
  }

  const relevantReceiptEntries = options.all
    ? Object.values(receipt.skills)
    : options.skills.map((name) => receipt.skills[name]).filter(Boolean);
  for (const entry of relevantReceiptEntries) {
    for (const destination of entry.providerDestinations || []) {
      addTarget(destination, [entry.source, physicalPath(entry.source)]);
    }
  }

  const hasRecordedProviders = relevantReceiptEntries.some(
    (entry) => (entry.providerDestinations || []).length > 0,
  );
  if (!layout.matchedSource && !hasRecordedProviders) {
    throw new Error(
      `The uninstall target is not a skills source in ${options.agentSyncConfig}, and no recorded provider destinations are available.`,
    );
  }

  return [...targetsByPhysicalPath.values()];
}

function ownedProviderSymlinkNames(configuredProviders, options, receipt) {
  const names = new Set();
  for (const provider of configuredProviders) {
    let entries;
    try {
      entries = fs.readdirSync(provider.target, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (
        skillNamePattern.test(entry.name) &&
        isOwnedProviderLink(entry.name, provider, options, receipt.skills[entry.name])
      ) {
        names.add(entry.name);
      }
    }
  }
  return [...names];
}

function isOwnedProviderLink(name, provider, options, receiptEntry) {
  const providerEntry = path.join(provider.target, name);
  const stats = fs.lstatSync(providerEntry, { throwIfNoEntry: false });
  return (
    stats?.isSymbolicLink() &&
    providerExpectedTargets(name, provider, options, receiptEntry).has(
      resolvedLinkTarget(providerEntry),
    )
  );
}

function providerExpectedTargets(name, provider, options, receiptEntry, primaryAction = null) {
  const expectedTargets = primaryExpectedTargets(name, receiptEntry);
  const ownedPrimary =
    primaryAction?.type === "symlink" ||
    isOwnedPrimaryLink(name, options.target, receiptEntry);
  if (receiptEntry || ownedPrimary) {
    expectedTargets.add(path.join(options.target, name));
    expectedTargets.add(path.join(options.targetConfigured, name));
    expectedTargets.add(path.join(options.targetPhysical, name));
    for (const sourcePath of provider.sourcePaths) {
      expectedTargets.add(path.join(sourcePath, name));
      expectedTargets.add(path.join(physicalPath(sourcePath), name));
    }
  }
  if (primaryAction?.linkTarget) {
    expectedTargets.add(path.resolve(path.dirname(primaryAction.path), primaryAction.linkTarget));
  }
  return expectedTargets;
}

function preflightProvider(name, provider, options, receiptEntry, primaryAction) {
  const providerEntry = path.join(provider.target, name);
  validateDestination(provider.target, providerEntry);
  const stats = fs.lstatSync(providerEntry, { throwIfNoEntry: false });
  if (!stats) return null;

  if (!stats.isSymbolicLink()) {
    return skippedProviderAction(name, providerEntry, "entry is not a symlink");
  }

  const linkTarget = fs.readlinkSync(providerEntry);
  const resolvedTarget = path.resolve(path.dirname(providerEntry), linkTarget);
  if (
    !providerExpectedTargets(name, provider, options, receiptEntry, primaryAction).has(
      resolvedTarget,
    )
  ) {
    return skippedProviderAction(
      name,
      providerEntry,
      "symlink target is not owned by this repository",
    );
  }

  return removalAction("provider", name, providerEntry, stats, {
    linkTarget,
    targetPhysical: provider.targetPhysical,
    targetIdentity: provider.targetIdentity,
  });
}

function removalAction(role, name, entryPath, stats, options) {
  return {
    type: "symlink",
    role,
    name,
    path: entryPath,
    device: stats.dev,
    inode: stats.ino,
    ...options,
  };
}

function skippedProviderAction(name, entryPath, reason) {
  return {
    type: "skip",
    role: "provider",
    name,
    path: entryPath,
    reason,
  };
}

function resolvedLinkTarget(linkPath) {
  return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
}

function executeProviderAction(action, dryRun) {
  if (action.type === "skip") {
    const prefix = dryRun ? "would leave" : "left";
    console.log(`${action.name}: ${prefix} provider unchanged (${action.reason}) -> ${action.path}`);
    return;
  }
  executeRemoval(action, dryRun);
}

function executeRemoval(action, dryRun) {
  const role = action.role === "provider" ? " provider" : "";
  if (dryRun) {
    console.log(`${action.name}: would unlink${role} -> ${action.path}`);
    return;
  }

  assertTargetIdentity(action.targetPhysical, action.targetIdentity);
  const stats = fs.lstatSync(action.path, { throwIfNoEntry: false });
  if (!stats || stats.dev !== action.device || stats.ino !== action.inode) {
    throw new Error(`Refusing to remove an entry that changed after preflight: ${action.path}`);
  }
  if (!stats.isSymbolicLink() || fs.readlinkSync(action.path) !== action.linkTarget) {
    throw new Error(`Refusing to unlink a changed symlink: ${action.path}`);
  }

  fs.unlinkSync(action.path);
  console.log(`${action.name}: unlink${role} -> ${action.path}`);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const receipt = loadInstallReceipt(options.target);
  const configuredProviders = options.removeProviderLinks
    ? await providerTargets(options, receipt)
    : [];

  options.targetIdentity = assertTargetIdentity(options.target, options.targetIdentity, {
    allowMissing: true,
  });
  for (const provider of configuredProviders) {
    provider.targetIdentity = assertTargetIdentity(provider.target, provider.targetIdentity, {
      allowMissing: true,
    });
  }

  const names = selectedSkillNames(options, receipt, configuredProviders);
  const primaryActions = names.map((name) =>
    preflightPrimary(name, options, receipt.skills[name]),
  );
  const providerActions = [];

  if (options.removeProviderLinks) {
    for (const [index, name] of names.entries()) {
      for (const provider of configuredProviders) {
        const action = preflightProvider(
          name,
          provider,
          options,
          receipt.skills[name],
          primaryActions[index],
        );
        if (action) providerActions.push(action);
      }
    }
  }

  for (const action of providerActions) executeProviderAction(action, options.dryRun);
  for (const action of primaryActions) {
    if (action.type === "missing") {
      assertTargetIdentity(action.targetPhysical, action.targetIdentity, { allowMissing: true });
      if (fs.lstatSync(action.path, { throwIfNoEntry: false })) {
        throw new Error(`Refusing to ignore an entry that appeared after preflight: ${action.path}`);
      }
      console.log(`${action.name}: not installed -> ${action.path}`);
    } else {
      executeRemoval(action, options.dryRun);
    }
    if (!options.dryRun) forgetReceiptEntry(options.target, action.name, action.targetIdentity);
  }
}

function forgetReceiptEntry(target, name, targetIdentity) {
  const currentReceipt = loadInstallReceipt(target);
  if (!currentReceipt.skills[name]) return;
  assertTargetIdentity(target, targetIdentity);
  delete currentReceipt.skills[name];
  saveInstallReceipt(target, currentReceipt);
}

function readTargetIdentity(target) {
  const stats = fs.lstatSync(target, { throwIfNoEntry: false });
  return stats ? { device: stats.dev, inode: stats.ino } : null;
}

function assertTargetIdentity(target, expectedIdentity, { allowMissing = false } = {}) {
  const stats = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stats && allowMissing) return null;
  if (!stats?.isDirectory() || stats.isSymbolicLink() || physicalPath(target) !== target) {
    throw new Error(`Refusing to use a target that changed after validation: ${target}`);
  }
  if (
    expectedIdentity &&
    (stats.dev !== expectedIdentity.device || stats.ino !== expectedIdentity.inode)
  ) {
    throw new Error(`Refusing to use a replaced target: ${target}`);
  }
  return expectedIdentity || { device: stats.dev, inode: stats.ino };
}

try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
