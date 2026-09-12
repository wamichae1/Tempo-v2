import type {
  AiProvider,
  AiProviderId,
  AiProviderMetadata,
  RunnableAiProviderId,
} from "@/features/agent/ai/ai-provider";
import { GeminiProvider } from "@/features/agent/ai/gemini-provider";
import { GroqProvider } from "@/features/agent/ai/groq-provider";
import { OpenAiProvider } from "@/features/agent/ai/openai-provider";
import { OpenCodeProvider } from "@/features/agent/ai/opencode-provider";
import { OpenRouterProvider } from "@/features/agent/ai/openrouter-provider";

export interface AiProviderDefinition {
  metadata: AiProviderMetadata;
  create?: () => AiProvider;
}

const factories: Record<RunnableAiProviderId, () => AiProvider> = {
  openai: () => new OpenAiProvider(),
  openrouter: () => new OpenRouterProvider(),
  groq: () => new GroqProvider(),
  opencode: () => new OpenCodeProvider(),
  gemini: () => new GeminiProvider(),
};

const definitions: readonly AiProviderDefinition[] = [
  { metadata: new OpenAiProvider().metadata, create: factories.openai },
  { metadata: new OpenRouterProvider().metadata, create: factories.openrouter },
  { metadata: new GroqProvider().metadata, create: factories.groq },
  { metadata: new OpenCodeProvider().metadata, create: factories.opencode },
  { metadata: new GeminiProvider().metadata, create: factories.gemini },
  {
    metadata: {
      id: "nvidia-nim",
      displayName: "NVIDIA NIM",
      apiKeyStorageKey: "tempo:ai-key:nvidia-nim:v1",
      apiKeyPlaceholder: "NVIDIA API key",
      defaultModelId: "",
      availability: "deferred",
      availabilityLabel: "Coming soon",
      unavailableReason: "NVIDIA NIM browser support is coming soon.",
    },
  },
];

export function listAiProviderDefinitions(): readonly AiProviderDefinition[] {
  return definitions;
}

export function listRunnableAiProviders(): readonly AiProviderDefinition[] {
  return definitions.filter(
    (definition) => definition.metadata.availability === "enabled",
  );
}

export function getAiProviderDefinition(
  provider: AiProviderId,
): AiProviderDefinition {
  const definition = definitions.find(
    (candidate) => candidate.metadata.id === provider,
  );
  if (!definition) throw new Error(`Unknown AI provider "${provider}".`);
  return definition;
}

export function isRunnableAiProviderId(
  value: unknown,
): value is RunnableAiProviderId {
  return typeof value === "string" && value in factories;
}

export function createAiProvider(provider: RunnableAiProviderId): AiProvider {
  return factories[provider]();
}
