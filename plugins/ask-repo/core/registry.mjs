// The alias registry: a JSON object { "<alias>": "<absolute path>" } outside every repo, so no
// personal path is ever committed. $ASK_REPO_REGISTRY moves it.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AskRepoError, usageError } from './errors.mjs';

export const ALIAS = /^[\w.-]+$/;

export const registryPath = (env = process.env) =>
  env.ASK_REPO_REGISTRY || path.join(os.homedir(), '.config', 'ask-repo', 'registry.json');

/** The registry's entries; an empty object when the file does not exist yet. */
export function readRegistry(file) {
  if (!existsSync(file)) return {};
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new AskRepoError(`${file} is not valid JSON: ${error.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new AskRepoError(`${file} must hold a JSON object of alias to path`);
  }
  return data;
}

// Written to a temporary file first, so an interrupted write never leaves half a registry.
function writeRegistry(file, registry) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Registers `alias` for `dir`, resolved against `cwd`; returns the absolute path stored. */
export function addAlias(file, alias, dir, cwd) {
  if (!ALIAS.test(alias)) throw usageError(`alias may hold only letters, digits, _, . and -: ${alias}`);
  const target = path.resolve(cwd, dir);
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new AskRepoError(`not a directory: ${target}`);
  const registry = readRegistry(file);
  if (alias in registry) {
    throw new AskRepoError(`alias ${alias} already points to ${registry[alias]}; remove it first with: ask-repo --remove ${alias}`);
  }
  writeRegistry(file, { ...registry, [alias]: target });
  return target;
}

export function removeAlias(file, alias) {
  const registry = readRegistry(file);
  if (!(alias in registry)) throw new AskRepoError(`no alias ${alias} in ${file}`);
  delete registry[alias];
  writeRegistry(file, registry);
}

/** The directory `alias` points to, checked to exist. */
export function resolveAlias(file, alias) {
  const registry = readRegistry(file);
  const target = registry[alias];
  if (typeof target !== 'string') {
    const known = Object.keys(registry);
    throw new AskRepoError(
      `no alias ${alias} in ${file}; ${known.length ? `known: ${known.join(', ')}` : 'add one with: ask-repo --add <alias> <path>'}`
    );
  }
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new AskRepoError(`the path for ${alias} is not a directory: ${target}`);
  }
  return target;
}
