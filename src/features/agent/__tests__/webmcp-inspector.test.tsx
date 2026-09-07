// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentToolsState } from "@/features/agent/use-agent-tools";
import { WebMcpInspector } from "@/features/agent/webmcp-inspector";

function createAgent(supported: boolean): AgentToolsState {
  return {
    supported,
    tools: [],
    confirmationsEnabled: true,
    setConfirmationsEnabled: vi.fn(),
  } as unknown as AgentToolsState;
}

describe("WebMcpInspector setup guide", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("opens the existing guide from the unavailable state", async () => {
    const onOpenWebMcpGuide = vi.fn();
    await act(async () => {
      root.render(
        <WebMcpInspector
          agent={createAgent(false)}
          onOpenWebMcpGuide={onOpenWebMcpGuide}
        />,
      );
    });

    expect(container.textContent).toContain("Unavailable");
    const guideButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "WebMCP Guide",
    );
    expect(guideButton).toBeDefined();

    await act(async () => guideButton?.click());
    expect(onOpenWebMcpGuide).toHaveBeenCalledOnce();
  });

  it("does not show the setup guide button when WebMCP is available", async () => {
    await act(async () => {
      root.render(
        <WebMcpInspector
          agent={createAgent(true)}
          onOpenWebMcpGuide={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Available");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "WebMCP Guide",
      ),
    ).toBe(false);
  });
});
