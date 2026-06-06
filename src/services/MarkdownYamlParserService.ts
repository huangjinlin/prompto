/**
 * 受限 YAML 子集解析器
 * 仅支持规范 v1 定义的结构：映射、数组、标量、多行字符串
 * 不支持 anchors、aliases、merge keys、多文档、flow style
 */

const INDENT_UNIT = 2;

export function parseYamlSubset(content: string): unknown {
  const lines = content.split("\n");
  const result = parseBlock(lines, 0, 0);
  return result.value;
}

interface ParseResult {
  value: unknown;
  nextIndex: number;
}

function parseBlock(
  lines: string[],
  startIndex: number,
  baseIndent: number
): ParseResult {
  if (startIndex >= lines.length) {
    return { value: {}, nextIndex: startIndex };
  }

  // 判断当前块是数组还是映射
  const firstLine = lines[startIndex];
  const firstTrimmed = firstLine.trimStart();

  if (firstTrimmed.startsWith("- ")) {
    return parseArray(lines, startIndex, baseIndent);
  }

  return parseMapping(lines, startIndex, baseIndent);
}

function parseMapping(
  lines: string[],
  startIndex: number,
  baseIndent: number
): ParseResult {
  const result: Record<string, unknown> = {};
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!trimmed) {
      i++;
      continue;
    }

    const currentIndent = line.length - trimmed.length;

    if (currentIndent < baseIndent) {
      break;
    }

    if (currentIndent > baseIndent) {
      break;
    }

    const kvMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kvMatch) {
      break;
    }

    const key = kvMatch[1];
    const rawValue = kvMatch[2];

    if (rawValue === "|") {
      // 多行字符串
      const multiline = parseMultilineString(lines, i + 1, currentIndent + INDENT_UNIT);
      result[key] = multiline.value;
      i = multiline.nextIndex;
    } else if (rawValue === "") {
      // 嵌套块
      const childIndent = findNextIndent(lines, i + 1);
      if (childIndent > currentIndent) {
        const child = parseBlock(lines, i + 1, childIndent);
        result[key] = child.value;
        i = child.nextIndex;
      } else {
        result[key] = null;
        i++;
      }
    } else {
      result[key] = parseScalar(rawValue);
      i++;
    }
  }

  return { value: result, nextIndex: i };
}

function parseArray(
  lines: string[],
  startIndex: number,
  baseIndent: number
): ParseResult {
  const result: unknown[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!trimmed) {
      i++;
      continue;
    }

    const currentIndent = line.length - trimmed.length;

    if (currentIndent < baseIndent) {
      break;
    }

    if (currentIndent > baseIndent) {
      break;
    }

    if (!trimmed.startsWith("- ")) {
      break;
    }

    const afterDash = trimmed.slice(2);

    if (!afterDash || !afterDash.trim()) {
      // 空 `- ` 后面跟嵌套块
      const childIndent = findNextIndent(lines, i + 1);
      if (childIndent > currentIndent) {
        const child = parseBlock(lines, i + 1, childIndent);
        result.push(child.value);
        i = child.nextIndex;
      } else {
        result.push(null);
        i++;
      }
    } else {
      const kvMatch = afterDash.match(
        /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/
      );
      if (kvMatch) {
        // `- key: value` 形式，收集同缩进的后续 key-value 构成对象
        const obj: Record<string, unknown> = {};
        const key = kvMatch[1];
        const rawValue = kvMatch[2];

        if (rawValue === "|") {
          const multiline = parseMultilineString(
            lines,
            i + 1,
            currentIndent + INDENT_UNIT + INDENT_UNIT
          );
          obj[key] = multiline.value;
          i = multiline.nextIndex;
        } else if (rawValue === "") {
          const childIndent = findNextIndent(lines, i + 1);
          if (childIndent > currentIndent) {
            const child = parseBlock(lines, i + 1, childIndent);
            obj[key] = child.value;
            i = child.nextIndex;
          } else {
            obj[key] = null;
            i++;
          }
        } else {
          obj[key] = parseScalar(rawValue);
          i++;
        }

        // 收集同级（与 `- ` 同缩进）的额外 key: value
        while (i < lines.length) {
          const nextLine = lines[i];
          const nextTrimmed = nextLine.trimStart();

          if (!nextTrimmed) {
            i++;
            continue;
          }

          const nextIndent = nextLine.length - nextTrimmed.length;
          if (nextIndent !== currentIndent + INDENT_UNIT) {
            break;
          }

          const nextKv = nextTrimmed.match(
            /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/
          );
          if (!nextKv) {
            break;
          }

          const nextKey = nextKv[1];
          const nextRawValue = nextKv[2];

          if (nextRawValue === "|") {
            const multiline = parseMultilineString(
              lines,
              i + 1,
              nextIndent + INDENT_UNIT
            );
            obj[nextKey] = multiline.value;
            i = multiline.nextIndex;
          } else if (nextRawValue === "") {
            const childIndent = findNextIndent(lines, i + 1);
            if (childIndent > nextIndent) {
              const child = parseBlock(lines, i + 1, childIndent);
              obj[nextKey] = child.value;
              i = child.nextIndex;
            } else {
              obj[nextKey] = null;
              i++;
            }
          } else {
            obj[nextKey] = parseScalar(nextRawValue);
            i++;
          }
        }

        result.push(obj);
      } else {
        result.push(parseScalar(afterDash));
        i++;
      }
    }
  }

  return { value: result, nextIndex: i };
}

function parseMultilineString(
  lines: string[],
  startIndex: number,
  baseIndent: number
): ParseResult {
  const collected: string[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      collected.push("");
      i++;
      continue;
    }

    const currentIndent = line.length - line.trimStart().length;
    if (currentIndent < baseIndent) {
      break;
    }

    collected.push(line.slice(baseIndent));
    i++;
  }

  // 去掉末尾空行
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
  }

  return { value: collected.join("\n"), nextIndex: i };
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed === "null" || trimmed === "~" || trimmed === "") {
    return null;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  // 整数
  if (/^-?\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // 浮点数
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // 去掉引号
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function findNextIndent(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed) {
      continue;
    }
    return line.length - trimmed.length;
  }
  return 0;
}
