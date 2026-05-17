import * as vscode from "vscode";
import { SelectedTextVariableContext } from "./SelectedTextVariableService";

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/;
const CODE_FENCE_REGEX = /^\s*(`{3,}|~{3,})/;
const PROMPTO_METADATA_START_REGEX = /^\s*<!--\s*prompto\s*$/;
const PROMPTO_METADATA_END_REGEX = /^\s*-->\s*$/;
const KEY_VALUE_REGEX = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)\s*$/;

export interface MarkdownPromptBlock {
  headingLine: number;
  headingLevel: number;
  headingText: string;
  metadataStartLine: number;
  metadataEndLine: number;
  bodyStartLine: number;
  bodyEndLine: number;
  promptReference?: string;
  variables: Record<string, string>;
  body: string;
}

export function parseMarkdownPromptBlocks(
  document: vscode.TextDocument
): MarkdownPromptBlock[] {
  const lines = Array.from({ length: document.lineCount }, (_, index) =>
    document.lineAt(index).text
  );
  const promptBlocks: MarkdownPromptBlock[] = [];

  let inCodeFence = false;
  let activeFenceMarker: string | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const fenceMatch = line.match(CODE_FENCE_REGEX);

    if (fenceMatch) {
      const fenceMarker = fenceMatch[1][0];
      if (!inCodeFence) {
        inCodeFence = true;
        activeFenceMarker = fenceMarker;
      } else if (activeFenceMarker === fenceMarker) {
        inCodeFence = false;
        activeFenceMarker = undefined;
      }
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const headingMatch = line.match(HEADING_REGEX);
    if (!headingMatch) {
      continue;
    }

    const promptBlock = parsePromptBlockAtHeading(lines, lineIndex, headingMatch);
    if (!promptBlock) {
      continue;
    }

    promptBlocks.push(promptBlock);
    lineIndex = Math.max(promptBlock.bodyEndLine, promptBlock.metadataEndLine);
  }

  return promptBlocks;
}

export function getMarkdownPromptBlockAtHeadingLine(
  document: vscode.TextDocument,
  headingLine: number
): MarkdownPromptBlock | undefined {
  return parseMarkdownPromptBlocks(document).find(
    (promptBlock) => promptBlock.headingLine === headingLine
  );
}

export function getSelectedTextContextForMarkdownPromptBlock(
  promptBlock: MarkdownPromptBlock
): SelectedTextVariableContext {
  return {
    rawSelectedText: promptBlock.body,
    selectedText: promptBlock.body,
    variables: { ...promptBlock.variables },
    promptReference: promptBlock.promptReference,
  };
}

function parsePromptBlockAtHeading(
  lines: string[],
  headingLine: number,
  headingMatch: RegExpMatchArray
): MarkdownPromptBlock | undefined {
  let metadataStartLine = headingLine + 1;
  while (metadataStartLine < lines.length && !lines[metadataStartLine].trim()) {
    metadataStartLine += 1;
  }

  const parsedMetadata = parsePromptMetadata(lines, metadataStartLine);
  if (!parsedMetadata) {
    return undefined;
  }

  let bodyStartLine = parsedMetadata.metadataEndLine + 1;
  while (bodyStartLine < lines.length && !lines[bodyStartLine].trim()) {
    bodyStartLine += 1;
  }

  const headingLevel = headingMatch[1].length;
  const bodyEndLineExclusive = findPromptBlockBodyEnd(
    lines,
    bodyStartLine,
    headingLevel
  );
  const promptReference = parsedMetadata.variables.prompt?.trim() || undefined;
  const variables = { ...parsedMetadata.variables };

  if (promptReference) {
    delete variables.prompt;
  }

  const body = lines
    .slice(bodyStartLine, bodyEndLineExclusive)
    .join("\n")
    .replace(/\n+$/, "");

  return {
    headingLine,
    headingLevel,
    headingText: headingMatch[2],
    metadataStartLine,
    metadataEndLine: parsedMetadata.metadataEndLine,
    bodyStartLine,
    bodyEndLine: Math.max(bodyStartLine, bodyEndLineExclusive - 1),
    promptReference,
    variables,
    body,
  };
}

function parsePromptMetadata(
  lines: string[],
  metadataStartLine: number
): { metadataEndLine: number; variables: Record<string, string> } | undefined {
  if (metadataStartLine >= lines.length) {
    return undefined;
  }

  if (!PROMPTO_METADATA_START_REGEX.test(lines[metadataStartLine])) {
    return undefined;
  }

  const variables: Record<string, string> = {};

  for (
    let currentLineIndex = metadataStartLine + 1;
    currentLineIndex < lines.length;
    currentLineIndex++
  ) {
    const line = lines[currentLineIndex];

    if (PROMPTO_METADATA_END_REGEX.test(line)) {
      return {
        metadataEndLine: currentLineIndex,
        variables,
      };
    }

    if (!line.trim()) {
      continue;
    }

    const keyValueMatch = line.match(KEY_VALUE_REGEX);
    if (!keyValueMatch) {
      return undefined;
    }

    const [, key, value] = keyValueMatch;
    variables[key] = value;
  }

  return undefined;
}

function findPromptBlockBodyEnd(
  lines: string[],
  bodyStartLine: number,
  headingLevel: number
): number {
  let inCodeFence = false;
  let activeFenceMarker: string | undefined;

  for (let lineIndex = bodyStartLine; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const fenceMatch = line.match(CODE_FENCE_REGEX);

    if (fenceMatch) {
      const fenceMarker = fenceMatch[1][0];
      if (!inCodeFence) {
        inCodeFence = true;
        activeFenceMarker = fenceMarker;
      } else if (activeFenceMarker === fenceMarker) {
        inCodeFence = false;
        activeFenceMarker = undefined;
      }
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const headingMatch = line.match(HEADING_REGEX);
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      return lineIndex;
    }
  }

  return lines.length;
}