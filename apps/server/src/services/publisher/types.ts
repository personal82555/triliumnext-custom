/**
 * TriliumNext Publisher - Type Definitions
 *
 * Core types for the self-media publishing engine.
 * Each publisher platform implements the Publisher interface.
 */

/** Publishing platform identifiers */
export type PlatformType = "wechat" | "wordpress" | "toutiao" | "bilibili" | "smzdm" | "csdn" | "zhihu";

/** Publish status for a single platform */
export type PublishStatus = "draft" | "pending" | "publishing" | "success" | "failed";

/** Platform-specific credentials/config */
export interface PlatformConfig {
    id: string;
    platform: PlatformType;
    name: string;               // user-facing label, e.g. "实用软技"
    config: Record<string, string>; // api keys, tokens, etc.
    enabled: boolean;
}

/** Article content extracted from a Trilium note */
export interface ArticleContent {
    noteId: string;
    title: string;
    content: string;            // HTML body
    coverImage?: string;        // URL
    summary?: string;
    author?: string;
    tags?: string[];
    categories?: string[];
    seo?: {
        description?: string;
        keywords?: string;
        ogImage?: string;
    };
}

/** Result of a single publish operation */
export interface PublishResult {
    platform: PlatformType;
    platformName: string;
    status: PublishStatus;
    url?: string;               // public URL of the published article
    errorMessage?: string;
    publishedAt?: string;       // ISO timestamp
}

/** Full publishing state for one note */
export interface ArticlePublishState {
    noteId: string;
    platforms: Record<PlatformType, PublishResult>;
    lastUpdated?: string;
}

/** Publisher interface - each platform implements this */
export interface Publisher {
    readonly id: PlatformType;
    readonly name: string;
    readonly icon: string;

    /** Validate that the platform config is correct (test connection) */
    validateConfig(config: PlatformConfig): Promise<{ valid: boolean; message?: string }>;

    /** Publish an article to this platform */
    publish(article: ArticleContent, config: PlatformConfig): Promise<PublishResult>;
}

/** Image host interface */
export interface MediaHost {
    readonly id: string;
    readonly name: string;

    /** Upload an image file, return the public URL */
    upload(filePath: string, fileName?: string): Promise<string>;

    /** Upload image from a buffer */
    uploadBuffer(data: Buffer, fileName: string, mimeType: string): Promise<string>;

    /** Test the connection */
    checkConnection(): Promise<boolean>;
}
