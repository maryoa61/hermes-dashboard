import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Square,
  RotateCcw,
  Plus,
  Trash2,
  Download,
  AlertCircle,
  Menu,
  X,
  Bot,
  User,
  Zap,
} from 'lucide-react';
import { ChatMessage, Conversation, HermesServerProfile, ToolProgressItem } from '../types/hermes';
import {
  idbDeleteConversation,
  idbGetConversations,
  idbSaveConversation,
  loadActiveConversationId,
  loadDraft,
  saveActiveConversationId,
  saveDraft,
} from '../utils/storage';
import { streamChatCompletions } from '../utils/hermesClient';
import { releaseScreenWakeLock, requestScreenWakeLock } from '../utils/wakeLock';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { ToolProgressBadge } from '../components/ToolProgressBadge';
import { ThinkingBlock } from '../components/ThinkingBlock';
import { translations } from '../i18n/translations';

interface ChatViewProps {
  profile: HermesServerProfile | null;
  systemPromptLayer?: string;
  language: 'en' | 'fa';
  onNavigateSettings: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  profile,
  systemPromptLayer,
  language,
  onNavigateSettings,
}) => {
  const t = translations[language];

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(() => loadActiveConversationId());
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolProgress, setActiveToolProgress] = useState<ToolProgressItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load conversations from IndexedDB
  const refreshConversations = async () => {
    const list = await idbGetConversations();
    setConversations(list);
    if (list.length === 0) {
      createNewConversation();
    } else if (!activeConvId || !list.some((c) => c.id === activeConvId)) {
      const firstId = list[0].id;
      setActiveConvId(firstId);
      saveActiveConversationId(firstId);
    }
  };

  useEffect(() => {
    refreshConversations();
  }, []);

  const currentConversation = conversations.find((c) => c.id === activeConvId);

  // Load draft when conversation changes
  useEffect(() => {
    if (activeConvId) {
      const savedDraft = loadDraft(activeConvId);
      setInputText(savedDraft);
    }
  }, [activeConvId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages.length, isStreaming, activeToolProgress.length]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (activeConvId) {
      saveDraft(activeConvId, val);
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  };

  const createNewConversation = async () => {
    const newConv: Conversation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `${t.newChat} ${conversations.length + 1}`,
      profileId: profile?.id || 'default',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await idbSaveConversation(newConv);
    const updated = [newConv, ...conversations];
    setConversations(updated);
    setActiveConvId(newConv.id);
    saveActiveConversationId(newConv.id);
    setInputText('');
    setSidebarOpen(false);
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(t.deleteChatConfirm)) return;
    await idbDeleteConversation(convId);
    const remaining = conversations.filter((c) => c.id !== convId);
    setConversations(remaining);
    if (activeConvId === convId) {
      const nextId = remaining.length > 0 ? remaining[0].id : null;
      setActiveConvId(nextId);
      saveActiveConversationId(nextId);
    }
  };

  const exportConversation = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    const jsonStr = JSON.stringify(conv, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hermes-chat-${conv.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleSendMessage = async (overridePrompt?: string) => {
    if (!profile) {
      onNavigateSettings();
      return;
    }

    const messageText = (overridePrompt ?? inputText).trim();
    if (!messageText || isStreaming || !currentConversation) return;

    // Reset draft
    setInputText('');
    if (activeConvId) saveDraft(activeConvId, '');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Append user message
    const userMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
    };

    // Placeholder assistant message
    const assistantMessageId = `${Date.now() + 1}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      reasoning: '',
      timestamp: Date.now(),
      toolProgress: [],
    };

    let newTitle = currentConversation.title;
    if (currentConversation.messages.length === 0) {
      newTitle = messageText.slice(0, 30);
    }

    const updatedMessages = [...currentConversation.messages, userMessage, assistantPlaceholder];
    const updatedConv: Conversation = {
      ...currentConversation,
      title: newTitle,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };

    const nextConversations = conversations.map((c) => (c.id === currentConversation.id ? updatedConv : c));
    setConversations(nextConversations);
    await idbSaveConversation(updatedConv);

    setIsStreaming(true);
    setActiveToolProgress([]);
    await requestScreenWakeLock();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const messagePayload = updatedMessages
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    const collectedTools: ToolProgressItem[] = [];

    try {
      const result = await streamChatCompletions({
        profile,
        messages: messagePayload,
        systemPromptLayer,
        signal: abortController.signal,
        onChunk: (_delta, fullText) => {
          setConversations((prevConvs) =>
            prevConvs.map((c) => {
              if (c.id !== currentConversation.id) return c;
              const msgs = c.messages.map((m) => {
                if (m.id === assistantMessageId) {
                  return { ...m, content: fullText };
                }
                return m;
              });
              return { ...c, messages: msgs, updatedAt: Date.now() };
            })
          );
        },
        onReasoningChunk: (_delta, fullReasoning) => {
          setConversations((prevConvs) =>
            prevConvs.map((c) => {
              if (c.id !== currentConversation.id) return c;
              const msgs = c.messages.map((m) => {
                if (m.id === assistantMessageId) {
                  return { ...m, reasoning: fullReasoning };
                }
                return m;
              });
              return { ...c, messages: msgs, updatedAt: Date.now() };
            })
          );
        },
        onToolProgress: (toolItem) => {
          collectedTools.push(toolItem);
          setActiveToolProgress([...collectedTools]);
          setConversations((prevConvs) =>
            prevConvs.map((c) => {
              if (c.id !== currentConversation.id) return c;
              const msgs = c.messages.map((m) => {
                if (m.id === assistantMessageId) {
                  return { ...m, toolProgress: [...collectedTools] };
                }
                return m;
              });
              return { ...c, messages: msgs };
            })
          );
        },
        onTokenUsage: (tokens) => {
          setConversations((prevConvs) =>
            prevConvs.map((c) => {
              if (c.id !== currentConversation.id) return c;
              const msgs = c.messages.map((m) => {
                if (m.id === assistantMessageId) {
                  return { ...m, tokens };
                }
                return m;
              });
              return { ...c, messages: msgs };
            })
          );
        },
      });

      // Finalize and save to IndexedDB
      setConversations((prevConvs) => {
        const finalized = prevConvs.map((c) => {
          if (c.id !== currentConversation.id) return c;
          const msgs = c.messages.map((m) => {
            if (m.id === assistantMessageId) {
              return {
                ...m,
                content: result.fullText || (result.interrupted ? `(${result.errorMessage || 'Interrupted'})` : m.content),
                reasoning: result.fullReasoning,
                interrupted: result.interrupted,
                toolProgress: collectedTools,
              };
            }
            return m;
          });
          const updated = { ...c, messages: msgs, updatedAt: Date.now() };
          idbSaveConversation(updated);
          return updated;
        });
        return finalized;
      });
    } catch (err) {
      console.error('Chat stream error', err);
    } finally {
      setIsStreaming(false);
      setActiveToolProgress([]);
      abortControllerRef.current = null;
      await releaseScreenWakeLock();
    }
  };

  const handleRetry = (msgIndex: number) => {
    if (!currentConversation) return;
    const priorUserMsg = currentConversation.messages
      .slice(0, msgIndex)
      .reverse()
      .find((m) => m.role === 'user');

    if (priorUserMsg) {
      const pruned = currentConversation.messages.slice(0, msgIndex);
      const updatedConv = { ...currentConversation, messages: pruned };
      const nextConversations = conversations.map((c) => (c.id === currentConversation.id ? updatedConv : c));
      setConversations(nextConversations);
      idbSaveConversation(updatedConv);

      handleSendMessage(priorUserMsg.content);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100dvh-3.5rem-3.5rem)] relative overflow-hidden bg-[#002b36]">
      {/* Top chat bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#002b36]/90 border-b border-[#073642] z-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg bg-[#073642]/60 hover:bg-[#073642] text-[#93a1a1] hover:text-[#eee8d5] transition"
            title={t.chats}
          >
            <Menu className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-[#eee8d5] truncate max-w-[180px] sm:max-w-xs">
            {currentConversation?.title || t.newChat}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={createNewConversation}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-[#2aa198] text-xs font-medium border border-[#2aa198]/30 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.newChat}</span>
          </button>
        </div>
      </div>

      {/* Slide-out Sidebar for conversations */}
      {sidebarOpen && (
        <div className="absolute inset-0 z-30 flex">
          <div className="w-72 bg-[#00222a] border-r border-[#073642] flex flex-col h-full shadow-2xl p-3">
            <div className="flex items-center justify-between pb-3 border-b border-[#073642]">
              <span className="text-xs font-bold text-[#eee8d5] uppercase tracking-wider">{t.chats}</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded text-[#93a1a1] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2 space-y-1">
              {conversations.map((c) => {
                const isSelected = c.id === activeConvId;
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setActiveConvId(c.id);
                      saveActiveConversationId(c.id);
                      setSidebarOpen(false);
                    }}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer group transition ${
                      isSelected
                        ? 'bg-[#073642] text-[#eee8d5] font-semibold border border-[#2aa198]/40'
                        : 'text-[#93a1a1] hover:bg-[#073642]/50'
                    }`}
                  >
                    <span className="truncate flex-1 mr-2">{c.title}</span>
                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        onClick={(e) => exportConversation(c, e)}
                        className="p-1 hover:text-[#2aa198]"
                        title={t.exportChat}
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => deleteConversation(c.id, e)}
                        className="p-1 hover:text-rose-400"
                        title={t.deleteChat}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={createNewConversation}
              className="w-full py-2 rounded-lg bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              <span>{t.newChat}</span>
            </button>
          </div>
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
        {!currentConversation || currentConversation.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 select-none opacity-80">
            <div className="w-14 h-14 rounded-2xl bg-[#073642] border border-[#ff7b25]/40 flex items-center justify-center text-[#ff7b25] mb-3 shadow-lg">
              <Bot className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-[#eee8d5] mb-1">{t.emptyChatTitle}</h3>
            <p className="text-xs text-[#839496] max-w-xs leading-relaxed mb-4">
              {t.emptyChatSubtitle}
            </p>
            {profile && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#073642]/60 text-[11px] font-mono text-[#2aa198] border border-[#2aa198]/20" dir="ltr">
                <Zap className="w-3 h-3 text-[#ff7b25]" />
                <span>{profile.modelName || 'hermes-agent'}</span>
              </div>
            )}
          </div>
        ) : (
          currentConversation.messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const isLastMessage = idx === currentConversation.messages.length - 1;
            return (
              <div
                key={msg.id || idx}
                className={`flex gap-2.5 sm:gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-lg bg-[#073642] border border-[#2aa198]/40 flex items-center justify-center shrink-0 text-[#2aa198] mt-1">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[88%] sm:max-w-xl rounded-2xl px-4 py-3 shadow-sm ${
                    isUser
                      ? 'bg-[#073642] text-[#eee8d5] rounded-tr-sm border border-[#2aa198]/20'
                      : 'bg-[#00222a] text-[#93a1a1] rounded-tl-sm border border-[#073642]'
                  }`}
                >
                  {/* Tool progress badge */}
                  {msg.toolProgress && msg.toolProgress.length > 0 && (
                    <ToolProgressBadge
                      progressList={msg.toolProgress}
                      isActive={isStreaming && isLastMessage}
                    />
                  )}

                  {/* Thinking Block for reasoning_content per Requirement 10 */}
                  {msg.reasoning && (
                    <ThinkingBlock
                      reasoning={msg.reasoning}
                      isStreaming={isStreaming && isLastMessage && !msg.content}
                    />
                  )}

                  {/* Message content */}
                  {msg.content ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : isStreaming && isLastMessage ? (
                    <div className="flex items-center gap-1.5 text-xs text-[#ff7b25] py-1 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-[#ff7b25]" />
                      <span>Hermes is generating...</span>
                    </div>
                  ) : null}

                  {/* Interrupted notice and Retry button per Requirement 7 */}
                  {msg.interrupted && (
                    <div className="mt-2 pt-2 border-t border-rose-900/40 flex items-center justify-between text-xs text-rose-400">
                      <div className="flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{msg.content?.includes('no data for') ? msg.content.replace(/[()]/g, '') : t.interrupted}</span>
                      </div>
                      <button
                        onClick={() => handleRetry(idx)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#073642] hover:bg-[#0e4a57] text-[#2aa198] font-medium border border-[#2aa198]/30 transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t.retry}</span>
                      </button>
                    </div>
                  )}

                  {/* Token usage metadata */}
                  {msg.tokens && (
                    <div className="mt-2 text-[10px] text-[#586e75] font-mono flex items-center gap-2 justify-end" dir="ltr">
                      <span>{msg.tokens.total_tokens || (msg.tokens.prompt_tokens || 0) + (msg.tokens.completion_tokens || 0)} {t.tokens}</span>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-7 h-7 rounded-lg bg-[#0e4a57] border border-[#ff7b25]/40 flex items-center justify-center shrink-0 text-[#ff7b25] mt-1">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Input Area */}
      <div className="p-3 bg-[#002b36] border-t border-[#073642] shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-end gap-2 max-w-4xl mx-auto"
        >
          <div className="flex-1 relative rounded-2xl bg-[#001e26] border border-[#073642] focus-within:border-[#2aa198] transition">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              rows={1}
              placeholder={t.messagePlaceholder}
              className="w-full bg-transparent text-[#eee8d5] text-xs sm:text-sm p-3 pb-2 focus:outline-none resize-none max-h-36 leading-relaxed"
            />
            {inputText.trim() && (
              <div className="px-3 pb-1 text-[10px] text-[#586e75] flex items-center justify-between select-none">
                <span>{t.draftSaved}</span>
                <button
                  type="button"
                  onClick={() => {
                    setInputText('');
                    if (activeConvId) saveDraft(activeConvId, '');
                  }}
                  className="hover:text-rose-400 text-[#586e75]"
                >
                  {t.clearDraft}
                </button>
              </div>
            )}
          </div>

          {/* Action Button: Stop or Send */}
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg active:scale-95 transition cursor-pointer shrink-0"
              title={t.stop}
            >
              <Square className="w-4 h-4 fill-white" />
              <span className="hidden sm:inline">{t.stop}</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputText.trim() || !profile}
              className="h-11 w-11 rounded-xl bg-[#ff7b25] hover:bg-[#e06818] disabled:bg-[#073642] text-white disabled:text-[#586e75] flex items-center justify-center shadow-lg active:scale-95 transition cursor-pointer shrink-0 disabled:cursor-not-allowed"
              title={t.send}
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
