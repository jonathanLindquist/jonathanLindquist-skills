import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const skillsRoot = path.join(repoRoot, "skills");
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const usage = `Usage:
  verify_skill_dependencies.mjs [options]

Options:
  --skill <name>        Skill to verify. Repeatable. Defaults to all skills.
  --plugin-root <path>  Additional plugin cache or plugin directory to inspect.
                        Repeatable.
  --help                Show this help.
`;

export function verifySkillDependencies(skillNames, options = {}) {
  const names = skillNames.length > 0 ? skillNames : installableSkillNames();
  const searchRoots = pluginSearchRoots(options.pluginRoots || []);
  const failures = [];
  const checkedSkills = [];

  for (const name of names) {
    validateSkillName(name);
    const manifest = readDependencyManifest(name);
    checkedSkills.push(name);

    for (const dependency of manifest.dependencies) {
      const result = verifyDependency(name, dependency, searchRoots);
      if (!result.ok) {
        failures.push(formatDependencyFailure(name, dependency, result));
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n\n"));
  }

  if (!options.quiet) {
    for (const name of checkedSkills) {
      console.log(`${name}: dependencies ok`);
    }
  }
}

export function parseArgs(argv) {
  const options = {
    skillNames: [],
    pluginRoots: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--skill") {
      options.skillNames.push(requireValue(argv, ++index, arg));
    } else if (arg === "--plugin-root") {
      options.pluginRoots.push(requireValue(argv, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }

  for (const skillName of options.skillNames) {
    validateSkillName(skillName);
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.\n\n${usage}`);
  }
  return value;
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

function isValidSkillName(name) {
  return skillNamePattern.test(name);
}

function validateSkillName(name) {
  if (!isValidSkillName(name)) {
    throw new Error(`Invalid skill name ${name}. Use lowercase letters, digits, and hyphens only.`);
  }
}

function readDependencyManifest(skillName) {
  const skillRoot = path.join(skillsRoot, skillName);
  if (!fs.existsSync(path.join(skillRoot, "SKILL.md"))) {
    throw new Error(`No skill named ${skillName} found at ${skillRoot}.`);
  }

  const manifestPath = path.join(skillRoot, "dependencies.json");
  if (!fs.existsSync(manifestPath)) {
    return { dependencies: [] };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath(manifestPath)}: ${error.message}`);
  }

  if (manifest.version !== 1) {
    throw new Error(`${relativePath(manifestPath)} must set version to 1.`);
  }

  if (!Array.isArray(manifest.dependencies)) {
    throw new Error(`${relativePath(manifestPath)} must define a dependencies array.`);
  }

  for (const [index, dependency] of manifest.dependencies.entries()) {
    validateDependencyManifestEntry(manifestPath, dependency, index);
  }

  return manifest;
}

function validateDependencyManifestEntry(manifestPath, dependency, index) {
  const prefix = `${relativePath(manifestPath)} dependencies[${index}]`;

  if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
    throw new Error(`${prefix} must be an object.`);
  }

  if (dependency.kind !== "plugin") {
    throw new Error(`${prefix}.kind must be "plugin".`);
  }

  for (const key of ["id", "source"]) {
    if (!isNonEmptyString(dependency[key])) {
      throw new Error(`${prefix}.${key} must be a non-empty string.`);
    }
  }

  if (!Array.isArray(dependency.capabilities) || dependency.capabilities.length === 0) {
    throw new Error(`${prefix}.capabilities must be a non-empty array.`);
  }

  for (const capability of dependency.capabilities) {
    if (!isNonEmptyString(capability)) {
      throw new Error(`${prefix}.capabilities entries must be non-empty strings.`);
    }
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function verifyDependency(skillName, dependency, searchRoots) {
  if (dependency.kind !== "plugin") {
    return {
      ok: false,
      checked: [],
      missingCapabilities: dependency.capabilities,
      reason: `Unsupported dependency kind ${dependency.kind} for ${skillName}.`,
    };
  }

  return findPluginWithCapabilities(dependency, searchRoots);
}

function findPluginWithCapabilities(dependency, searchRoots) {
  const checked = [];
  let closestMatch = null;

  for (const candidate of pluginCandidates(dependency, searchRoots)) {
    if (checked.includes(candidate)) continue;
    checked.push(candidate);

    const capabilityRoots = capabilityRootsFor(candidate);
    if (capabilityRoots.length === 0) continue;

    const missingCapabilities = missingCapabilitiesFor(capabilityRoots, dependency.capabilities);
    if (missingCapabilities.length === 0) {
      return {
        ok: true,
        checked,
        pluginPath: candidate,
        missingCapabilities: [],
      };
    }

    if (!closestMatch || missingCapabilities.length < closestMatch.missingCapabilities.length) {
      closestMatch = {
        pluginPath: candidate,
        missingCapabilities,
      };
    }
  }

  return {
    ok: false,
    checked,
    pluginPath: closestMatch?.pluginPath || null,
    missingCapabilities: closestMatch?.missingCapabilities || dependency.capabilities,
  };
}

function pluginSearchRoots(extraRoots) {
  const roots = [];

  for (const root of extraRoots) {
    roots.push({ path: path.resolve(expandHome(root)), explicit: true });
  }

  const codexHome = path.resolve(expandHome(process.env.CODEX_HOME || path.join(os.homedir(), ".codex")));
  roots.push({ path: path.join(codexHome, "plugins", "cache"), explicit: false });
  roots.push({ path: path.join(os.homedir(), ".codex", "plugins", "cache"), explicit: false });
  roots.push({ path: path.join(os.homedir(), ".agents", "plugins", "cache"), explicit: false });
  roots.push({ path: path.join(os.homedir(), ".claude", "plugins", "cache"), explicit: false });
  roots.push({ path: path.join(os.homedir(), ".cursor", "plugins", "cache"), explicit: false });

  const seen = new Set();
  return roots.filter((root) => {
    if (seen.has(root.path)) return false;
    seen.add(root.path);
    return true;
  });
}

function pluginCandidates(dependency, searchRoots) {
  const candidates = [];

  for (const root of searchRoots) {
    candidates.push(path.join(root.path, dependency.source, dependency.id));
    candidates.push(path.join(root.path, dependency.id));

    if (root.explicit) {
      candidates.push(root.path);
      candidates.push(path.join(root.path, "plugins", dependency.id));
    }
  }

  return candidates;
}

function capabilityRootsFor(pluginPath) {
  const roots = [];

  if (!directoryExists(pluginPath)) return roots;

  roots.push(pluginPath);
  for (const entry of fs.readdirSync(pluginPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      roots.push(path.join(pluginPath, entry.name));
    }
  }

  return roots;
}

function missingCapabilitiesFor(pluginRoots, capabilities) {
  return capabilities.filter((capability) => {
    return !pluginRoots.some((pluginRoot) => {
      return fs.existsSync(path.join(pluginRoot, "skills", capability, "SKILL.md"));
    });
  });
}

function directoryExists(candidate) {
  const stats = fs.statSync(candidate, { throwIfNoEntry: false });
  return Boolean(stats?.isDirectory());
}

function formatDependencyFailure(skillName, dependency, result) {
  const lines = [`${skillName} dependency check failed:`];
  const capabilities = dependency.capabilities.join(", ");
  const installCommands = dependency.install?.codex || [];

  if (result.pluginPath) {
    lines.push(`- Plugin dependency ${dependency.id} from ${dependency.source} is missing required capabilities.`);
    lines.push(`  Plugin found at: ${displayPath(result.pluginPath)}`);
    lines.push(`  Missing capabilities: ${result.missingCapabilities.join(", ")}`);
  } else {
    lines.push(`- Missing plugin dependency ${dependency.id} from ${dependency.source}.`);
  }

  lines.push(`  Required capabilities: ${capabilities}`);

  if (result.checked.length > 0) {
    lines.push("  Checked plugin locations:");
    for (const checkedPath of result.checked.slice(0, 8)) {
      lines.push(`    - ${displayPath(checkedPath)}`);
    }
  }

  if (installCommands.length > 0) {
    lines.push("  Install for Codex:");
    for (const command of installCommands) {
      lines.push(`    ${command}`);
    }
  }

  return lines.join("\n");
}

function displayPath(filePath) {
  const resolved = path.resolve(filePath);
  const codexHome = process.env.CODEX_HOME ? path.resolve(expandHome(process.env.CODEX_HOME)) : null;
  if (codexHome && (resolved === codexHome || resolved.startsWith(`${codexHome}${path.sep}`))) {
    return `$CODEX_HOME${resolved.slice(codexHome.length)}`;
  }

  const homeDir = os.homedir();
  if (resolved === homeDir || resolved.startsWith(`${homeDir}${path.sep}`)) {
    return `$HOME${resolved.slice(homeDir.length)}`;
  }

  return resolved;
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

function relativePath(filePath) {
  return path.relative(repoRoot, filePath);
}

if (process.argv[1] === scriptPath) {
  try {
    const options = parseArgs(process.argv.slice(2));
    verifySkillDependencies(options.skillNames, { pluginRoots: options.pluginRoots });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
