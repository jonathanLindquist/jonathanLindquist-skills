import fs from "node:fs";
import { parse } from "yaml";

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function isSkillDeprecated(skillFile) {
  const metadata = readSkillMetadata(skillFile);
  const deprecated = metadata.deprecated;

  if (deprecated === undefined || deprecated === false || deprecated === "false") {
    return false;
  }
  if (deprecated === true || deprecated === "true") {
    return true;
  }

  throw new Error(
    `Expected metadata.deprecated in ${skillFile} to be true or false, got ${JSON.stringify(deprecated)}.`,
  );
}

export function readSkillMetadata(skillFile) {
  const content = fs.readFileSync(skillFile, "utf8");
  const frontMatter = content.match(frontMatterPattern);
  if (!frontMatter) {
    throw new Error(`Expected YAML front matter in ${skillFile}.`);
  }

  let skill;
  try {
    skill = parse(frontMatter[1]);
  } catch (error) {
    throw new Error(`Invalid YAML front matter in ${skillFile}: ${error.message}`);
  }

  if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
    throw new Error(`Expected YAML front matter in ${skillFile} to be a mapping.`);
  }

  const metadata = skill.metadata;
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`Expected metadata in ${skillFile} to be a mapping.`);
  }

  return metadata;
}
