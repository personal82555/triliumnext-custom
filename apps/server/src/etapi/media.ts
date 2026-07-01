/**
 * ETAPI: Media Library Endpoints
 *
 * REST API endpoints for image hosting and media management.
 *
 * Endpoints:
 *   GET    /etapi/media/config         - Get media host config status
 *   POST   /etapi/media/upload         - Upload an image file → returns public URL
 *   POST   /etapi/media/upload-url     - Upload image from a URL (fetch + rehost)
 *   GET    /etapi/media/test           - Test media host connection
 *   POST   /etapi/media/save-config    - Save media host configuration
 */

import type { Router } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { becca, getLog, options as optionService } from "@triliumnext/core";
import eu from "./etapi_utils.js";
import { parseLskyProConfig } from "../services/media_host/lskypro.js";

/** Read Lsky Pro config from individual options (lskyApiUrl, lskyToken, etc.) */
function getLskyProConfigJson(): string | null {
    const baseUrl = optionService.getOptionOrNull("lskyApiUrl");
    const token = optionService.getOptionOrNull("lskyToken");
    if (!baseUrl || !token) return null;
    const config: Record<string, any> = {
        baseUrl,
        token,
        strategyId: parseInt(optionService.getOptionOrNull("lskyStrategyId") || "1", 10) || 1,
        albumId: parseInt(optionService.getOptionOrNull("lskyAlbumId") || "0", 10) || 0,
        publicDomain: optionService.getOptionOrNull("lskyPublicDomain") || "",
    };
    return JSON.stringify(config);
}

function register(router: Router) {
    /**
     * GET /etapi/media/config
     * Returns the current media host configuration status.
     */
    eu.route(router, "get", "/etapi/media/config", (req, res) => {
        const configJson = getLskyProConfigJson();
        const { host, error } = parseLskyProConfig(configJson || undefined);

        res.json({
            configured: !!host,
            error: error || null,
            provider: host ? "lskypro" : null,
        });
    });

    /**
     * POST /etapi/media/save-config
     * Save media host configuration.
     *
     * Body: {
     *   baseUrl: string,
     *   token: string,
     *   strategyId?: number,
     *   albumId?: number,
     *   publicDomain?: string,
     * }
     */
     eu.route(router, "post", "/etapi/media/save-config", (req, res) => {
         const { baseUrl, token, strategyId, albumId, publicDomain } = req.body as {
            baseUrl: string;
            token: string;
            strategyId?: number;
             albumId?: number;
            publicDomain?: string;
        };

        if (!baseUrl || !token) {
            throw new eu.EtapiError(400, "MISSING_CONFIG", "baseUrl and token are required");
        }

        const config = {
            baseUrl,
            token,
            strategyId: strategyId || 1,
             albumId: albumId || 0,
            publicDomain: publicDomain || "",
        };

        optionService.setOption(MEDIA_HOST_CONFIG_OPTION, JSON.stringify(config));

        res.json({ success: true });
    });

    /**
     * POST /etapi/media/test
     * Test the configured media host connection.
     */
    eu.route(router, "post", "/etapi/media/test", async (req, res) => {
        const configJson = getLskyProConfigJson();
        const { host, error } = parseLskyProConfig(configJson || undefined);

        if (!host) {
            res.json({ success: false, message: error || "未配置图片托管服务" });
            return;
        }

        try {
            const connected = await host.checkConnection();
            res.json({ success: connected, message: connected ? "连接成功" : "连接失败" });
        } catch (e: any) {
            res.json({ success: false, message: e.message });
        }
    });

    /**
     * POST /etapi/media/upload
     * Upload a local image file to the media host.
     *
     * Body: multipart/form-data with a "file" field, OR
     * JSON: { filePath: string, fileName?: string }
     *
     * Returns: { success: true, url: "https://..." }
     */
    eu.route(router, "post", "/etapi/media/upload", async (req, res) => {
        const configJson = getLskyProConfigJson();
        const { host, error } = parseLskyProConfig(configJson || undefined);

        if (!host) {
            throw new eu.EtapiError(400, "NO_MEDIA_HOST", error || "未配置图片托管服务");
        }

        try {
            let filePath: string;
            let fileName: string | undefined;

            // Support both JSON body and file path
            if (req.body?.filePath) {
                filePath = req.body.filePath;
                fileName = req.body.fileName;
            } else if (req.file) {
                // If using multer multipart upload
                filePath = req.file.path;
                fileName = req.file.originalname;
            } else {
                throw new eu.EtapiError(400, "NO_FILE", "请提供 filePath 或上传文件");
            }

            if (!fs.existsSync(filePath)) {
                throw new eu.EtapiError(400, "FILE_NOT_FOUND", `文件不存在: ${filePath}`);
            }

            const url = await host.upload(filePath, fileName);

            res.json({
                success: true,
                url,
                fileName: fileName || path.basename(filePath),
            });
        } catch (e: any) {
            throw new eu.EtapiError(500, "UPLOAD_FAILED", `上传失败: ${e.message}`);
        }
    });

    /**
     * POST /etapi/media/upload-url
     * Upload an image from a URL to the media host (fetch + rehost).
     *
     * Body: { url: string, fileName?: string }
     * Returns: { success: true, originalUrl: string, newUrl: string }
     */
    eu.route(router, "post", "/etapi/media/upload-url", async (req, res) => {
        const configJson = getLskyProConfigJson();
        const { host, error } = parseLskyProConfig(configJson || undefined);

        if (!host) {
            throw new eu.EtapiError(400, "NO_MEDIA_HOST", error || "未配置图片托管服务");
        }

        const { url: imageUrl, fileName } = req.body as { url: string; fileName?: string };

        if (!imageUrl) {
            throw new eu.EtapiError(400, "MISSING_URL", "url is required");
        }

        try {
            // Download the image to a temp file
            const ext = path.extname(new URL(imageUrl).pathname) || ".png";
            const tempFile = path.join(os.tmpdir(), `trilium-media-${Date.now()}${ext}`);

            // Use fetch to download (Node 18+)
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`下载失败: HTTP ${response.status}`);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(tempFile, buffer);

            // Upload to media host
            const newUrl = await host.upload(tempFile, fileName || `image${ext}`);

            // Clean up temp file
            try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

            res.json({
                success: true,
                originalUrl: imageUrl,
                newUrl,
            });
        } catch (e: any) {
            throw new eu.EtapiError(500, "REHOST_FAILED", `转存失败: ${e.message}`);
        }
    });
}

export default {
    register
};
