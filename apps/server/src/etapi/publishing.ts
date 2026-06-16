/**
 * ETAPI: Publishing Endpoints
 *
 * REST API endpoints for publishing articles to self-media platforms.
 *
 * Endpoints:
 *   GET    /etapi/publisher/platforms         - List configured platforms
 *   POST   /etapi/publisher/validate          - Validate platform config
 *   POST   /etapi/publisher/publish           - Publish a note to platform(s)
 *   GET    /etapi/publisher/status/:noteId    - Get publish status for a note
 *   GET    /etapi/publisher/registered        - List all available publisher types
 */

import type { Router } from "express";
import { becca, getLog, options as optionService } from "@triliumnext/core";
import eu from "./etapi_utils.js";
import {
    getRegisteredPublishers,
    parsePlatformConfigs,
    extractArticleContent,
    publishToPlatforms,
    publishToPlatform,
    getPublisher,
} from "../services/publisher/core.js";
import type { PlatformConfig, ArticleContent } from "../services/publisher/types.js";

/** Option name where platform configs are stored */
const PUBLISHER_CONFIGS_OPTION = "publisherConfigs";

function register(router: Router) {
    /**
     * GET /etapi/publisher/registered
     * Returns all available publisher types (WordPress, WeChat, etc.)
     */
    eu.route(router, "get", "/etapi/publisher/registered", (req, res) => {
        const publishers = getRegisteredPublishers();
        res.json({ publishers });
    });

    /**
     * GET /etapi/publisher/platforms
     * Returns the user's configured publishing platforms.
     */
    eu.route(router, "get", "/etapi/publisher/platforms", (req, res) => {
        const configsJson = optionService.getOptionOrNull(PUBLISHER_CONFIGS_OPTION);
        const configs = parsePlatformConfigs(configsJson || undefined);
        res.json({ platforms: configs });
    });

    /**
     * POST /etapi/publisher/platforms
     * Save platform configurations.
     * Body: { platforms: PlatformConfig[] }
     */
    eu.route(router, "post", "/etapi/publisher/platforms", (req, res) => {
        const { platforms } = req.body as { platforms: PlatformConfig[] };
        if (!Array.isArray(platforms)) {
            throw new eu.EtapiError(400, "INVALID_PLATFORMS", "platforms must be an array");
        }
        optionService.setOption(PUBLISHER_CONFIGS_OPTION, JSON.stringify(platforms));
        res.json({ success: true, count: platforms.length });
    });

    /**
     * POST /etapi/publisher/validate
     * Test a platform connection.
     * Body: { config: PlatformConfig }
     */
    eu.route(router, "post", "/etapi/publisher/validate", async (req, res) => {
        const { config } = req.body as { config: PlatformConfig };
        if (!config || !config.platform) {
            throw new eu.EtapiError(400, "INVALID_CONFIG", "config with platform is required");
        }

        try {
            const publisher = getPublisher(config.platform);
            const result = await publisher.validateConfig(config);
            res.json(result);
        } catch (e: any) {
            res.json({ valid: false, message: e.message });
        }
    });

    /**
     * POST /etapi/publisher/publish
     * Publish a note to one or more platforms.
     *
     * Body: {
     *   noteId: string,
     *   platforms?: string[]        // platform IDs to publish to; omit for all configured
     *   options?: {
     *     coverImage?: string,
     *     summary?: string,
     *     author?: string,
     *     tags?: string[],
     *   }
     * }
     */
    eu.route(router, "post", "/etapi/publisher/publish", async (req, res) => {
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
            throw new eu.EtapiError(400, "MISSING_NOTE_ID", "noteId is required");
        }

        // Get the note
        const note = eu.getAndCheckNote(noteId);

        // Get the note's HTML content
        const htmlContent = note.getContent() || "";

        // Build the article content
        const article = extractArticleContent(noteId, note.title, htmlContent.toString(), options);

        // Get configured platforms
        const configsJson = optionService.getOptionOrNull(PUBLISHER_CONFIGS_OPTION);
        const allConfigs = parsePlatformConfigs(configsJson || undefined);

        // Filter to target platforms if specified
        let platformConfigs: PlatformConfig[];
        if (targetPlatforms && targetPlatforms.length > 0) {
            platformConfigs = allConfigs.filter(c => targetPlatforms.includes(c.platform) || targetPlatforms.includes(c.id));
        } else {
            platformConfigs = allConfigs;
        }

        if (platformConfigs.length === 0) {
            throw new eu.EtapiError(400, "NO_PLATFORMS", "No platforms configured or matched");
        }

        // Execute publishing
        const results = await publishToPlatforms(article, platformConfigs);

        res.json({
            success: results.some(r => r.status === "success"),
            total: results.length,
            succeeded: results.filter(r => r.status === "success").length,
            failed: results.filter(r => r.status === "failed").length,
            results,
        });
    });

    /**
     * GET /etapi/publisher/status/:noteId
     * Get publishing status for a note.
     * Returns the stored publishing state from the note's labels.
     */
    eu.route(router, "get", "/etapi/publisher/status/:noteId", (req, res) => {
        const { noteId } = req.params;
        const note = eu.getAndCheckNote(noteId);

        // Look for publish state in note labels
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

export default register;
