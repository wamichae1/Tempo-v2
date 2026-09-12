// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const catalogModels = vi.hoisted(() => ({
  models: [] as { id: string; providerId: string; displayName: string }[],
}));

vi.mock("@/features/agent/use-ai-models", () => ({
  useAiModels: () => ({
    models: catalogModels.models,
    status: "loaded",
    error: "",
    refresh: vi.fn(),
  }),
}));

import { AgentChat } from "@/features/agent/agent-chat";
import { EMPTY_API_KEY_STATES } from "@/features/agent/ai/api-key-store";
import type { AgentChatState } from "@/features/agent/use-agent-chat";
import type { AiSettingsState } from "@/features/agent/use-ai-settings";

function createChat(overrides: Partial<AgentChatState> = {}): AgentChatState {
  return {
    entries: [],
    draft: "",
    setDraft: vi.fn(),
    submitDraft: vi.fn(() => true),
    cancelRun: vi.fn(),
    retryLast: vi.fn(),
    clearConversation: vi.fn(),
    runtimeStatus: "idle",
    configured: true,
    isRunning: false,
    ...overrides,
  };
}

function createSettings(
  overrides: Partial<AiSettingsState> = {},
): AiSettingsState {
  const keyStates = structuredClone(EMPTY_API_KEY_STATES);
  keyStates.gemini.value = "gemini-key";
  keyStates.gemini.persisted = true;
  return {
    provider: "gemini",
    setProvider: vi.fn(),
    model: "gemini-3.7-flash",
    setModel: vi.fn(),
    models: {
      openai: "gpt-test",
      openrouter: "openrouter-test",
      groq: "openai/gpt-oss-20b",
      opencode: "gpt-5.4-mini",
      gemini: "gemini-3.7-flash",
    },
    apiKey: "gemini-key",
    setApiKey: vi.fn(),
    rememberApiKey: true,
    setRememberApiKey: vi.fn(),
    keyStates,
    getKeyState: (provider) => keyStates[provider],
    saveApiKey: vi.fn(),
    clearApiKey: vi.fn(),
    clearAllApiKeys: vi.fn(),
    configured: true,
    configuredKeys: ["gemini-key"],
    ...overrides,
  } as AiSettingsState;
}

describe("AgentChat composer", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (
    chat: AgentChatState,
    settings: AiSettingsState,
  ): Promise<void> => {
    await act(async () => {
      root.render(
        <AgentChat
          chat={chat}
          settings={settings}
          confirmationsEnabled
          onConfirmationsEnabledChange={vi.fn()}
        />,
      );
    });
  };

  beforeEach(() => {
    catalogModels.models = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("auto-grows the textarea as the draft gets longer", async () => {
    const setDraft = vi.fn();
    await render(createChat({ setDraft }), createSettings());

    const textarea = document.querySelector("textarea");
    expect(textarea).not.toBeNull();
    Object.defineProperty(textarea!, "scrollHeight", {
      configurable: true,
      get: () =>
        (textarea as HTMLTextAreaElement).value.length > 20 ? 96 : 28,
    });

    await act(async () => {
      root.render(
        <AgentChat
          chat={createChat({ draft: "short", setDraft })}
          settings={createSettings()}
          confirmationsEnabled
          onConfirmationsEnabledChange={vi.fn()}
        />,
      );
    });
    expect(textarea!.style.height).toBe("28px");

    await act(async () => {
      root.render(
        <AgentChat
          chat={createChat({
            draft: "a much longer draft that wraps across lines",
            setDraft,
          })}
          settings={createSettings()}
          confirmationsEnabled
          onConfirmationsEnabledChange={vi.fn()}
        />,
      );
    });
    expect(textarea!.style.height).toBe("96px");
  });

  it("shows the selected file as a removable chip without sending it", async () => {
    const chat = createChat();
    await render(chat, createSettings());

    const attachButton = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Attach a file",
    );
    expect(attachButton).toBeDefined();

    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("notes.txt");
    expect(container.textContent).toContain("not sent yet");
    expect(chat.submitDraft).not.toHaveBeenCalled();

    const remove = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Remove notes.txt",
    );
    await act(async () => {
      remove!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("notes.txt");
  });

  it("shows the current provider and model below the input", async () => {
    catalogModels.models = [
      {
        id: "gemini-3.7-flash",
        providerId: "gemini",
        displayName: "Gemini 3.7 Flash",
      },
    ];
    await render(createChat(), createSettings());
    expect(container.textContent).toContain(
      "Google Gemini · Gemini 3.7 Flash",
    );
    expect(container.textContent).not.toContain("Enter to send");
    expect(container.textContent).not.toContain("Shift+Enter");
  });

  it("falls back to the raw model id when the catalog has no match", async () => {
    await render(createChat(), createSettings());
    expect(container.textContent).toContain(
      "Google Gemini · gemini-3.7-flash",
    );
  });

  it("updates the indicator when the provider or model changes", async () => {
    await render(createChat(), createSettings());
    expect(container.textContent).toContain("Google Gemini");

    await render(
      createChat(),
      createSettings({ provider: "openai", model: "gpt-5.2" }),
    );
    expect(container.textContent).toContain("OpenAI · gpt-5.2");
  });
});
