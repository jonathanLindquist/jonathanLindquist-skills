import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  --mode <mode>      symlink or copy. Defaults to symlink.
  --replace          Replace an existing installed skill.
  --update           Replace one skill and run agent-sync for it.
  --sync-providers   Run agent-sync after installing selected skills.
  --agent-sync-bin <path>
                     agent-sync executable. Defaults to the local dependency, then PATH.
  --agent-sync-provider <flag>
                     Provider flag for agent-sync. Repeatable. Defaults to --all-providers.
  --help             Show this help.
`;

function parseArgs(argv) {
  const options = {
    skill: null,
    target: defaultTarget,
    mode: "symlink",
    replace: false,
    update: false,
    syncProviders: false,
    agentSyncBin: null,
    agentSyncProviderFlags: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--skill") {
      options.skill = requireValue(argv, ++index, arg);
    } else if (arg === "--target") {
      options.target = requireValue(argv, ++index, arg);
    } else if (arg === "--mode") {
      options.mode = requireValue(argv, ++index, arg);
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

  if (!["symlink", "copy"].includes(options.mode)) {
    throw new Error(`Invalid --mode ${options.mode}. Expected symlink or copy.`);
  }

  options.target = path.resolve(expandHome(options.target));
  options.agentSyncBin = expandHome(options.agentSyncBin || defaultAgentSyncBin());
  if (options.agentSyncProviderFlags.length === 0) {
    options.agentSyncProviderFlags = ["--all-providers"];
  }
  for (const flag of options.agentSyncProviderFlags) {
    if (!flag.startsWith("--")) {
      throw new Error(`Invalid --agent-sync-provider ${flag}. Expected a flag beginning with --.`);
    }
  }
  validateTarget(options.target);
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

  const existingDestination = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existingDestination) {
    if (!options.replace) {
      throw new Error(
        `${destination} already exists. Remove it first or rerun with --replace.`,
      );
    }
    removeExistingDestination(destination, existingDestination);
  }

  if (options.mode === "symlink") {
    fs.symlinkSync(source, destination, "dir");
  } else {
    fs.cpSync(source, destination, { recursive: true });
  }

  console.log(`${name}: ${options.mode} -> ${destination}`);
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

function run() {
  const options = parseArgs(process.argv.slice(2));
  const names = options.skill ? [options.skill] : installableSkillNames();

  if (names.length === 0) {
    throw new Error("No installable skill folders found under skills/.");
  }

  verifySkillDependencies(names, { quiet: true });

  for (const name of names) {
    installSkill(name, options);
  }

  if (options.syncProviders) {
    syncProviderSkills(names, options);
  }
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
