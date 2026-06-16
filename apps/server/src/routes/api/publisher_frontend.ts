/**
 * Frontend API routes for the Publisher module.
 * These are session-authenticated routes that the Trilium client UI calls.
 * Mirrors the ETAPI endpoints but uses cookie/session auth.
 */

import { becca, getLog, options as optionService } from "@triliumnext/core";
import type { Request, Response, Router } from "express";

import {
    getRegisteredPublishers,
    parsePlatformConfigs,
    extractArticleContent,
    publishToPlatforms,
    publishToPlatform,
    getPublisher,
} from "../../services/publisher/core.js";
import type { PlatformConfig } from "../../services/publisher/types.js";

const PUBLISHER_CONFIGS_OPTION = "publisherConfigs";

export function registerPublisherApi(
    apiRoute: (method: string, path: string, handler: (req: Request, res: Response) => any) => void,
    asyncApiRoute: (method: string, path: string, handler: (req: Request, res: Response) => Promise<any>) => void
) {
    // GET /api/publisher/registered - List available publisher types
    apiRoute("get", "/api/publisher/registered", (req, res) => {
        const publishers = getRegisteredPublishers();
        res.json({ publishers });
    });

    // GET /api/publisher/platforms - List configured platforms
    apiRoute("get", "/api/publisher/platforms", (req, res) => {
        const configsJson = optionService.getOptionOrNull(PUBLISHER_CONFIGS_OPTION);
        const configs = parsePlatformConfigs(configsJson || undefined);
        res.json({ platforms: configs });
    });

    // POST /api/publisher/platforms - Save platform configs
    apiRoute("post", "/api/publisher/platforms", (req, res) => {
        const { platforms } = req.body as { platforms: PlatformConfig[] };
        if (!Array.isArray(platforms)) {
            return res.status(400).json({ error: "platforms must be an array" });
        }
        optionService.setOption(PUBLISHER_CONFIGS_OPTION, JSON.stringify(platforms));
        res.json({ success: true, count: platforms.length });
    });

    // POST /api/publisher/validate - Test platform connection
    asyncApiRoute("post", "/api/publisher/validate", async (req, res) => {
        const { config } = req.body as { config: PlatformConfig };
        if (!config?.platform) {
            return res.status(400).json({ valid: false, message: "config.platform is required" });
        }
        try {
            const publisher = getPublisher(config.platform);
            const result = await publisher.validateConfig(config);
            res.json(result);
        } catch (e: any) {
            res.json({ valid: false, message: e.message });
        }
    });

    // POST /api/publisher/publish - Publish to platforms
    asyncApiRoute("post", "/api/publisher/publish", async (req, res) => {
        const { noteId, platforms: targetPlatforms, options } = req.body as {
            noteId: string;
            platforms?: string[];
            options?: {
                coverImage?: string;
                summary?: string;
                author?: string;
                tags?: string[];
                categories?: string[];
            };
        };

        if (!noteId) {
            return res.status(400).json({ error: "noteId is required" });
        }

        // Load note content
        const note = becca.getNote(noteId);
        if (!note) {
            return res.status(404).json({ error: "Note not found" });
        }

        const htmlContent = note.getContent() || "";
        const article = extractArticleContent(noteId, note.title, htmlContent.toString(), options);

        // Get configured platforms
        const configsJson = optionService.getOptionOrNull(PUBLISHER_CONFIGS_OPTION);
        const allConfigs = parsePlatformConfigs(configsJson || undefined);

        let platformConfigs: PlatformConfig[];
        if (targetPlatforms && targetPlatforms.length > 0) {
            platformConfigs = allConfigs.filter(c => targetPlatforms.includes(c.platform) || targetPlatforms.includes(c.id));
        } else {
            platformConfigs = allConfigs;
        }

        if (platformConfigs.length === 0) {
            return res.status(400).json({ error: "No platforms configured or matched" });
        }

        const results = await publishToPlatforms(article, platformConfigs);

        res.json({
            success: results.some(r => r.status === "success"),
            total: results.length,
            succeeded: results.filter(r => r.status === "success").length,
            failed: results.filter(r => r.status === "failed").length,
            results,
        });
    });

    // GET /api/publisher/status/:noteId - Get publish status
    apiRoute("get", "/api/publisher/status/:noteId", (req, res) => {
        const { noteId } = req.params;
        const note = becca.getNote(noteId);
        if (!note) {
            return res.status(404).json({ error: "Note not found" });
        }

        const publishStateAttr = note.getAttribute("label", "publishState");
        let publishState = {};
        if (publishStateAttr?.value) {
            try {
                publishState = JSON.parse(publishStateAttr.value);
            } catch { /* ignore */ }
        }

        res.json({
            noteId,
            title: note.title,
            publishState,
        });
    });
}
