// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validationMocks = vi.hoisted(() => ({
  validateAndPersistApiKey: vi.fn(),
}));

vi.mock("@/features/agent/ai/api-key-validation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/agent/ai/api-key-validation")
  >()),
  validateAndPersistApiKey: validationMocks.validateAndPersistApiKey,
}));

import type { ApiKeySaveResult } from "@/features/agent/ai/api-key-validation";
import {
  useAiSettings,
  type AiSettingsState,
} from "@/features/agent/use-ai-settings";

describe("useAiSettings candidate validation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: AiSettingsState;

  function Harness() {
    current = useAiSettings();
    return null;
  }

  beforeEach(async () => {
    localStorage.clear();
    validationMocks.validateAndPersistApiKey.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("keeps a verified key intact when a replacement candidate is rejected", async () => {
    validationMocks.validateAndPersistApiKey.mockResolvedValueOnce({
      ok: true,
      state: {
        value: "existing-key",
        persisted: true,
        revision: 1,
        status: "verified",
        error: "",
      },
    } satisfies ApiKeySaveResult);

    await act(async () => {
      await current.saveApiKey("openai", "existing-key", true);
    });
    const verified = current.getKeyState("openai");
    expect(verified).toMatchObject({
      value: "existing-key",
      persisted: true,
      revision: 1,
      status: "verified",
      error: "",
    });

    validationMocks.validateAndPersistApiKey.mockResolvedValueOnce({
      ok: false,
      status: "invalid",
      message: "Invalid API key. The provider rejected this key.",
    } satisfies ApiKeySaveResult);
    await act(async () => {
      await current.saveApiKey("openai", "rejected-replacement", false);
    });

    expect(current.getKeyState("openai")).toEqual(verified);
  });

  it("leaves an unconfigured provider state clean after a rejected candidate", async () => {
    const initial = current.getKeyState("gemini");
    validationMocks.validateAndPersistApiKey.mockResolvedValueOnce({
      ok: false,
      status: "invalid",
      message: "Invalid API key. The provider rejected this key.",
    } satisfies ApiKeySaveResult);

    await act(async () => {
      await current.saveApiKey("gemini", "rejected-candidate", false);
    });

    expect(current.getKeyState("gemini")).toEqual(initial);
  });

  it("keeps Groq key state separate from other providers", async () => {
    validationMocks.validateAndPersistApiKey.mockResolvedValueOnce({
      ok: true,
      state: {
        value: "gsk-session-key",
        persisted: false,
        revision: 1,
        status: "verified",
        error: "",
      },
    } satisfies ApiKeySaveResult);

    await act(async () => {
      await current.saveApiKey("groq", "gsk-session-key", false);
    });

    expect(current.getKeyState("groq")).toMatchObject({
      value: "gsk-session-key",
      persisted: false,
      status: "verified",
    });
    expect(current.getKeyState("openai").value).toBe("");
    expect(current.models.groq).toBe("openai/gpt-oss-20b");
  });
});
