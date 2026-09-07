import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TempoDialog } from "@/components/ui/tempo-dialog";
import { isWebMcpSupported } from "@/features/agent/webmcp";
import { cn } from "@/lib/utils";

export const WEBMCP_FLAG_URL = "chrome://flags/#enable-webmcp-testing";

export interface WebMcpGuideProps {
  open: boolean;
  onClose: () => void;
  /** Opens the existing Agent settings dialog (BYOK configuration). */
  onOpenAiSettings: () => void;
}

function StepHeading({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="text-foreground flex items-center gap-2 text-xs font-semibold">
      <span className="bg-secondary text-muted-foreground flex size-4.5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]">
        {n}
      </span>
      {children}
    </h3>
  );
}

/**
 * Short manual guide for connecting Tempo to WebMCP-capable AI agents.
 * Instructional only — reuses the existing `isWebMcpSupported` detection
 * and the existing Agent settings dialog for BYOK configuration.
 */
export function WebMcpGuide({
  open,
  onClose,
  onOpenAiSettings,
}: WebMcpGuideProps) {
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);
  const [webMcpAvailable] = useState(() => isWebMcpSupported());

  useEffect(
    () => () => {
      if (copyResetRef.current !== null)
        window.clearTimeout(copyResetRef.current);
    },
    [],
  );

  const copyFlagUrl = async () => {
    try {
      await navigator.clipboard.writeText(WEBMCP_FLAG_URL);
    } catch {
      // Clipboard unavailable (permissions, insecure context) — the URL is
      // still visible in the field for manual selection.
    }
    setCopied(true);
    if (copyResetRef.current !== null)
      window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <TempoDialog
      open={open}
      onClose={onClose}
      title="Set up WebMCP"
      description="Connect Tempo to compatible AI agents."
      widthClass="w-[400px]"
    >
      <div className="mt-4 flex flex-col gap-5">
        <section>
          <StepHeading n={1}>Enable WebMCP in Chrome</StepHeading>
          <div className="mt-2 flex items-center gap-1.5">
            <code
              className="bg-secondary/60 min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 font-mono text-[11px]"
              aria-label="WebMCP flag URL"
            >
              {WEBMCP_FLAG_URL}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={copyFlagUrl}
              aria-live="polite"
            >
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
            Open that address, set WebMCP for testing to Enabled, then relaunch
            Chrome.
          </p>
          {webMcpAvailable && (
            <p className="mt-1.5 font-mono text-[10px] text-event-green-border uppercase">
              WebMCP detected in this browser
            </p>
          )}
        </section>

        <section>
          <StepHeading n={2}>Use your own AI provider</StepHeading>
          <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
            Tempo's AI features use your own AI provider and API key (BYOK).
            Keys are used directly from your browser and are never sent to a
            Tempo server. Open Settings → API Keys to configure a supported
            provider.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              onClose();
              onOpenAiSettings();
            }}
          >
            Open AI Settings
          </Button>
        </section>

        <section>
          <StepHeading n={3}>Use an AI browser or agent</StepHeading>
          <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
            In an AI environment with WebMCP support — such as Codex with its
            in-app browser — just open Tempo there. WebMCP is automatically
            available to the agent; there is no separate connection step. You
            can simply open Tempo and chat with the agent.
          </p>
          <ul
            className={cn(
              "mt-2 flex flex-col gap-1 font-mono text-[11px]",
            )}
          >
            {[
              "What events do I have tomorrow?",
              "Create a study session tomorrow at 4 PM.",
              "Move my 3 PM meeting to 4 PM.",
            ].map((example) => (
              <li
                key={example}
                className="bg-secondary/60 rounded-md border px-2 py-1.5"
              >
                {example}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </TempoDialog>
  );
}
