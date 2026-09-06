import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  models: vi.fn(),
  responses: vi.fn(),
  apiError: null as (Error & { status?: number; code?: string }) | null,
}));

vi.mock("openai", () => {
  class APIUserAbortError extends Error {}
  class APIConnectionError extends Error {}
  class APIError extends Error {
    status?: number;
    code?: string;
  }
  openAiMocks.apiError = new APIError();
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
import { runAgentTurn } from "@/features/agent/agent-runtime";
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
        Response.json({ data: { label: "Tempo test key" } }),
      )
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
    expect(fetchMock.mock.calls[2]?.[1]?.body).not.toContain("test-only-key");
  });

  it("discovers and streams OpenCode Zen models", async () => {
    const fetchMock = vi
      .fn()
        .mockResolvedValueOnce(
          new Response(null, { status: 400 }),
        )
        .mockResolvedValueOnce(
          Response.json({
            data: [{ id: "gpt-test", owned_by: "opencode" }],
          }),
        )
        .mockResolvedValueOnce(
          sseResponse([{ choices: [{ delta: { content: "Zen" } }] }]),
        );
    vi.stubGlobal("fetch", fetchMock);
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://opencode.ai/zen/v1/responses",
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      model: "gpt-5.4-mini",
    });
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
          {
            event_type: "interaction.start",
          },
          {
            event_type: "step.start",
            index: 0,
            step: {
              type: "model_output",
              content: [{ type: "text", text: "Check" }],
            },
          },
          {
            event_type: "step.delta",
            index: 0,
            delta: { type: "text", text: "ing" },
          },
          {
            event_type: "step.stop",
            index: 0,
          },
          {
            event_type: "step.start",
            index: 1,
            step: {
              type: "function_call",
              id: "gemini-call",
              name: "tempo_test",
              arguments: {},
              thought_signature: "signature-to-preserve",
            },
          },
          {
            event_type: "step.delta",
            index: 1,
            delta: {
              type: "arguments_delta",
              arguments: "{\"day\":\"today\"}",
            },
          },
          {
            event_type: "step.stop",
            index: 1,
          },
          { event_type: "interaction.completed" },
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
    expect(events).toContainEqual({ type: "text-delta", text: "Check" });
    expect(events).toContainEqual({ type: "text-delta", text: "ing" });
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    expect(request).toEqual({
      model: "gemini-3.7-flash",
      system_instruction: "Use tools safely.",
      input: [{
        type: "user_input",
        content: [{ type: "text", text: "Hello" }],
      }],
      tools: [{
        type: "function",
        name: "tempo_test",
        description: "Test tool",
        parameters: { type: "object", properties: {} },
      }],
      stream: true,
      store: false,
    });
    expect(JSON.stringify(request)).not.toContain("test-only-key");

    const completed = events.at(-1);
    if (completed?.type !== "completed") {
      throw new Error("expected a completed Gemini interaction");
    }
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          event_type: "step.start",
          index: 0,
          step: {
            type: "model_output",
            content: [{ type: "text", text: "Done" }],
          },
        },
        {
          event_type: "step.stop",
          index: 0,
          step: {
            type: "model_output",
            content: [{ type: "text", text: "Done" }],
          },
        },
        { event_type: "interaction.completed" },
      ]),
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
    expect(continuationRequest.input).toContainEqual({
      type: "function_call",
      id: "gemini-call",
      name: "tempo_test",
      arguments: { day: "today" },
      thought_signature: "signature-to-preserve",
    });
  });

  it("runs a Gemini agent tool call through its function-result continuation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          {
            event_type: "step.start",
            index: 0,
            step: {
              type: "function_call",
              id: "agent-call",
              name: "tempo_test",
              arguments: {},
              thought_signature: "agent-signature",
            },
          },
          {
            event_type: "step.delta",
            index: 0,
            delta: {
              type: "arguments_delta",
              arguments: "{\"day\":\"today\"}",
            },
          },
          { event_type: "step.stop", index: 0 },
          { event_type: "interaction.completed" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          {
            event_type: "step.start",
            index: 0,
            step: {
              type: "model_output",
              content: [{ type: "text", text: "Calendar checked." }],
            },
          },
          { event_type: "step.stop", index: 0 },
          { event_type: "interaction.completed" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const execute = vi.fn().mockResolvedValue({ ok: true, events: [] });

    await expect(
      runAgentTurn({
        provider: new GeminiProvider(),
        config: {
          provider: "gemini",
          apiKey: "test-only-key",
          model: "gemini-3.7-flash",
        },
        systemPrompt: "Use tools safely.",
        conversation: [{ role: "user", text: "Check today." }],
        tools: [{
          name: "tempo_test",
          description: "Test tool",
          inputSchema: { type: "object", properties: {} },
          execute,
        }],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      finalText: "Calendar checked.",
      rounds: 2,
      toolCalls: 1,
    });
    expect(execute).toHaveBeenCalledWith(
      { day: "today" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const continuationRequest = JSON.parse(
      fetchMock.mock.calls[1]?.[1]?.body as string,
    );
    expect(continuationRequest.input).toContainEqual({
      type: "function_result",
      call_id: "agent-call",
      name: "tempo_test",
      result: { ok: true, events: [] },
    });
  });

  it.each([
    [400, "provider", false],
    [404, "unsupported-model", false],
    [429, "rate-limit", true],
    [503, "provider", true],
  ] as const)(
    "classifies Gemini HTTP %s responses",
    async (status, code, retryable) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(new Response(null, { status })),
      );
      await expect(collect(new GeminiProvider())).rejects.toMatchObject({
        code,
        retryable,
      });
    },
  );

  it("classifies an OpenCode auth-probe fetch failure as network unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("CORS")));
    await expect(
      new OpenCodeProvider().discoverModels({
        apiKey: "test",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "network",
      retryable: true,
      message: expect.not.stringContaining("CORS"),
    });
  });

  it("classifies Gemini stream errors without exposing upstream details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        sseResponse([{
          event_type: "error",
          error: {
            code: "RESOURCE_EXHAUSTED",
            message: "secret upstream detail",
          },
        }]),
      ),
    );
    await expect(collect(new GeminiProvider())).rejects.toMatchObject({
      code: "rate-limit",
      retryable: true,
      message: expect.not.stringContaining("secret upstream detail"),
    });
  });

  it.each([
    [400, true],
    [422, true],
    [401, false],
    [403, false],
    [409, false],
    [429, false],
    [500, false],
  ] as const)(
    "handles OpenCode auth probe status %s without accepting arbitrary 4xx",
    async (status, accepted) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status }));
      if (accepted) {
        fetchMock.mockResolvedValueOnce(Response.json({ data: [] }));
      }
      vi.stubGlobal("fetch", fetchMock);
      const result = new OpenCodeProvider().discoverModels({
        apiKey: "test",
        signal: new AbortController().signal,
      });
      if (accepted) {
        await expect(result).resolves.toEqual([]);
      } else {
        await expect(result).rejects.toMatchObject({
          code:
            status === 401 || status === 403
              ? "authentication"
              : status === 429
                ? "rate-limit"
                : "provider",
        });
      }
    },
  );

  it.each([401, 403])(
    "rejects OpenAI model discovery authentication failures (%s)",
    async (status) => {
      const error = openAiMocks.apiError;
      if (!error) throw new Error("OpenAI API error mock was not initialized");
      error.status = status;
      openAiMocks.models.mockRejectedValueOnce(error);
      await expect(
        new OpenAiProvider().discoverModels({
          apiKey: "arbitrary-non-empty-text",
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        code: "authentication",
        message: expect.not.stringContaining("arbitrary-non-empty-text"),
      });
    },
  );

  it.each([
    ["openrouter", () => new OpenRouterProvider()],
    ["opencode", () => new OpenCodeProvider()],
    ["gemini", () => new GeminiProvider()],
  ] as const)(
    "rejects %s discovery when the provider returns 401 or 403",
    async (_name, createProvider) => {
      const provider = createProvider();
      for (const status of [401, 403]) {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValueOnce(new Response(null, { status })),
        );
        await expect(
          provider.discoverModels({
            apiKey: "arbitrary-non-empty-text",
            signal: new AbortController().signal,
          }),
        ).rejects.toMatchObject({
          code: "authentication",
          message: expect.not.stringContaining("arbitrary-non-empty-text"),
        });
      }
    },
  );
});
