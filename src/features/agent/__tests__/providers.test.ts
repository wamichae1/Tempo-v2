import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  models: vi.fn(),
  responses: vi.fn(),
}));

vi.mock("openai", () => {
  class APIUserAbortError extends Error {}
  class APIConnectionError extends Error {}
  class APIError extends Error {
    status?: number;
    code?: string;
  }
  class OpenAI {
    static APIUserAbortError = APIUserAbortError;
    static APIConnectionError = APIConnectionError;
    static APIError = APIError;
    models = { list: openAiMocks.models };
    responses = { create: openAiMocks.responses };
  }
  return { default: OpenAI };
});

import type {
  AiProvider,
  AiProviderEvent,
} from "@/features/agent/ai/ai-provider";
import { GeminiProvider } from "@/features/agent/ai/gemini-provider";
import { OpenAiProvider } from "@/features/agent/ai/openai-provider";
import { OpenCodeProvider } from "@/features/agent/ai/opencode-provider";
import { OpenRouterProvider } from "@/features/agent/ai/openrouter-provider";

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")
    .concat("data: [DONE]\n\n");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(provider: AiProvider): Promise<AiProviderEvent[]> {
  const events: AiProviderEvent[] = [];
  for await (const event of provider.stream({
    kind: "start",
    config: {
      provider: provider.id,
      apiKey: "test-only-key",
      model: provider.metadata.defaultModelId,
    },
    systemPrompt: "Use tools safely.",
    conversation: [{ role: "user", text: "Hello" }],
    tools: [{
      name: "tempo_test",
      description: "Test tool",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    }],
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

describe("provider implementations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    openAiMocks.models.mockReset();
    openAiMocks.responses.mockReset();
  });

  it("discovers and streams OpenAI Responses", async () => {
    openAiMocks.models.mockResolvedValue({
      data: [
        { id: "gpt-test", owned_by: "openai" },
        { id: "text-embedding-test", owned_by: "openai" },
      ],
    });
    openAiMocks.responses.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: "Hello" };
        yield {
          type: "response.completed",
          response: { output_text: "Hello", output: [] },
        };
      },
    });
    const provider = new OpenAiProvider();
    await expect(
      provider.discoverModels({
        apiKey: "test",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "gpt-test", providerId: "openai" }),
    ]);
    const events = await collect(provider);
    expect(events).toContainEqual({ type: "text-delta", text: "Hello" });
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "completed",
        result: expect.objectContaining({ text: "Hello" }),
      }),
    );
    expect(openAiMocks.responses).toHaveBeenCalledWith(
      expect.objectContaining({
        parallel_tool_calls: false,
        store: false,
        stream: true,
      }),
      expect.anything(),
    );
  });

  it("discovers tool-capable OpenRouter models and streams chat tool calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "vendor/tool-model",
              name: "Tool Model",
              supported_parameters: ["tools"],
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "vendor/no-tools",
              name: "No Tools",
              supported_parameters: [],
              architecture: { output_modalities: ["text"] },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { content: "Working" } }] },
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call-1",
                  function: { name: "tempo_test", arguments: "{\"x\":" },
                }],
              },
            }],
          },
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: "1}" },
                }],
              },
            }],
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "https://tempo.test" } });

    const provider = new OpenRouterProvider();
    const models = await provider.discoverModels({
      apiKey: "test",
      signal: new AbortController().signal,
    });
    expect(models.map((model) => model.id)).toEqual(["vendor/tool-model"]);
    const events = await collect(provider);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "completed",
        result: expect.objectContaining({
          toolCalls: [{
            callId: "call-1",
            name: "tempo_test",
            argumentsText: "{\"x\":1}",
          }],
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).not.toContain("test-only-key");
  });

  it("discovers and streams OpenCode Zen models", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            data: [{ id: "gpt-test", owned_by: "opencode" }],
          }),
        )
        .mockResolvedValueOnce(
          sseResponse([{ choices: [{ delta: { content: "Zen" } }] }]),
        ),
    );
    const provider = new OpenCodeProvider();
    await expect(
      provider.discoverModels({
        apiKey: "test",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "gpt-test", providerId: "opencode" }),
    ]);
    const events = await collect(provider);
    expect(events).toContainEqual({ type: "text-delta", text: "Zen" });
  });

  it("discovers Gemini models and streams interaction function calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          models: [
            {
              name: "models/gemini-test",
              displayName: "Gemini Test",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { event_type: "step.delta", delta: { text: "Checking" } },
          {
            event_type: "interaction.complete",
            interaction: {
              outputs: [
                { type: "text", text: "Checking" },
                {
                  type: "function_call",
                  call_id: "gemini-call",
                  name: "tempo_test",
                  arguments: { day: "today" },
                },
              ],
            },
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GeminiProvider();
    await expect(
      provider.discoverModels({
        apiKey: "test",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "gemini-test", providerId: "gemini" }),
    ]);
    const events = await collect(provider);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "completed",
        result: expect.objectContaining({
          text: "Checking",
          toolCalls: [{
            callId: "gemini-call",
            name: "tempo_test",
            argumentsText: "{\"day\":\"today\"}",
          }],
        }),
      }),
    );
    const request = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(request).toMatchObject({ stream: true, store: false });
    expect(JSON.stringify(request)).not.toContain("test-only-key");

    const completed = events.at(-1);
    if (completed?.type !== "completed") {
      throw new Error("expected a completed Gemini interaction");
    }
    fetchMock.mockResolvedValueOnce(
      sseResponse([{
        event_type: "interaction.complete",
        interaction: { outputs: [{ type: "text", text: "Done" }] },
      }]),
    );
    for await (const event of provider.stream({
      kind: "continue",
      config: {
        provider: "gemini",
        apiKey: "test-only-key",
        model: "gemini-test",
      },
      systemPrompt: "Use tools safely.",
      continuation: completed.result.continuation,
      toolResults: [{ callId: "gemini-call", output: "{\"ok\":true}" }],
      tools: [],
      signal: new AbortController().signal,
    })) {
      void event;
    }
    const continuationRequest = JSON.parse(
      fetchMock.mock.calls[2]?.[1]?.body as string,
    );
    expect(continuationRequest.input.at(-1)).toEqual({
      type: "function_result",
      call_id: "gemini-call",
      name: "tempo_test",
      result: { ok: true },
    });
  });
});
