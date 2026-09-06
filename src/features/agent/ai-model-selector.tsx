import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AIModel } from "@/features/agent/ai/ai-provider";
import { searchModels } from "@/features/agent/ai/model-catalog";
import type {
  AiModelsState,
} from "@/features/agent/use-ai-models";
import { cn } from "@/lib/utils";

export function AiModelSelector({
  value,
  onChange,
  catalog,
  disabled,
}: {
  value: string;
  onChange: (model: string) => void;
  catalog: AiModelsState;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => searchModels(catalog.models, query),
    [catalog.models, query],
  );
  const selected = catalog.models.find((model) => model.id === value);
  const savedMissing =
    value && catalog.status === "loaded" && !selected
      ? ({
          id: value,
          displayName: value,
          providerId: catalog.models[0]?.providerId ?? "openai",
          toolSupport: "unknown",
        } satisfies AIModel)
      : null;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 w-full justify-between px-2 font-mono text-xs font-normal"
          disabled={disabled || catalog.status === "missing-key"}
          aria-label="Select AI model"
        >
          <span className="min-w-0 truncate">
            {selected?.displayName || value || "Select a model"}
          </span>
          {catalog.status === "loading" ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <ChevronsUpDown className="size-3 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(420px,calc(100vw-3rem))] p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models..."
          aria-label="Search models"
          className="bg-background h-8 w-full rounded-md border px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <div className="mt-2 max-h-64 overflow-y-auto">
          {savedMissing && (
            <button
              type="button"
              className="bg-secondary/40 mb-1 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs"
              onClick={() => setOpen(false)}
            >
              <span className="min-w-0 truncate">{savedMissing.displayName}</span>
              <span className="text-muted-foreground ml-auto text-[9px]">
                Saved selection unavailable
              </span>
            </button>
          )}
          {catalog.status === "error" ? (
            <div className="px-2 py-3 text-xs">
              <p className="text-destructive">{catalog.error}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={catalog.refresh}
              >
                <RefreshCw className="size-3" />
                Retry
              </Button>
            </div>
          ) : catalog.status === "empty" ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              This provider returned no compatible models.
            </p>
          ) : results.length === 0 && catalog.status !== "loading" ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              No models match this search.
            </p>
          ) : (
            results.map((model) => (
              <button
                key={model.id}
                type="button"
                className={cn(
                  "hover:bg-secondary flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                  model.id === value && "bg-secondary/60",
                )}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate">{model.displayName}</span>
                  {model.displayName !== model.id && (
                    <span className="text-muted-foreground block truncate font-mono text-[9px]">
                      {model.id}
                    </span>
                  )}
                </span>
                {model.id === value && <Check className="ml-auto size-3" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
