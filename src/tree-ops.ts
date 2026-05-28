/** Tree management operations: create, delete, rename nodes. */

import { createFile, deleteFile, getFileContent } from './github.ts';
import { removeCachedContent } from './cache.ts';
import { logInfo, logError } from './logging-client.ts';
import { formatDirName, errorMessage, basename, contentPathFor } from './utils.ts';

/**
 * Validate a node name.
 * Returns error message if invalid, null if valid.
 */
function validateName(name: string): string | null {
  if (!name || !name.trim()) {
    return 'Name cannot be empty';
  }
  if (name.includes('/') || name.includes('\\')) {
    return 'Name cannot contain / or \\';
  }
  return null;
}

/**
 * Find all descendant files (full paths in contentPaths) under a dirPath.
 * E.g., if dirPath='teach/CPP', returns all paths starting with 'teach/CPP/'.
 */
function findDescendants(dirPath: string, contentPaths: string[]): string[] {
  if (!dirPath) return [];
  const prefix = dirPath + '/';
  return contentPaths.filter(p => p.startsWith(prefix));
}

/**
 * Create a new child node.
 * Validates name, checks for duplicates, creates text/{parentPath}/{newName}/README.md.
 */
export async function createNode(
  host: string, token: string,
  owner: string, repo: string,
  parentPath: string, newName: string,
  contentPaths: string[],
): Promise<string> {
  const nameError = validateName(newName);
  if (nameError) {
    throw new Error(`Invalid name: ${nameError}`);
  }

  // Check for duplicate sibling
  const newDirPath = parentPath ? `${parentPath}/${newName}` : newName;
  if (contentPaths.includes(newDirPath)) {
    throw new Error(`Node '${newName}' already exists at this level`);
  }

  const filePath = contentPathFor(newDirPath);
  const displayName = formatDirName(newName);
  const content = `# ${displayName}\n\n`;

  try {
    await createFile(host, token, owner, repo, filePath, content, `Create node ${newDirPath}`);
    logInfo(`TreeOps: Created node ${newDirPath}`);
    return newDirPath;
  } catch (err) {
    const msg = errorMessage(err);
    logError(`TreeOps: Failed to create ${newDirPath}: ${msg}`);
    throw err;
  }
}

/**
 * Delete a node (and all descendants if confirmed).
 * Returns { needsConfirm, paths } if non-leaf.
 * After confirmation, deletes all files and clears cache.
 */
export async function deleteNode(
  host: string, token: string,
  owner: string, repo: string,
  dirPath: string,
  contentPaths: string[],
): Promise<{ needsConfirm: false } | { needsConfirm: true; paths: string[] }> {
  if (dirPath === '') {
    throw new Error('Cannot delete root node');
  }

  const descendants = findDescendants(dirPath, contentPaths);
  const allPaths = [dirPath, ...descendants];

  // If non-leaf, return confirmation data
  if (descendants.length > 0) {
    return {
      needsConfirm: true,
      paths: allPaths,
    };
  }

  // Delete the single file
  try {
    const filePath = contentPathFor(dirPath);
    const { sha } = await getFileContent(host, token, owner, repo, filePath);
    await deleteFile(host, token, owner, repo, filePath, sha, `Delete node ${dirPath}`);
    removeCachedContent(filePath);
    logInfo(`TreeOps: Deleted node ${dirPath}`);
    return { needsConfirm: false };
  } catch (err) {
    const msg = errorMessage(err);
    logError(`TreeOps: Failed to delete ${dirPath}: ${msg}`);
    throw err;
  }
}

/**
 * Delete multiple nodes (after confirmation).
 * Fetches SHAs and deletes files sequentially.
 */
export async function confirmDeleteNodes(
  host: string, token: string,
  owner: string, repo: string,
  paths: string[],
): Promise<void> {
  try {
    for (const path of paths) {
      const filePath = contentPathFor(path);
      const { sha } = await getFileContent(host, token, owner, repo, filePath);
      await deleteFile(host, token, owner, repo, filePath, sha, `Delete node ${path}`);
      removeCachedContent(filePath);
    }
    logInfo(`TreeOps: Deleted ${paths.length} node(s)`);
  } catch (err) {
    const msg = errorMessage(err);
    logError(`TreeOps: Failed during cascade delete: ${msg}`);
    throw err;
  }
}

/** Relocate files from oldBase to newBase in three parallel phases: fetch, create, delete. */
async function relocateFiles(
  host: string, token: string,
  owner: string, repo: string,
  allPaths: string[], oldBase: string, newBase: string, commitMsg: string,
): Promise<void> {
  const entries = allPaths.map(path => ({
    oldFile: contentPathFor(path),
    newFile: contentPathFor(newBase + path.slice(oldBase.length)),
  }));

  const files = await Promise.all(
    entries.map(e => getFileContent(host, token, owner, repo, e.oldFile)
      .then(f => ({ ...e, content: f.content, sha: f.sha }))),
  );

  await Promise.all(
    files.map(f => createFile(host, token, owner, repo, f.newFile, f.content, commitMsg)),
  );

  await Promise.all(
    files.map(f => deleteFile(host, token, owner, repo, f.oldFile, f.sha, commitMsg)),
  );

  for (const e of entries) {
    removeCachedContent(e.oldFile);
    removeCachedContent(e.newFile);
  }
}

export async function moveNode(
  host: string, token: string,
  owner: string, repo: string,
  sourceDirPath: string, destParentPath: string,
  contentPaths: string[],
): Promise<string> {
  if (sourceDirPath === '') {
    throw new Error('Cannot move root node');
  }

  const sourceName = basename(sourceDirPath);
  const newDirPath = destParentPath ? `${destParentPath}/${sourceName}` : sourceName;

  if (newDirPath === sourceDirPath) {
    throw new Error('Source and destination are the same');
  }

  if (destParentPath === sourceDirPath || destParentPath.startsWith(sourceDirPath + '/')) {
    throw new Error('Cannot move a node into itself or its descendant');
  }

  if (contentPaths.includes(newDirPath)) {
    throw new Error(`Node '${sourceName}' already exists at the destination`);
  }

  const allPaths = [sourceDirPath, ...findDescendants(sourceDirPath, contentPaths)];

  try {
    await relocateFiles(host, token, owner, repo, allPaths, sourceDirPath, newDirPath,
      `Move ${sourceDirPath} → ${newDirPath}`);
    logInfo(`TreeOps: Moved node ${sourceDirPath} → ${newDirPath}`);
    return newDirPath;
  } catch (err) {
    logError(`TreeOps: Failed to move ${sourceDirPath}: ${errorMessage(err)}`);
    throw err;
  }
}

export async function renameNode(
  host: string, token: string,
  owner: string, repo: string,
  oldDirPath: string, newName: string,
  contentPaths: string[],
): Promise<string> {
  const nameError = validateName(newName);
  if (nameError) {
    throw new Error(`Invalid name: ${nameError}`);
  }

  const parentPath = oldDirPath.includes('/') ? oldDirPath.slice(0, oldDirPath.lastIndexOf('/')) : '';
  const newDirPath = parentPath ? `${parentPath}/${newName}` : newName;

  if (newDirPath !== oldDirPath && contentPaths.includes(newDirPath)) {
    throw new Error(`Node '${newName}' already exists at this level`);
  }

  const allPaths = [oldDirPath, ...findDescendants(oldDirPath, contentPaths)];

  try {
    await relocateFiles(host, token, owner, repo, allPaths, oldDirPath, newDirPath,
      `Rename ${oldDirPath} → ${newDirPath}`);
    logInfo(`TreeOps: Renamed node ${oldDirPath} → ${newDirPath}`);
    return newDirPath;
  } catch (err) {
    logError(`TreeOps: Failed to rename ${oldDirPath}: ${errorMessage(err)}`);
    throw err;
  }
}
