import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_AGENT_SYNC_CONFIG = path.join(
  repoRoot,
  "node_modules",
  "agent-sync",
  "agent-sync.json",
);

export async function configuredSkillProviders({
  configPath = DEFAULT_AGENT_SYNC_CONFIG,
  sourceDir,
  env = process.env,
}) {
  let agentSyncConfig;
  try {
    agentSyncConfig = await import("agent-sync/src/providers.js");
  } catch (error) {
    throw new Error(`Unable to load agent-sync's config parser: ${error.message}`);
  }

  let config;
  try {
    config = await agentSyncConfig.loadConfig(configPath);
  } catch (error) {
    throw new Error(`Unable to read agent-sync config at ${configPath}: ${error.message}`);
  }

  const homeDir = agentSyncConfig.getHomeDir(env);
  const resolvedConfig = agentSyncConfig.configWithResolvedPaths(config, homeDir);
  const sourcePhysical = physicalPath(sourceDir);
  const artifacts = resolvedConfig.artifacts.filter(
    (artifact) =>
      artifact.type === "skills" &&
      physicalPath(path.resolve(artifact.sourceDir)) === sourcePhysical,
  );

  return {
    matchedSource: artifacts.length > 0,
    providers: artifacts.flatMap((artifact) =>
      artifact.providers.map((provider) => ({
        artifactId: artifact.id,
        providerId: provider.id,
        providerFlag: provider.flag,
        sourceDir: path.resolve(artifact.sourceDir),
        destinationDir: path.resolve(provider.skillsDir),
      })),
    ),
  };
}

export function physicalPath(inputPath) {
  let existingAncestor = path.resolve(inputPath);
  const missingSegments = [];

  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }

  return path.join(fs.realpathSync(existingAncestor), ...missingSegments);
}
