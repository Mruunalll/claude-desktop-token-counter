export type ClaudeContentBlock = {
  type?: string;
  text?: string;
  title?: string;
  url?: string;
  content?: unknown;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
};

export type ClaudeMessage = {
  uuid?: string;
  parent_message_uuid?: string;
  sender?: string;
  created_at?: string;
  content?: ClaudeContentBlock[];
  attachments?: Array<{ extracted_content?: string }>;
};

export type ClaudeConversation = {
  current_leaf_message_uuid?: string;
  chat_messages?: ClaudeMessage[];
};

export type TokenEstimate = {
  tokens: number;
  chars: number;
  estimator: "heuristic" | "gpt-tokenizer";
};

const ROOT_MESSAGE_ID = "00000000-0000-4000-8000-000000000000";

type TokenizerModule = {
  countTokens?: (text: string) => number;
  encode?: (text: string) => unknown[];
  default?: TokenizerModule;
};

let tokenizerModulePromise: Promise<TokenizerModule | null> | null = null;

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(normalize);

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) {
      out[key] = normalize((v as Record<string, unknown>)[key]);
    }
    return out;
  };

  try {
    return JSON.stringify(normalize(value));
  } catch {
    return "";
  }
}

export function isCountableContentItem(item: ClaudeContentBlock): boolean {
  if (!item || typeof item !== "object") return false;
  if (typeof item.type !== "string") return false;
  if (item.type === "thinking" || item.type === "redacted_thinking") return false;
  if (item.type === "image" || item.type === "document") return false;
  return true;
}

export function stringifyCountableContentItem(item: ClaudeContentBlock): string {
  if (!isCountableContentItem(item)) return "";
  if (item.type === "text" && typeof item.text === "string") return item.text;

  if (item.type === "tool_use") {
    return stableStringify({ id: item.id, name: item.name, input: item.input });
  }

  if (item.type === "tool_result") {
    return stableStringify({
      tool_use_id: item.tool_use_id,
      is_error: item.is_error,
      content: item.content,
    });
  }

  const minimal: Record<string, unknown> = {};
  if (typeof item.text === "string") minimal.text = item.text;
  if (typeof item.title === "string") minimal.title = item.title;
  if (typeof item.url === "string") minimal.url = item.url;
  if (typeof item.content === "string" || Array.isArray(item.content)) {
    minimal.content = item.content;
  }
  return Object.keys(minimal).length ? stableStringify(minimal) : "";
}

export function stringifyMessageCountables(message: ClaudeMessage): string {
  const parts: string[] = [];

  for (const item of message.content ?? []) {
    const text = stringifyCountableContentItem(item);
    if (text) parts.push(text);
  }

  for (const attachment of message.attachments ?? []) {
    if (attachment.extracted_content) parts.push(attachment.extracted_content);
  }

  return parts.join("\n");
}

export function buildTrunk(conversation: ClaudeConversation): ClaudeMessage[] {
  const messages = conversation.chat_messages ?? [];
  const byId = new Map(messages.filter((m) => m.uuid).map((m) => [m.uuid!, m]));
  const trunk: ClaudeMessage[] = [];
  let currentId = conversation.current_leaf_message_uuid;

  while (currentId && currentId !== ROOT_MESSAGE_ID) {
    const message = byId.get(currentId);
    if (!message) break;
    trunk.push(message);
    currentId = message.parent_message_uuid;
  }

  return trunk.reverse();
}

async function loadTokenizer(): Promise<TokenizerModule | null> {
  tokenizerModulePromise ??= (async () => {
    const candidates = [
      "gpt-tokenizer/model/o200k_base",
      "gpt-tokenizer/encoding/o200k_base",
      "gpt-tokenizer",
    ];

    for (const specifier of candidates) {
      try {
        return (await import(specifier)) as TokenizerModule;
      } catch {
        // Keep trying supported package entry points. Fall back to heuristic below.
      }
    }

    return null;
  })();

  return tokenizerModulePromise;
}

function countWithTokenizer(tokenizer: TokenizerModule | null, text: string): number | null {
  const candidates = [tokenizer, tokenizer?.default].filter(Boolean) as TokenizerModule[];

  for (const candidate of candidates) {
    if (typeof candidate.countTokens === "function") return candidate.countTokens(text);
    if (typeof candidate.encode === "function") return candidate.encode(text).length;
  }

  return null;
}

function estimateTokensHeuristically(text: string): TokenEstimate {
  const chars = text.length;
  if (!text) return { tokens: 0, chars, estimator: "heuristic" };

  const segments = text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  const asciiWords = text.match(/[A-Za-z0-9_]+/g) ?? [];
  const nonAsciiChars = text.match(/[^\x00-\x7F]/g) ?? [];
  const whitespaceRuns = text.match(/\s+/g) ?? [];

  const estimated = Math.ceil(
    asciiWords.join("").length / 4 +
      Math.max(0, segments.length - asciiWords.length) * 0.75 +
      nonAsciiChars.length * 0.35 +
      whitespaceRuns.length * 0.1
  );

  return { tokens: Math.max(1, estimated), chars, estimator: "heuristic" };
}

export async function estimateTokens(text: string): Promise<TokenEstimate> {
  const chars = text.length;
  if (!text) return { tokens: 0, chars, estimator: "heuristic" };

  try {
    const tokenCount = countWithTokenizer(await loadTokenizer(), text);
    if (typeof tokenCount === "number" && Number.isFinite(tokenCount)) {
      return { tokens: tokenCount, chars, estimator: "gpt-tokenizer" };
    }
  } catch {
    // The tool should keep working even if the optional tokenizer cannot load.
  }

  return estimateTokensHeuristically(text);
}

export async function computeConversationMetrics(conversation: ClaudeConversation) {
  const trunk = buildTrunk(conversation);
  const text = trunk.map(stringifyMessageCountables).filter(Boolean).join("\n");
  const estimate = await estimateTokens(text);
  const lastAssistantMs = trunk.reduce<number | null>((latest, message) => {
    if (message.sender !== "assistant" || !message.created_at) return latest;
    const ms = Date.parse(message.created_at);
    return Number.isFinite(ms) && (!latest || ms > latest) ? ms : latest;
  }, null);

  return {
    trunkMessageCount: trunk.length,
    totalTokens: estimate.tokens,
    chars: estimate.chars,
    estimator: estimate.estimator,
    cachedUntil: lastAssistantMs ? new Date(lastAssistantMs + 5 * 60 * 1000).toISOString() : null,
    limitations: [
      "Does not include Claude Desktop system prompt or hidden context.",
      "Counts only user-supplied/exported conversation data.",
      "Uses gpt-tokenizer when installed, with a transparent heuristic fallback.",
    ],
  };
}
