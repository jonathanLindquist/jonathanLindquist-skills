import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTarget = path.join(os.homedir(), ".agents", "skills");
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const usage = `Usage:
  install.mjs [options]

Options:
  --skill <name>     Skill to install. Defaults to all top-level skill folders.
  --target <path>    Skills directory. Defaults to ~/.agents/skills.
  --mode <mode>      symlink or copy. Defaults to symlink.
  --replace          Replace an existing installed skill.
  --help             Show this help.
`;

function parseArgs(argv) {
  const options = {
    skill: null,
    target: defaultTarget,
    mode: "symlink",
    replace: false,
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
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }

  if (options.skill) validateSkillName(options.skill);
  if (!["symlink", "copy"].includes(options.mode)) {
    throw new Error(`Invalid --mode ${options.mode}. Expected symlink or copy.`);
  }

  options.target = path.resolve(expandHome(options.target));
  validateTarget(options.target);
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
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
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
  if (!isInside(repoRoot, source)) {
    throw new Error(`Refusing to install from outside this repo: ${source}`);
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

function topLevelSkillNames() {
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(isValidSkillName)
    .filter((name) => fs.existsSync(path.join(repoRoot, name, "SKILL.md")))
    .sort();
}

function installSkill(name, options) {
  validateSkillName(name);
  const source = path.join(repoRoot, name);
  const destination = path.join(options.target, name);
  validateInstallPaths(source, destination, options.target);

  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new Error(`No skill named ${name} found at ${source}.`);
  }

  fs.mkdirSync(options.target, { recursive: true });

  if (fs.existsSync(destination) || fs.lstatSync(destination, { throwIfNoEntry: false })) {
    if (!options.replace) {
      throw new Error(
        `${destination} already exists. Remove it first or rerun with --replace.`,
      );
    }
    fs.rmSync(destination, { recursive: true, force: true });
  }

  if (options.mode === "symlink") {
    fs.symlinkSync(source, destination, "dir");
  } else {
    fs.cpSync(source, destination, { recursive: true });
  }

  console.log(`${name}: ${options.mode} -> ${destination}`);
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const names = options.skill ? [options.skill] : topLevelSkillNames();

  if (names.length === 0) {
    throw new Error("No top-level skill folders found.");
  }

  for (const name of names) {
    installSkill(name, options);
  }
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
