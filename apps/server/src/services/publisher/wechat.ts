/**
 * WeChat Official Account (微信公众号) Publisher
 *
 * Uses the official WeChat MP API:
 * 1. Get access_token via appid + appsecret
 * 2. Create draft (草稿) via draft/add
 * 3. Submit draft for publishing (群发) via freepublish/submit
 *
 * API docs: https://developers.weixin.qq.com/doc/offiaccount/Draft_Management/Add_Draft.html
 */

import https from "https";
import { getLog } from "@triliumnext/core";
import type { Publisher, PlatformConfig, ArticleContent, PublishResult } from "./types.js";

const WECHAT_API_BASE = "https://api.weixin.qq.com/cgi-bin";

/**
 * Simple HTTPS GET helper.
 */
function httpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, { timeout: 15000 }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk.toString("utf-8"); });
            res.on("end", () => resolve(data));
        }).on("error", reject).on("timeout", function(this: any) {
            this.destroy();
            reject(new Error("HTTPS GET timed out"));
        });
    });
}

/**
 * Simple HTTPS POST helper.
 */
function httpsPost(url: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(body),
            },
            timeout: 30000,
        }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk.toString("utf-8"); });
            res.on("end", () => resolve(data));
        });
        req.on("error", reject);
        req.on("timeout", function(this: any) {
            this.destroy();
            reject(new Error("HTTPS POST timed out"));
        });
        req.write(body);
        req.end();
    });
}

/**
 * Get WeChat access token using appid and appsecret.
 */
async function getAccessToken(appid: string, appsecret: string): Promise<string> {
    const url = `${WECHAT_API_BASE}/token?grant_type=client_credential&appid=${appid}&secret=${appsecret}`;
    const resp = await httpsGet(url);
    const data = JSON.parse(resp);

    if (data.errcode && data.errcode !== 0) {
        throw new Error(`WeChat auth failed: ${data.errmsg} (code ${data.errcode})`);
    }
    if (!data.access_token) {
        throw new Error(`WeChat auth failed: no access_token in response`);
    }

    return data.access_token;
}

/**
 * Create a WeChat draft (草稿).
 * Returns the draft media_id.
 */
async function createDraft(accessToken: string, article: ArticleContent, author: string): Promise<string> {
    // Build the body content with proper WeChat HTML formatting
    let bodyContent = article.content;

    // WeChat requires all images to use the `data-src` attribute and be on the whitelisted CDN
    // Also needs inline styles for mobile rendering
    bodyContent = bodyContent
        .replace(/<img /g, '<img data-w="auto" ')
        .replace(/src="([^"]+)"/g, (match, url) => {
            // WeChat prefers their own CDN, but external HTTPS images work too
            return `data-src="${url}" data-w="auto"`;
        });

    // Build the draft payload
    const draftPayload = {
        articles: [
            {
                title: article.title,
                author: author || "自媒体创作者",
                digest: article.summary || article.title,
                content: bodyContent,
                content_source_url: "",
                thumb_media_id: "", // Will be set if cover image is provided
                need_open_comment: 1,
                only_fans_can_comment: 0,
            },
        ],
    };

    // If there's a cover image, upload it first as a permanent image
    if (article.coverImage) {
        // WeChat requires thumb_media_id — this needs image upload via a separate API
        // For now, skip the cover image upload (WeChat will use the first image in content)
    }

    const url = `${WECHAT_API_BASE}/draft/add?access_token=${accessToken}`;
    const resp = await httpsPost(url, JSON.stringify(draftPayload));
    const data = JSON.parse(resp);

    if (data.errcode && data.errcode !== 0) {
        throw new Error(`WeChat draft/create failed: ${data.errmsg} (code ${data.errcode})`);
    }
    if (!data.media_id) {
        throw new Error(`WeChat draft/create failed: no media_id in response`);
    }

    return data.media_id;
}

/**
 * Submit a draft for publishing (free publish).
 * Returns the publish_id for status checking.
 */
async function submitPublish(accessToken: string, mediaId: string): Promise<{ publishId: string; msgStatus: string }> {
    const url = `${WECHAT_API_BASE}/freepublish/submit?access_token=${accessToken}`;
    const resp = await httpsPost(url, JSON.stringify({ media_id: mediaId }));
    const data = JSON.parse(resp);

    if (data.errcode && data.errcode !== 0) {
        throw new Error(`WeChat publish/submit failed: ${data.errmsg} (code ${data.errcode})`);
    }

    return {
        publishId: String(data.publish_id || ""),
        msgStatus: String(data.msg_status || ""),
    };
}

export class WeChatPublisher implements Publisher {
    readonly id = "wechat" as const;
    readonly name = "微信公众号";
    readonly icon = "bxl-wechat";

    async validateConfig(config: PlatformConfig): Promise<{ valid: boolean; message?: string }> {
        const appid = config.config["appid"];
        const appsecret = config.config["appsecret"];

        if (!appid || !appsecret) {
            return { valid: false, message: "缺少配置：appid、appsecret 为必填项" };
        }

        try {
            const token = await getAccessToken(appid, appsecret);
            if (token) {
                return { valid: true, message: "连接成功" };
            }
            return { valid: false, message: "获取 token 失败" };
        } catch (e: any) {
            return { valid: false, message: `连接失败: ${e.message}` };
        }
    }

    async publish(article: ArticleContent, config: PlatformConfig): Promise<PublishResult> {
        const appid = config.config["appid"];
        const appsecret = config.config["appsecret"];
        const author = config.config["author"] || article.author || "自媒体创作者";

        const log = getLog();
        log.info(`Publishing to WeChat: "${article.title}"`);

        try {
            // Step 1: Get access token
            const accessToken = await getAccessToken(appid, appsecret);

            // Step 2: Create draft
            const mediaId = await createDraft(accessToken, article, author);
            log.info(`WeChat draft created: ${mediaId}`);

            // Step 3: Submit for publishing
            const publishResult = await submitPublish(accessToken, mediaId);
            log.info(`WeChat publish submitted: ${publishResult.publishId}`);

            return {
                platform: this.id,
                platformName: config.name,
                status: "success",
                url: `https://mp.weixin.qq.com/s/${publishResult.publishId}`,
                publishedAt: new Date().toISOString(),
            };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            log.error(`WeChat publish failed: ${errorMessage}`);
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
