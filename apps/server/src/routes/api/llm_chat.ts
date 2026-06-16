import type { LlmMessage } from "@triliumnext/commons";
import type { Request, Response } from "express";

import { generateChatTitle } from "../../services/llm/chat_title.js";
import { getAllModels, getProvider, hasConfiguredProviders, type LlmProviderConfig, getConfiguredProviders } from "../../services/llm/index.js";
import { streamToChunks } from "../../services/llm/stream.js";
import { getLog } from "@triliumnext/core";
import { safeExtractMessageAndStackFromError } from "../../services/utils.js";

interface ChatRequest {
    messages: LlmMessage[];
    config?: LlmProviderConfig;
}

/**
 * SSE endpoint for streaming chat completions.
 *
 * Response format (Server-Sent Events):
 * data: {"type":"text","content":"Hello"}
 * data: {"type":"text","content":" world"}
 * data: {"type":"done"}
 *
 * On error:
 * data: {"type":"error","error":"Error message"}
 */
async function streamChat(req: Request, res: Response) {
    const { messages, config = {} } = req.body as ChatRequest;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
    }

    // Set up SSE headers - disable compression and buffering for real-time streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    // Mark response as handled to prevent double-handling by apiResultHandler
    res.triliumResponseHandled = true;

    // Type assertion for flush method (available when compression is used)
    const flushableRes = res as Response & { flush?: () => void };

    try {
        if (!hasConfiguredProviders()) {
            res.write(`data: ${JSON.stringify({ type: "error", error: "No LLM providers configured. Please add a provider in Options → AI / LLM." })}\n\n`);
            return;
        }

        const errors: string[] = [];
        // Collect all provider config IDs in fallback order
        const allConfigs = getConfiguredProviders();
        const fallbackProviderIds = allConfigs.map(c => c.id);
        // Primary is the one matching the selected model's provider, or first
        let primaryProviderId = config.provider;
        if (!primaryProviderId || !fallbackProviderIds.includes(primaryProviderId)) {
            primaryProviderId = allConfigs[0]?.id;
        }

        // Try providers in order until one succeeds
        const providerQueue = [primaryProviderId, ...fallbackProviderIds.filter(id => id !== primaryProviderId)];

        let lastError: unknown;
        let usedProvider: string | undefined;

        for (const pid of providerQueue) {
            try {
                usedProvider = pid;
                const provider = getProvider(pid);
                const result = provider.chat(messages, { ...config, provider: pid });

                // Get pricing and display name for the model
                const modelId = config.model || provider.getAvailableModels().find(m => m.isDefault)?.id;
                if (!modelId) {
                    res.write(`data: ${JSON.stringify({ type: "error", error: "No model specified and no default model available for the provider." })}\n\n`);
                    return;
                }

                const pricing = provider.getModelPricing(modelId);
                const modelDisplayName = provider.getAvailableModels().find(m => m.id === modelId)?.name || modelId;

                // If this is a fallback (not the primary), tell the user
                if (pid !== primaryProviderId) {
                    const fallbackName = allConfigs.find(c => c.id === pid)?.name || pid;
                    res.write(`data: ${JSON.stringify({ type: "info", content: `⚠️ Primary provider failed, using ${fallbackName} as fallback.` })}\n\n`);
                }

                for await (const chunk of streamToChunks(result, { model: modelDisplayName, pricing })) {
                    if (chunk.type === "error") {
                        getLog().error(`LLM chat stream error (model ${modelDisplayName}): ${chunk.error}`);
                    }
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    if (typeof flushableRes.flush === "function") {
                        flushableRes.flush();
                    }
                }

                // Success — exit the fallback loop
                lastError = undefined;
                break;
            } catch (error) {
                lastError = error;
                const errMsg = error instanceof Error ? error.message : "Unknown error";
                errors.push(errMsg);
                getLog().warn(`Provider ${pid} failed, trying next: ${errMsg}`);
                // Continue to next provider in queue
            }
        }

        if (lastError) {
            // All providers failed
            res.write(`data: ${JSON.stringify({ type: "error", error: `All providers failed:\n${errors.join("\n")}` })}\n\n`);
        }

        // Auto-generate a title for the chat note on the first user message
        const userMessages = messages.filter(m => m.role === "user");
        if (userMessages.length === 1 && config.chatNoteId) {
            try {
                const firstContent = userMessages[0].content;
                // Multimodal content: title from the text parts only — image
                // bytes are useless to the title model.
                const firstText = typeof firstContent === "string"
                    ? firstContent
                    : firstContent.filter(p => p.type === "text").map(p => p.text).join("\n").trim();
                if (firstText) {
                    await generateChatTitle(config.chatNoteId, firstText);
                }
            } catch (err) {
                // Title generation is best-effort; don't fail the chat
                getLog().error(`Failed to generate chat title: ${safeExtractMessageAndStackFromError(err)}`);
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        getLog().error(`LLM chat stream failed: ${safeExtractMessageAndStackFromError(error)}`);
        res.write(`data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`);
    } finally {
        res.end();
    }
}

/**
 * Get available models from all configured providers.
 */
function getModels(_req: Request, _res: Response) {
    if (!hasConfiguredProviders()) {
        return { models: [] };
    }

    return { models: getAllModels() };
}

export default {
    streamChat,
    getModels
};
