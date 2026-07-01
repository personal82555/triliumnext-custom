/**
 * Lsky Pro Media Host
 *
 * Uploads images to a self-hosted Lsky Pro instance via its REST API.
 * Reuses the proven pattern from your existing publish scripts.
 *
 * API: POST /api/v1/upload  (multipart/form-data with Bearer token)
 * Returns: { status: true, data: { links: { url: "..." } } }
 */

import https from "https";
import http from "http";
import fs from "fs";
import { getLog } from "@triliumnext/core";
import type { MediaHost } from "../publisher/types.js";

/** Generate a random boundary for multipart uploads */
function randomBoundary(): string {
    return `----TriliumPublisher${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export class LskyProHost implements MediaHost {
    readonly id = "lskypro";
    readonly name = "Lsky Pro";

    private baseUrl: string;
    private token: string;
    private strategyId: number;
    private albumId?: number;
    private publicDomain?: string;

    constructor(baseUrl: string, token: string, options?: { strategyId?: number; albumId?: number; publicDomain?: string }) {
        // Normalize base URL (remove trailing slash)
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.token = token;
        this.strategyId = options?.strategyId ?? 1;
        this.albumId = options?.albumId;
        this.publicDomain = options?.publicDomain;
    }

    async checkConnection(): Promise<boolean> {
        try {
            const url = `${this.baseUrl}/api/v1/albums`;
            const result = await this._request("GET", url);
            return result !== null;
        } catch {
            return false;
        }
    }

    async upload(filePath: string, fileName?: string): Promise<string> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const imageData = fs.readFileSync(filePath);
        const basename = fileName || filePath.split("/").pop() || "image.png";
        const mimeType = this._guessMimeType(basename);

        return this._uploadMultipart(imageData, basename, mimeType);
    }

    async uploadBuffer(data: Buffer, fileName: string, mimeType: string): Promise<string> {
        return this._uploadMultipart(data, fileName, mimeType);
    }

    private async _uploadMultipart(data: Buffer, fileName: string, mimeType: string): Promise<string> {
        const boundary = randomBoundary();

        // Build multipart body
        const parts: string[] = [];
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="strategy_id"\r\n\r\n${this.strategyId}`);
        if (this.albumId) {
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="album_id"\r\n\r\n${this.albumId}`);
        }
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n`);

        const bodyParts: Buffer[] = [];
        for (const part of parts) {
            bodyParts.push(Buffer.from(part, "utf-8"));
        }
        bodyParts.push(data);
        bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"));
        const body = Buffer.concat(bodyParts);

        const url = `${this.baseUrl}/api/v1/upload`;
        const urlObj = new URL(url);

        return new Promise((resolve, reject) => {
            const transport = urlObj.protocol === "https:" ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
                path: urlObj.pathname,
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.token}`,
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                    "Content-Length": body.length,
                    "Accept": "application/json",
                },
                timeout: 60000,
            };

            const req = transport.request(options, (res) => {
                let data = "";
                res.on("data", (chunk: Buffer) => { data += chunk.toString("utf-8"); });
                res.on("end", () => {
                    try {
                        const result = JSON.parse(data);
                        if (result.status !== true) {
                            reject(new Error(`Lsky Pro upload failed: ${result.message || JSON.stringify(result)}`));
                            return;
                        }

                        let imageUrl = result.data?.links?.url;
                        if (!imageUrl) {
                            reject(new Error(`Lsky Pro upload failed: no URL in response`));
                            return;
                        }

                        // Convert HTTP to HTTPS if publicDomain matches
                        if (this.publicDomain && imageUrl.startsWith("http://") && imageUrl.includes(this.publicDomain)) {
                            imageUrl = "https://" + imageUrl.slice(7);
                        }

                        resolve(imageUrl);
                    } catch (e: any) {
                        reject(new Error(`Lsky Pro response parse error: ${e.message}\nBody: ${data.substring(0, 200)}`));
                    }
                });
            });

            req.on("error", reject);
            req.on("timeout", function(this: any) {
                this.destroy();
                reject(new Error("Lsky Pro upload timed out"));
            });
            req.write(body);
            req.end();
        });
    }

    private _request(method: string, url: string): Promise<any> {
        const urlObj = new URL(url);
        const transport = urlObj.protocol === "https:" ? https : http;

        return new Promise((resolve, reject) => {
            const req = transport.request(
                {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method,
                    headers: {
                        "Authorization": `Bearer ${this.token}`,
                        "Accept": "application/json",
                    },
                    timeout: 15000,
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk: Buffer) => { data += chunk.toString("utf-8"); });
                    res.on("end", () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch {
                            resolve(null);
                        }
                    });
                }
            );
            req.on("error", reject);
            req.on("timeout", function(this: any) {
                this.destroy();
                reject(new Error("Request timed out"));
            });
            req.end();
        });
    }

    private _guessMimeType(filename: string): string {
        const ext = filename.split(".").pop()?.toLowerCase() || "";
        const mimes: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            bmp: "image/bmp",
        };
        return mimes[ext] || "image/png";
    }
}

/** Parse Lsky Pro config from a JSON options string */
export function parseLskyProConfig(jsonString?: string): { host: LskyProHost | null; error?: string } {
    if (!jsonString) return { host: null, error: "未配置 Lsky Pro" };

    try {
        const config = JSON.parse(jsonString);
        const baseUrl = config["baseUrl"] || config["base_url"];
        const token = config["token"] || config["apiKey"] || config["api_key"];

        if (!baseUrl || !token) {
            return { host: null, error: "Lsky Pro 配置缺少 baseUrl 或 token" };
        }

        const host = new LskyProHost(baseUrl, token, {
            strategyId: config["strategyId"] || 1,
            albumId: config["albumId"] || config["album_id"],
            publicDomain: config["publicDomain"],
        });

        return { host };
    } catch (e: any) {
        return { host: null, error: `Lsky Pro 配置解析失败: ${e.message}` };
    }
}
