// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/use-ai-models", () => ({
  useAiModels: () => ({
    models: [],
    status: "loaded",
    error: "",
    refresh: vi.fn(),
  }),
}));

import { AgentSettingsDialog } from "@/features/agent/agent-settings-dialog";
import {
  EMPTY_API_KEY_STATES,
  type ApiKeyStates,
} from "@/features/agent/ai/api-key-store";
import type { ApiKeySaveResult } from "@/features/agent/ai/api-key-validation";
import type { AiSettingsState } from "@/features/agent/use-ai-settings";

function findButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button "${label}".`);
  }
  return button;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    findButton(label).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
}

async function enterKey(value: string): Promise<void> {
  const input = document.querySelector(
    'input[aria-label="OpenAI API key"]',
  );
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Could not find the OpenAI key input.");
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function createSettings(
  keyStates: ApiKeyStates,
  saveApiKey: AiSettingsState["saveApiKey"],
): AiSettingsState {
  return {
    provider: "openai",
    setProvider: vi.fn(),
    model: "gpt-test",
    setModel: vi.fn(),
    models: {
      openai: "gpt-test",
      openrouter: "openrouter-test",
      groq: "openai/gpt-oss-20b",
      opencode: "gpt-5.4-mini",
      gemini: "gemini-3.7-flash",
    },
    apiKey: keyStates.openai.value,
    rememberApiKey: keyStates.openai.persisted,
    keyStates,
    getKeyState: (provider) => keyStates[provider],
    saveApiKey,
    retryApiKeyValidation: vi.fn(),
    clearApiKey: vi.fn(),
    clearAllApiKeys: vi.fn(),
    configured: keyStates.openai.status === "verified",
    configuredKeys: Object.values(keyStates)
      .map((state) => state.value)
      .filter(Boolean),
  };
}

describe("AgentSettingsDialog API-key validation lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("clears a failed replacement error on navigation and close without changing the verified key", async () => {
    const keys = structuredClone(EMPTY_API_KEY_STATES);
    keys.openai = {
      value: "existing-verified-key",
      persisted: true,
      revision: 4,
      status: "verified",
      error: "",
    };
    const saveApiKey = vi.fn<AiSettingsState["saveApiKey"]>().mockResolvedValue({
      ok: false,
      status: "invalid",
      message: "Invalid API key. The provider rejected this key.",
    });
    const settings = createSettings(keys, saveApiKey);
    let open = true;
    const render = () => {
      root.render(
        <AgentSettingsDialog
          open={open}
          onClose={() => {
            open = false;
            render();
          }}
          settings={settings}
          confirmationsEnabled
          onConfirmationsEnabledChange={vi.fn()}
        />,
      );
    };

    await act(async () => render());
    await click("API Keys");
    await click("Change key");
    await enterKey("rejected-replacement");
    await click("Save key");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid API key",
    );

    await click("General");
    await click("API Keys");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("Verified");

    await click("Change key");
    await enterKey("rejected-again");
    await click("Save key");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await click("Done");
    expect(document.querySelector('[aria-label="Tempo Agent settings"]')).toBeNull();

    open = true;
    await act(async () => render());
    await click("API Keys");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("Verified");
    expect(keys.openai).toEqual({
      value: "existing-verified-key",
      persisted: true,
      revision: 4,
      status: "verified",
      error: "",
    });
    expect(settings.clearApiKey).not.toHaveBeenCalled();
  });

  it("does not resurrect a late validation failure after the dialog closes", async () => {
    let resolveSave: ((result: ApiKeySaveResult) => void) | undefined;
    const saveApiKey = vi.fn<AiSettingsState["saveApiKey"]>().mockImplementation(
      () =>
        new Promise<ApiKeySaveResult>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const keys = structuredClone(EMPTY_API_KEY_STATES);
    const settings = createSettings(keys, saveApiKey);
    let open = true;
    const render = () => {
      root.render(
        <AgentSettingsDialog
          open={open}
          onClose={() => {
            open = false;
            render();
          }}
          settings={settings}
          confirmationsEnabled
          onConfirmationsEnabledChange={vi.fn()}
        />,
      );
    };

    await act(async () => render());
    await click("API Keys");
    await click("Add key");
    await enterKey("candidate");
    await click("Save key");
    await click("Done");
    await act(async () => {
      resolveSave?.({
        ok: false,
        status: "invalid",
        message: "Invalid API key. The provider rejected this key.",
      });
      await Promise.resolve();
    });

    open = true;
    await act(async () => render());
    await click("API Keys");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("Not configured");
  });

  it("keeps the browser-direct security disclosure on the API Keys page", async () => {
    const settings = createSettings(
      structuredClone(EMPTY_API_KEY_STATES),
      vi.fn<AiSettingsState["saveApiKey"]>(),
    );
    await act(async () => {
      root.render(
        <AgentSettingsDialog
          open
          onClose={vi.fn()}
          settings={settings}
          confirmationsEnabled
          onConfirmationsEnabledChange={vi.fn()}
        />,
      );
    });
    await click("API Keys");
    expect(document.body.textContent).toContain(
      "Tempo has no backend and never receives your keys.",
    );
  });

  it("shows Groq as an enabled provider with its own API-key row", async () => {
    const settings = createSettings(
      structuredClone(EMPTY_API_KEY_STATES),
      vi.fn<AiSettingsState["saveApiKey"]>(),
    );
    await act(async () => {
      root.render(
        <AgentSettingsDialog
          open
          onClose={vi.fn()}
          settings={settings}
          confirmationsEnabled
          onConfirmationsEnabledChange={vi.fn()}
        />,
      );
    });

    const option = document.querySelector(
      'option[value="groq"]',
    ) as HTMLOptionElement | null;
    expect(option?.disabled).toBe(false);
    expect(option?.textContent).toContain("Groq");

    await click("API Keys");
    const row = document.querySelector('[data-provider-id="groq"]');
    expect(row?.textContent).toContain("Groq");
    expect(row?.textContent).toContain("Not configured");
  });
});
