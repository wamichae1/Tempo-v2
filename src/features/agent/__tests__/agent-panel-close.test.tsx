// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/agent-chat", () => ({
  AgentChat: () => <div data-testid="agent-chat" />,
}));
vi.mock("@/features/agent/webmcp-inspector", () => ({
  WebMcpInspector: ({
    onOpenWebMcpGuide,
  }: {
    onOpenWebMcpGuide?: () => void;
  }) => (
    <button
      type="button"
      data-testid="webmcp-inspector"
      onClick={onOpenWebMcpGuide}
    >
      WebMCP inspector
    </button>
  ),
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

  const render = async (
    onClose?: () => void,
    onOpenWebMcpGuide?: () => void,
  ): Promise<void> => {
    await act(async () => {
      root.render(
        <AgentPanel
          agent={{ supported: false } as AgentToolsState}
          onClose={onClose}
          onOpenWebMcpGuide={onOpenWebMcpGuide}
        />,
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

  it("threads the WebMCP Guide callback to the inspector", async () => {
    const onOpenWebMcpGuide = vi.fn();
    await render(undefined, onOpenWebMcpGuide);

    const inspector = container.querySelector(
      '[data-testid="webmcp-inspector"]',
    ) as HTMLButtonElement;
    await act(async () => inspector.click());

    expect(onOpenWebMcpGuide).toHaveBeenCalledOnce();
  });
});
