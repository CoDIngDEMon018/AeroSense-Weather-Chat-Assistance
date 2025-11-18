"use client"

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { fetchWeather, fetchGeminiResponse, translateText, batchTranslate } from '@/lib/api';
import { WeatherData } from '@/lib/constants';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { Sidebar } from '@/components/Sidebar';
import { autoSaveChat } from '@/lib/chatStorage';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';

// Message Interface
interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system';
  // original content as created (user input or assistant response)
  original: string;
  // translations keyed by language code (e.g., 'en-US', 'ja-JP')
  translations?: Record<string, string>;
  timestamp: Date;
  weatherData?: WeatherData;
  sources?: { uri: string; title: string }[];
}



// Translations moved to `src/lib/translations.ts` and language provider in context


const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const linkify = (s: string): string =>
  s.replace(/\b(https?:\/\/[^\s<]+)\b/gi, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);

const applyInlineEmphasis = (s: string): string => {
 
  const keywords = [
    'today', 'tonight', 'this morning', 'this afternoon', 'this evening',
    'rain', 'snow', 'thunderstorm', 'storm', 'clear', 'sunny', 'cloudy', 'overcast', 'drizzle', 'humid', 'dry', 'windy',
    'hot', 'very hot', 'warm', 'cool', 'cold', 'chilly',
    'uv index', 'air quality', 'visibility',
    'warning', 'alert', 'advisory'
  ];
  let out = s;
  // Temperatures like 23°C or 72°F
  out = out.replace(/(-?\d+(?:\.\d+)?)\s?°\s?[CF]/gi, '<strong>$&</strong>');
  
  out = out.replace(/(\b\d{1,3})%/g, '<strong>$1%</strong>');
  
  out = out.replace(/(\b\d+(?:\.\d+)?)\s?(?:m\/s|km\/?h|kph|mph)\b/gi, '<strong>$&</strong>');
 
  out = out.replace(/\b(\d{1,2})(?:[:.]\d{2})?\s?(?:am|pm)\b/gi, '<strong>$&</strong>');
  // Highlight gear/advice words
  const highlight = ['umbrella', 'raincoat', 'jacket', 'coat', 'sunscreen', 'water', 'mask', 'hydrated', 'layers'];
  highlight.forEach(w => {
    const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, '<span class="hl">$&</span>');
  });
  // Bold keywords
  keywords.forEach(w => {
    const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, '<strong>$&</strong>');
  });
  return out;
};

const formatAssistantHtml = (text: string): { __html: string } => {
  const lines = text.split(/\r?\n/);
  let html = '';
  let inList = false;
  const bulletRe = /^\s*[-•]\s+(.*)$/;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(bulletRe);
    if (bullet) {
      if (!inList) { html += '<ul class="assistant-list">'; inList = true; }
      const item = applyInlineEmphasis(linkify(escapeHtml(bullet[1])));
      html += `<li>${item}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') { html += '<br />'; }
      else {
        const content = applyInlineEmphasis(linkify(escapeHtml(line)));
        html += `<p>${content}</p>`;
      }
    }
  }
  if (inList) html += '</ul>';
  return { __html: html };
};

// Props interface for MessageItem
interface MessageItemProps {
  message: ChatMessage;
  getMessageText: (m: ChatMessage) => string;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  translatingRef: React.MutableRefObject<Set<string>>;
  translatingCountRef: React.MutableRefObject<number>;
  MAX_CONCURRENT_TRANSLATIONS: number;
  mounted: boolean;
  language: string;
  t: (key: string) => string;
}

// MessageItem component moved outside AppContent to prevent recreation
const MessageItem: React.FC<MessageItemProps> = React.memo(({
  message,
  getMessageText,
  setMessages,
  translatingRef,
  translatingCountRef,
  MAX_CONCURRENT_TRANSLATIONS,
  mounted,
  language,
  t
}) => {
  const [localTranslating, setLocalTranslating] = React.useState(false);

  const ensureTranslation = React.useCallback(async () => {
    if (!message.original) return;
    if (message.translations && message.translations[language]) return;
    if (translatingRef.current.has(message.id)) return;

    // Simple concurrency limiter
    const startWhenAllowed = async () => {
      while (translatingCountRef.current >= MAX_CONCURRENT_TRANSLATIONS) {
        await new Promise(r => setTimeout(r, 150));
      }
      translatingCountRef.current++;
      translatingRef.current.add(message.id);
      setLocalTranslating(true);
      try {
        const translated = await translateText(message.original, language);
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, translations: { ...(m.translations || {}), [language]: translated } } : m));
      } catch (err) {
        console.error('Translation failed for message', message.id, err);
      } finally {
        translatingCountRef.current--;
        translatingRef.current.delete(message.id);
        setLocalTranslating(false);
      }
    };

    startWhenAllowed();
  }, [message.id, message.original, message.translations, language, setMessages, translatingRef, translatingCountRef, MAX_CONCURRENT_TRANSLATIONS]);

  React.useEffect(() => {
    // Only translate assistant/system messages by default (user messages keep original)
    if (message.type === 'assistant' || message.type === 'system') {
      if (!message.translations || !message.translations[language]) {
        ensureTranslation();
      }
    }
  }, [language, message.id, ensureTranslation]);

  const text = getMessageText(message);

  const getWeatherIcon = (condition: string) => {
    const conditionLower = condition.toLowerCase();
    if (conditionLower.includes('clear')) return '☀️';
    if (conditionLower.includes('cloud')) return '☁️';
    if (conditionLower.includes('rain') || conditionLower.includes('drizzle')) return '🌧️';
    if (conditionLower.includes('thunder')) return '⛈️';
    if (conditionLower.includes('snow')) return '🌨️';
    return '🌀';
  };

  return (
    <div className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] sm:max-w-[85%] md:max-w-md px-3 sm:px-4 py-2 rounded-lg ${
        message.type === 'user'
          ? 'bg-indigo-500 text-white'
          : message.type === 'assistant'
          ? 'bg-gray-100 text-gray-800'
          : 'bg-blue-50 text-blue-800 text-center mx-auto'
      }`}>
        {message.type === 'assistant' && message.weatherData && (
          <div className="assistant-card mb-3 p-2 sm:p-3 bg-blue-50 border border-blue-200">
            <div className="flex items-center justify-between flex-wrap sm:flex-nowrap gap-2">
              <div className="flex items-center gap-2 text-xs sm:text-sm text-blue-700">
                <span className="text-lg sm:text-xl">{getWeatherIcon(message.weatherData.condition)}</span>
                <div className="font-semibold">{message.weatherData.city}</div>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-indigo-700">{Math.round(message.weatherData.temp)}°C</div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className="assistant-pill bg-yellow-100 text-yellow-800 capitalize text-xs sm:text-sm">{message.weatherData.description}</span>
              <span className="assistant-pill bg-indigo-100 text-indigo-800 text-xs sm:text-sm">{t('feels')} {Math.round(message.weatherData.feelsLike)}°C</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2 text-xs">
              <div className="assistant-stat bg-white/60 dark:bg-white/5 p-1.5 sm:p-2">
                <div className="text-gray-600 text-[10px] sm:text-xs">{t('humidity')}</div>
                <div className="font-semibold text-xs sm:text-sm">{message.weatherData.humidity}%</div>
              </div>
              <div className="assistant-stat bg-white/60 dark:bg-white/5 p-1.5 sm:p-2">
                <div className="text-gray-600 text-[10px] sm:text-xs">{t('windSpeed')}</div>
                <div className="font-semibold text-xs sm:text-sm">{message.weatherData.windSpeed} m/s</div>
              </div>
              <div className="assistant-stat bg-white/60 dark:bg-white/5 p-1.5 sm:p-2">
                <div className="text-gray-600 text-[10px] sm:text-xs">{t('visibility')}</div>
                <div className="font-semibold text-xs sm:text-sm">{message.weatherData.visibilityKm != null ? `${message.weatherData.visibilityKm}km` : '—'}</div>
              </div>
            </div>
          </div>
        )}

        {message.type === 'assistant' ? (
          <div className="assistant-content" dangerouslySetInnerHTML={formatAssistantHtml(text || (localTranslating ? t('translating') : message.original))} />
        ) : (
          <div className="whitespace-pre-wrap">{text || (localTranslating ? t('translating') : message.original)}</div>
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-1">{t('sources')}</p>
            <div className="space-y-1">
              {message.sources.slice(0, 2).map((source, index) => (
                <a
                  key={index}
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-blue-600 hover:text-blue-800 hover:underline truncate"
                >
                  {source.title}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs opacity-60 mt-1">
          {mounted ? message.timestamp.toLocaleTimeString() : '--:--'}
        </div>
      </div>
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

// Utility Icons
const LoadingSpinner: React.FC<{ text?: string }> = ({ text }) => (
  <div className="flex justify-center items-center p-2">
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" />
    <span className="ml-2 text-gray-600">{text ?? '...'}</span>
  </div>
);

const AppContent: React.FC = () => {
  const [userInput, setUserInput] = useState<string>('');
  const [location, setLocation] = useState<string>('Tokyo');
  // use language from context
  const { language, setLanguage, t } = useLanguage();
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'system',
      original: t('systemGreeting'),
      translations: { [language]: t('systemGreeting') },
      timestamp: new Date()
    }
  ]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [shouldAutoSubmit, setShouldAutoSubmit] = useState<boolean>(false);
  const [showScrollButton, setShowScrollButton] = useState<boolean>(false);
  const [compactHeader, setCompactHeader] = useState<boolean>(false);
  const compactRef = useRef<boolean>(false);
  const tickingRef = useRef<boolean>(false);
  const lastToggleRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  // translator `t` is provided by LanguageContext

  const getMessageText = useCallback((m: ChatMessage) => {
    return m.translations?.[language] ?? m.original ?? '';
  }, [language]);

  // update initial system message when language changes
  useEffect(() => {
    setMessages(prev => prev.map(m => m.id === '1' && m.type === 'system'
      ? { ...m, original: t('systemGreeting') ?? m.original, translations: { ...(m.translations || {}), [language]: t('systemGreeting') } }
      : m
    ));

    // Optimized batch translation for existing messages: translate missing messages in batches
    (async () => {
      try {
        setMessages(currentMessages => {
          const toTranslate = currentMessages.filter(m => m.original && (!m.translations || !m.translations[language]) && m.type !== 'user');
          if (toTranslate.length === 0) return currentMessages;
          
          // Process translations asynchronously without causing re-renders
          (async () => {
            const BATCH = 8;
            for (let i = 0; i < toTranslate.length; i += BATCH) {
              const batch = toTranslate.slice(i, i + BATCH);
              const texts = batch.map(b => b.original);
              try {
                const results = await batchTranslate(texts, language);
                setMessages(prev => prev.map(m => {
                  const idx = batch.findIndex(b => b.id === m.id);
                  if (idx !== -1) {
                    return { ...m, translations: { ...(m.translations || {}), [language]: results[idx] } };
                  }
                  return m;
                }));
              } catch (err) {
                console.error('Batch translate failed', err);
              }
            }
          })();
          
          return currentMessages;
        });
      } catch (e) {
        console.error('Batch translation flow error', e);
      }
    })();
  }, [language, t]);
  // Language options (display labels localized to selected UI language)
  const languageOptions = [
    { value: 'en-US', label: { 'en-US': 'English', 'ja-JP': '英語' } },
    { value: 'ja-JP', label: { 'en-US': 'Japanese', 'ja-JP': '日本語' } }
  ];

  // Auto-save chat to localStorage whenever messages change (except initial greeting)
  useEffect(() => {
    if (messages.length > 1) {
      // Only auto-save if there are user/assistant messages beyond the initial greeting
      const hasUserMessages = messages.some(m => m.type === 'user');
      if (hasUserMessages) {
        const updated = autoSaveChat(messages);
        // notify other parts of the app (same window) that chats changed
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aerosense:chats-updated', { detail: { count: updated.length } }));
          }
        } catch (e) {
          console.warn('Failed to dispatch chats-updated event', e);
        }
      }
    }
  }, [messages]);
  
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
      const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = saved ? saved === 'dark' : prefersDark;
      setDarkMode(isDark);
      document.documentElement.classList.toggle('dark', isDark);
    } catch {}
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch {}
      return next;
    });
  }, []);

 
  const detectCity = useCallback((text: string) => {
      try {
        const lowerText = text.toLowerCase();
        
        // Common city names (Japanese and English) 
        const commonCities = [
          
          '東京', 'とうきょう', '大阪', 'おおさか', '京都', 'きょうと', '横浜', 'よこはま', '神戸', 'こうべ',
          '名古屋', 'なごや', '福岡', 'ふくおか', '札幌', 'さっぽろ', '仙台', 'せんだい', '広島', 'ひろしま',
          
          '東京都', '大阪市', '京都市', '横浜市', '神戸市', '名古屋市', '福岡市', '札幌市', '仙台市', '広島市',
          
          'tokyo', 'osaka', 'kyoto', 'yokohama', 'kobe', 'nagoya', 'fukuoka', 'sapporo', 'sendai', 'hiroshima',
          'new york', 'london', 'paris', 'berlin', 'sydney', 'melbourne', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
         
          'delhi', 'new delhi', 'mumbai', 'bombay', 'bengaluru', 'bangalore', 'hyderabad', 'chennai', 'kolkata', 'calcutta', 'pune', 'ahmedabad'
        ];
        
       
        const cityMap: { [key: string]: string } = {
          '東京': 'Tokyo', 'とうきょう': 'Tokyo', '東京都': 'Tokyo',
          '大阪': 'Osaka', 'おおさか': 'Osaka', '大阪市': 'Osaka',
          '京都': 'Kyoto', 'きょうと': 'Kyoto', '京都市': 'Kyoto',
          '横浜': 'Yokohama', 'よこはま': 'Yokohama', '横浜市': 'Yokohama',
          '神戸': 'Kobe', 'こうべ': 'Kobe', '神戸市': 'Kobe',
          '名古屋': 'Nagoya', 'なごや': 'Nagoya', '名古屋市': 'Nagoya',
          '福岡': 'Fukuoka', 'ふくおか': 'Fukuoka', '福岡市': 'Fukuoka',
          '札幌': 'Sapporo', 'さっぽろ': 'Sapporo', '札幌市': 'Sapporo',
          '仙台': 'Sendai', 'せんだい': 'Sendai', '仙台市': 'Sendai',
          '広島': 'Hiroshima', 'ひろしま': 'Hiroshima', '広島市': 'Hiroshima',
          
          'new delhi': 'Delhi', 'delhi': 'Delhi',
          'mumbai': 'Mumbai', 'bombay': 'Mumbai',
          'bengaluru': 'Bengaluru', 'bangalore': 'Bengaluru',
          'hyderabad': 'Hyderabad', 'chennai': 'Chennai',
          'kolkata': 'Kolkata', 'calcutta': 'Kolkata',
          'pune': 'Pune', 'ahmedabad': 'Ahmedabad'
        };
        
        
        for (const city of commonCities) {
          const cityLower = city.toLowerCase();
          const hasJapanese = /[ぁ-んァ-ヶ一-龯]/.test(cityLower);
          if (hasJapanese) {
           
            if (lowerText.includes(cityLower)) {
              return cityMap[city] || city;
            }
          } else {
            
            const wordBoundaryRegex = new RegExp(`\\b${cityLower.replace(/\s+/g, '\\s+')}\\b`, 'i');
            if (wordBoundaryRegex.test(lowerText)) {
              return cityMap[city] || city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
            }
          }
        }
        
       
  const locationPatterns = [
          // Japanese patterns (more specific)
          /([ぁ-んァ-ヶー一-龯]{2,})の天気/, // "[City]の天気" pattern
          /([ぁ-んァ-ヶー一-龯]{2,})市/, // "[City]市" pattern 
          /([ぁ-んァ-ヶー一-龯]{2,})県/, // "[Prefecture]県" pattern
          /([ぁ-んァ-ヶー一-龯]{2,})区/, // "[Ward]区" pattern
          // English patterns (more specific, avoid greedy matching)
          /weather\s+in\s+([a-zA-Z][a-zA-Z\s]{1,30}?)(?:\s|$)/i,
         
          /([a-zA-Z][a-zA-Z]+(?:\s+[a-zA-Z][a-zA-Z]+){0,2})\s+weather(?:\s|$)/i,
          /([a-zA-Z][a-zA-Z\s]{1,20}?)\s+temperature(?:\s|$)/i,
          /\bin\s+([a-zA-Z][a-zA-Z\s]{1,20}?)(?:\s+(?:today|now|currently|right now))?(?:\s|$)/i
        ];
        
        // Check patterns
        for (const pattern of locationPatterns) {
          const match = lowerText.match(pattern);
          if (match && match[1]) {
            const detectedCityRaw = match[1].trim();
           
            const jpBan = ['今日', '明日', '天気', '気温', '風', '湿度', '空気', '今', '現在', '明後日'];
            const isJapanese = /[ぁ-んァ-ヶ一-龯]/.test(detectedCityRaw);

            if (isJapanese) {
             
              const normalized = detectedCityRaw.replace(/[市県区]$/, '');
              if (jpBan.some(w => normalized.includes(w))) continue;
              if (cityMap[detectedCityRaw]) return cityMap[detectedCityRaw];
              if (cityMap[normalized]) return cityMap[normalized];
             
              continue;
            } else {
            
              const cleaned = detectedCityRaw.replace(/\s+/g, ' ').trim();
              const tokens = cleaned.split(/\s+/);
              const stop = new Set(['what', "what's", 'how', "how's", 'is', 'are', 'was', 'were', 'will', 'would', 'could', 'should', 'the', 'a', 'an', 'tell', 'can', 'please', 'show', 'give', 'me', 'about', 'today', 'now', 'currently']);
              const hasStop = tokens.some(t => stop.has(t));
            
              if (!hasStop && cleaned.length >= 2 && cleaned.length <= 30 && tokens.length <= 3) {
                return cleaned.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(' ');
              }
              
              if (/^the\s+hague$/i.test(cleaned)) {
                return 'The Hague';
              }
            }
          }
        }
        
        return null;
      } catch (error) {
        console.error('Error in location detection:', error);
        return null;
      }
    }, []);

  
  const handleTranscript = useCallback((transcript: string) => {
    try {
      
      const detectedLocation = detectCity(transcript);
      if (detectedLocation && detectedLocation !== location) {
        console.log(`Location detected and updated: ${location} -> ${detectedLocation}`);
        setLocation(detectedLocation);
      }
      
      // Fill the input field with voice transcript; user can review/edit before sending
      setUserInput(transcript);
      // Do NOT auto-submit; let user manually send the message
    } catch (error) {
      console.error('Error processing transcript:', error);
     
      // Still fill input field even if error occurs
      setUserInput(transcript);
    }
  }, [location, detectCity]);

  const { isListening, voiceError, isSupported, startListening } = useVoiceInput(handleTranscript, language);
  
  // Prevent hydration mismatch: only treat browser capabilities as available after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  

  //  "Scroll to latest" button 
  useEffect(() => {
    const ENTER_COMPACT_AT = 120; 
    const EXIT_COMPACT_AT = 48;   

    const handleScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(() => {
        try {
          const doc = document.documentElement;
          const y = window.scrollY || doc.scrollTop || 0;
          const nearBottom = window.innerHeight + y >= (doc.scrollHeight - 120);
          setShowScrollButton(!nearBottom);

          // Hysteresis + debounce to avoid fluttering around the threshold
          let nextCompact = compactRef.current;
          if (!nextCompact && y > ENTER_COMPACT_AT) nextCompact = true;
          else if (nextCompact && y < EXIT_COMPACT_AT) nextCompact = false;

          if (nextCompact !== compactRef.current) {
            const now = Date.now();
            // small minimum interval between toggles
            if (now - lastToggleRef.current > 250) {
              lastToggleRef.current = now;
              compactRef.current = nextCompact;
              setCompactHeader(nextCompact);
            }
          }
        } finally {
          tickingRef.current = false;
        }
      });
    };

    
    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  //Chat Message Submission 
  const handleSendMessage = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    if (!userInput.trim()) {
      setError(t('pleaseEnterMessage'));
      return;
    }

    
    const typedDetectedCity = detectCity(userInput);
    if (typedDetectedCity && typedDetectedCity !== location) {
      setLocation(typedDetectedCity);
    }

   
  const cityForFetch = (typedDetectedCity || location || '').trim();
    
    const looksInvalidCity = /^(what|how)(\s+is|\s+are)?(\s+the)?$/i.test(cityForFetch) || cityForFetch.length < 2;
    if (!typedDetectedCity && looksInvalidCity) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 0.25).toString(),
        type: 'system',
        original: t('pleaseMentionCityExample'),
        translations: { [language]: t('pleaseMentionCityExample') },
        timestamp: new Date()
      }]);
      setError(t('pleaseProvideCity'));
      setLoading(false);
      return;
    }

    // Add user message to chat
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      original: userInput.trim(),
      translations: { [language]: userInput.trim() },
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setLoading(true);

    try {
      // 1. Fetch Weather Data 
      let weather: WeatherData;
      try {
        weather = await fetchWeather(cityForFetch);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        const is404 = msg.includes('404') && msg.toLowerCase().includes('city not found');
        if (is404 && typedDetectedCity && location && typedDetectedCity !== location) {
         
          weather = await fetchWeather(location);
         
          setMessages(prev => [...prev, {
            id: (Date.now() + 0.5).toString(),
            type: 'system',
            original: `${t('couldNotFindCity', { typed: typedDetectedCity })} ${t('showingWeatherFor', { location })}`,
            translations: { [language]: `${t('couldNotFindCity', { typed: typedDetectedCity })} ${t('showingWeatherFor', { location })}` },
            timestamp: new Date()
          }]);
        } else {
          throw err;
        }
      }

      // 2. Build conversation 
      const recentMessages = messages.slice(-5); // Last 5 messages for context
      const conversationContext = recentMessages
        .filter(msg => msg.type !== 'system')
        .map(msg => `${msg.type === 'user' ? 'User' : 'Assistant'}: ${getMessageText(msg)}`)
        .join('\n');

      // 3. Create query 
      const enhancedQuery = conversationContext 
        ? `Previous conversation:\n${conversationContext}\n\nCurrent question: ${userInput}`
        : userInput;

  // 4. Fetch Gemini Response (request bilingual so we have immediate translations)
  const response = await fetchGeminiResponse(enhancedQuery, weather, undefined, true);

      // 5. Parse bilingual response if available
      let enText = '';
      let jaText = '';
      try {
        const parsed = JSON.parse(response.text);
        enText = parsed.en || '';
        jaText = parsed.ja || '';
      } catch {
        // If parsing fails, fall back to the raw text for current language
        if (language === 'ja-JP') jaText = response.text || '';
        else enText = response.text || '';
      }

      const translations: Record<string, string> = {};
      if (enText) translations['en-US'] = enText;
      if (jaText) translations['ja-JP'] = jaText;

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        // store the message in the currently selected language as the primary original
        original: translations[language] ?? response.text ?? (enText || jaText || ''),
        translations,
        timestamp: new Date(),
        weatherData: weather,
        sources: response.sources
      };

      setMessages(prev => [...prev, assistantMessage]);

    } catch (err: unknown) {
      console.error('Chat Error:', err);
      
      const errorMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'system',
        original: `${t('errorPrefix')} ${err instanceof Error ? err.message : 'An unknown error occurred'}`,
        translations: { [language]: `${t('errorPrefix')} ${err instanceof Error ? err.message : 'An unknown error occurred'}` },
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorMessage]);
      
      if (err instanceof Error && err.message.includes('API key is not set')) {
        setError(err.message + ". Please ensure NEXT_PUBLIC_GEMINI_API_KEY is correctly set in your .env.local.");
      } else {
        setError(err instanceof Error ? err.message : 'An unknown error occurred during processing.');
      }
    } finally {
      setLoading(false);
    }
  }, [userInput, location, messages, language, detectCity]);

  
  useEffect(() => {
    if (shouldAutoSubmit) {
      setShouldAutoSubmit(false);
      if (userInput && !loading) {
        handleSendMessage();
      }
    }
  }, [shouldAutoSubmit, userInput, loading, handleSendMessage]);

  // Lazy translate messages on-demand when they're rendered.
  const translatingRef = useRef<Set<string>>(new Set());
  const translatingCountRef = useRef<number>(0);
  const MAX_CONCURRENT_TRANSLATIONS = 3;


  const clearChat = () => {
    setMessages([
      {
        id: Date.now().toString(),
        type: 'system',
        original: t('chatCleared'),
        translations: { [language]: t('chatCleared') },
        timestamp: new Date()
      }
    ]);
    setError(null);
  };

  const handleSaveChat = () => {
    // Callback for when user saves chat from sidebar
    // Can add additional logic here if needed
  };

  const handleLoadChat = (loadedMessages: ChatMessage[]) => {
    setMessages(loadedMessages);
    scrollToBottom();
  };

  return (
    <div className="min-h-screen flex flex-row font-sans">
      {/* Sidebar */}
      <Sidebar
        currentMessages={messages}
        onNewChat={clearChat}
        onSelectChat={handleLoadChat}
        onSaveChat={handleSaveChat}
        
      />

      {/* Main App Container */}
      <div className="flex-1 flex flex-col lg:ml-0">
      {/* Header */}
      <header className={`app-header sticky top-0 z-50 bg-white/90 dark:bg-[#0b1220]/80 backdrop-blur-md backdrop-saturate-150 border-b border-gray-200/70 dark:border-[#243044]/80 shadow-sm ${compactHeader ? 'py-1.5 px-2' : 'py-2 px-3 sm:py-3 sm:px-4'}`}>
  <div className={`${compactHeader ? 'max-w-2xl' : 'max-w-3xl'} mx-auto`}>
          {/* Title Row */}
          <div className="flex justify-between items-center mb-1 sm:mb-2 md:mb-0">
            <div className="text-left">
              <h1 className={`${compactHeader ? 'text-base sm:text-lg' : 'text-lg sm:text-xl md:text-2xl'} font-bold text-indigo-700 dark:text-indigo-300`}>
                <span className="text-indigo-400 dark:text-indigo-400">AeroSense</span>  🌤️
              </h1>
              {!compactHeader && (
                <p className="text-gray-500 text-[10px] sm:text-xs md:text-sm hidden sm:block">{t('headerSubtitle')}</p>
              )}
            </div>
            {/* Mobile: Dark mode and Clear chat buttons */}
            <div className="flex md:hidden items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={toggleDarkMode}
                className="p-1.5 sm:p-2 rounded-lg border border-gray-300 text-gray-700 bg-white/70 shadow-sm hover:bg-white dark:border-gray-600 dark:text-gray-200 dark:bg-white/10 dark:hover:bg-white/15 transition"
                title={darkMode ? t('switchToLight') : t('switchToDark')}
                aria-pressed={darkMode}
              >
                <span aria-hidden className="text-sm sm:text-lg">{darkMode ? '☀️' : '🌙'}</span>
              </button>
              <button
                onClick={clearChat}
                className="p-1.5 sm:p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white text-xs sm:text-sm"
                title={t('clearChat')}
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 md:gap-3">
            {/* City Input */}
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <label htmlFor="location" className="text-gray-700 dark:text-gray-200 font-medium text-[10px] sm:text-xs md:text-sm whitespace-nowrap">{t('cityLabel')}</label>
              <input
                id="location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={`app-input p-1.5 sm:p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 text-sm ${compactHeader ? 'w-16 sm:w-20' : 'w-20 sm:w-24 md:w-32'}`}
                placeholder={t('cityPlaceholder')}
                disabled={loading}
              />
            </div>
            {/* Language Select */}
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <label htmlFor="language" className="text-gray-700 dark:text-gray-200 font-medium text-[10px] sm:text-xs md:text-sm whitespace-nowrap">{t('languageLabel')}</label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={`app-select p-1.5 sm:p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 text-sm ${compactHeader ? 'w-20 sm:w-24' : 'w-24 sm:w-28 md:w-32'}`}
                disabled={loading}
              >
                {languageOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label[language as keyof typeof opt.label] || opt.label['en-US']}
                  </option>
                ))}
              </select>
            </div>
            {/* Desktop: Dark mode and Clear chat buttons */}
            <div className="hidden md:flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={toggleDarkMode}
                className={`px-3 py-2 rounded-lg border border-gray-300 text-gray-700 bg-white/70 shadow-sm hover:bg-white dark:border-gray-600 dark:text-gray-200 dark:bg-white/10 dark:hover:bg-white/15 transition ${compactHeader ? 'text-sm' : ''}`}
                title={darkMode ? t('switchToLight') : t('switchToDark')}
                aria-pressed={darkMode}
              >
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden>{darkMode ? '☀️' : '🌙'}</span>
                  <span className="hidden lg:inline">{darkMode ? t('light') : t('dark')}</span>
                </span>
              </button>
              <button
                onClick={clearChat}
                className={`px-3 py-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white text-sm whitespace-nowrap ${compactHeader ? 'px-2' : ''}`}
              >
                {t('clearChat')}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Messages Container */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-2 sm:p-4 flex flex-col">
        <div 
          ref={chatContainerRef}
          className="flex-1 bg-white dark:bg-transparent rounded-lg shadow-lg lg:shadow-sm p-2 sm:p-3 md:p-4 mb-4 overflow-y-auto"
        >
          <div className="space-y-4 pb-[150px]">
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                getMessageText={getMessageText}
                setMessages={setMessages}
                translatingRef={translatingRef}
                translatingCountRef={translatingCountRef}
                MAX_CONCURRENT_TRANSLATIONS={MAX_CONCURRENT_TRANSLATIONS}
                mounted={mounted}
                language={language}
                t={t}
              />
            ))}
            
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-800 max-w-xs lg:max-w-md px-4 py-2 rounded-lg">
                  <LoadingSpinner text={t('thinking')} />
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Error Display */}
        {(error || voiceError) && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-800 p-3 rounded mb-4">
            <p className="font-medium text-sm">{t('errorLabel')}</p>
            <p className="text-sm">{error || voiceError}</p>
          </div>
        )}

        {/* Message Input Form*/}
        <div className="fixed bottom-0 left-0 right-0 z-40">
          <div className="max-w-4xl mx-auto w-full px-1.5 sm:px-2 md:px-4 pt-1.5 sm:pt-2 md:pt-4 pb-0">
            <form onSubmit={handleSendMessage} className="bg-white/90 dark:bg-[#0b1220]/80 backdrop-blur-md backdrop-saturate-150 border-t border-gray-200/70 dark:border-[#243044]/80 rounded-t-lg shadow-sm p-1.5 sm:p-2 md:p-3 lg:p-4">
              <div className="flex gap-1 sm:gap-2 items-stretch">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder={isListening ? t('listening') : t('inputPlaceholder')}
                  className={`app-input min-w-0 flex-1 p-2 sm:p-2.5 md:p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 text-xs sm:text-sm md:text-base ${
                    isListening ? 'bg-indigo-50 border-indigo-500' : ''
                  }`}
                  disabled={loading}
                />

                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={startListening}
                    disabled={!mounted || loading || !isSupported}
                    aria-hidden={!mounted || !isSupported}
                    className={`p-1.5 sm:p-2 md:p-2.5 lg:p-3 rounded-lg transition duration-150 ease-in-out shadow-md flex-shrink-0 ${
                      mounted && isSupported
                        ? (isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-indigo-500 hover:bg-indigo-600 text-white')
                        : 'bg-transparent text-transparent pointer-events-none'
                    } ${(!mounted || loading || !isSupported) ? 'disabled:bg-gray-400' : ''}`}
                    title={mounted && isSupported ? (isListening ? t('stopVoice') : t('startVoice')) : ''}
                  >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 8c1.1 0 2-.9 2-2V3a2 2 0 10-4 0v3c0 1.1.9 2 2 2zM10 18c3.31 0 6-2.69 6-6h-2c0 2.21-1.79 4-4 4s-4-1.79-4-4H4c0 3.31 2.69 6 6 6zM15 9H5a1 1 0 000 2h10a1 1 0 000-2z" />
                    </svg>
                  </button>
                  {mounted && isSupported && (
                    <span className="text-[8px] sm:text-[9px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {language === 'ja-JP' ? '日本語' : 'EN'}
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !userInput.trim() || !location.trim()}
                  className="px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 md:py-2.5 lg:py-3 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-semibold shadow-md transition duration-150 disabled:bg-gray-400 flex-shrink-0 text-xs sm:text-sm md:text-base"
                >
                  {loading ? '...' : t('send')}
                </button>
              </div>
              
              <div className="mt-1 sm:mt-1.5 md:mt-2 text-[9px] sm:text-[10px] md:text-xs text-gray-500 text-center">
                {t('enhancedBy')}
              </div>
            </form>
          </div>
        </div>
      </main>

      
      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="fixed bottom-28 sm:bottom-32 right-2 sm:right-4 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-full shadow-lg bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 text-xs sm:text-sm"
          aria-label={t('latest')}
        >
          {'↓ '}{t('latest')}
        </button>
      )}
      </div>
    </div>
  );
};

const App: React.FC = () => (
  <LanguageProvider>
    <AppContent />
  </LanguageProvider>
);

export default App;
