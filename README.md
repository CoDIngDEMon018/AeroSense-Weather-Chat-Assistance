## Weather Chat Assistant — Overview(works best on chrome)

A compact weather chat built with **Next.js (App Router)**. It fetches current weather from **OpenWeatherMap** and asks **Google Gemini** for short suggestions (activities, clothing, food, safety) in English or Japanese.

---

## ✨ Highlights

- 🌐 Replies match selected language (EN / JA) end-to-end  
- 🏙️ City detection for EN/JP (with common variants) and safe 404 fallback  
- 📋 Weather card shows the asked city or keeps the current one  
- 🎙️ Voice input (Web Speech API)  
- 📌 Sticky header (compact on scroll), “↓ Latest” button, dark mode  

---

## 🛠️ What I Worked On

- 📝 Enforced reply language via system instruction and UI language selection  
- 🏯 Robust city detection for EN/JP, including JP suffixes (`市/県/区`) and Indian city variants  
- ⚠️ 404 handling with graceful fallback to last valid city + system notice  
- 🌦️ Weather card bound to the asked city (or current city when none provided)  
- 🎤 Voice input hooked into the same city detection and submit flow  
- 🎨 UI polish: dark mode with persistence, compact-on-scroll header with hysteresis + small debounce, fixed bottom input, floating “↓ Latest” button  
- 💬 Assistant reply formatting: safe HTML, **bold key values**, highlight helpful gear words, linkify URLs  
- ✂️ Removed non-essential dynamic background for a cleaner UI  

---

## 🔄 Flow at a Glance

1. Detect city from user text/voice (EN/JP). If found, update city field.  
2. Fetch weather from OpenWeatherMap. On 404 for a new city, fall back to the previous one and notify.  
3. Build a concise weather context + question and send to the Gemini proxy.  
4. Server route calls Gemini with enforced language and returns text + sources.  
5. UI renders a weather card and formatted assistant reply; auto-scroll manages the view.  

---

## 🏗️ Architecture

Architecture (text version to ensure compatibility on all viewers):
- User (browser) → Next.js UI (`src/app/page.tsx`)
- UI → OpenWeatherMap (fetch current weather)
- UI → `/api/gemini` (server route with system instruction + language)
- Server route → Google Gemini (generate content)
- UI ← reply + sources → render Weather Card + Assistant text

### Project structure 

```
src/
  app/
    page.tsx        # Chat UI
    api/
      gemini/route.ts  # Server proxy to Gemini (language enforced)
    globals.css     
  hooks/
    useVoiceInput.ts  # Web Speech API integration
  lib/
    api.ts          # fetchWeather + fetchGeminiResponse
    constants.ts    # system prompt
```

### Setup
Create `.env.local` in the project root:

```
NEXT_PUBLIC_OPENWEATHER_API_KEY=your_openweather_key
GEMINI_API_KEY=your_gemini_key
```

Install and run:

```bash
npm install
npm run dev
```

Open http://localhost:3000

### Quick check
- Switch language and ask in JA/EN → reply matches
- Ask for “Weather in Delhi” or “東京の天気” → card city updates
- Try an unknown city → falls back to previous city with a small notice
