import { parseMarkdownMetaDocument } from "./MarkdownMetaParserService";
import type { MarkdownMetaDocument } from "../models/MarkdownMeta";

export interface MarkdownSection {
  title: string;
  level: number;
  line: number;
  endLine: number;
  content: string;
}

export function getMarkdownSections(
  lines: string[],
  metadata: MarkdownMetaDocument = parseMarkdownMetaDocument(lines),
  includeAllHeadings = false
): MarkdownSection[] {
  const levels = includeAllHeadings ? [1, 2, 3, 4, 5, 6] : metadata.document.namespaces.prompto?.sectionLevels ?? [];
  if (levels.length === 0) {
    return [];
  }

  const headings: { title: string; level: number; line: number }[] = [];
  const contentLines = [...lines];
  let fence: { marker: string; length: number } | undefined;
  let inComment = false;
  let inMetadata = false;

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    if (inComment) {
      if (inMetadata) {
        contentLines[line] = "";
      }
      if (text.includes("-->")) {
        inComment = false;
        inMetadata = false;
      }
      continue;
    }

    const fenceMatch = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.marker &&
          fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) {
        fence = undefined;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }

    if (/^\s*<!--\s*md-meta\s*$/.test(text)) {
      inComment = true;
      inMetadata = true;
      contentLines[line] = "";
      continue;
    }
    if (text.includes("<!--")) {
      inComment = !text.slice(text.indexOf("<!--") + 4).includes("-->");
      if (/^\s*<!--/.test(text)) {
        continue;
      }
    }

    const heading = text.match(/^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/);
    if (heading) {
      headings.push({ title: heading[2].replace(/\s+#+\s*$/, ""), level: heading[1].length, line });
    }
  }

  return headings.flatMap((heading, index) => {
    if (!levels.includes(heading.level) || (!includeAllHeadings && metadata.nodes.some(node =>
      node.line === heading.line && Boolean(node.namespaces.prompto?.promptContent)))) {
      return [];
    }
    const endLine = headings.slice(index + 1).find(next => next.level <= heading.level)?.line ?? lines.length;
    return [{
      ...heading,
      endLine,
      content: contentLines.slice(heading.line + 1, endLine).join("\n").trim(),
    }];
  });
}
