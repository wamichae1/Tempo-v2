// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/agent-chat", () => ({
  AgentChat: () => <div data-testid="agent-chat" />,
}));
vi.mock("@/features/agent/webmcp-inspector", () => ({
  WebMcpInspector: () => <div data-testid="webmcp-inspector" />,
}));
vi.mock("@/features/agent/use-agent-chat", () => ({
  useAgentChat: () => ({}),
}));
vi.mock("@/features/agent/use-ai-settings", () => ({
  useAiSettings: () => ({}),
}));

import { AgentPanel } from "@/features/agent/agent-panel";
import type { AgentToolsState } from "@/features/agent/use-agent-tools";

describe("AgentPanel close button", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (onClose?: () => void): Promise<void> => {
    await act(async () => {
      root.render(
        <AgentPanel agent={{ supported: false } as AgentToolsState} onClose={onClose} />,
      );
    });
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("renders an accessible close button in the header row", async () => {
    await render(vi.fn());
    const close = container.querySelector(
      'button[aria-label="Close Tempo Agent"]',
    ) as HTMLButtonElement | null;
    expect(close).not.toBeNull();
    expect(close?.title).toBe("Close Tempo Agent");
    // Same header row as the "Tempo Agent" label.
    expect(close?.parentElement?.textContent).toContain("Tempo Agent");
  });

  it("invokes onClose when clicked", async () => {
    const onClose = vi.fn();
    await render(onClose);
    const close = container.querySelector(
      'button[aria-label="Close Tempo Agent"]',
    ) as HTMLButtonElement;
    await act(async () => {
      close.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
