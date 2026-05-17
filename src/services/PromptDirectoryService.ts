import * as path from "path";
import * as vscode from "vscode";

const DEFAULT_PROMPT_DIRECTORY = ".prompto";

export function getPromptDirectorySetting(): string {
  const configuredDirectory = vscode.workspace
    .getConfiguration("prompto")
    .get<string>("promptsDirectory", DEFAULT_PROMPT_DIRECTORY);

  const promptDirectory = (configuredDirectory || DEFAULT_PROMPT_DIRECTORY)
    .trim()
    .replace(/[\\/]+$/, "");

  return promptDirectory || DEFAULT_PROMPT_DIRECTORY;
}

export function getPromptDirectoryPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const resolvedPath = path.resolve(workspaceRoot, getPromptDirectorySetting());
  const relativePath = path.relative(workspaceRoot, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return path.join(workspaceRoot, DEFAULT_PROMPT_DIRECTORY);
  }

  return resolvedPath;
}

export function resolvePromptFilePath(
  workspaceFolder: vscode.WorkspaceFolder,
  promptReference: string
): string | undefined {
  const promptDirectoryPath = getPromptDirectoryPath(workspaceFolder);
  const normalizedReference = promptReference.trim().replace(/\\/g, "/");

  if (!normalizedReference) {
    return undefined;
  }

  const promptReferenceWithExtension = path.extname(normalizedReference)
    ? normalizedReference
    : `${normalizedReference}.md`;

  const resolvedPromptPath = path.resolve(
    promptDirectoryPath,
    promptReferenceWithExtension
  );
  const relativePromptPath = path.relative(
    promptDirectoryPath,
    resolvedPromptPath
  );

  if (
    relativePromptPath.startsWith("..") ||
    path.isAbsolute(relativePromptPath)
  ) {
    return undefined;
  }

  return resolvedPromptPath;
}