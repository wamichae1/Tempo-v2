import { describe, expect, it } from "vitest";

import {
  migrateLegacyChat,
  parseStoredChat,
  serializeStoredChat,
  type AgentChatEntry,
} from "@/features/agent/agent-chat-state";

describe("agent chat persistence", () => {
  it("migrates valid v1 messages and cancels interrupted streams", () => {
    const entries = migrateLegacyChat(
      JSON.stringify({
        version: 1,
        messages: [
          {
            kind: "message",
            id: "one",
            role: "assistant",
            text: "partial",
            status: "streaming",
            createdAt: "2026-09-05T12:00:00.000Z",
          },
        ],
      }),
    );
    expect(entries).toEqual([
      expect.objectContaining({ id: "one", status: "cancelled" }),
    ]);
  });

  it("caps storage at 100 entries", () => {
    const entries: AgentChatEntry[] = Array.from({ length: 110 }, (_, index) => ({
      kind: "message",
      id: String(index),
      role: "user",
      text: String(index),
      status: "complete",
      createdAt: "2026-09-05T12:00:00.000Z",
    }));
    const parsed = parseStoredChat(serializeStoredChat(entries));
    expect(parsed).toHaveLength(100);
    expect(parsed[0]).toMatchObject({ id: "10" });
  });

  it("removes credential-shaped fields and continuation data", () => {
    const serialized = serializeStoredChat([
      {
        kind: "tool",
        id: "tool",
        callId: "call",
        toolName: "tempo_list_events",
        status: "succeeded",
        arguments: {
          query: "study",
          apiKey: "sk-secret",
          authorization: "Bearer sk-secret",
        },
        result: { continuation: { secret: "sk-secret" }, ok: true },
        createdAt: "2026-09-05T12:00:00.000Z",
      },
    ]);
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("continuation");
    expect(serialized).toContain("study");
  });
});
