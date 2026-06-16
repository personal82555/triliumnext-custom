import { getLog, options as optionService } from "@triliumnext/core";

import { AnthropicProvider } from "./providers/anthropic.js";
import { GoogleProvider } from "./providers/google.js";
import { OpenAiProvider, type CustomModelDef } from "./providers/openai.js";
import type { LlmProvider, ModelInfo } from "./types.js";

/**
 * Configuration for a single LLM provider instance.
 * This matches the structure stored in the llmProviders option.
 */
export interface LlmProviderSetup {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    /** Optional override for the SDK's default API endpoint (e.g. for self-hosted Ollama, vLLM, or proxies). */
    baseURL?: string;
    /** Optional custom model list for OpenAI-compatible providers */
    models?: CustomModelDef[];
}

/** Factory functions for creating provider instances */
const providerFactories: Record<string, (apiKey: string, baseURL?: string, setup?: LlmProviderSetup) => LlmProvider> = {
    anthropic: (apiKey, baseURL) => new AnthropicProvider(apiKey, baseURL),
    openai: (apiKey, baseURL, setup) => new OpenAiProvider(apiKey, baseURL, setup?.models),
    google: (apiKey, baseURL) => new GoogleProvider(apiKey, baseURL)
};

/** Cache of instantiated providers by their config ID */
let cachedProviders: Record<string, LlmProvider> = {};

/**
 * Get configured providers from the options.
 */
export function getConfiguredProviders(): LlmProviderSetup[] {
    try {
        const providersJson = optionService.getOptionOrNull("llmProviders");
        if (!providersJson) {
            return [];
        }
        return JSON.parse(providersJson) as LlmProviderSetup[];
    } catch (e) {
        getLog().error(`Failed to parse llmProviders option: ${e}`);
        return [];
    }
}

/**
 * Get a provider instance by its configuration ID.
 * If no ID is provided, returns the first configured provider.
 */
export function getProvider(providerId?: string): LlmProvider {
    const configs = getConfiguredProviders();

    if (configs.length === 0) {
        throw new Error("No LLM providers configured. Please add a provider in Options → AI / LLM.");
    }

    // Find the requested provider or use the first one
    const config = providerId
        ? configs.find(c => c.id === providerId)
        : configs[0];

    if (!config) {
        throw new Error(`LLM provider not found: ${providerId}`);
    }

    // Check cache
    if (cachedProviders[config.id]) {
        return cachedProviders[config.id];
    }

    // Create new provider instance
    const factory = providerFactories[config.provider];
    if (!factory) {
        throw new Error(`Unknown LLM provider type: ${config.provider}. Available: ${Object.keys(providerFactories).join(", ")}`);
    }

    const provider = factory(config.apiKey, config.baseURL, config);
    cachedProviders[config.id] = provider;
    return provider;
}

/**
 * Get the first configured provider of a specific type (e.g., "anthropic").
 */
export function getProviderByType(providerType: string): LlmProvider {
    const configs = getConfiguredProviders();
    const config = configs.find(c => c.provider === providerType);

    if (!config) {
        throw new Error(`No ${providerType} provider configured. Please add one in Options → AI / LLM.`);
    }

    return getProvider(config.id);
}

/**
 * Check if any providers are configured.
 */
export function hasConfiguredProviders(): boolean {
    return getConfiguredProviders().length > 0;
}

/**
 * Derive a human-readable provider label from the config, preferring the
 * user-supplied name when it's not the generic type name, otherwise falling
 * back to a friendy name based on the base URL hostname.
 */
function deriveProviderLabel(config: LlmProviderSetup): string {
    // If the user set a custom name that isn't just the type default, use it
    const typeNames = ["Anthropic", "OpenAI", "Google Gemini", "OpenAI 兼容", "自定义 OpenAI 兼容"];
    if (config.name && !typeNames.includes(config.name)) {
        return config.name;
    }

    // Fall back to a nice name from the base URL hostname
    if (config.baseURL) {
        try {
            const url = new URL(config.baseURL);
            const hostname = url.hostname;
            const pathname = url.pathname;
            // Known mappings — check hostname + path first, then hostname-only
            const known: Record<string, string> = {
                "api.openai.com": "OpenAI",
                "api.anthropic.com": "Anthropic",
                "generativelanguage.googleapis.com": "Google Gemini",
                "api.deepseek.com": "DeepSeek",
                "openrouter.ai": "OpenRouter",
                "api.groq.com": "Groq",
                "api.together.xyz": "Together AI",
                "api.mistral.ai": "Mistral AI",
                "api.perplexity.ai": "Perplexity",
                "api.x.ai": "xAI (Grok)",
                "api.fireworks.ai": "Fireworks AI",
                "api.cohere.ai": "Cohere",
            };
            // Path-specific OpenCode mappings (check before generic hostname match)
            if (hostname === "opencode.ai" || hostname.endsWith(".opencode.ai")) {
                if (pathname.startsWith("/zen/go/")) return "OpenCode Go";
                if (pathname.startsWith("/zen/")) return "OpenCode Zen";
                return "OpenCode"; // fallback if path is unknown
            }
            for (const [pattern, label] of Object.entries(known)) {
                if (hostname === pattern || hostname.endsWith("." + pattern)) {
                    return label;
                }
            }
            // Local / self-hosted — friendly short names
            if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
                const port = new URL(config.baseURL).port;
                if (port === "11434") return "Ollama";
                if (port === "8000") return "vLLM";
                return `本地 (端口 ${port})`;
            }
            // Unknown hostname: show just the main domain segment
            const parts = hostname.replace(/^api\./, "").replace(/^www\./, "").split(".");
            return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        } catch {
            // Invalid URL — fall through
        }
    }

    return config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
}

/**
 * Get all models from all configured providers, tagged with their provider type.
 */
export function getAllModels(): ModelInfo[] {
    const configs = getConfiguredProviders();
    const allModels: ModelInfo[] = [];
    let firstModel = true;

    for (const config of configs) {
        try {
            const provider = getProvider(config.id);
            const models = provider.getAvailableModels();
            const providerLabel = deriveProviderLabel(config);
            for (const model of models) {
                // Only the very first model across all providers is the default
                allModels.push({
                    ...model,
                    isDefault: firstModel,
                    provider: config.id,
                    // Store the human-readable provider name for display
                    // so the client can show it as a group header and prefix.
                    providerName: providerLabel
                } as ModelInfo & { providerName: string });
                firstModel = false;
            }
        } catch (e) {
            getLog().error(`Failed to get models from provider ${config.provider}: ${e}`);
        }
    }

    return allModels;
}

/**
 * Clear the provider cache. Call this when provider configurations change.
 */
export function clearProviderCache(): void {
    cachedProviders = {};
}

export type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing } from "./types.js";
