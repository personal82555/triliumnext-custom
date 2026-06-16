/**
 * TriliumNext Publisher - Core Engine
 *
 * Orchestrates publishing to multiple platforms.
 * Manages publishing state, retry logic, and scheduling.
 */

import { getLog } from "@triliumnext/core";
import type {
    PlatformConfig,
    PlatformType,
    Publisher,
    ArticleContent,
    PublishResult,
    PublishStatus,
    ArticlePublishState
} from "./types.js";
import { WordPressPublisher } from "./wordpress.js";
// import { WeChatPublisher } from "./wechat.js";

/** Registry of available publishers */
const publisherRegistry: Map<PlatformType, Publisher> = new Map();

/** Register all built-in publishers */
function registerBuiltinPublishers() {
    const publishers: Publisher[] = [
        new WordPressPublisher(),
        // new WeChatPublisher(),   // Will be added after core is stable
    ];

    for (const p of publishers) {
        publisherRegistry.set(p.id, p);
    }
}

// Auto-register on module load
registerBuiltinPublishers();

/** Get a publisher by its platform type */
export function getPublisher(platform: PlatformType): Publisher {
    const publisher = publisherRegistry.get(platform);
    if (!publisher) {
        throw new Error(`Unknown publisher platform: ${platform}. Available: ${Array.from(publisherRegistry.keys()).join(", ")}`);
    }
    return publisher;
}

/** Get all registered publisher types */
export function getRegisteredPublishers(): { id: PlatformType; name: string; icon: string }[] {
    return Array.from(publisherRegistry.values()).map(p => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
    }));
}

/** Parse platform configurations from the Trilium options string */
export function parsePlatformConfigs(jsonString?: string): PlatformConfig[] {
    if (!jsonString) return [];
    try {
        const configs = JSON.parse(jsonString) as PlatformConfig[];
        return configs.filter(c => c.enabled !== false);
    } catch (e) {
        getLog().error(`Failed to parse platform configs: ${e}`);
        return [];
    }
}

/**
 * Extract article content from a Trilium note.
 * Note: This is called server-side using the internal note service.
 */
export function extractArticleContent(
    noteId: string,
    title: string,
    htmlContent: string,
    options?: {
        coverImage?: string;
        summary?: string;
        author?: string;
        tags?: string[];
        categories?: string[];
    }
): ArticleContent {
    return {
        noteId,
        title,
        content: htmlContent,
        coverImage: options?.coverImage,
        summary: options?.summary,
        author: options?.author,
        tags: options?.tags,
        categories: options?.categories,
    };
}

/**
 * Publish an article to a single platform.
 * Returns the publish result.
 */
export async function publishToPlatform(
    article: ArticleContent,
    platformConfig: PlatformConfig
): Promise<PublishResult> {
    const publisher = getPublisher(platformConfig.platform);
    const log = getLog();

    try {
        log.info(`Publishing "${article.title}" to ${platformConfig.platform} (${platformConfig.name})...`);
        const result = await publisher.publish(article, platformConfig);
        log.info(`Publish result for ${platformConfig.platform}: ${result.status}${result.url ? ` → ${result.url}` : ""}`);
        return result;
    } catch (error: any) {
        const errorMessage = error?.message || String(error);
        log.error(`Publish failed for ${platformConfig.platform}: ${errorMessage}`);
        return {
            platform: platformConfig.platform,
            platformName: platformConfig.name,
            status: "failed",
            errorMessage,
            publishedAt: new Date().toISOString(),
        };
    }
}

/**
 * Publish an article to multiple platforms in parallel.
 * Returns results for all platforms.
 */
export async function publishToPlatforms(
    article: ArticleContent,
    platformConfigs: PlatformConfig[]
): Promise<PublishResult[]> {
    const results = await Promise.allSettled(
        platformConfigs.map(config => publishToPlatform(article, config))
    );

    return results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        return {
            platform: platformConfigs[i].platform,
            platformName: platformConfigs[i].name,
            status: "failed" as PublishStatus,
            errorMessage: r.reason?.message || "Unknown error",
            publishedAt: new Date().toISOString(),
        };
    });
}

/**
 * Sanitize HTML content for a specific platform.
 * Each platform may require different transformations:
 * - WeChat: inline styles, no external JS
 * - WordPress: full HTML, extra meta
 * - Toutiao: simplified HTML, no tables
 */
export function sanitizeForPlatform(html: string, platform: PlatformType): string {
    switch (platform) {
        case "wechat":
            // WeChat needs inline styles and no scripts
            return html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<link[\s\S]*?>/gi, "")
                .replace(/class="[^"]*"/g, ""); // Remove classes, rely on inline styles
        case "wordpress":
            return html; // WordPress handles full HTML
        case "toutiao":
            // Remove tables, scripts, iframes
            return html
                .replace(/<table[\s\S]*?<\/table>/gi, "<p>[表格内容]</p>")
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
        default:
            return html;
    }
}

export { WordPressPublisher } from "./wordpress.js";
// export { WeChatPublisher } from "./wechat.js";
