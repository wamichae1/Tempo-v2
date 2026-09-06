import { AiProviderError } from "@/features/agent/ai/ai-provider";

function parseEventBlock(block: string): string | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data || null;
}

export async function* readJsonSse(
  response: Response,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  if (!response.body) {
    throw new AiProviderError(
      "malformed-response",
      "The AI provider returned an empty streaming response.",
      true,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) {
        throw new AiProviderError("cancelled", "The request was cancelled.");
      }
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const data = parseEventBlock(block);
        if (!data || data === "[DONE]") continue;
        try {
          yield JSON.parse(data) as unknown;
        } catch {
          throw new AiProviderError(
            "malformed-response",
            "The AI provider returned malformed streaming data.",
            true,
          );
        }
      }
      if (done) break;
    }

    const data = parseEventBlock(buffer);
    if (data && data !== "[DONE]") {
      try {
        yield JSON.parse(data) as unknown;
      } catch {
        throw new AiProviderError(
          "malformed-response",
          "The AI provider returned malformed streaming data.",
          true,
        );
      }
    }
  } finally {
    reader.releaseLock();
  }
}
