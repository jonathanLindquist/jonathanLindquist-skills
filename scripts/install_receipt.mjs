import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const INSTALL_RECEIPT_FILE = ".jonathan-lindquist-skills-install.json";
export const INSTALL_RECEIPT_VERSION = 1;
export const REPOSITORY_ID = "jonathanLindquist-skills";
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function emptyInstallReceipt() {
  return {
    version: INSTALL_RECEIPT_VERSION,
    repository: REPOSITORY_ID,
    skills: {},
  };
}

export function loadInstallReceipt(target) {
  const receiptPath = path.join(target, INSTALL_RECEIPT_FILE);
  let content;

  try {
    content = fs.readFileSync(receiptPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyInstallReceipt();
    throw error;
  }

  let receipt;
  try {
    receipt = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid install receipt at ${receiptPath}: ${error.message}`);
  }

  validateInstallReceipt(receipt, receiptPath);
  return receipt;
}

export function saveInstallReceipt(target, receipt) {
  const receiptPath = path.join(target, INSTALL_RECEIPT_FILE);
  validateInstallReceipt(receipt, receiptPath);

  if (Object.keys(receipt.skills).length === 0) {
    fs.rmSync(receiptPath, { force: true });
    return;
  }

  const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, receiptPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function validateInstallReceipt(receipt, receiptPath) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error(`Invalid install receipt at ${receiptPath}: expected an object.`);
  }

  if (receipt.version !== INSTALL_RECEIPT_VERSION) {
    throw new Error(
      `Unsupported install receipt version at ${receiptPath}: ${receipt.version}.`,
    );
  }

  if (receipt.repository !== REPOSITORY_ID) {
    throw new Error(
      `Install receipt at ${receiptPath} belongs to ${receipt.repository || "another repository"}.`,
    );
  }

  if (!receipt.skills || typeof receipt.skills !== "object" || Array.isArray(receipt.skills)) {
    throw new Error(`Invalid install receipt at ${receiptPath}: expected a skills object.`);
  }

  for (const [name, installation] of Object.entries(receipt.skills)) {
    if (!skillNamePattern.test(name)) {
      throw new Error(`Invalid skill name in install receipt at ${receiptPath}: ${name}.`);
    }

    if (!installation || typeof installation !== "object" || Array.isArray(installation)) {
      throw new Error(`Invalid install receipt entry for ${name} at ${receiptPath}.`);
    }

    if (typeof installation.source !== "string" || !path.isAbsolute(installation.source)) {
      throw new Error(`Invalid install receipt source for ${name} at ${receiptPath}.`);
    }

    if (
      installation.providerDestinations !== undefined &&
      (!Array.isArray(installation.providerDestinations) ||
        installation.providerDestinations.some(
          (destination) => typeof destination !== "string" || !path.isAbsolute(destination),
        ))
    ) {
      throw new Error(
        `Invalid provider destinations for ${name} at ${receiptPath}.`,
      );
    }
  }
}
