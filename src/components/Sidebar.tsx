"use client"

import React, { useState, useMemo } from 'react';
import { deleteChat, deleteAllChats, loadChatsFromStorage, type ChatMessage, type ChatRecord } from '@/lib/chatStorage';
import { translateText } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

interface SidebarProps {
  // kept optional for backward compatibility with parent props
  currentMessages?: ChatMessage[];
  onNewChat: () => void;
  onSelectChat: (messages: ChatMessage[]) => void;
  onSaveChat?: () => void;
  // translations provided via LanguageContext
}

const formatDateGroup = (date: Date): 'today' | 'yesterday' | 'previous7days' | 'older' => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date.toDateString() === now.toDateString()) {
    return 'today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'yesterday';
  } else if (date > weekAgo) {
    return 'previous7days';
  } else {
    return 'older';
  }
};

export const Sidebar: React.FC<SidebarProps> = ({
  onNewChat,
  onSelectChat
}) => {
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = useState(true);
  // Start empty on first render to avoid SSR/client hydration mismatches
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState<string>('');
  const [showChatsDropdown, setShowChatsDropdown] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Listen for updates from other parts of the app and reload chats
  // Load chats after mount and subscribe to update events to avoid
  // hydration mismatches between server and client renders.
  React.useEffect(() => {
    let mounted = true;

    const load = () => {
      try {
        const fresh = loadChatsFromStorage();
        if (mounted) setChats(fresh);
      } catch (e) {
        console.warn('Failed to load chats from storage', e);
      }
    };

    const onUpdated = () => load();

    // initial load
    if (typeof window !== 'undefined') load();

    // subscribe
    if (typeof window !== 'undefined') {
      window.addEventListener('aerosense:chats-updated', onUpdated as EventListener);
    }

    return () => {
      mounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('aerosense:chats-updated', onUpdated as EventListener);
      }
    };
  }, []);

  // Observe `language` prop so the component updates when language changes
  React.useEffect(() => {
    // When UI language changes, reload chats from storage so titles/snippets
    // and any language-specific fields refresh immediately. Also lazily
    // translate first-user messages for display if translations are missing.
    let mounted = true;
    (async () => {
      try {
        const fresh = loadChatsFromStorage();
        if (!mounted) return;
        setChats(fresh);

        // Build list of messages to translate (first user message per chat)
        const toTranslate: { chatId: string; msgId: string; text: string }[] = [];
        for (const chat of fresh) {
          const firstUser = chat.messages.find(m => m.type === 'user');
          if (firstUser && !(firstUser.translations && firstUser.translations[language])) {
            // only queue non-empty texts
            if (firstUser.original && firstUser.original.trim()) {
              toTranslate.push({ chatId: chat.id, msgId: firstUser.id, text: firstUser.original });
            }
          }
        }

        // Translate sequentially to avoid excessive parallel API calls
        for (const item of toTranslate) {
          if (!mounted) break;
          try {
            const translated = await translateText(item.text, language);
            if (!mounted) break;
            // update in-memory chats and persist translations back to storage
            setChats(prev => {
              const updated = prev.map(c => {
                if (c.id !== item.chatId) return c;
                const messages = c.messages.map(m => m.id === item.msgId ? { ...m, translations: { ...(m.translations || {}), [language]: translated } } : m);
                return { ...c, messages, updatedAt: new Date() };
              });
              try { localStorage.setItem('aerosense_chats_v1', JSON.stringify(updated)); } catch {}
              return updated;
            });
          } catch (err) {
            console.warn('Failed to translate chat title/snippet for UI', err);
          }
        }
      } catch (e) {
        // ignore
      }
    })();

    return () => { mounted = false; };
  }, [language]);

  // Group chats by date
  const groupedChats = useMemo(() => {
    let filtered = chats;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = chats.filter(
        chat =>
          chat.title.toLowerCase().includes(query) ||
          chat.messages.some(msg => msg.original.toLowerCase().includes(query))
      );
    }

    const groups: Record<string, ChatRecord[]> = {};
    filtered.forEach(chat => {
      const groupKey = formatDateGroup(new Date(chat.updatedAt));
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(chat);
    });

    // Sort by date, most recent first
    const groupOrder = ['today', 'yesterday', 'previous7days', 'older'];
    const sorted: Record<string, ChatRecord[]> = {};
    groupOrder.forEach(g => {
      if (groups[g]) sorted[g] = groups[g].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });

    return sorted;
  }, [chats, searchQuery]);

  const getDisplayTitle = (chat: ChatRecord) => {
    // Prefer stored title when present
    if (chat.title && chat.title.trim()) return chat.title;
    // Fallback to first user message translation for current language
    const firstUser = chat.messages.find(m => m.type === 'user');
    if (firstUser) {
      const translated = firstUser.translations?.[language];
      const text = translated ?? firstUser.original ?? '';
      return text.length > 50 ? text.slice(0, 50) + '...' : text || t('untitledChat');
    }
    const firstAssistant = chat.messages.find(m => m.type === 'assistant');
    if (firstAssistant) {
      const translated = firstAssistant.translations?.[language];
      const text = translated ?? firstAssistant.original ?? '';
      return text.length > 50 ? text.slice(0, 50) + '...' : text || t('untitledChat');
    }
    return t('untitledChat');
  };

  const handleSelectChat = (chat: ChatRecord) => {
    onSelectChat(chat.messages);
    if (window.innerWidth < 1024) {
      setIsOpen(false);
    }
  };

  const handleDeleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteChat(chatId);
    setChats(updated);
  };

  const handleDeleteAll = () => {
    if (window.confirm(t('deleteAllConfirm'))) {
      deleteAllChats();
      setChats([]);
    }
  };

  const handleRenameStart = (chat: ChatRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingChatId(chat.id);
    setRenameText(chat.title);
  };

  const handleRenameSave = (chatId: string) => {
    if (renameText.trim()) {
      const updated = chats.map(chat =>
        chat.id === chatId
          ? { ...chat, title: renameText.trim(), updatedAt: new Date() }
          : chat
      );
      setChats(updated);
      if (typeof window !== 'undefined') {
        localStorage.setItem('aerosense_chats_v1', JSON.stringify(updated));
      }
    }
    setRenamingChatId(null);
    setRenameText('');
  };

  const handleRenameCancel = () => {
    setRenamingChatId(null);
    setRenameText('');
  };

  return (
    <>
      {/* Mobile Hamburger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed left-3 top-3 z-50 lg:hidden p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg transition-all duration-200"
        aria-label={t('showSidebarTooltip')}
        title={t('showSidebarTooltip')}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden bg-black/60 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 z-40 h-screen bg-white dark:bg-[#0b1220] border-r border-gray-200 dark:border-[#243044] flex flex-col shadow-xl transition-all duration-300 lg:shadow-lg sidebar-mobile ${
          isOpen 
            ? 'w-72 sm:w-80 translate-x-0' 
            : 'w-72 sm:w-80 -translate-x-full lg:w-20 lg:translate-x-0'
        }`}
      >
        {/* Close Mobile Button */}
        <button
          onClick={() => setIsOpen(false)}
          className="lg:hidden absolute top-3 right-3 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-[#1a2332] transition-colors duration-200"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Expand Button (Desktop) */}
        {!isOpen && (
          <button
            onClick={() => setIsOpen(true)}
            className="hidden lg:flex absolute top-4 left-1/2 -translate-x-1/2 p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a2332] rounded-lg transition-colors duration-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Top Menu (Hidden when collapsed on desktop) */}
        {isOpen && (
          <div className="p-3 sm:p-4 space-y-3 border-b border-gray-200 dark:border-[#243044]">
            {/* Logo/Brand */}
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h1 className="text-lg font-bold text-indigo-700 dark:text-indigo-400">AeroSense 🌤️</h1>
              <button
                onClick={() => setIsOpen(false)}
                className="hidden lg:flex p-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a2332] rounded transition-colors duration-200"
                title={t('collapse')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
            </div>

            {/* New Chat Button */}
            <button
              onClick={() => {
                onNewChat();
                setSearchQuery('');
              }}
              className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('newChat')}
            </button>

            {/* Search Bar */}
            <div className="relative">
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder={t('searchChats')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-[#1a2332] text-gray-900 dark:text-white placeholder-gray-500 text-sm focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
        )}



        {/* Chats Dropdown Section */}
        {isOpen && (
          <div className="flex-1 overflow-y-auto">
            {/* Chats Header */}
            <button
              onClick={() => setShowChatsDropdown(!showChatsDropdown)}
              className="w-full px-4 py-2 flex items-center justify-between text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a2332] transition text-sm font-semibold"
            >
              <span>{t('chats')}</span>
              <svg
                className={`w-4 h-4 transition-transform ${showChatsDropdown ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>

            {/* Chat List */}
            {showChatsDropdown && (
              <div className="px-2 py-1 space-y-1">
                {Object.keys(groupedChats).length === 0 ? (
                  <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 text-center">
                    {t('noChatYet')}
                  </div>
                ) : (
                  Object.entries(groupedChats).map(([group, groupChats]) => (
                    <div key={group}>
                      {/* Group Label */}
                      <div className="px-4 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        {t(group)}
                      </div>

                      {/* Group Chats */}
                      <div className="space-y-1">
                        {groupChats.map(chat => (
                          <div key={chat.id}>
                            {renamingChatId === chat.id ? (
                              // Rename Mode
                              <div className="mx-2 px-2 py-1.5 rounded bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-300 dark:border-indigo-700 flex items-center gap-1">
                                <input
                                  type="text"
                                  value={renameText}
                                  onChange={(e) => setRenameText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameSave(chat.id);
                                    if (e.key === 'Escape') handleRenameCancel();
                                  }}
                                  className="flex-1 px-2 py-0.5 text-xs bg-white dark:bg-[#0b1220] text-gray-900 dark:text-white border border-indigo-300 dark:border-indigo-700 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleRenameSave(chat.id)}
                                  className="p-0.5 text-green-600 dark:text-green-400 hover:text-green-700"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </button>
                                <button
                                  onClick={handleRenameCancel}
                                  className="p-0.5 text-gray-400 dark:text-gray-500 hover:text-gray-600"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              // Chat Item
                              <div
                                onClick={() => handleSelectChat(chat)}
                                className="mx-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-[#1a2332] hover:bg-gray-200 dark:hover:bg-[#243044] cursor-pointer transition flex items-center justify-between group"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{getDisplayTitle(chat)}</p>
                                </div>

                                {/* 3-Dot Menu Button (visible and theme-aware) */}
                                <div className="ml-2 relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(openMenuId === chat.id ? null : chat.id);
                                    }}
                                    aria-haspopup="menu"
                                    aria-expanded={openMenuId === chat.id}
                                    aria-label={t('viewSavedChatsTooltip')}
                                    className="p-1 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#243044] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                                  >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="5" r="1.5" />
                                      <circle cx="12" cy="12" r="1.5" />
                                      <circle cx="12" cy="19" r="1.5" />
                                    </svg>
                                  </button>

                                  {/* Dropdown Menu (Rename / Delete only) */}
                                    {openMenuId === chat.id && (
                                    <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-[#0b1220] border border-gray-200 dark:border-[#243044] rounded-lg shadow-lg z-50 overflow-hidden backdrop-blur-none isolate mix-blend-normal bg-opacity-100 dark:bg-opacity-100">
                                      <button
                                        onClick={(e) => {
                                          handleRenameStart(chat, e);
                                          setOpenMenuId(null);
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#243044] flex items-center gap-2 border-b border-gray-200 dark:border-[#243044]"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                        {t('renameChat')}
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          handleDeleteChat(chat.id, e);
                                          setOpenMenuId(null);
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-red-500 dark:text-white hover:bg-red-100 dark:hover:bg-red-800/30 flex items-center gap-2 font-semibold hover:text-red-700 dark:hover:text-white dark:bg-transparent"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        {t('deleteChat')}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer (Hidden when collapsed) */}
        {isOpen && chats.length > 0 && (
          <div className="p-2 border-t border-gray-700 dark:border-[#ffffff]">
            <button
              onClick={handleDeleteAll}
              className="w-full px-3 py-2 flex items-center gap-3 text-red-500 dark:text-white hover:bg-red-100 dark:hover:bg-red-800/30 rounded-lg transition text-sm font-semibold hover:text-red-700 dark:hover:text-white"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>{t('deleteAllChats')}</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
};
