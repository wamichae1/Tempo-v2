import { useState } from "react";
import { AlertTriangle, Eye, EyeOff, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TempoDialog } from "@/components/ui/tempo-dialog";
import { AiModelSelector } from "@/features/agent/ai-model-selector";
import type {
  RunnableAiProviderId,
} from "@/features/agent/ai/ai-provider";
import {
  listAiProviderDefinitions,
  listRunnableAiProviders,
} from "@/features/agent/ai/provider-registry";
import { maskApiKey } from "@/features/agent/ai/api-key-store";
import { useAiModels } from "@/features/agent/use-ai-models";
import type { AiSettingsState } from "@/features/agent/use-ai-settings";
import { cn } from "@/lib/utils";

type SettingsPage = "general" | "api-keys";

export function AgentSettingsDialog({
  open,
  onClose,
  settings,
  confirmationsEnabled,
  onConfirmationsEnabledChange,
  runtimeBusy = false,
}: {
  open: boolean;
  onClose: () => void;
  settings: AiSettingsState;
  confirmationsEnabled: boolean;
  onConfirmationsEnabledChange: (enabled: boolean) => void;
  runtimeBusy?: boolean;
}) {
  const [page, setPage] = useState<SettingsPage>("general");
  const [revealed, setRevealed] = useState<Set<RunnableAiProviderId>>(
    () => new Set(),
  );
  const [editing, setEditing] = useState<RunnableAiProviderId | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [rememberDraft, setRememberDraft] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const currentKeyState = settings.getKeyState(settings.provider);
  const catalog = useAiModels({
    provider: settings.provider,
    apiKey: currentKeyState.value,
    keyRevision: currentKeyState.revision,
    enabled: open && page === "general",
  });

  const close = () => {
    setPage("general");
    setEditing(null);
    setKeyDraft("");
    setShowDraft(false);
    setRevealed(new Set());
    onClose();
  };

  const startEditing = (provider: RunnableAiProviderId) => {
    setEditing(provider);
    setKeyDraft("");
    setRememberDraft(settings.getKeyState(provider).persisted);
    setShowDraft(false);
  };

  const hasAnyKey = Object.values(settings.keyStates).some(
    (state) => state.value.trim().length > 0,
  );

  return (
    <>
      <TempoDialog
        open={open}
        onClose={close}
        title="Tempo Agent settings"
        description="Choose an AI provider and manage browser-direct API keys."
        widthClass="w-[min(620px,calc(100vw-2rem))]"
      >
        <div className="mt-4 flex min-h-96 gap-4 max-sm:flex-col">
          <div
            role="tablist"
            aria-label="Agent settings pages"
            className="flex w-32 shrink-0 flex-col gap-1 max-sm:w-full max-sm:flex-row"
          >
            {([
              ["general", "General"],
              ["api-keys", "API Keys"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={page === id}
                onClick={() => setPage(id)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-left text-xs font-medium",
                  page === id
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            {page === "general" ? (
              <div
                role="tabpanel"
                className="flex flex-col gap-4"
                aria-label="General settings"
              >
                <label className="flex flex-col gap-1">
                  <span className="label-mono text-muted-foreground">
                    Provider
                  </span>
                  <select
                    value={settings.provider}
                    disabled={runtimeBusy}
                    onChange={(event) =>
                      settings.setProvider(
                        event.target.value as RunnableAiProviderId,
                      )
                    }
                    className="bg-background h-8 rounded-md border px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
                  >
                    {listRunnableAiProviders().map((definition) => (
                      <option
                        key={definition.metadata.id}
                        value={definition.metadata.id}
                      >
                        {definition.metadata.displayName}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex flex-col gap-1">
                  <span className="label-mono text-muted-foreground">Model</span>
                  <AiModelSelector
                    value={settings.model}
                    onChange={settings.setModel}
                    catalog={catalog}
                    disabled={runtimeBusy}
                  />
                  {!currentKeyState.value && (
                    <button
                      type="button"
                      className="text-muted-foreground w-fit text-left text-[10px] underline-offset-2 hover:underline"
                      onClick={() => setPage("api-keys")}
                    >
                      Add a {listAiProviderDefinitions().find(
                        (item) => item.metadata.id === settings.provider,
                      )?.metadata.displayName} API key to load models.
                    </button>
                  )}
                </div>

                <label className="flex items-center justify-between gap-3 text-xs">
                  <span>
                    Confirm destructive actions
                    <span className="text-muted-foreground mt-0.5 block text-[10px]">
                      Ask before deleting events or calendars.
                    </span>
                  </span>
                  <Switch
                    checked={confirmationsEnabled}
                    onCheckedChange={onConfirmationsEnabledChange}
                    aria-label="Confirm destructive agent actions"
                  />
                </label>

                {runtimeBusy && (
                  <p className="text-muted-foreground text-[10px]">
                    Stop the current response before changing providers, models,
                    or API keys.
                  </p>
                )}
              </div>
            ) : (
              <div
                role="tabpanel"
                aria-label="API key settings"
                className="flex flex-col gap-3"
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="text-muted-foreground size-4" />
                  <div>
                    <h3 className="text-xs font-semibold">Provider API keys</h3>
                    <p className="text-muted-foreground text-[10px]">
                      Keys are kept for this session unless you explicitly save
                      them on this device.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col divide-y rounded-md border">
                  {listAiProviderDefinitions().map((definition) => {
                    const id = definition.metadata.id;
                    if (definition.metadata.availability === "deferred") {
                      return (
                        <div
                          key={id}
                          data-provider-id={id}
                          className="px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium">
                              {definition.metadata.displayName}
                            </span>
                            <span className="text-muted-foreground text-[9px] uppercase">
                              Unavailable in browser
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-1 text-[10px]">
                            {definition.metadata.unavailableReason}
                          </p>
                        </div>
                      );
                    }

                    const providerId = id as RunnableAiProviderId;
                    const state = settings.getKeyState(providerId);
                    const configured = state.value.trim().length > 0;
                    const isRevealed = revealed.has(providerId);
                    return (
                      <div
                        key={id}
                        data-provider-id={id}
                        className="px-3 py-2.5"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">
                                {definition.metadata.displayName}
                              </span>
                              <span
                                className={cn(
                                  "font-mono text-[9px] uppercase",
                                  configured
                                    ? "text-event-green-border"
                                    : "text-muted-foreground",
                                )}
                              >
                                {configured ? "Configured" : "Not configured"}
                              </span>
                            </div>
                            {configured && (
                              <>
                                <div className="mt-1 flex items-center gap-1.5">
                                  <code className="min-w-0 truncate text-[10px]">
                                    {isRevealed
                                      ? state.value
                                      : maskApiKey(state.value)}
                                  </code>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="size-6"
                                    onClick={() =>
                                      setRevealed((current) => {
                                        const next = new Set(current);
                                        if (next.has(providerId)) {
                                          next.delete(providerId);
                                        } else {
                                          next.add(providerId);
                                        }
                                        return next;
                                      })
                                    }
                                    aria-label={
                                      isRevealed
                                        ? `Hide ${definition.metadata.displayName} API key`
                                        : `Reveal ${definition.metadata.displayName} API key`
                                    }
                                  >
                                    {isRevealed ? (
                                      <EyeOff className="size-3" />
                                    ) : (
                                      <Eye className="size-3" />
                                    )}
                                  </Button>
                                </div>
                                <p className="text-muted-foreground text-[9px]">
                                  {state.persisted
                                    ? "Saved on this device"
                                    : "This session only"}
                                </p>
                              </>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={runtimeBusy}
                              onClick={() => startEditing(providerId)}
                            >
                              {configured ? "Change key" : "Add key"}
                            </Button>
                            {configured && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={runtimeBusy}
                                onClick={() => settings.clearApiKey(providerId)}
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                        </div>

                        {editing === providerId && (
                          <div className="bg-secondary/30 mt-2 rounded-md border p-2">
                            <div className="flex rounded-md border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                              <input
                                type={showDraft ? "text" : "password"}
                                value={keyDraft}
                                onChange={(event) =>
                                  setKeyDraft(event.target.value)
                                }
                                placeholder={definition.metadata.apiKeyPlaceholder}
                                autoComplete="off"
                                spellCheck={false}
                                aria-label={`${definition.metadata.displayName} API key`}
                                className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="m-0.5 size-7"
                                onClick={() => setShowDraft((shown) => !shown)}
                                aria-label={
                                  showDraft ? "Hide API key" : "Reveal API key"
                                }
                              >
                                {showDraft ? (
                                  <EyeOff className="size-3.5" />
                                ) : (
                                  <Eye className="size-3.5" />
                                )}
                              </Button>
                            </div>
                            <label className="mt-2 flex items-center justify-between gap-3 text-[10px]">
                              <span>
                                Remember API key
                                <span className="text-muted-foreground block text-[9px]">
                                  Stores it unencrypted in this browser.
                                </span>
                              </span>
                              <Switch
                                size="sm"
                                checked={rememberDraft}
                                onCheckedChange={setRememberDraft}
                                aria-label={`Remember ${definition.metadata.displayName} API key`}
                              />
                            </label>
                            <div className="mt-2 flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditing(null);
                                  setKeyDraft("");
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={!keyDraft.trim()}
                                onClick={() => {
                                  settings.saveApiKey(
                                    providerId,
                                    keyDraft,
                                    rememberDraft,
                                  );
                                  setEditing(null);
                                  setKeyDraft("");
                                  setShowDraft(false);
                                }}
                              >
                                Save key
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="bg-secondary/50 text-muted-foreground rounded-md border px-2.5 py-2 text-[10px] leading-relaxed">
                  Requests and model discovery go directly from this browser to
                  the selected provider. Tempo has no backend and never receives
                  your keys. Browser-side keys cannot be securely hidden from
                  scripts, extensions, developer tools, or someone with access
                  to this browser or device.
                </div>

                <div className="border-destructive/30 mt-1 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="text-destructive mt-0.5 size-3.5" />
                    <div className="flex-1">
                      <p className="text-xs font-medium">Danger zone</p>
                      <p className="text-muted-foreground mt-0.5 text-[10px]">
                        Remove every session and saved provider key.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={!hasAnyKey || runtimeBusy}
                      onClick={() => setClearAllOpen(true)}
                    >
                      Clear all API keys
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" size="sm" onClick={close}>
            Done
          </Button>
        </div>
      </TempoDialog>

      <TempoDialog
        open={clearAllOpen}
        onClose={() => setClearAllOpen(false)}
        title="Clear all API keys?"
        description="This removes all in-memory and saved provider keys from Tempo."
      >
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setClearAllOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              settings.clearAllApiKeys();
              setEditing(null);
              setKeyDraft("");
              setRevealed(new Set());
              setClearAllOpen(false);
            }}
          >
            Clear all API keys
          </Button>
        </div>
      </TempoDialog>
    </>
  );
}
