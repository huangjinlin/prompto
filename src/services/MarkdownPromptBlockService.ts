import * as vscode from "vscode";
import { SelectedTextVariableContext } from "./SelectedTextVariableService";

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/;
const CODE_FENCE_REGEX = /^\s*(`{3,}|~{3,})/;
const PROMPTO_METADATA_START_REGEX = /^\s*<!--\s*prompto\s*$/;
const PROMPTO_ACTION_METADATA_START_REGEX = /^\s*<!--\s*prompto-action\s*$/;
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
  inlinePromptContent?: string;
  variables: Record<string, string>;
  body: string;
}

export interface MarkdownPromptAction {
  title: string;
  anchorLine: number;
  metadataStartLine: number;
  metadataEndLine: number;
  promptReference?: string;
  inlinePromptContent?: string;
  variables: Record<string, string>;
}

export function parseMarkdownPromptBlocks(
  document: vscode.TextDocument
): MarkdownPromptBlock[] {
  const lines = Array.from({ length: document.lineCount }, (_, index) =>
    document.lineAt(index).text
  );
  const promptBlocks: MarkdownPromptBlock[] = [];
  const actionMetadataRanges = parseMarkdownPromptActionMetadataRanges(lines);

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

    const promptBlock = parsePromptBlockAtHeading(
      lines,
      lineIndex,
      headingMatch,
      actionMetadataRanges
    );
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

export function parseMarkdownPromptActions(
  document: vscode.TextDocument
): MarkdownPromptAction[] {
  const lines = Array.from({ length: document.lineCount }, (_, index) =>
    document.lineAt(index).text
  );

  return parseMarkdownPromptActionsFromLines(lines);
}

export function getMarkdownPromptActionAtLine(
  document: vscode.TextDocument,
  anchorLine: number
): MarkdownPromptAction | undefined {
  return parseMarkdownPromptActions(document).find(
    (promptAction) => promptAction.anchorLine === anchorLine
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
    inlinePromptContent: promptBlock.inlinePromptContent,
  };
}

export function getSelectedTextContextForMarkdownPromptAction(
  promptAction: MarkdownPromptAction
): SelectedTextVariableContext {
  return {
    rawSelectedText: "",
    selectedText: "",
    variables: { ...promptAction.variables },
    promptReference: promptAction.promptReference,
    inlinePromptContent: promptAction.inlinePromptContent,
  };
}

function parsePromptBlockAtHeading(
  lines: string[],
  headingLine: number,
  headingMatch: RegExpMatchArray,
  actionMetadataRanges: Array<{ startLine: number; endLine: number }>
): MarkdownPromptBlock | undefined {
  let metadataStartLine = headingLine + 1;
  while (metadataStartLine < lines.length && !lines[metadataStartLine].trim()) {
    metadataStartLine += 1;
  }

  const parsedMetadata = parsePromptMetadata(
    lines,
    metadataStartLine,
    PROMPTO_METADATA_START_REGEX
  );
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
  const inlinePromptContent = normalizeInlinePromptContent(
    parsedMetadata.variables.promptContent
  );
  const variables = { ...parsedMetadata.variables };

  if (promptReference) {
    delete variables.prompt;
  }

  if (inlinePromptContent) {
    delete variables.promptContent;
  }

  const body = lines
    .slice(bodyStartLine, bodyEndLineExclusive)
    .filter(
      (_, offset) =>
        !isLineWithinRanges(bodyStartLine + offset, actionMetadataRanges)
    )
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
    inlinePromptContent,
    variables,
    body,
  };
}

function parsePromptMetadata(
  lines: string[],
  metadataStartLine: number,
  metadataStartRegex: RegExp
): { metadataEndLine: number; variables: Record<string, string> } | undefined {
  if (metadataStartLine >= lines.length) {
    return undefined;
  }

  if (!metadataStartRegex.test(lines[metadataStartLine])) {
    return undefined;
  }

  const variables: Record<string, string> = {};

  for (
    let currentLineIndex = metadataStartLine + 1;
    currentLineIndex < lines.length;
  ) {
    const line = lines[currentLineIndex];

    if (PROMPTO_METADATA_END_REGEX.test(line)) {
      return {
        metadataEndLine: currentLineIndex,
        variables,
      };
    }

    if (!line.trim()) {
      currentLineIndex += 1;
      continue;
    }

    const keyValueMatch = line.match(KEY_VALUE_REGEX);
    if (!keyValueMatch) {
      return undefined;
    }

    const [, key, value] = keyValueMatch;

    if (value === "|") {
      const blockValue = parseBlockMetadataValue(lines, currentLineIndex);
      if (!blockValue) {
        return undefined;
      }

      variables[key] = blockValue.value;
      currentLineIndex = blockValue.nextLineIndex;
      continue;
    }

    variables[key] = value;
    currentLineIndex += 1;
  }

  return undefined;
}

function parseMarkdownPromptActionsFromLines(
  lines: string[]
): MarkdownPromptAction[] {
  const promptActions: MarkdownPromptAction[] = [];

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

    if (inCodeFence || !PROMPTO_ACTION_METADATA_START_REGEX.test(line)) {
      continue;
    }

    const parsedMetadata = parsePromptMetadata(
      lines,
      lineIndex,
      PROMPTO_ACTION_METADATA_START_REGEX
    );

    if (!parsedMetadata) {
      continue;
    }

    const title = normalizeMetadataValue(parsedMetadata.variables.title);
    const promptReference = normalizeMetadataValue(
      parsedMetadata.variables.prompt
    );
    const inlinePromptContent = normalizeInlinePromptContent(
      parsedMetadata.variables.promptContent
    );
    const variables = { ...parsedMetadata.variables };

    delete variables.title;

    if (promptReference) {
      delete variables.prompt;
    }

    if (inlinePromptContent) {
      delete variables.promptContent;
    }

    if (title) {
      promptActions.push({
        title,
        anchorLine: findPromptActionAnchorLine(
          lines,
          lineIndex,
          parsedMetadata.metadataEndLine
        ),
        metadataStartLine: lineIndex,
        metadataEndLine: parsedMetadata.metadataEndLine,
        promptReference,
        inlinePromptContent,
        variables,
      });
    }

    lineIndex = parsedMetadata.metadataEndLine;
  }

  return promptActions;
}

function parseMarkdownPromptActionMetadataRanges(
  lines: string[]
): Array<{ startLine: number; endLine: number }> {
  const metadataRanges: Array<{ startLine: number; endLine: number }> = [];

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

    if (inCodeFence || !PROMPTO_ACTION_METADATA_START_REGEX.test(line)) {
      continue;
    }

    const parsedMetadata = parsePromptMetadata(
      lines,
      lineIndex,
      PROMPTO_ACTION_METADATA_START_REGEX
    );

    if (!parsedMetadata) {
      continue;
    }

    metadataRanges.push({
      startLine: lineIndex,
      endLine: parsedMetadata.metadataEndLine,
    });
    lineIndex = parsedMetadata.metadataEndLine;
  }

  return metadataRanges;
}

function findPromptActionAnchorLine(
  lines: string[],
  metadataStartLine: number,
  metadataEndLine: number
): number {
  for (let lineIndex = metadataEndLine + 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    if (
      PROMPTO_ACTION_METADATA_START_REGEX.test(line) ||
      PROMPTO_METADATA_START_REGEX.test(line) ||
      HEADING_REGEX.test(line) ||
      trimmedLine.startsWith("<!--")
    ) {
      return metadataStartLine;
    }

    return lineIndex;
  }

  return metadataStartLine;
}

function isLineWithinRanges(
  lineIndex: number,
  ranges: Array<{ startLine: number; endLine: number }>
): boolean {
  return ranges.some(
    (range) => lineIndex >= range.startLine && lineIndex <= range.endLine
  );
}

function parseBlockMetadataValue(
  lines: string[],
  keyLineIndex: number
): { value: string; nextLineIndex: number } | undefined {
  const headerIndentLength = getIndentLength(lines[keyLineIndex]);
  const valueLines: string[] = [];
  let blockIndentLength: number | undefined;
  let currentLineIndex = keyLineIndex + 1;

  while (currentLineIndex < lines.length) {
    const line = lines[currentLineIndex];

    if (PROMPTO_METADATA_END_REGEX.test(line)) {
      break;
    }

    if (!line.trim()) {
      valueLines.push("");
      currentLineIndex += 1;
      continue;
    }

    const indentLength = getIndentLength(line);

    if (blockIndentLength === undefined) {
      if (indentLength <= headerIndentLength) {
        break;
      }

      blockIndentLength = indentLength;
    } else if (indentLength < blockIndentLength) {
      break;
    }

    valueLines.push(line.slice(blockIndentLength));
    currentLineIndex += 1;
  }

  return {
    value: valueLines.join("\n").replace(/\n+$/, ""),
    nextLineIndex: currentLineIndex,
  };
}

function getIndentLength(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function normalizeInlinePromptContent(
  value: string | undefined
): string | undefined {
  return value?.trim() ? value : undefined;
}

function normalizeMetadataValue(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
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