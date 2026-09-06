import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  LoaderCircle,
  Paperclip,
  SendHorizontal,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TempoDialog } from "@/components/ui/tempo-dialog";
import { AgentSettingsDialog } from "@/features/agent/agent-settings-dialog";
import { getAiProviderDefinition } from "@/features/agent/ai/provider-registry";
import { useAiModels } from "@/features/agent/use-ai-models";
import type {
  AgentChatMessage,
  AgentChatState,
  AgentChatToolActivity,
} from "@/features/agent/use-agent-chat";
import type { AiSettingsState } from "@/features/agent/use-ai-settings";
import { cn } from "@/lib/utils";

function ChatMessage({ message }: { message: AgentChatMessage }) {
  const assistant = message.role === "assistant";

  return (
    <article
      className={cn(
        "min-w-0 rounded-md border px-2.5 py-2",
        assistant ? "bg-background" : "bg-secondary/50 ml-5",
        message.status === "error" && "border-destructive/40",
        message.status === "cancelled" && "border-dashed opacity-70",
      )}
      aria-label={`${assistant ? "Tempo Agent" : "You"} message`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        {assistant && <Sparkles className="text-muted-foreground size-3" />}
        <span className="label-mono text-muted-foreground">
          {assistant ? "Tempo Agent" : "You"}
        </span>
        {message.status === "streaming" && (
          <LoaderCircle
            className="text-muted-foreground ml-auto size-3 animate-spin"
            aria-label="Response streaming"
          />
        )}
        {message.status === "error" && (
          <span className="text-destructive ml-auto font-mono text-[9px] uppercase">
            Error
          </span>
        )}
        {message.status === "cancelled" && (
          <span className="text-muted-foreground ml-auto font-mono text-[9px] uppercase">
            Cancelled
          </span>
        )}
      </div>
      <p className="text-foreground break-words whitespace-pre-wrap text-xs leading-relaxed">
        {message.text ||
          (message.status === "streaming" ? "Thinking..." : "No response.")}
      </p>
    </article>
  );
}

function ToolActivity({ activity }: { activity: AgentChatToolActivity }) {
  const pending =
    activity.status === "requested" || activity.status === "running";
  return (
    <article
      className={cn(
        "bg-secondary/30 mx-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5",
        activity.status === "failed" && "border-destructive/30",
      )}
      aria-label={`Tool ${activity.toolName} ${activity.status}`}
      title={JSON.stringify(activity.arguments)}
    >
      {pending ? (
        <LoaderCircle className="text-muted-foreground size-3 animate-spin" />
      ) : activity.status === "succeeded" ? (
        <CheckCircle2 className="size-3 text-event-green-border" />
      ) : activity.status === "failed" ? (
        <XCircle className="text-destructive size-3" />
      ) : (
        <Wrench className="text-muted-foreground size-3" />
      )}
      <span className="min-w-0 truncate font-mono text-[10px]">
        {activity.toolName}
      </span>
      <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[9px] uppercase">
        {activity.status}
      </span>
    </article>
  );
}

export function AgentChat({
  chat,
  settings,
  confirmationsEnabled,
  onConfirmationsEnabledChange,
}: {
  chat: AgentChatState;
  settings: AiSettingsState;
  confirmationsEnabled: boolean;
  onConfirmationsEnabledChange: (enabled: boolean) => void;
}) {
  const [clearOpen, setClearOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentKeyState = settings.getKeyState(settings.provider);
  const catalog = useAiModels({
    provider: settings.provider,
    apiKey: settings.apiKey,
    keyRevision: currentKeyState.revision,
    enabled: true,
  });

  const composerLabel = useMemo(() => {
    let providerName: string = settings.provider;
    try {
      providerName = getAiProviderDefinition(
        settings.provider,
      ).metadata.displayName;
    } catch {
      // Fall back to the raw provider id.
    }
    const modelId = settings.model.trim();
    if (!modelId) return providerName;
    const modelName =
      catalog.models.find((model) => model.id === modelId)?.displayName ??
      modelId;
    return `${providerName} · ${modelName}`;
  }, [catalog.models, settings.model, settings.provider]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [chat.entries, chat.runtimeStatus]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [chat.draft]);

  const submit = () => {
    if (!chat.configured) {
      setSettingsOpen(true);
      return;
    }
    chat.submitDraft();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center border-b px-3">
        <span className="label-mono text-muted-foreground">
          {chat.entries.length > 0 ? "Conversation" : "Chat"}
        </span>
        {!chat.configured && (
          <span className="text-muted-foreground ml-2 text-[10px]">
            Not configured
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground ml-auto size-6"
          onClick={() => setSettingsOpen(true)}
          aria-label="Tempo Agent settings"
          title="Tempo Agent settings"
        >
          <Settings className="size-3" />
        </Button>
        {chat.entries.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-6 px-1.5 text-[10px]"
            onClick={() => setClearOpen(true)}
          >
            <Trash2 className="size-3" />
            Clear
          </Button>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {chat.entries.length === 0 ? (
          <div className="flex h-full min-h-52 flex-col items-center justify-center px-3 text-center">
            <div className="bg-secondary mb-3 flex size-8 items-center justify-center rounded-md border">
              <Bot className="text-muted-foreground size-4" />
            </div>
            <h2 className="text-xs font-semibold">Chat with Tempo</h2>
            <p className="text-muted-foreground mt-1 max-w-60 text-[11px] leading-relaxed">
              Ask Tempo to inspect, create, move, or update events using your
              own AI provider key.
            </p>
            {!chat.configured && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setSettingsOpen(true)}
              >
                Configure AI
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {chat.entries.map((entry) => {
              if (entry.kind === "message") {
                return <ChatMessage key={entry.id} message={entry} />;
              }
              if (entry.kind === "tool") {
                return <ToolActivity key={entry.id} activity={entry} />;
              }
              return (
                <article
                  key={entry.id}
                  className="border-destructive/30 bg-destructive/5 rounded-md border px-2.5 py-2"
                  role="alert"
                >
                  <div className="text-destructive flex items-center gap-1.5 text-[10px] font-medium">
                    <AlertCircle className="size-3" />
                    Tempo Agent error
                  </div>
                  <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
                    {entry.message}
                  </p>
                  {entry.retryable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-6 px-1.5 text-[10px]"
                      onClick={chat.retryLast}
                    >
                      Copy last request to composer
                    </Button>
                  )}
                </article>
              );
            })}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-2.5">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            setAttachment(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        {attachment && (
          <div
            className="bg-secondary/40 mb-1.5 flex items-center gap-1.5 rounded-md border px-2 py-1"
            aria-label={`Selected file ${attachment.name}`}
          >
            <Paperclip className="text-muted-foreground size-3 shrink-0" />
            <span className="min-w-0 truncate text-[10px]">
              {attachment.name}
            </span>
            <span className="text-muted-foreground shrink-0 text-[9px]">
              (not sent yet)
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground ml-auto size-4"
              onClick={() => setAttachment(null)}
              aria-label={`Remove ${attachment.name}`}
            >
              <X className="size-2.5" />
            </Button>
          </div>
        )}
        <div className="focus-within:border-ring focus-within:ring-ring/30 flex items-end gap-1.5 rounded-md border bg-background p-1.5 focus-within:ring-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground size-7 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a file"
            title="Attach a file (not sent to the model yet)"
          >
            <Paperclip className="size-3.5" />
          </Button>
          <textarea
            ref={textareaRef}
            value={chat.draft}
            onChange={(event) => chat.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            disabled={chat.isRunning}
            rows={1}
            placeholder="Ask Tempo about your calendar..."
            aria-label="Message Tempo Agent"
            className="placeholder:text-muted-foreground max-h-28 min-h-7 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1.5 py-1 text-xs leading-5 outline-none disabled:opacity-60"
          />
          {chat.isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="size-7"
              onClick={chat.cancelRun}
              disabled={chat.runtimeStatus === "cancelling"}
              aria-label="Stop response"
              title="Stop response"
            >
              {chat.runtimeStatus === "cancelling" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3" />
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              className="size-7"
              disabled={!chat.draft.trim()}
              onClick={submit}
              aria-label="Send message"
              title={chat.configured ? "Send message" : "Configure and send"}
            >
              <SendHorizontal className="size-3.5" />
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-1.5 px-1 font-mono text-[9px]">
          {chat.isRunning
            ? "Tempo is working - stop to cancel"
            : `${composerLabel} - Enter to send - Shift+Enter for a new line`}
        </p>
      </div>

      <AgentSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        confirmationsEnabled={confirmationsEnabled}
        onConfirmationsEnabledChange={onConfirmationsEnabledChange}
        runtimeBusy={chat.isRunning}
      />

      <TempoDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear conversation?"
        description="This removes the locally saved Tempo Chat transcript."
      >
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              chat.clearConversation();
              setClearOpen(false);
            }}
          >
            Clear conversation
          </Button>
        </div>
      </TempoDialog>
    </div>
  );
}
