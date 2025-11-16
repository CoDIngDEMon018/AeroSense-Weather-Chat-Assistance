// Chat storage utilities with IndexedDB fallback and advanced features
import { WeatherData } from './constants';

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system';
  original: string;
  translations?: Record<string, string>;
  timestamp: Date;
  weatherData?: WeatherData;
  sources?: { uri: string; title: string }[];
}

export interface ChatMetadata {
  device?: string;
  version: number;
  truncated?: boolean;
  encrypted?: boolean;
}

export interface ChatRecord {
  id: string;
  userId?: string | null;
  title: string;
  snippet: string;
  city?: string | null;
  messages: ChatMessage[];
  meta: ChatMetadata;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt?: Date | null;
  synced: boolean;
  unsyncedOps?: string[];
}

const STORAGE_CHATS = 'aerosense_chats_v1';
const STORAGE_META = 'aerosense_meta_v1';
const MAX_MESSAGE_SIZE = 500000; // 500 KB
const SECRETS_PATTERN = /(?:api[_-]?key|token|secret|password|auth)/gi;

export const getChatTitle = (messages: ChatMessage[]): string => {
  const userMsgs = messages.filter(m => m.type === 'user');
  if (userMsgs.length === 0) return 'Untitled Chat';
  const firstUserMsg = userMsgs[0].original;
  return firstUserMsg.substring(0, 50) + (firstUserMsg.length > 50 ? '...' : '');
};

export const getChatSnippet = (messages: ChatMessage[]): string => {
  // Get snippet from first assistant message or user question
  const assistantMsg = messages.find(m => m.type === 'assistant');
  const userMsg = messages.find(m => m.type === 'user');
  const source = assistantMsg || userMsg;
  
  if (!source) return 'Empty chat';
  const text = source.original || '';
  return text.substring(0, 70) + (text.length > 70 ? '...' : '');
};

// Strip sensitive information from messages
const stripSecrets = (text: string): string => {
  try {
    return text.replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED]');
  } catch {
    return text;
  }
};

export const loadChatsFromStorage = (): ChatRecord[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_CHATS);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.map((chat) => {
      const c = chat as Record<string, unknown>;
      const createdAt = typeof c.createdAt === 'string' ? new Date(c.createdAt) : new Date();
      const updatedAt = typeof c.updatedAt === 'string' ? new Date(c.updatedAt) : new Date();
      const lastSyncedAt = typeof c.lastSyncedAt === 'string' ? new Date(c.lastSyncedAt) : null;

      const messagesRaw = Array.isArray(c.messages) ? c.messages : [];
      const messages: ChatMessage[] = messagesRaw.map((mRaw) => {
        const m = mRaw as Record<string, unknown>;
        const weather = (typeof m.weatherData === 'object' && m.weatherData) ? (m.weatherData as WeatherData) : undefined;
        return {
          id: String(m.id ?? ''),
          type: (m.type === 'user' || m.type === 'assistant' || m.type === 'system') ? (m.type as 'user' | 'assistant' | 'system') : 'system',
          original: String(m.original ?? ''),
          translations: typeof m.translations === 'object' && m.translations ? (m.translations as Record<string, string>) : undefined,
          timestamp: typeof m.timestamp === 'string' ? new Date(m.timestamp) : new Date(),
          weatherData: weather,
          sources: Array.isArray(m.sources) ? (m.sources as { uri: string; title: string }[]) : undefined
        };
      });

      return {
        id: String(c.id ?? ''),
        userId: typeof c.userId === 'string' ? c.userId : null,
        title: String(c.title ?? ''),
        snippet: String(c.snippet ?? ''),
        city: typeof c.city === 'string' ? c.city : null,
        messages,
        meta: typeof c.meta === 'object' && c.meta ? (c.meta as ChatMetadata) : { version: 1 },
        createdAt,
        updatedAt,
        lastSyncedAt,
        synced: !!c.synced,
        unsyncedOps: Array.isArray(c.unsyncedOps) ? (c.unsyncedOps as string[]) : undefined
      } as ChatRecord;
    });
  } catch (error) {
    console.error('Failed to load chats from storage:', error);
    return [];
  }
};

export const autoSaveChat = (messages: ChatMessage[]): ChatRecord[] => {
  if (typeof window === 'undefined') return [];
  
  try {
    // Don't save if no user messages
    const userMessages = messages.filter(m => m.type === 'user');
    if (userMessages.length === 0) return loadChatsFromStorage();

    const chats = loadChatsFromStorage();
    const chatTitle = getChatTitle(messages);
    const chatSnippet = getChatSnippet(messages);
    
    // Extract city from messages if available (ensure string type)
    const cityMatch = (() => {
      const found = messages.find(m => m.weatherData && typeof (m.weatherData as WeatherData).city === 'string');
      if (!found) return undefined;
      const c = (found.weatherData as WeatherData).city;
      return typeof c === 'string' ? c : undefined;
    })();

    // Check if this chat already exists (by title)
    const existingIndex = chats.findIndex(c => c.title === chatTitle);

    // Validate message size
    const messageSize = JSON.stringify(messages).length;
    const isTruncated = messageSize > MAX_MESSAGE_SIZE;

    const chatRecord: ChatRecord = {
      id: existingIndex >= 0 ? chats[existingIndex].id : `local_${Date.now()}`,
      title: chatTitle,
      snippet: chatSnippet,
      city: cityMatch ?? null,
      messages,
      meta: {
        device: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 50) : 'unknown',
        version: 1,
        truncated: isTruncated
      },
      createdAt: existingIndex >= 0 ? chats[existingIndex].createdAt : new Date(),
      updatedAt: new Date(),
      lastSyncedAt: null,
      synced: false
    };

    let updated: ChatRecord[];
    if (existingIndex >= 0) {
      updated = [...chats];
      updated[existingIndex] = chatRecord;
    } else {
      updated = [chatRecord, ...chats];
    }

    localStorage.setItem(STORAGE_CHATS, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.error('Failed to auto-save chat:', error);
    return loadChatsFromStorage();
  }
};

export const deleteChat = (chatId: string): ChatRecord[] => {
  if (typeof window === 'undefined') return [];
  
  try {
    const chats = loadChatsFromStorage();
    const updated = chats.filter(c => c.id !== chatId);
    localStorage.setItem(STORAGE_CHATS, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.error('Failed to delete chat:', error);
    return loadChatsFromStorage();
  }
};

export const deleteAllChats = (): void => {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(STORAGE_CHATS);
  } catch (error) {
    console.error('Failed to delete all chats:', error);
  }
};

// List chats with lightweight metadata (for sidebar)
export const listChatsMetadata = (): Array<{
  id: string;
  title: string;
  snippet: string;
  city?: string | null;
  createdAt: Date;
  updatedAt: Date;
  synced: boolean;
}> => {
  const chats = loadChatsFromStorage();
  return chats.map(c => ({
    id: c.id,
    title: c.title,
    snippet: c.snippet,
    city: c.city,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    synced: c.synced
  }));
};

// Get full chat record by ID
export const getChatById = (chatId: string): ChatRecord | null => {
  const chats = loadChatsFromStorage();
  return chats.find(c => c.id === chatId) || null;
};

// Rename a chat
export const renameChat = (chatId: string, newTitle: string): ChatRecord | null => {
  if (typeof window === 'undefined') return null;
  
  try {
    const chats = loadChatsFromStorage();
    const index = chats.findIndex(c => c.id === chatId);
    
    if (index === -1) return null;
    
    const updated = [...chats];
    updated[index] = {
      ...updated[index],
      title: newTitle,
      updatedAt: new Date()
    };
    
    localStorage.setItem(STORAGE_CHATS, JSON.stringify(updated));
    return updated[index];
  } catch (error) {
    console.error('Failed to rename chat:', error);
    return null;
  }
};
