import "./ChatInputBar.css";

import { AttributeEditor as CKEditorAttributeEditor, type CKTextEditor, type MentionFeed } from "@triliumnext/ckeditor5";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Fragment } from "preact";

import { t } from "../../../services/i18n.js";
import link from "../../../services/link.js";
import note_autocomplete, { type Suggestion } from "../../../services/note_autocomplete.js";
import options from "../../../services/options.js";
import ActionButton from "../../react/ActionButton.js";
import Button from "../../react/Button.js";
import CKEditor, { type CKEditorApi } from "../../react/CKEditor.js";
import Dropdown from "../../react/Dropdown.js";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem, FormListToggleableItem } from "../../react/FormList.js";
import { useLegacyImperativeHandlers } from "../../react/hooks.js";
import AddProviderModal, { type LlmProviderConfig } from "../options/llm/AddProviderModal.js";
import { SafeImage } from "./retry_image.js";
import { useChatAttachments } from "./useChatAttachments.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

const READ_ONLY_LOCK = "llm-chat-streaming";

const mentionFeeds: MentionFeed[] = [
    {
        marker: "@",
        feed: (queryText) => note_autocomplete.autocompleteSourceForCKEditor(queryText),
        itemRenderer: (rawItem) => {
            const item = rawItem as Suggestion;
            const itemElement = document.createElement("button");

            const iconElement = document.createElement("span");
            let iconClass = item.icon ?? "bx bx-note";
            if (item.action === "create-note") {
                iconClass = "bx bx-plus";
            }
            iconElement.className = iconClass;

            itemElement.append(iconElement, document.createTextNode(" "));
            const titleContainer = document.createElement("span");
            titleContainer.innerHTML = item.highlightedNotePathTitle ?? "";
            itemElement.append(...titleContainer.childNodes, document.createTextNode(" "));

            return itemElement;
        },
        minimumCharacters: 0
    }
];

/** Format token count with thousands separators */
function formatTokenCount(tokens: number): string {
    return tokens.toLocaleString();
}

/**
 * Convert CKEditor HTML into plain text suitable for an LLM prompt.
 *
 * Paragraphs and <br> become newlines. Note reference links (anchors with a
 * `#root/...` href) are rendered as markdown-style `[Title](#root/noteId)` so
 * the LLM sees both the human-readable title and the addressable note path it
 * can feed into note tools.
 */
function htmlToPlainText(html: string): string {
    const container = document.createElement("div");
    container.innerHTML = html;
    container.querySelectorAll<HTMLAnchorElement>("a[href^='#']").forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        const title = (a.textContent ?? "").trim();
        a.replaceWith(`[${title}](${href})`);
    });
    // Two-space + newline = markdown hard line break (preserves shift+Enter).
    container.querySelectorAll("br").forEach((br) => br.replaceWith("  \n"));
    // Iterate over all child nodes (not just element children) so top-level
    // text nodes — text not wrapped in a block element — aren't silently dropped.
    const parts: string[] = [];
    container.childNodes.forEach((node) => {
        const text = (node.textContent ?? "").trim();
        if (text) {
            parts.push(text);
        }
    });
    return parts.join("\n\n");
}

interface ChatInputBarProps {
    /** The chat hook result */
    chat: UseLlmChatReturn;
    /** Current active note ID (for note context toggle) */
    activeNoteId?: string;
    /** Current active note title (for note context toggle) */
    activeNoteTitle?: string;
    /** Custom submit handler (overrides chat.handleSubmit) */
    onSubmit?: (e: Event) => void;
    /** Callback when web search toggle changes */
    onWebSearchChange?: () => void;
    /** Callback when note tools toggle changes */
    onNoteToolsChange?: () => void;
    /** Callback when extended thinking toggle changes */
    onExtendedThinkingChange?: () => void;
    /** Callback when model changes */
    onModelChange?: (model: string) => void;
}

export default function ChatInputBar({
    chat,
    activeNoteId,
    activeNoteTitle,
    onSubmit,
    onWebSearchChange,
    onNoteToolsChange,
    onExtendedThinkingChange,
    onModelChange
}: ChatInputBarProps) {
    const [showAddProviderModal, setShowAddProviderModal] = useState(false);
    const editorApiRef = useRef<CKEditorApi>();
    const editorInstanceRef = useRef<CKTextEditor>();
    // Always-fresh submit handler for the editor's enter listener.
    const submitRef = useRef<(e: Event) => void>(() => {});

    // Clipboard / drag-drop / file-picker upload management.
    const attachments = useChatAttachments(chat);

    // CKEditor's ReferenceLink plugin calls back into the parent component to
    // resolve a note's title from its href.
    useLegacyImperativeHandlers({
        async loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string | null = null) {
            await link.loadReferenceLinkTitle($el, href);
        }
    });

    const baseSubmit = onSubmit ?? chat.handleSubmit;

    const currentModel = chat.availableModels.find(m => m.id === chat.selectedModel);
    const isAutoMode = chat.selectedModel === "__auto__";
    const currentModels = chat.availableModels.filter(m => !m.isLegacy);
    const legacyModels = chat.availableModels.filter(m => m.isLegacy);

    /** Simple task classifier for auto mode — picks the best model based on input content. */
    function classifyTask(input: string): string {
        const text = input.toLowerCase().trim();
        // Code-related keywords → use the strongest available model
        const codeKeywords = [
            "function", "class", "def ", "import ", "export ", "const ", "let ", "var ",
            "try ", "catch ", "throw", "async ", "await ", "=>", "-->", "```",
            "bug", "error", "refactor", "debug", "compile", "syntax",
            "git ", "npm ", "pip ", "docker", "api ", "http ", "sql ",
            "algorithm", "array", "object", "return ", "if (", "for (", "while ("
        ];
        const isCode = codeKeywords.some(kw => text.includes(kw));

        // Very short queries → cheapest model
        const isShort = text.length < 50;

        // Longer, non-code questions → stronger model
        const isComplex = text.split(/\s+/).length > 30;

        if (isCode || isComplex) {
            // Use the most capable model: the one with the largest context window
            // among available non-legacy models
            const best = [...chat.availableModels]
                .filter(m => !m.isLegacy && m.id !== "__auto__")
                .sort((a, b) => (b.contextWindow || 0) - (a.contextWindow || 0))[0];
            return best?.id || "big-pickle";
        }

        if (isShort) {
            // Find the cheapest model (the one without cost multiplier = free)
            const cheap = chat.availableModels
                .filter(m => !m.isLegacy && m.id !== "__auto__" && !m.costMultiplier)
                .sort((a, b) => (a.contextWindow || 0) - (b.contextWindow || 0))[0];
            return cheap?.id || chat.availableModels[0]?.id || "big-pickle";
        }

        // Default: first available model
        return chat.availableModels.find(m => m.id !== "__auto__")?.id || "big-pickle";
    }

    // Clear the editor immediately when a submit fires with non-empty, non-streaming
    // input — mirrors the rejection check inside chat.handleSubmit so we don't wipe
    // text that won't actually be sent. Doing it here (instead of as a useEffect on
    // chat.input) avoids the React-render / CKEditor-change-event race that left the
    // editor visually populated after submit.
    const handleSubmit = useCallback((e: Event) => {
        const willSubmit = (chat.input.trim() || chat.pendingAttachments.length > 0) && !chat.isStreaming;
        if (willSubmit && isAutoMode) {
            // Classify the input and auto-select the best model
            const bestModel = classifyTask(chat.input);
            chat.setSelectedModel(bestModel);
        }
        baseSubmit(e);
        if (willSubmit) {
            editorApiRef.current?.setText("");
            editorApiRef.current?.focus();
        }
    }, [baseSubmit, chat.input, chat.isStreaming, chat.pendingAttachments.length, isAutoMode]);
    submitRef.current = handleSubmit;

    // Reflect streaming state into CKEditor's read-only lock.
    useEffect(() => {
        const editor = editorInstanceRef.current;
        if (!editor) return;
        if (chat.isStreaming) {
            editor.enableReadOnlyMode(READ_ONLY_LOCK);
        } else {
            editor.disableReadOnlyMode(READ_ONLY_LOCK);
        }
    }, [chat.isStreaming]);

    const handleWebSearchToggle = (newValue: boolean) => {
        chat.setEnableWebSearch(newValue);
        onWebSearchChange?.();
    };

    const handleNoteToolsToggle = (newValue: boolean) => {
        chat.setEnableNoteTools(newValue);
        onNoteToolsChange?.();
    };

    const handleExtendedThinkingToggle = (newValue: boolean) => {
        chat.setEnableExtendedThinking(newValue);
        onExtendedThinkingChange?.();
    };

    const handleModelSelect = (model: string) => {
        chat.setSelectedModel(model);
        onModelChange?.(model);
    };

    const handleNoteContextToggle = () => {
        if (chat.contextNoteId) {
            chat.setContextNoteId(undefined);
        } else if (activeNoteId) {
            chat.setContextNoteId(activeNoteId);
        }
    };

    const handleAddProvider = useCallback(async (provider: LlmProviderConfig) => {
        // Get current providers and add the new one
        const currentProviders = options.getJson("llmProviders") || [];
        const newProviders = [...currentProviders, provider];
        await options.save("llmProviders", JSON.stringify(newProviders));
        // Refresh models to pick up the new provider
        chat.refreshModels();
    }, [chat]);

    const isNoteContextEnabled = !!chat.contextNoteId && !!activeNoteId;

    // Gemini 2.x cannot combine googleSearch with function tools in a single
    // request. When note tools are enabled on a Gemini model we silently drop
    // web search server-side; reflect that here by disabling the toggle so the
    // user understands the trade-off instead of seeing it mysteriously ignored.
    const webSearchUnavailable = currentModel?.provider === "google" && chat.enableNoteTools;
    const contextWindow = currentModel?.contextWindow || 200000;
    const percentage = Math.min((chat.lastPromptTokens / contextWindow) * 100, 100);
    const isWarning = percentage > 75;
    const isCritical = percentage > 90;
    const pieColor = isCritical ? "var(--danger-color, #d9534f)" : isWarning ? "var(--warning-color, #f0ad4e)" : "var(--main-selection-color, #007bff)";

    // Show setup prompt if no provider is configured
    if (!chat.isCheckingProvider && !chat.hasProvider) {
        return (
            <div className="llm-chat-no-provider">
                <div className="llm-chat-no-provider-content">
                    <span className="bx bx-bot llm-chat-no-provider-icon" />
                    <p>{t("llm_chat.no_provider_message")}</p>
                    <Button
                        text={t("llm_chat.add_provider")}
                        icon="bx bx-plus"
                        onClick={() => setShowAddProviderModal(true)}
                    />
                </div>
                <AddProviderModal
                    show={showAddProviderModal}
                    onHidden={() => setShowAddProviderModal(false)}
                    onSave={handleAddProvider}
                />
            </div>
        );
    }

    return (
        <form
            className="llm-chat-input-form"
            onSubmit={handleSubmit}
            onDrop={attachments.handleDrop}
            onDragOver={attachments.handleDragOver}
        >
            {chat.pendingAttachments.length > 0 && (
                <div className="llm-chat-attachments">
                    {chat.pendingAttachments.map((att) => (
                        <div
                            key={att.attachmentId}
                            className={`llm-chat-attachment-chip llm-chat-attachment-chip-${att.type}`}
                            title={att.title}
                        >
                            {att.type === "image" ? (
                                <SafeImage src={att.url} alt={att.title} />
                            ) : (
                                <div className="llm-chat-attachment-file">
                                    <span className={`bx ${att.type === "file" ? "bxs-file-pdf" : "bxs-file-blank"} llm-chat-attachment-file-icon`} />
                                    <span className="llm-chat-attachment-file-name">{att.title}</span>
                                </div>
                            )}
                            <button
                                type="button"
                                className="llm-chat-attachment-remove"
                                title={t("llm_chat.remove_attachment")}
                                onClick={() => chat.removePendingAttachment(att.attachmentId)}
                                disabled={chat.isStreaming}
                            >
                                <span className="bx bx-x" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <CKEditor
                apiRef={editorApiRef}
                className="llm-chat-input"
                editor={CKEditorAttributeEditor}
                config={{
                    toolbar: { items: [] },
                    placeholder: t("llm_chat.placeholder"),
                    mention: { feeds: mentionFeeds },
                    licenseKey: "GPL",
                    language: "en"
                }}
                onChange={(html) => {
                    chat.setInput(htmlToPlainText(html ?? ""));
                }}
                onInitialized={(editor) => {
                    editorInstanceRef.current = editor;
                    // Enter submits, Shift+Enter falls through to ShiftEnter (soft break).
                    editor.editing.view.document.on(
                        "enter",
                        (event, data) => {
                            if (data.isSoft) return;
                            event.stop();
                            data.preventDefault();
                            submitRef.current(new Event("submit"));
                        },
                        { priority: "high" }
                    );
                    // Capture pasted images at the DOM layer so CKEditor doesn't
                    // try to embed them as base64 data URLs inside the editor.
                    // Go through `pasteHandlerRef` so this one-time registration
                    // always sees the latest closure (chatNoteId arrives via a
                    // useEffect in the parent, after first render).
                    const editable = editor.editing.view.getDomRoot();
                    editable?.addEventListener(
                        "paste",
                        (e) => attachments.pasteHandlerRef.current(e as ClipboardEvent),
                        { capture: true }
                    );
                }}
            />
            <input
                ref={attachments.fileInputRef}
                type="file"
                accept={attachments.acceptAttr}
                multiple
                onChange={attachments.handleFilePickerChange}
                style={{ display: "none" }}
            />
            <div className="llm-chat-options">
                <div className="llm-chat-model-selector">
                    <span className="bx bx-chip" />
                    <Dropdown
                        text={<>{isAutoMode ? "🤖 自动" : currentModel?.providerName ? `${currentModel.providerName} / ${currentModel.name}` : currentModel?.name}</>}
                        disabled={chat.isStreaming}
                        buttonClassName="llm-chat-model-select"
                        dropdownOptions={{ popperConfig: { placement: 'top-end' } }}
                    >
                        {(() => {
                            // Group current models by provider name
                            const groups = new Map<string, typeof currentModels>();
                            // Add "自动" as a virtual provider group at the top
                            groups.set("🤖 自动", []);
                            // Show what auto mode would pick (for display)
                            const autoModel = chat.input ? classifyTask(chat.input) : undefined;
                            const autoDesc = autoModel
                                ? chat.availableModels.find(m => m.id === autoModel)?.name || autoModel
                                : "";
                            for (const model of currentModels) {
                                const key = model.providerName || 'Other';
                                if (!groups.has(key)) groups.set(key, []);
                                groups.get(key)!.push(model);
                            }
                            const entries = Array.from(groups.entries());
                            return entries.map(([providerName, models], gi) => (
                                <Fragment key={providerName}>
                                    {gi > 0 && <FormDropdownDivider />}
                                    {entries.length > 1 && (
                                        <div className="dropdown-header" style={{
                                            padding: '4px 12px',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            color: 'var(--text-weak, #888)',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            {providerName}
                                        </div>
                                    )}
                                    {models.length === 0 && providerName === "🤖 自动" ? (
                                        // "自动" mode as a special list item
                                        <FormListItem
                                            key="__auto__"
                                            onClick={() => handleModelSelect("__auto__")}
                                            checked={isAutoMode}
                                        >
                                            🤖 自动
                                            {autoDesc && <small> → {autoDesc}</small>}
                                        </FormListItem>
                                    ) : (
                                        models.map(model => (
                                            <FormListItem
                                                key={model.id}
                                                onClick={() => handleModelSelect(model.id)}
                                                checked={chat.selectedModel === model.id}
                                            >
                                                {model.name} <small>({model.costDescription})</small>
                                            </FormListItem>
                                        ))
                                    )}
                                </Fragment>
                            ));
                        })()}
                        {legacyModels.length > 0 && (
                            <>
                                <FormDropdownDivider />
                                <FormDropdownSubmenu
                                    icon="bx bx-history"
                                    title={t("llm_chat.legacy_models")}
                                >
                                    {legacyModels.map(model => (
                                        <FormListItem
                                            key={model.id}
                                            onClick={() => handleModelSelect(model.id)}
                                            checked={chat.selectedModel === model.id}
                                        >
                                            {model.name} <small>({model.costDescription})</small>
                                        </FormListItem>
                                    ))}
                                </FormDropdownSubmenu>
                            </>
                        )}
                        <FormDropdownDivider />
                        <FormListToggleableItem
                            icon="bx bx-globe"
                            title={t("llm_chat.web_search")}
                            currentValue={chat.enableWebSearch && !webSearchUnavailable}
                            onChange={handleWebSearchToggle}
                            disabled={chat.isStreaming || webSearchUnavailable}
                            disabledTooltip={webSearchUnavailable ? t("llm_chat.web_search_unavailable_gemini") : undefined}
                        />
                        <FormListToggleableItem
                            icon="bx bx-note"
                            title={t("llm_chat.note_tools")}
                            currentValue={chat.enableNoteTools}
                            onChange={handleNoteToolsToggle}
                            disabled={chat.isStreaming}
                        />
                        <FormListToggleableItem
                            icon="bx bx-brain"
                            title={t("llm_chat.extended_thinking")}
                            currentValue={chat.enableExtendedThinking}
                            onChange={handleExtendedThinkingToggle}
                            disabled={chat.isStreaming}
                        />
                    </Dropdown>
                    {activeNoteId && activeNoteTitle && (
                        <Button
                            text={activeNoteTitle}
                            icon={isNoteContextEnabled ? "bx-file" : "bx-hide"}
                            kind="lowProfile"
                            size="micro"
                            className={`llm-chat-note-context ${isNoteContextEnabled ? "active" : ""}`}
                            onClick={handleNoteContextToggle}
                            disabled={chat.isStreaming}
                            title={isNoteContextEnabled
                                ? t("llm_chat.note_context_enabled", { title: activeNoteTitle })
                                : t("llm_chat.note_context_disabled")}
                        />
                    )}
                    {chat.lastPromptTokens > 0 && (
                        <div
                            className="llm-chat-context-indicator"
                            title={`${formatTokenCount(chat.lastPromptTokens)} / ${formatTokenCount(contextWindow)} ${t("llm_chat.tokens")}`}
                        >
                            <div
                                className="llm-chat-context-pie"
                                style={{
                                    background: `conic-gradient(${pieColor} ${percentage}%, var(--accented-background-color) ${percentage}%)`
                                }}
                            />
                            <span className="llm-chat-context-text">{t("llm_chat.context_used", { percentage: percentage.toFixed(0) })}</span>
                        </div>
                    )}
                </div>
                <ActionButton
                    icon="bx bx-paperclip"
                    text={t("llm_chat.attach_file")}
                    onClick={attachments.openFilePicker}
                    disabled={chat.isStreaming || !chat.chatNoteId}
                    className="llm-chat-attach-btn"
                />
                <ActionButton
                    icon={chat.isStreaming ? "bx bx-stop" : "bx bx-send"}
                    text={chat.isStreaming ? t("llm_chat.stop") : t("llm_chat.send")}
                    onClick={chat.isStreaming ? chat.stopStreaming : handleSubmit}
                    disabled={!chat.isStreaming && !chat.input.trim() && chat.pendingAttachments.length === 0}
                    className={`llm-chat-send-btn ${chat.isStreaming ? "llm-chat-stop-btn" : ""}`}
                />
            </div>
        </form>
    );
}
