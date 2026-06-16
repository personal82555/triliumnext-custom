/**
 * WordPress Publisher
 *
 * Publishes articles to WordPress via XML-RPC (metaWeblog).
 * Reuses the proven pattern from sync_trilium_to_wordpress.py.
 */

import https from "https";
import http from "http";
import { getLog } from "@triliumnext/core";
import type { Publisher, PlatformConfig, ArticleContent, PublishResult } from "./types.js";

/**
 * Build a simple XML-RPC request body.
 */
function buildXmlRpcBody(methodName: string, params: any[]): string {
    const toXml = (val: any): string => {
        if (typeof val === "string") {
            // Escape XML special chars
            const escaped = val.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
            return `<string>${escaped}</string>`;
        }
        if (typeof val === "number") return Number.isInteger(val) ? `<int>${val}</int>` : `<double>${val}</double>`;
        if (typeof val === "boolean") return `<boolean>${val ? 1 : 0}</boolean>`;
        if (val === null || val === undefined) return "<nil/>";
        if (Array.isArray(val)) {
            return `<array><data>${val.map(v => `<value>${toXml(v)}</value>`).join("")}</data></array>`;
        }
        if (typeof val === "object") {
            const members = Object.entries(val)
                .map(([k, v]) => `<member><name>${k}</name><value>${toXml(v)}</value></member>`)
                .join("");
            return `<struct>${members}</struct>`;
        }
        return `<string>${String(val)}</string>`;
    };

    const paramsXml = params.map(p => `<param><value>${toXml(p)}</value></param>`).join("");
    return `<?xml version="1.0"?><methodCall><methodName>${methodName}</methodName><params>${paramsXml}</params></methodCall>`;
}

/**
 * Parse XML-RPC response to extract the return value.
 * Simplified parser — handles the common WordPress responses.
 */
function parseXmlRpcResponse(xml: string): any {
    // Extract <string>...</string>
    const stringMatch = xml.match(/<string>([\s\S]*?)<\/string>/);
    if (stringMatch) return stringMatch[1];

    // Extract <int>...</int>
    const intMatch = xml.match(/<int>(\d+)<\/int>/);
    if (intMatch) return parseInt(intMatch[1], 10);

    // Extract <boolean>...</boolean>
    const boolMatch = xml.match(/<boolean>(\d+)<\/boolean>/);
    if (boolMatch) return boolMatch[1] === "1";

    // Extract faultString (error)
    const faultMatch = xml.match(/<fault>[\s\S]*?<string>([\s\S]*?)<\/string>/);
    if (faultMatch) throw new Error(faultMatch[1]);

    return xml;
}

/**
 * Send an XML-RPC request via HTTP/HTTPS.
 */
function xmlRpcCall(url: string, method: string, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const body = buildXmlRpcBody(method, params);
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === "https:";
        const transport = isHttps ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname,
            method: "POST",
            headers: {
                "Content-Type": "text/xml; charset=utf-8",
                "Content-Length": Buffer.byteLength(body),
                "User-Agent": "TriliumNext-Publisher/1.0",
            },
            timeout: 60000, // 60s
        };

        const req = transport.request(options, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk.toString("utf-8"); });
            res.on("end", () => {
                try {
                    const result = parseXmlRpcResponse(data);
                    resolve(result);
                } catch (e: any) {
                    reject(new Error(`XML-RPC parse error: ${e.message}\nResponse: ${data.substring(0, 500)}`));
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("XML-RPC request timed out")); });
        req.write(body);
        req.end();
    });
}

/**
 * Extract categories from the article content and map to WordPress category names.
 */
function mapCategories(article: ArticleContent): string[] {
    const categories: string[] = [];

    // Use explicit categories first
    if (article.categories && article.categories.length > 0) {
        categories.push(...article.categories);
    }

    // Fall back to tag-based categorization
    if (article.tags) {
        for (const tag of article.tags) {
            const lower = tag.toLowerCase();
            if (lower.includes("开源") || lower.includes("github")) {
                if (!categories.includes("GitHub")) categories.push("GitHub");
            } else if (lower.includes("手机") || lower.includes("android") || lower.includes("ios")) {
                if (!categories.includes("手机软件")) categories.push("手机软件");
            } else if (lower.includes("电视") || lower.includes("tv")) {
                if (!categories.includes("电视TV软件")) categories.push("电视TV软件");
            }
        }
    }

    if (categories.length === 0) {
        categories.push("精品软件");
    }

    return categories;
}

export class WordPressPublisher implements Publisher {
    readonly id = "wordpress" as const;
    readonly name = "WordPress";
    readonly icon = "bxl-wordpress";

    async validateConfig(config: PlatformConfig): Promise<{ valid: boolean; message?: string }> {
        const xmlrpcUrl = config.config["xmlrpcUrl"];
        const username = config.config["username"];
        const password = config.config["password"];

        if (!xmlrpcUrl || !username || !password) {
            return { valid: false, message: "缺少配置：xmlrpcUrl、username、password 为必填项" };
        }

        try {
            await xmlRpcCall(xmlrpcUrl, "wp.getUsersBlogs", [username, password]);
            return { valid: true, message: "连接成功" };
        } catch (e: any) {
            return { valid: false, message: `连接失败: ${e.message}` };
        }
    }

    async publish(article: ArticleContent, config: PlatformConfig): Promise<PublishResult> {
        const xmlrpcUrl = config.config["xmlrpcUrl"];
        const username = config.config["username"];
        const password = config.config["password"];
        const blogId = config.config["blogId"] || "1";

        // Build the article HTML with meta
        let html = article.content;

        // Prepend cover image if available
        if (article.coverImage) {
            html = `<p><img src="${article.coverImage}" alt="${article.title}" style="max-width:100%"/></p>\n${html}`;
        }

        // Build the WordPress post struct
        const postStruct: Record<string, any> = {
            title: article.title,
            description: html,
            post_status: "publish",
            mt_allow_comments: 1,
            mt_allow_pings: 1,
        };

        // Add categories
        const categories = mapCategories(article);
        if (categories.length > 0) {
            postStruct.categories = categories;
        }

        // Add excerpt/summary
        if (article.summary) {
            postStruct.excerpt = article.summary;
        }

        // Add tags
        if (article.tags && article.tags.length > 0) {
            postStruct.mt_keywords = article.tags.join(", ");
        }

        const log = getLog();
        log.info(`Publishing to WordPress: "${article.title}" → ${xmlrpcUrl}`);

        try {
            const postId = await xmlRpcCall(xmlrpcUrl, "metaWeblog.newPost", [
                blogId,
                username,
                password,
                postStruct,
                1, // publish immediately
            ]);

            const postIdNum = typeof postId === "string" ? parseInt(postId, 10) : postId;
            const url = `${new URL(xmlrpcUrl).origin}/?p=${postIdNum}`;

            log.info(`WordPress publish success: ${url}`);

            return {
                platform: this.id,
                platformName: config.name,
                status: "success",
                url,
                publishedAt: new Date().toISOString(),
            };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            log.error(`WordPress publish failed: ${errorMessage}`);
            return {
                platform: this.id,
                platformName: config.name,
                status: "failed",
                errorMessage,
                publishedAt: new Date().toISOString(),
            };
        }
    }
}
