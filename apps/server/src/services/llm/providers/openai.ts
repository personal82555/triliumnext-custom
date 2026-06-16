import { createOpenAI, type OpenAIProvider as OpenAISDKProvider } from "@ai-sdk/openai";
import type { ToolSet } from "ai";

import { BaseProvider, buildModelList } from "./base_provider.js";

/**
 * Available OpenAI models with pricing (USD per million tokens).
 * Source: https://platform.openai.com/docs/pricing
 */
const { models: AVAILABLE_MODELS, pricing: MODEL_PRICING } = buildModelList([
    // ===== Current Models =====
    {
        id: "gpt-4.1",
        name: "GPT-4.1",
        pricing: { input: 2, output: 8 },
        contextWindow: 1047576,
        isDefault: true
    },
    {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        pricing: { input: 0.4, output: 1.6 },
        contextWindow: 1047576
    },
    {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        pricing: { input: 0.1, output: 0.4 },
        contextWindow: 1047576
    },
    {
        id: "o3",
        name: "o3",
        pricing: { input: 2, output: 8 },
        contextWindow: 200000
    },
    {
        id: "o4-mini",
        name: "o4-mini",
        pricing: { input: 1.1, output: 4.4 },
        contextWindow: 200000
    },
    // ===== Legacy Models =====
    {
        id: "gpt-4o",
        name: "GPT-4o",
        pricing: { input: 2.5, output: 10 },
        contextWindow: 128000,
        isLegacy: true
    },
    {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        pricing: { input: 0.15, output: 0.6 },
        contextWindow: 128000,
        isLegacy: true
    }
]);

export interface CustomModelDef {
    id: string;
    name: string;
}

export class OpenAiProvider extends BaseProvider {
    name = "openai";
    protected defaultModel = "gpt-4.1";
    protected titleModel = "gpt-4.1-mini";
    protected availableModels: ModelInfo[];
    protected modelPricing: Record<string, ModelPricing>;

    private openai: OpenAISDKProvider;

    constructor(apiKey: string, baseURL?: string, customModels?: CustomModelDef[]) {
        super();
        this.openai = createOpenAI({ apiKey, ...(baseURL && { baseURL }) });

        if (customModels && customModels.length > 0) {
            const first = customModels[0];
            this.defaultModel = first.id;
            this.titleModel = first.id;
            this.availableModels = customModels.map((m, i) => ({
                id: m.id,
                name: m.name,
                pricing: { input: 0, output: 0 },
                isDefault: i === 0,
                contextWindow: 128000
            }));
            this.modelPricing = Object.fromEntries(
                customModels.map(m => [m.id, { input: 0, output: 0 }])
            );
        } else {
            this.availableModels = AVAILABLE_MODELS;
            this.modelPricing = MODEL_PRICING;
        }
    }

    protected createModel(modelId: string) {
        // Use chat() explicitly to force Chat Completions API (/v1/chat/completions)
        // instead of the newer Responses API (/v1/responses), for broader
        // compatibility with OpenAI-compatible providers.
        return this.openai.chat(modelId);
    }

    protected override addWebSearchTool(tools: ToolSet): void {
        tools.web_search = this.openai.tools.webSearch();
    }
}
