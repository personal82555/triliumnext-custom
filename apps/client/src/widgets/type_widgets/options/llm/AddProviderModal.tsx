import { createPortal } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import Modal from "../../../react/Modal";
import FormGroup from "../../../react/FormGroup";
import FormSelect from "../../../react/FormSelect";
import FormTextBox from "../../../react/FormTextBox";
import { t } from "../../../../services/i18n";

export interface LlmProviderConfig {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    baseURL?: string;
    models?: { id: string; name: string }[];
}

export interface ProviderType {
    /** Unique identifier for this preset (used as FormSelect value) */
    id: string;
    /** Human-readable display name */
    name: string;
    /** Provider factory type: which SDK to use ("openai", "anthropic", "google") */
    provider: string;
    /** Default API base URL */
    defaultBaseUrl: string;
    /** Predefined model list for this provider (shown as checkboxes) */
    defaultModels?: { id: string; name: string }[];
}

export const PROVIDER_TYPES: ProviderType[] = [
    // ==================== 云端 OpenAI 兼容 ====================
    {
        id: "openai", name: "OpenAI", provider: "openai",
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModels: [
            { id: "gpt-4o", name: "GPT-4o" },
            { id: "gpt-4o-mini", name: "GPT-4o Mini" },
            { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
            { id: "gpt-4", name: "GPT-4" },
            { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
            { id: "o1", name: "o1" },
            { id: "o1-mini", name: "o1 Mini" },
            { id: "o3-mini", name: "o3 Mini" },
        ]
    },
    {
        id: "deepseek", name: "DeepSeek", provider: "openai",
        defaultBaseUrl: "https://api.deepseek.com/v1",
        defaultModels: [
            { id: "deepseek-chat", name: "DeepSeek Chat (V3)" },
            { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
        ]
    },
    {
        id: "opencode-zen", name: "OpenCode Zen (免费)", provider: "openai",
        defaultBaseUrl: "https://opencode.ai/zen/v1",
        defaultModels: [
            // Free tier
            { id: "deepseek-v4-flash-free", name: "🆓 DeepSeek V4 Flash Free" },
            { id: "big-pickle", name: "🆓 Big Pickle" },
            { id: "nemotron-3-super-free", name: "🆓 Nemotron 3 Super Free" },
            { id: "qwen3.6-plus-free", name: "🆓 Qwen 3.6 Plus Free" },
            { id: "minimax-m2.5-free", name: "🆓 MiniMax M2.5 Free" },
            { id: "mimo-v2.5-free", name: "🆓 Mimo V2.5 Free" },
            // Claude
            { id: "claude-opus-4-8", name: "Claude Opus 4-8" },
            { id: "claude-opus-4-7", name: "Claude Opus 4-7" },
            { id: "claude-opus-4-6", name: "Claude Opus 4-6" },
            { id: "claude-opus-4-5", name: "Claude Opus 4-5" },
            { id: "claude-opus-4-1", name: "Claude Opus 4-1" },
            { id: "claude-sonnet-4-6", name: "Claude Sonnet 4-6" },
            { id: "claude-sonnet-4-5", name: "Claude Sonnet 4-5" },
            { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
            { id: "claude-haiku-4-5", name: "Claude Haiku 4-5" },
            // Gemini
            { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
            { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
            { id: "gemini-3-flash", name: "Gemini 3 Flash" },
            // GPT
            { id: "gpt-5.5", name: "GPT 5.5" },
            { id: "gpt-5.5-pro", name: "GPT 5.5 Pro" },
            { id: "gpt-5.4", name: "GPT 5.4" },
            { id: "gpt-5.4-pro", name: "GPT 5.4 Pro" },
            { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
            { id: "gpt-5.4-nano", name: "GPT 5.4 Nano" },
            { id: "gpt-5.3-codex-spark", name: "GPT 5.3 Codex Spark" },
            { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
            { id: "gpt-5.2", name: "GPT 5.2" },
            { id: "gpt-5.2-codex", name: "GPT 5.2 Codex" },
            { id: "gpt-5.1", name: "GPT 5.1" },
            { id: "gpt-5.1-codex-max", name: "GPT 5.1 Codex Max" },
            { id: "gpt-5.1-codex", name: "GPT 5.1 Codex" },
            { id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini" },
            { id: "gpt-5", name: "GPT 5" },
            { id: "gpt-5-codex", name: "GPT 5 Codex" },
            { id: "gpt-5-nano", name: "GPT 5 Nano" },
            // Other
            { id: "grok-build-0.1", name: "Grok Build 0.1" },
            { id: "glm-5.1", name: "GLM 5.1" },
            { id: "glm-5", name: "GLM 5" },
            { id: "minimax-m2.7", name: "MiniMax M2.7" },
            { id: "minimax-m2.5", name: "MiniMax M2.5" },
            { id: "kimi-k2.6", name: "Kimi K2.6" },
            { id: "kimi-k2.5", name: "Kimi K2.5" },
            { id: "qwen3.6-plus", name: "Qwen 3.6 Plus" },
            { id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
        ]
    },
    {
        id: "opencode-go", name: "OpenCode Go (付费)", provider: "openai",
        defaultBaseUrl: "https://opencode.ai/zen/go/v1",
        defaultModels: [
            { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
            { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
            { id: "qwen3.7-max", name: "Qwen 3.7 Max" },
            { id: "qwen3.6-plus", name: "Qwen 3.6 Plus" },
            { id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
            { id: "kimi-k2.6", name: "Kimi K2.6" },
            { id: "kimi-k2.5", name: "Kimi K2.5" },
            { id: "glm-5.1", name: "GLM 5.1" },
            { id: "glm-5", name: "GLM 5" },
            { id: "minimax-m2.7", name: "MiniMax M2.7" },
            { id: "minimax-m2.5", name: "MiniMax M2.5" },
            { id: "mimo-v2.5-pro", name: "Mimo V2.5 Pro" },
            { id: "mimo-v2.5", name: "Mimo V2.5" },
            { id: "mimo-v2-pro", name: "Mimo V2 Pro" },
            { id: "mimo-v2-omni", name: "Mimo V2 Omni" },
            { id: "hy3-preview", name: "HY3 Preview" },
        ]
    },
    {
        id: "openrouter", name: "OpenRouter", provider: "openai",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
        defaultModels: [
            { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
            { id: "openai/gpt-4o", name: "GPT-4o" },
            { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
            { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
            { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
        ]
    },
    {
        id: "groq", name: "Groq", provider: "openai",
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        defaultModels: [
            { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
            { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
            { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
            { id: "gemma2-9b-it", name: "Gemma 2 9B" },
            { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B" },
        ]
    },
    {
        id: "together", name: "Together AI", provider: "openai",
        defaultBaseUrl: "https://api.together.xyz/v1",
        defaultModels: [
            { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo" },
            { id: "mistralai/Mixtral-8x22B-Instruct-v0.1", name: "Mixtral 8x22B" },
            { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
        ]
    },
    {
        id: "mistral", name: "Mistral AI", provider: "openai",
        defaultBaseUrl: "https://api.mistral.ai/v1",
        defaultModels: [
            { id: "mistral-large-latest", name: "Mistral Large (Latest)" },
            { id: "mistral-small-latest", name: "Mistral Small (Latest)" },
            { id: "open-mistral-nemo", name: "Mistral Nemo" },
            { id: "codestral-latest", name: "Codestral" },
        ]
    },
    {
        id: "perplexity", name: "Perplexity", provider: "openai",
        defaultBaseUrl: "https://api.perplexity.ai",
        defaultModels: [
            { id: "sonar-pro", name: "Sonar Pro" },
            { id: "sonar", name: "Sonar" },
            { id: "sonar-deep-research", name: "Sonar Deep Research" },
        ]
    },
    {
        id: "xai", name: "xAI (Grok)", provider: "openai",
        defaultBaseUrl: "https://api.x.ai/v1",
        defaultModels: [
            { id: "grok-2", name: "Grok 2" },
            { id: "grok-2-vision", name: "Grok 2 Vision" },
            { id: "grok-beta", name: "Grok Beta" },
        ]
    },
    {
        id: "fireworks", name: "Fireworks AI", provider: "openai",
        defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
        defaultModels: [
            { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B" },
            { id: "accounts/fireworks/models/deepseek-r1", name: "DeepSeek R1" },
            { id: "accounts/fireworks/models/qwen3-72b", name: "Qwen 3 72B" },
        ]
    },
    {
        id: "cohere", name: "Cohere", provider: "openai",
        defaultBaseUrl: "https://api.cohere.ai/v1",
        defaultModels: [
            { id: "command-r-plus", name: "Command R+" },
            { id: "command-r", name: "Command R" },
            { id: "command-a", name: "Command A" },
        ]
    },

    // ==================== 本地 / 自建 ====================
    { id: "ollama", name: "Ollama (本地)", provider: "openai", defaultBaseUrl: "http://localhost:11434/v1" },
    { id: "vllm", name: "vLLM (自建)", provider: "openai", defaultBaseUrl: "http://localhost:8000/v1" },
    { id: "custom-openai", name: "自定义 OpenAI 兼容", provider: "openai", defaultBaseUrl: "" },

    // ==================== 原生 SDK（非 OpenAI 兼容） ====================
    {
        id: "anthropic", name: "Anthropic", provider: "anthropic",
        defaultBaseUrl: "https://api.anthropic.com/v1",
        defaultModels: [
            { id: "claude-opus-4", name: "Claude Opus 4" },
            { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
            { id: "claude-haiku-3-5", name: "Claude Haiku 3.5" },
            { id: "claude-3-5-haiku", name: "Claude 3.5 Haiku" },
        ]
    },
    {
        id: "google", name: "Google Gemini", provider: "google",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        defaultModels: [
            { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
            { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro" },
            { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
        ]
    },
];

function isValidBaseUrl(value: string): boolean {
    if (!value) {
        return true;
    }
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

interface AddProviderModalProps {
    show: boolean;
    onHidden: () => void;
    onSave: (provider: LlmProviderConfig) => void;
}

export default function AddProviderModal({ show, onHidden, onSave }: AddProviderModalProps) {
    const [selectedProvider, setSelectedProvider] = useState(PROVIDER_TYPES[0].id);
    const [name, setName] = useState(PROVIDER_TYPES[0].name);
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [customModels, setCustomModels] = useState("");
    const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
    const [modelSearch, setModelSearch] = useState("");
    const formRef = useRef<HTMLFormElement>(null);

    const providerType = useMemo(
        () => PROVIDER_TYPES.find(p => p.id === selectedProvider),
        [selectedProvider]
    );

    // Reset name, model selections, and base URL when provider type changes
    useEffect(() => {
        if (providerType) {
            setName(providerType.name);
            setBaseUrl("");
            setCustomModels("");
            setModelSearch("");
            if (providerType.defaultModels?.length) {
                setSelectedModelIds(new Set(providerType.defaultModels.map(m => m.id)));
            } else {
                setSelectedModelIds(new Set());
            }
        }
    }, [providerType]);

    const trimmedBaseUrl = baseUrl.trim();
    const baseUrlIsValid = isValidBaseUrl(trimmedBaseUrl);
    const canSubmit = baseUrlIsValid;

    function parseCustomModels(text: string): { id: string; name: string }[] {
        return text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith("#"))
            .map(line => {
                const parts = line.split("|").map(s => s.trim());
                if (parts.length >= 2) {
                    return { id: parts[0], name: parts[1] };
                }
                return { id: parts[0], name: parts[0] };
            });
    }

    const hasDefaultModels = !!providerType?.defaultModels?.length;

    const filteredModels = useMemo(() => {
        if (!providerType?.defaultModels?.length) return [];
        const q = modelSearch.toLowerCase().trim();
        if (!q) return providerType.defaultModels;
        return providerType.defaultModels.filter(m =>
            m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        );
    }, [providerType, modelSearch]);

    function toggleModel(modelId: string) {
        setSelectedModelIds(prev => {
            const next = new Set(prev);
            if (next.has(modelId)) {
                next.delete(modelId);
            } else {
                next.add(modelId);
            }
            return next;
        });
    }

    function selectAllModels() {
        if (providerType?.defaultModels) {
            setSelectedModelIds(new Set(providerType.defaultModels.map(m => m.id)));
        }
    }

    function deselectAllModels() {
        setSelectedModelIds(new Set());
    }

    function handleSubmit() {
        if (!canSubmit) {
            return;
        }

        let allModels: { id: string; name: string }[] = [];

        if (hasDefaultModels) {
            // Collect checked models from the checkbox list
            for (const m of providerType!.defaultModels!) {
                if (selectedModelIds.has(m.id)) {
                    allModels.push({ id: m.id, name: m.name });
                }
            }
            // Also parse custom models from textarea if present
            if (customModels.trim()) {
                const parsed = parseCustomModels(customModels);
                for (const m of parsed) {
                    if (!allModels.find(e => e.id === m.id)) {
                        allModels.push(m);
                    }
                }
            }
        } else {
            // No default models: parse from textarea only
            const parsed = parseCustomModels(customModels);
            allModels = parsed;
        }

        const newProvider: LlmProviderConfig = {
            id: `${providerType?.provider || selectedProvider}_${Date.now()}`,
            name: name.trim() || providerType?.name || selectedProvider,
            provider: providerType?.provider || selectedProvider,
            apiKey: apiKey.trim(),
            ...(trimmedBaseUrl && { baseURL: trimmedBaseUrl }),
            ...(allModels.length > 0 && { models: allModels })
        };

        onSave(newProvider);
        resetForm();
        onHidden();
    }

    function resetForm() {
        setSelectedProvider(PROVIDER_TYPES[0].id);
        setName(PROVIDER_TYPES[0].name);
        setApiKey("");
        setBaseUrl("");
        setCustomModels("");
        setModelSearch("");
        if (PROVIDER_TYPES[0].defaultModels?.length) {
            setSelectedModelIds(new Set(PROVIDER_TYPES[0].defaultModels.map(m => m.id)));
        } else {
            setSelectedModelIds(new Set());
        }
    }

    function handleCancel() {
        resetForm();
        onHidden();
    }

    return createPortal(
        <Modal
            show={show}
            onHidden={handleCancel}
            onSubmit={handleSubmit}
            formRef={formRef}
            title={t("llm.add_provider_title")}
            className="add-provider-modal"
            size="lg"
            footer={
                <>
                    <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        {t("llm.cancel")}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                        {t("llm.add_provider")}
                    </button>
                </>
            }
        >
            <FormGroup name="provider-type" label={t("llm.provider_type")}>
                <FormSelect
                    values={PROVIDER_TYPES}
                    keyProperty="id"
                    titleProperty="name"
                    currentValue={selectedProvider}
                    onChange={setSelectedProvider}
                />
            </FormGroup>

            <FormGroup name="provider-name" label="名称">
                <FormTextBox
                    type="text"
                    currentValue={name}
                    onChange={setName}
                    placeholder={providerType?.name || selectedProvider}
                />
            </FormGroup>

            <FormGroup
                name="base-url"
                label={t("llm.base_url")}
                description={
                    !baseUrlIsValid
                        ? <span className="text-danger">{t("llm.base_url_invalid")}</span>
                        : t("llm.base_url_description")
                }
            >
                <FormTextBox
                    type="text"
                    currentValue={baseUrl}
                    onChange={setBaseUrl}
                    placeholder={providerType?.defaultBaseUrl || "https://"}
                />
            </FormGroup>

            <FormGroup name="api-key" label={t("llm.api_key")}>
                <FormTextBox
                    type="password"
                    currentValue={apiKey}
                    onChange={setApiKey}
                    placeholder={t("llm.api_key_placeholder")}
                    autoFocus
                />
            </FormGroup>

            <FormGroup
                name="model-selection"
                label="模型选择"
                description={hasDefaultModels ? "勾选需要使用的模型。支持搜索、全选/取消全选。🆓 = 免费模型" : "请手动添加模型，每行一个，格式：模型ID | 显示名称"}
            >
                {hasDefaultModels ? (
                    <div className="model-selector">
                        {/* Toolbar: Select All / Deselect All / Search */}
                        <div style={{ display: "flex", gap: "6px", marginBottom: "8px", alignItems: "center", flexWrap: "wrap" }}>
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={selectAllModels} style={{ fontSize: "12px", padding: "2px 10px" }}>
                                全选
                            </button>
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={deselectAllModels} style={{ fontSize: "12px", padding: "2px 10px" }}>
                                取消全选
                            </button>
                            <span style={{ fontSize: "12px", color: "#888" }}>
                                已选 {selectedModelIds.size} / {providerType?.defaultModels?.length || 0}
                            </span>
                            <input
                                type="text"
                                className="form-control"
                                placeholder="搜索模型名称或 ID..."
                                value={modelSearch}
                                onInput={e => setModelSearch((e.target as HTMLInputElement).value)}
                                style={{ marginLeft: "auto", maxWidth: "220px", fontSize: "13px", height: "30px" }}
                            />
                        </div>

                        {/* Scrollable model checkbox list */}
                        <div
                            className="model-checkbox-list"
                            style={{
                                maxHeight: "320px",
                                overflowY: "auto",
                                border: "1px solid #d0d0d0",
                                borderRadius: "6px",
                                padding: "4px",
                                background: "#fafafa"
                            }}
                        >
                            {filteredModels.length > 0 ? (
                                filteredModels.map(model => (
                                    <label
                                        key={model.id}
                                        className="form-check model-checkbox-row"
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "6px 10px",
                                            margin: 0,
                                            cursor: "pointer",
                                            borderRadius: "4px",
                                            transition: "background 0.15s",
                                            borderBottom: "1px solid #eee"
                                        }}
                                        onMouseOver={e => (e.currentTarget.style.background = "#f0f0f0")}
                                        onMouseOut={e => (e.currentTarget.style.background = "transparent")}
                                    >
                                        <input
                                            type="checkbox"
                                            className="form-check-input"
                                            checked={selectedModelIds.has(model.id)}
                                            onChange={() => toggleModel(model.id)}
                                            style={{ marginTop: 0 }}
                                        />
                                        <span className="form-check-label" style={{ fontWeight: 500, fontSize: "13px" }}>
                                            {model.name}
                                        </span>
                                        <code style={{ marginLeft: "auto", fontSize: "11px", color: "#999", userSelect: "none" }}>
                                            {model.id}
                                        </code>
                                    </label>
                                ))
                            ) : (
                                <div style={{ padding: "24px 16px", textAlign: "center", color: "#aaa", fontSize: "13px" }}>
                                    {modelSearch.trim() ? "没有匹配的模型" : "暂无可用模型"}
                                </div>
                            )}
                        </div>

                        {/* Optional: custom models textarea for additions */}
                        <details style={{ marginTop: "10px" }}>
                            <summary style={{ fontSize: "12px", color: "#888", cursor: "pointer" }}>
                                添加自定义模型（可选）
                            </summary>
                            <textarea
                                className="form-control"
                                value={customModels}
                                onInput={e => setCustomModels((e.target as HTMLTextAreaElement).value)}
                                placeholder="deepseek-chat | DeepSeek Chat&#10;deepseek-reasoner | DeepSeek Reasoner&#10;# 以 # 开头的行会被忽略"
                                rows={3}
                                style={{ marginTop: "6px", fontFamily: "monospace", fontSize: "12px" }}
                            />
                        </details>
                    </div>
                ) : (
                    /* For providers without default models: show textarea */
                    <textarea
                        className="form-control"
                        value={customModels}
                        onInput={e => setCustomModels((e.target as HTMLTextAreaElement).value)}
                        placeholder="deepseek-chat | DeepSeek Chat&#10;deepseek-reasoner | DeepSeek Reasoner&#10;# 以 # 开头的行会被忽略"
                        rows={5}
                        style={{ fontFamily: "monospace", fontSize: "13px" }}
                    />
                )}
            </FormGroup>
        </Modal>,
        document.body
    );
}
