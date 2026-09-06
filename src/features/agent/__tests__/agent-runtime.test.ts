import { describe, expect, it, vi } from "vitest";

import type { AgentTool } from "@/features/agent/agent-tool";
import { runAgentTurn } from "@/features/agent/agent-runtime";
import {
  AiProviderError,
  type AiProvider,
  type AiProviderEvent,
  type AiProviderRequest,
} from "@/features/agent/ai/ai-provider";

function providerWith(
  turns: Array<(request: AiProviderRequest) => AiProviderEvent[]>,
): AiProvider {
  let index = 0;
  return {
    id: "openai",
    async *stream(request) {
      const turn = turns[index];
      index += 1;
      if (!turn) throw new Error("unexpected provider turn");
      for (const event of turn(request)) yield event;
    },
  };
}

const config = {
  provider: "openai" as const,
  apiKey: "test-only",
  model: "test-model",
};

describe("runAgentTurn", () => {
  it("streams and completes a basic response", async () => {
    const onTextDelta = vi.fn();
    const result = await runAgentTurn({
      provider: providerWith([
        () => [
          { type: "text-delta", text: "Hello" },
          {
            type: "completed",
            result: { text: "Hello", toolCalls: [], continuation: [] },
          },
        ],
      ]),
      config,
      systemPrompt: "prompt",
      conversation: [{ role: "user", text: "Hi" }],
      tools: [],
      signal: new AbortController().signal,
      callbacks: { onTextDelta },
    });
    expect(result).toMatchObject({ finalText: "Hello", rounds: 1 });
    expect(onTextDelta).toHaveBeenCalledWith("Hello", 1);
  });

  it("executes multiple sequential tools and returns their outputs", async () => {
    const execute = vi.fn(async (input: Record<string, unknown>) => ({
      ok: true,
      input,
    }));
    const tool: AgentTool = {
      name: "tempo_test",
      description: "test",
      inputSchema: { type: "object", properties: {} },
      execute,
    };
    const provider = providerWith([
      () => [
        {
          type: "completed",
          result: {
            text: "",
            continuation: [{ type: "reasoning", id: "reason" }],
            toolCalls: [
              {
                callId: "one",
                name: "tempo_test",
                argumentsText: '{"step":1}',
              },
              {
                callId: "two",
                name: "tempo_test",
                argumentsText: '{"step":2}',
              },
            ],
          },
        },
      ],
      (request) => {
        expect(request.kind).toBe("continue");
        if (request.kind === "continue") {
          expect(request.toolResults).toHaveLength(2);
          expect(request.continuation).toEqual([
            { type: "reasoning", id: "reason" },
          ]);
        }
        return [
          {
            type: "completed",
            result: { text: "Done", toolCalls: [], continuation: [] },
          },
        ];
      },
    ]);
    const result = await runAgentTurn({
      provider,
      config,
      systemPrompt: "prompt",
      conversation: [{ role: "user", text: "Do two things" }],
      tools: [tool],
      signal: new AbortController().signal,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ finalText: "Done", toolCalls: 2, rounds: 2 });
  });

  it("returns unknown and malformed calls to the provider without executing", async () => {
    const completed = vi.fn();
    await runAgentTurn({
      provider: providerWith([
        () => [
          {
            type: "completed",
            result: {
              text: "",
              continuation: [],
              toolCalls: [
                { callId: "bad", name: "missing", argumentsText: "[]" },
              ],
            },
          },
        ],
        (request) => {
          if (request.kind === "continue") {
            expect(request.toolResults[0].output).toContain(
              "arguments must be a JSON object",
            );
          }
          return [
            {
              type: "completed",
              result: { text: "Could not run it", toolCalls: [], continuation: [] },
            },
          ];
        },
      ]),
      config,
      systemPrompt: "prompt",
      conversation: [{ role: "user", text: "Run it" }],
      tools: [],
      signal: new AbortController().signal,
      callbacks: { onToolComplete: completed },
    });
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "bad" }),
      {},
      expect.objectContaining({ ok: false }),
      false,
    );
  });

  it("stops on cancellation and loop limits", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAgentTurn({
        provider: providerWith([]),
        config,
        systemPrompt: "prompt",
        conversation: [],
        tools: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });

    await expect(
      runAgentTurn({
        provider: providerWith([
          () => [
            {
              type: "completed",
              result: {
                text: "",
                continuation: [],
                toolCalls: [
                  { callId: "one", name: "missing", argumentsText: "{}" },
                ],
              },
            },
          ],
        ]),
        config,
        systemPrompt: "prompt",
        conversation: [],
        tools: [],
        signal: new AbortController().signal,
        maxToolCalls: 0,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiProviderError>>({
        code: "loop-limit",
      }),
    );
  });
});
