import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TempoDialog } from "@/components/ui/tempo-dialog";
import type { AiSettingsState } from "@/features/agent/use-ai-settings";

export function AgentSettingsDialog({
  open,
  onClose,
  settings,
  confirmationsEnabled,
  onConfirmationsEnabledChange,
}: {
  open: boolean;
  onClose: () => void;
  settings: AiSettingsState;
  confirmationsEnabled: boolean;
  onConfirmationsEnabledChange: (enabled: boolean) => void;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <TempoDialog
      open={open}
      onClose={onClose}
      title="Tempo Agent settings"
      description="Connect Tempo directly to an AI provider with your own API key."
      widthClass="w-[min(420px,calc(100vw-2rem))]"
    >
      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">Provider</span>
          <select
            value={settings.provider}
            onChange={(event) => settings.setProvider(event.target.value as "openai")}
            className="bg-background h-8 rounded-md border px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          >
            <option value="openai">OpenAI</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">API key</span>
          <div className="flex rounded-md border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <input
              type={showKey ? "text" : "password"}
              value={settings.apiKey}
              onChange={(event) => settings.setApiKey(event.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              aria-label="OpenAI API key"
              className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="m-0.5 size-7"
              onClick={() => setShowKey((shown) => !shown)}
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
            </Button>
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">Model</span>
          <input
            value={settings.model}
            onChange={(event) => settings.setModel(event.target.value)}
            placeholder="gpt-5-mini"
            aria-label="OpenAI model"
            className="bg-background h-8 rounded-md border px-2 font-mono text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            Remember API key
            <span className="text-muted-foreground mt-0.5 block text-[10px]">
              Stores the key unencrypted in this browser.
            </span>
          </span>
          <Switch
            checked={settings.rememberApiKey}
            onCheckedChange={settings.setRememberApiKey}
            aria-label="Remember API key on this device"
          />
        </label>

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

        <div className="bg-secondary/50 text-muted-foreground rounded-md border px-2.5 py-2 text-[10px] leading-relaxed">
          Requests go directly from this browser to OpenAI. Tempo has no server
          and never receives your key. Keys used in a browser are not securely
          hidden from scripts running on this site or from someone with access
          to this browser profile.
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!settings.apiKey}
            onClick={settings.clearApiKey}
          >
            Clear key
          </Button>
          <Button type="button" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </TempoDialog>
  );
}
