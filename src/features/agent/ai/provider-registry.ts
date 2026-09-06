import type {
  AiProvider,
  AiProviderId,
} from "@/features/agent/ai/ai-provider";
import { OpenAiProvider } from "@/features/agent/ai/openai-provider";

export function createAiProvider(provider: AiProviderId): AiProvider {
  switch (provider) {
    case "openai":
      return new OpenAiProvider();
  }
}
