/**
 * Article Editor Widget
 *
 * A full-featured editor for self-media articles (自媒体文章).
 * Extends the standard text editor with:
 * - Cover image selector
 * - SEO metadata fields
 * - Publishing status display
 * - One-click publish button
 */

import "./Article.css";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { useEditorSpacedUpdate } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import EditableText from "../text/EditableText";

/** Article metadata stored alongside the HTML content */
interface ArticleMeta {
    coverImage?: string;
    summary?: string;
    author?: string;
    tags?: string[];
    categories?: string[];
    seoDescription?: string;
    seoKeywords?: string;
}

interface ArticleContent {
    html: string;
    meta: ArticleMeta;
}

/** Publishing platform status */
interface PublishState {
    platform: string;
    platformName: string;
    status: "draft" | "pending" | "publishing" | "success" | "failed";
    url?: string;
    errorMessage?: string;
    publishedAt?: string;
}

export default function Article({ note, ntxId, noteContext, parentComponent }: TypeWidgetProps) {
    const [meta, setMeta] = useState<ArticleMeta>({});
    const [publishStates, setPublishStates] = useState<PublishState[]>([]);
    const [isPublishing, setIsPublishing] = useState(false);
    const [platforms, setPlatforms] = useState<{ id: string; platform: string; name: string }[]>([]);
    const [showPlatformPicker, setShowPlatformPicker] = useState(false);
    const htmlRef = useRef<string>("");

    // Load existing article data from note content
    useEffect(() => {
        loadArticleData();
        loadPlatforms();
    }, [note.noteId]);

    async function loadArticleData() {
        try {
            const noteData: any = await server.get(`notes/${note.noteId}`);
            if (noteData?.content) {
                try {
                    const parsed: ArticleContent = JSON.parse(noteData.content);
                    htmlRef.current = parsed.html || "";
                    setMeta(parsed.meta || {});
                } catch {
                    // Content is raw HTML, not JSON — treat as legacy
                    htmlRef.current = noteData.content;
                }
            }
        } catch (e) {
            console.error("Failed to load article data:", e);
        }

        // Load publish state from labels
        try {
            const state: any = await server.get(`publisher/status/${note.noteId}`);
            if (state?.publishState?.platforms) {
                const states = Object.values(state.publishState.platforms) as PublishState[];
                setPublishStates(states);
            }
        } catch { /* ignore — no publish state yet */ }
    }

    async function loadPlatforms() {
        try {
            const resp: any = await server.get("publisher/platforms");
            if (resp?.platforms) {
                setPlatforms(resp.platforms);
            }
        } catch { /* ignore */ }
    }

    // Handle HTML content changes from the CKEditor
    const handleHtmlChange = useCallback((html: string) => {
        htmlRef.current = html;
    }, []);

    // Save the article (content + metadata)
    async function handleSave() {
        const content: ArticleContent = {
            html: htmlRef.current,
            meta,
        };

        try {
            await server.put(`notes/${note.noteId}/content`, JSON.stringify(content), {
                headers: { "Content-Type": "text/plain" },
            });
            toast.showMessage("文章已保存");
        } catch (e: any) {
            toast.showMessage("保存失败: " + (e.message || "未知错误"));
        }
    }

    // Publish to selected platforms
    async function handlePublish(platformIds: string[]) {
        setIsPublishing(true);
        try {
            const result: any = await server.post("publisher/publish", {
                noteId: note.noteId,
                platforms: platformIds,
                options: {
                    coverImage: meta.coverImage,
                    summary: meta.summary,
                    author: meta.author,
                    tags: meta.tags,
                },
            });

            if (result?.results) {
                setPublishStates(result.results);
            }

            const successCount = result?.succeeded || 0;
            const failCount = result?.failed || 0;
            if (failCount > 0) {
                toast.showMessage(`发布完成: ${successCount}成功, ${failCount}失败`);
            } else {
                toast.showMessage(`发布成功! 共${successCount}个平台`);
            }
        } catch (e: any) {
            toast.showMessage("发布失败: " + (e.message || "未知错误"));
        } finally {
            setIsPublishing(false);
            setShowPlatformPicker(false);
        }
    }

    // Update a metadata field
    function updateMeta(field: keyof ArticleMeta, value: any) {
        setMeta(prev => ({ ...prev, [field]: value }));
    }

    // Add a tag
    function addTag(tag: string) {
        if (!tag.trim()) return;
        setMeta(prev => ({
            ...prev,
            tags: [...(prev.tags || []), tag.trim()],
        }));
    }

    // Remove a tag
    function removeTag(tag: string) {
        setMeta(prev => ({
            ...prev,
            tags: (prev.tags || []).filter(t => t !== tag),
        }));
    }

    // Get the icon for a platform
    function getPlatformIcon(platform: string): string {
        const icons: Record<string, string> = {
            wechat: "bx bxl-wechat",
            wordpress: "bx bxl-wordpress",
            toutiao: "bx bxs-news",
            bilibili: "bx bxl-bilibili",
        };
        return icons[platform] || "bx bx-world";
    }

    // Get the status color
    function getStatusColor(status: string): string {
        switch (status) {
            case "success": return "#4caf50";
            case "failed": return "#f44336";
            case "publishing": return "#ff9800";
            case "pending": return "#2196f3";
            default: return "#9e9e9e";
        }
    }

    return (
        <div className="article-editor">
            {/* Metadata sidebar */}
            <div className="article-sidebar">
                <div className="article-sidebar-section">
                    <h3>文章信息</h3>

                    <label>作者</label>
                    <input
                        type="text"
                        value={meta.author || ""}
                        placeholder="自媒体创作者"
                        onInput={(e: any) => updateMeta("author", e.currentTarget.value)}
                    />

                    <label>摘要</label>
                    <textarea
                        rows={3}
                        value={meta.summary || ""}
                        placeholder="文章摘要..."
                        onInput={(e: any) => updateMeta("summary", e.currentTarget.value)}
                    />

                    <label>封面图 URL</label>
                    <input
                        type="text"
                        value={meta.coverImage || ""}
                        placeholder="https://img.88531.cn/..."
                        onInput={(e: any) => updateMeta("coverImage", e.currentTarget.value)}
                    />
                    {meta.coverImage && (
                        <img src={meta.coverImage} alt="封面预览" className="article-cover-preview"
                            onError={(e: any) => { e.target.style.display = "none"; }} />
                    )}
                </div>

                <div className="article-sidebar-section">
                    <h3>SEO 设置</h3>
                    <label>描述</label>
                    <textarea
                        rows={2}
                        value={meta.seoDescription || ""}
                        placeholder="SEO 描述..."
                        onInput={(e: any) => updateMeta("seoDescription", e.currentTarget.value)}
                    />
                    <label>关键词</label>
                    <input
                        type="text"
                        value={meta.seoKeywords || ""}
                        placeholder="关键词1,关键词2"
                        onInput={(e: any) => updateMeta("seoKeywords", e.currentTarget.value)}
                    />
                </div>

                <div className="article-sidebar-section">
                    <h3>标签</h3>
                    <div className="article-tags">
                        {(meta.tags || []).map(tag => (
                            <span key={tag} className="article-tag">
                                {tag}
                                <button onClick={() => removeTag(tag)}>&times;</button>
                            </span>
                        ))}
                    </div>
                    <TagInput onAdd={addTag} />
                </div>

                {/* Publishing section */}
                <div className="article-sidebar-section article-publish-section">
                    <h3>发布状态</h3>
                    {publishStates.length === 0 ? (
                        <p className="article-no-publish">尚未发布</p>
                    ) : (
                        <div className="article-publish-states">
                            {publishStates.map(ps => (
                                <div key={ps.platform} className="article-publish-state">
                                    <i className={getPlatformIcon(ps.platform)} />
                                    <span className="article-publish-platform">{ps.platformName}</span>
                                    <span className="article-publish-badge"
                                        style={{ backgroundColor: getStatusColor(ps.status) }}>
                                        {ps.status === "success" ? "已发布" :
                                         ps.status === "failed" ? "失败" :
                                         ps.status === "publishing" ? "发布中" : "待发布"}
                                    </span>
                                    {ps.url && (
                                        <a href={ps.url} target="_blank" className="article-publish-link" title="查看">
                                            <i className="bx bx-link-external" />
                                        </a>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="article-publish-actions">
                        <button
                            className="article-btn article-btn-primary"
                            onClick={() => setShowPlatformPicker(!showPlatformPicker)}
                            disabled={isPublishing}
                        >
                            {isPublishing ? "发布中..." : "📤 发布到..."}
                        </button>

                        <button className="article-btn" onClick={handleSave}>
                            💾 保存
                        </button>
                    </div>

                    {showPlatformPicker && (
                        <div className="article-platform-picker">
                            <p>选择发布平台:</p>
                            {platforms.map(p => (
                                <label key={p.id} className="article-platform-option">
                                    <input type="checkbox" value={p.id} />
                                    <i className={getPlatformIcon(p.platform)} />
                                    {p.name}
                                </label>
                            ))}
                            <button
                                className="article-btn article-btn-primary"
                                onClick={() => {
                                    const checked = document.querySelectorAll<HTMLInputElement>(
                                        ".article-platform-option input:checked"
                                    );
                                    const ids = Array.from(checked).map(cb => cb.value);
                                    if (ids.length === 0) {
                                        toast.showMessage("请选择至少一个平台");
                                        return;
                                    }
                                    handlePublish(ids);
                                }}
                            >
                                确认发布
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Main editor area */}
            <div className="article-main">
                <EditableText
                    note={note}
                    ntxId={ntxId}
                    noteContext={noteContext}
                    parentComponent={parentComponent}
                    viewScope={undefined}
                />
            </div>
        </div>
    );
}

/** Simple tag input component */
function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
    const [value, setValue] = useState("");

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (value.trim()) {
                onAdd(value.trim());
                setValue("");
            }
        }
    }

    return (
        <input
            type="text"
            className="article-tag-input"
            value={value}
            placeholder="输入标签后按 Enter"
            onInput={(e: any) => setValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown as any}
        />
    );
}
