const MARKDOWN_TABLE_REGEX = /^\|(.+)\|[\r\n]+\|[-:\s|]+\|[\r\n]+((?:\|.+\|[\r\n]*)+)/gm;
const MARKDOWN_CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;

type ParsedMarkdownTable = {
  headers: string[];
  rows: string[][];
  extraCount: number;
};

export type NaverWorksFlexBoxLayout = "horizontal" | "vertical" | "baseline";

export type NaverWorksFlexComponent =
  | {
      type: "text";
      text: string;
      action?: {
        type: "uri";
        uri: string;
      };
      size?: "xs" | "sm" | "md";
      weight?: "bold";
      color?: string;
      wrap?: boolean;
      margin?: "none" | "sm" | "md";
      flex?: number;
    }
  | {
      type: "image";
      url: string;
      size?: "full";
      aspectRatio?: string;
      aspectMode?: "fit" | "cover";
      margin?: "none" | "sm" | "md";
      flex?: number;
    }
  | {
      type: "separator";
      margin?: "none" | "sm" | "md";
    }
  | {
      type: "box";
      layout: NaverWorksFlexBoxLayout;
      contents: NaverWorksFlexComponent[];
      margin?: "none" | "sm" | "md";
      spacing?: "none" | "sm";
      flex?: number;
    };

export type NaverWorksFlexBubble = {
  type: "bubble";
  body: {
    type: "box";
    layout: "vertical";
    contents: NaverWorksFlexComponent[];
  };
};

export type NaverWorksFlexContainer = NaverWorksFlexBubble;

export function hasMarkdownFeatures(text: string): boolean {
  const input = text.trim();
  if (!input) {
    return false;
  }
  MARKDOWN_TABLE_REGEX.lastIndex = 0;
  MARKDOWN_CODE_BLOCK_REGEX.lastIndex = 0;
  CLICKABLE_URL_CANDIDATE_RE.lastIndex = 0;
  return (
    MARKDOWN_TABLE_REGEX.test(input) ||
    MARKDOWN_CODE_BLOCK_REGEX.test(input) ||
    /^\s*[-*+]\s+/m.test(input) ||
    /^\s*#{1,6}\s+/m.test(input) ||
    /\[[^\]]+\]\([^)]+\)/.test(input) ||
    CLICKABLE_URL_CANDIDATE_RE.test(input)
  );
}

function extractCodeBlocks(text: string): { codeBlocks: string[]; textWithoutCode: string } {
  MARKDOWN_CODE_BLOCK_REGEX.lastIndex = 0;
  const codeBlocks: string[] = [];
  const textWithoutCode = text.replace(MARKDOWN_CODE_BLOCK_REGEX, (_full, language, body) => {
    const lang = String(language || "").trim();
    const code = String(body || "").trim();
    const label = lang ? `Code (${lang})` : "Code";
    codeBlocks.push(`${label}\n${code}`.trim());
    return "";
  });
  return { codeBlocks, textWithoutCode };
}

function parseTableRow(row: string): string[] {
  return row
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell, index, arr) => !((index === 0 || index === arr.length - 1) && cell === ""));
}

function extractTables(text: string): { tables: ParsedMarkdownTable[]; textWithoutTables: string } {
  MARKDOWN_TABLE_REGEX.lastIndex = 0;
  const matches: { fullMatch: string; table: ParsedMarkdownTable }[] = [];
  let match: RegExpExecArray | null;

  while ((match = MARKDOWN_TABLE_REGEX.exec(text)) !== null) {
    const headers = parseTableRow(match[1] ?? "");
    const allRows = (match[2] ?? "")
      .trim()
      .split(/[\r\n]+/)
      .filter((line) => line.trim())
      .map(parseTableRow);

    if (headers.length === 0 || allRows.length === 0) {
      continue;
    }

    const rows = allRows.slice(0, 3);
    matches.push({
      fullMatch: match[0],
      table: {
        headers,
        rows,
        extraCount: allRows.length - rows.length,
      },
    });
  }

  let textWithoutTables = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    textWithoutTables = textWithoutTables.replace(matches[i].fullMatch, "");
  }

  return {
    tables: matches.map((entry) => entry.table),
    textWithoutTables,
  };
}

function normalizeInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .trim();
}

const TRAILING_URL_PUNCTUATION_RE = /[.,!?;:)\]}]+$/;
const LINK_TEXT_COLOR = "#0969da";
const CLICKABLE_URL_CANDIDATE_RE =
  /(?:https?:\/\/|www\.)(?:[^\s<>"']+)|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

function trimTrailingUrlPunctuation(value: string): string {
  let trimmed = value.trim();
  while (TRAILING_URL_PUNCTUATION_RE.test(trimmed)) {
    trimmed = trimmed.replace(TRAILING_URL_PUNCTUATION_RE, "");
  }
  return trimmed;
}

function normalizeClickableUrl(candidate: string): string | undefined {
  const trimmed = trimTrailingUrlPunctuation(candidate);
  if (!trimmed) {
    return undefined;
  }
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith("www.")
      ? `https://${trimmed}`
      : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return undefined;
    }
    if (!parsed.hostname.includes(".") || /\s/.test(parsed.hostname)) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function splitTextIntoClickableSegments(
  text: string,
): Array<{ text: string; uri?: string }> {
  const segments: Array<{ text: string; uri?: string }> = [];
  CLICKABLE_URL_CANDIDATE_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = CLICKABLE_URL_CANDIDATE_RE.exec(text)) !== null) {
    const matchedText = match[0] ?? "";
    const normalizedUrl = normalizeClickableUrl(matchedText);
    const start = match.index;
    const trimmedMatch = trimTrailingUrlPunctuation(matchedText);
    const trimmedLength = trimmedMatch.length;
    const end = start + trimmedLength;

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start) });
    }
    if (trimmedLength > 0) {
      segments.push({
        text: text.slice(start, end),
        uri: normalizedUrl,
      });
    }
    cursor = start + matchedText.length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

export function createTextComponent(
  text: string,
  options?: { bold?: boolean; margin?: "none" | "sm" | "md"; color?: string; size?: "sm" | "md" },
) {
  return {
    type: "text" as const,
    text,
    wrap: true,
    size: (options?.size ?? "md") as const,
    color: options?.color,
    weight: options?.bold ? ("bold" as const) : undefined,
    margin: options?.margin,
  };
}

export function createTextLineComponents(
  text: string,
  options?: { bold?: boolean; margin?: "none" | "sm" | "md"; color?: string; size?: "sm" | "md" },
): NaverWorksFlexComponent[] {
  const segments = splitTextIntoClickableSegments(text);
  if (segments.length <= 1) {
    const only = segments[0];
    return [
      {
        ...createTextComponent(text, {
          ...options,
          color: only?.uri ? LINK_TEXT_COLOR : options?.color,
        }),
        action: only?.uri ? { type: "uri" as const, uri: only.uri } : undefined,
      },
    ];
  }
  return [
    {
      type: "box" as const,
      layout: "baseline" as const,
      margin: options?.margin,
      contents: segments.map((segment) => ({
        ...createTextComponent(segment.text, {
          bold: options?.bold,
          color: segment.uri ? LINK_TEXT_COLOR : options?.color,
          size: options?.size,
        }),
        action: segment.uri ? { type: "uri" as const, uri: segment.uri } : undefined,
      })),
    },
  ];
}

function createTableRowComponents(
  table: ParsedMarkdownTable,
  options: { textColor: string; sectionTitleColor: string },
): NaverWorksFlexComponent[] {
  return createExpandedTableRowComponents(table, options);
}

function createExpandedTableRowComponents(
  table: ParsedMarkdownTable,
  options: { textColor: string; sectionTitleColor: string },
): NaverWorksFlexComponent[] {
  const contents: NaverWorksFlexComponent[] = [];
  for (const [rowIndex, row] of table.rows.entries()) {
    if (rowIndex > 0) {
      contents.push({ type: "separator", margin: "md" });
    }
    const rowContents: NaverWorksFlexComponent[] = [];
    for (const [index, header] of table.headers.entries()) {
      const label = header.trim() || `Column ${index + 1}`;
      const value = row[index]?.trim() || "-";
      if (rowContents.length > 0) {
        rowContents.push({ type: "separator", margin: "sm" });
      }
      rowContents.push({
        type: "box",
        layout: "vertical",
        margin: rowContents.length === 0 ? "none" : "sm",
        contents: [
          ...createTextLineComponents(label, {
            bold: true,
            color: options.sectionTitleColor,
            size: "sm",
          }),
          ...createTextLineComponents(value, {
            margin: "none",
            color: options.textColor,
            size: "md",
          }),
        ],
      });
    }
    contents.push({
      type: "box",
      layout: "vertical",
      margin: rowIndex === 0 ? "sm" : "md",
      spacing: "sm",
      contents: rowContents,
    });
  }
  if (table.extraCount > 0) {
    contents.push(
      ...createTextLineComponents(`... and ${table.extraCount} more row(s)`, {
        margin: "sm",
        color: options.textColor,
        size: "sm",
      }),
    );
  }
  return contents;
}

function buildAltText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "OpenClaw message";
  }
  return normalized.slice(0, 400);
}

export function markdownToNaverWorksFlexTemplate(
  text: string,
  options?: { theme?: "light" | "dark" | "auto" },
): {
  altText: string;
  contents: NaverWorksFlexContainer;
} | null {
  const trimmed = text.trim();
  if (!trimmed || !hasMarkdownFeatures(trimmed)) {
    return null;
  }

  const { codeBlocks, textWithoutCode } = extractCodeBlocks(trimmed);
  const { tables, textWithoutTables } = extractTables(textWithoutCode);
  const normalizedText = normalizeInlineMarkdown(textWithoutTables);
  const lines = normalizedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const resolvedTheme = options?.theme ?? "auto";
  const textColor = resolvedTheme === "dark" ? "#f5f5f5" : "#111111";
  const sectionTitleColor = resolvedTheme === "dark" ? "#ffffff" : "#000000";

  const contents: NaverWorksFlexComponent[] = [];

  if (lines.length > 0) {
    contents.push(
      ...createTextLineComponents(lines[0], { bold: true, color: sectionTitleColor, size: "md" }),
    );
    for (const line of lines.slice(1)) {
      contents.push(
        ...createTextLineComponents(line, { margin: "sm", color: textColor, size: "md" }),
      );
    }
  }

  for (const table of tables) {
    if (contents.length > 0) {
      contents.push({ type: "separator", margin: "md" });
    }
    contents.push(
      ...createTextLineComponents("Table", {
        bold: true,
        margin: "sm",
        color: sectionTitleColor,
        size: "md",
      }),
    );
    contents.push(...createTableRowComponents(table, { textColor, sectionTitleColor }));
  }

  for (const codeBlock of codeBlocks) {
    if (contents.length > 0) {
      contents.push({ type: "separator", margin: "md" });
    }
    const codeLines = codeBlock.split("\n").filter(Boolean);
    contents.push(
      ...createTextLineComponents(codeLines[0] ?? "Code", {
        bold: true,
        margin: "sm",
        color: sectionTitleColor,
        size: "md",
      }),
    );
    for (const line of codeLines.slice(1)) {
      contents.push(
        ...createTextLineComponents(line, { margin: "sm", color: textColor, size: "md" }),
      );
    }
  }

  if (contents.length === 0) {
    contents.push(
      ...createTextLineComponents(normalizedText || trimmed, {
        color: textColor,
        size: "md",
      }),
    );
  }

  return {
    altText: buildAltText(normalizedText || trimmed),
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents,
      },
    },
  };
}
