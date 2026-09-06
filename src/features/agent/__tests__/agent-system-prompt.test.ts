import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt } from "@/features/agent/agent-system-prompt";

describe("agent system prompt", () => {
  it("includes local time context and tool safety instructions", () => {
    const prompt = buildAgentSystemPrompt({
      now: new Date("2026-09-05T16:00:00.000Z"),
      locale: "en-CA",
      timeZone: "America/Toronto",
    });
    expect(prompt).toContain("America/Toronto");
    expect(prompt).toContain("2026");
    expect(prompt).toContain("provided Tempo tools");
    expect(prompt).toContain("untrusted user data");
    expect(prompt).toContain("confirmation");
    expect(prompt).not.toContain('"events":');
  });
});
