import { dirname, isAbsolute, resolve } from "path";
import { getMarkdownSections } from "./MarkdownSectionService";
import { resolveSelectionPathTemplates } from "./SelectionPathTemplateService";

export function createMarkdownFragmentLoader(
  hostPath: string | undefined,
  readFile: (filePath: string) => Promise<string>,
  workspaceRootForFile: (filePath: string) => string | undefined
): (reference: string, section: string) => Promise<{ content: string; transformContent: (content: string) => string }> {
  const files = new Map<string, Promise<string>>();
  return async (reference, section) => {
    try {
      if (!hostPath || !isAbsolute(hostPath)) throw new Error("Save the host document as a local file before using include.");
      if ([reference, section].some(value => !value.trim() || value !== value.trim() || /[{}\u0000-\u001f\u007f]/.test(value)) ||
          /^~(?:[\\/]|$)|^[\\/]{2}/.test(reference) ||
          (/^[a-z][a-z\d+.-]*:/i.test(reference) && !/^[a-z]:[\\/]/i.test(reference)) ||
          !/\.(md|markdown)$/i.test(reference)) {
        throw new Error("Include requires a literal local Markdown path and a non-empty heading.");
      }
      const filePath = resolve(dirname(hostPath), reference);
      if (!files.has(filePath)) files.set(filePath, readFile(filePath));
      const text = await files.get(filePath)!;
      if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new Error("Included files cannot exceed 1 MiB.");
      const matches = getMarkdownSections(text.split(/\r?\n/), undefined, true).filter(candidate => candidate.title === section);
      if (matches.length !== 1) throw new Error(`Heading must match exactly once; found ${matches.length}.`);
      if (!matches[0].content.trim()) throw new Error("The included section has no content.");
      return {
        content: matches[0].content,
        transformContent: content => resolveSelectionPathTemplates(content, filePath, workspaceRootForFile(filePath)),
      };
    } catch (error) {
      throw new Error(`Cannot include "${reference}" section "${section}": ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}