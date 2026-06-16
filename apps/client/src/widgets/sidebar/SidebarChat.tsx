import "./SidebarChat.css";

import type { Dropdown as BootstrapDropdown } from "bootstrap";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context.js";
import dateNoteService, { type RecentLlmChat } from "../../services/date_notes.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import { formatDateTime } from "../../utils/formatters";
import ActionButton from "../react/ActionButton.js";
import Dropdown from "../react/Dropdown.js";
import { FormDropdownDivider, FormListItem } from "../react/FormList.js";
import { useActiveNoteContext, useNote, useNoteProperty, useSpacedUpdate } from "../react/hooks.js";
import ChatInputBar from "../type_widgets/llm_chat/ChatInputBar.js";
import ChatMessageList from "../type_widgets/llm_chat/ChatMessageList.js";
import type { LlmChatContent } from "../type_widgets/llm_chat/llm_chat_types.js";
import { useLlmChat } from "../type_widgets/llm_chat/useLlmChat.js";
import RightPanelWidget from "./RightPanelWidget.js";

/**
 * Sidebar chat widget that appears in the right panel.
 * Uses a hidden LLM chat note for persistence across all notes.
 * The same chat persists when switching between notes.
 *
 * Unlike the LlmChat type widget which receives a valid FNote from the
 * framework, the sidebar creates notes lazily. We use useSpacedUpdate with
 * a direct server.put (using the string noteId) instead of useEditorSpacedUpdate
 * (which requires an FNote and silently no-ops when it's null).
 */
export default function SidebarChat() {
    const [chatNoteId, setChatNoteId] = useState<string | null>(null);
    const [recentChats, setRecentChats] = useState<RecentLlmChat[]>([]);
    const historyDropdownRef = useRef<BootstrapDropdown | null>(null);

    // Get the current active note context
    const { noteId: activeNoteId, note: activeNote } = useActiveNoteContext();

    // Reactively watch the chat note's title (updates via WebSocket sync after auto-rename)
    const chatNote = useNote(chatNoteId);
    const chatTitle = useNoteProperty(chatNote, "title") || t("sidebar_chat.title");

    // Refs for stable access in the spaced update callback
    const chatNoteIdRef = useRef(chatNoteId);
    chatNoteIdRef.current = chatNoteId;

    // Use shared chat hook with sidebar-specific options.
    // Use a ref for the onMessagesChange callback to avoid capture order issues
    // (the save callback is defined below, similar to how LlmChat.tsx uses spacedUpdateRef).
    const triggerSaveRef = useRef<() => void>(() => {});
    const chat = useLlmChat(
        () => triggerSaveRef.current(),
        { defaultEnableNoteTools: true, supportsExtendedThinking: true }
    );

    const chatRef = useRef(chat);
    chatRef.current = chat;

    // Save directly via server.put using the string noteId.
    // This avoids the FNote dependency that useEditorSpacedUpdate requires.
    const spacedUpdate = useSpacedUpdate(async () => {
        const noteId = chatNoteIdRef.current;
        if (!noteId) return;

        const content = chatRef.current.getContent();
        try {
            await server.put(`notes/${noteId}/data`, {
                content: JSON.stringify(content)
            });
        } catch (err) {
            console.error("Failed to save chat:", err);
        }
    });
    triggerSaveRef.current = () => spacedUpdate.scheduleUpdate();

    // Update chat context when active note changes
    useEffect(() => {
        chat.setContextNoteId(activeNoteId ?? undefined);
    }, [activeNoteId, chat.setContextNoteId]);

    // Sync chatNoteId into the hook for auto-title generation
    useEffect(() => {
        chat.setChatNoteId(chatNoteId ?? undefined);
    }, [chatNoteId, chat.setChatNoteId]);

    // Load the most recent chat on mount (runs once)
    useEffect(() => {
        let cancelled = false;

        const loadMostRecentChat = async () => {
            try {
                const existingChat = await dateNoteService.getMostRecentLlmChat();

                if (cancelled) return;

                if (existingChat) {
                    setChatNoteId(existingChat.noteId);
                    // Load content
                    try {
                        const blob = await server.get<{ content: string }>(`notes/${existingChat.noteId}/blob`);
                        if (!cancelled && blob?.content) {
                            const parsed: LlmChatContent = JSON.parse(blob.content);
                            chatRef.current.loadFromContent(parsed);
                        }
                    } catch (err) {
                        console.error("Failed to load chat content:", err);
                    }
                } else {
                    setChatNoteId(null);
                    chatRef.current.clearMessages();
                }
            } catch (err) {
                console.error("Failed to load sidebar chat:", err);
            }
        };

        loadMostRecentChat();

        return () => {
            cancelled = true;
        };
    }, []);

    // Custom submit handler that ensures chat note exists first
    const handleSubmit = useCallback(async (e: Event) => {
        e.preventDefault();
        if (!chat.input.trim() || chat.isStreaming) return;

        // Ensure chat note exists before sending (lazy creation)
        let noteId = chatNoteId;
        if (!noteId) {
            try {
                const note = await dateNoteService.getOrCreateLlmChat();
                if (note) {
                    setChatNoteId(note.noteId);
                    noteId = note.noteId;
                }
            } catch (err) {
                console.error("Failed to create sidebar chat:", err);
                return;
            }
        }

        if (!noteId) {
            console.error("Cannot send message: no chat note available");
            return;
        }

        // Ensure the hook has the chatNoteId before submitting (state update from
        // setChatNoteId above won't be visible until next render)
        chat.setChatNoteId(noteId);

        // Delegate to shared handler
        await chat.handleSubmit(e);
    }, [chatNoteId, chat]);

    const handleNewChat = useCallback(async () => {
        console.log("SidebarChat: handleNewChat called, clearing messages...");
        let newChatNoteId: string | null = null;

        // Save any pending changes before switching (best-effort, don't block the action)
        try {
            await spacedUpdate.updateNowIfNecessary();
        } catch (err) {
            console.error("Failed to save current chat before new chat:", err);
        }

        try {
            const note = await dateNoteService.createLlmChat();
            if (note) {
                newChatNoteId = note.noteId;
                console.log("SidebarChat: created new chat note:", note.noteId);
            } else {
                console.error("SidebarChat: createLlmChat returned null");
            }
        } catch (err) {
            console.error("Failed to create new chat:", err);
        }

        if (newChatNoteId) {
            setChatNoteId(newChatNoteId);
        } else {
            // If note creation failed, clear messages and set no note id
            // so the next message send will create a new chat lazily
            setChatNoteId(null);
        }
        // Always clear messages when starting a new chat (after async ops to avoid flicker)
        chatRef.current.clearMessages();
    }, [spacedUpdate, chatRef]);

    const handleSaveChat = useCallback(async () => {
        if (!chatNoteId) return;

        // Save any pending changes before moving the chat (best-effort)
        try {
            await spacedUpdate.updateNowIfNecessary();
        } catch (err) {
            console.error("Failed to save chat before save-to-permanent:", err);
        }

        try {
            await server.post("special-notes/save-llm-chat", { llmChatNoteId: chatNoteId });
            // Create a new empty chat after saving
            const note = await dateNoteService.createLlmChat();
            if (note) {
                setChatNoteId(note.noteId);
                chatRef.current.clearMessages();
            }
        } catch (err) {
            console.error("Failed to save chat to permanent location:", err);
        }
    }, [chatNoteId, spacedUpdate]);

    const loadRecentChats = useCallback(async () => {
        try {
            const chats = await dateNoteService.getRecentLlmChats(10);
            setRecentChats(chats);
        } catch (err) {
            console.error("Failed to load recent chats:", err);
        }
    }, []);

    const handleViewAllChats = useCallback(() => {
        historyDropdownRef.current?.hide();
        appContext.tabManager.openInNewTab("_llmChat", "_llmChat", true);
    }, []);

    const handleSelectChat = useCallback(async (noteId: string) => {
        console.log("SidebarChat: handleSelectChat called, noteId:", noteId);
        historyDropdownRef.current?.hide();

        if (noteId === chatNoteId) {
            console.log("SidebarChat: already on selected chat, skipping");
            return;
        }

        // Save any pending changes before switching (best-effort)
        try {
            await spacedUpdate.updateNowIfNecessary();
        } catch (err) {
            console.error("Failed to save current chat before switching:", err);
        }

        try {
            const blob = await server.get<{ content: string }>(`notes/${noteId}/blob`);
            if (blob?.content) {
                const parsed: LlmChatContent = JSON.parse(blob.content);
                console.log("SidebarChat: loaded chat content, messages:", parsed.messages?.length ?? 0);
                setChatNoteId(noteId);
                chatRef.current.loadFromContent(parsed);
                console.log("SidebarChat: state updated for chat switch");
            } else {
                console.error("Failed to load selected chat: no content in blob");
            }
        } catch (err) {
            console.error("Failed to load selected chat:", err);
        }
    }, [chatNoteId, spacedUpdate, chatRef]);

    return (
        <RightPanelWidget
            id="sidebar-chat"
            title={chatTitle}
            grow
            buttons={
                <>
                    <ActionButton
                        icon="bx bx-plus"
                        text={t("sidebar_chat.new_chat")}
                        onClick={handleNewChat}
                    />
                    <Dropdown
                        text=""
                        buttonClassName="bx bx-history"
                        title={t("sidebar_chat.history")}
                        iconAction
                        hideToggleArrow
                        dropdownContainerClassName="tn-dropdown-menu-scrollable"
                        dropdownOptions={{ popperConfig: { strategy: "fixed" } }}
                        dropdownRef={historyDropdownRef}
                        onShown={loadRecentChats}
                    >
                        {recentChats.length === 0 ? (
                            <FormListItem disabled>
                                {t("sidebar_chat.no_chats")}
                            </FormListItem>
                        ) : (
                            recentChats.map(chatItem => (
                                <FormListItem
                                    key={chatItem.noteId}
                                    icon="bx bx-message-square-dots"
                                    className={chatItem.noteId === chatNoteId ? "active" : ""}
                                    onClick={() => handleSelectChat(chatItem.noteId)}
                                >
                                    <div className="sidebar-chat-history-item-content">
                                        {chatItem.noteId === chatNoteId
                                            ? <strong>{chatItem.title}</strong>
                                            : <span>{chatItem.title}</span>}
                                        <span className="sidebar-chat-history-date">
                                            {formatDateTime(new Date(chatItem.dateModified), "short", "short")}
                                        </span>
                                    </div>
                                </FormListItem>
                            ))
                        )}
                        <FormDropdownDivider />
                        <FormListItem
                            icon="bx bx-folder-open"
                            onClick={handleViewAllChats}
                        >
                            {t("sidebar_chat.view_all_chats")}
                        </FormListItem>
                    </Dropdown>
                    <ActionButton
                        icon="bx bx-save"
                        text={t("sidebar_chat.save_chat")}
                        onClick={handleSaveChat}
                        disabled={chat.messages.length === 0}
                    />
                </>
            }
        >
            <div className="sidebar-chat-container">
                <ChatMessageList
                    chat={chat}
                    className="sidebar-chat-messages"
                    emptyStateText={t("sidebar_chat.empty_state")}
                />
                <ChatInputBar
                    chat={chat}
                    activeNoteId={activeNoteId ?? undefined}
                    activeNoteTitle={activeNote?.title}
                    onSubmit={handleSubmit}
                />
            </div>
        </RightPanelWidget>
    );
}
