import * as path from "path";

export function resolveSelectionPathTemplates(
  content: string,
  sourceFilePath?: string
): string {
  const processedContent = content.replace(
    /\{\{path:([^{}]*)\}\}/g,
    (_template, value: string) => {
      const filePath = value.trim();
      if (!filePath || /[\r\n\0]/.test(filePath)) {
        throw new Error("Path templates require a non-empty, single-line path.");
      }
      if (
        /^[a-z][a-z\d+.-]*:/i.test(filePath) &&
        !/^[a-z]:[\\/]/i.test(filePath)
      ) {
        throw new Error("Path templates do not support URLs or drive-relative paths.");
      }
      if (/^~(?:[\\/]|$)/.test(filePath)) {
        throw new Error("Path templates do not support home directory shortcuts.");
      }

      let resolvedPath: string;
      if (path.isAbsolute(filePath)) {
        resolvedPath = path.normalize(filePath);
      } else {
        if (!sourceFilePath) {
          throw new Error("Save the source document before resolving relative paths.");
        }
        resolvedPath = path.resolve(path.dirname(sourceFilePath), filePath);
      }
      return resolvedPath.replace(/\\/g, "/");
    }
  );

  if (processedContent.includes("{{path:")) {
    throw new Error("Invalid path template. Use {{path:relative/path}} without nesting.");
  }
  return processedContent;
}