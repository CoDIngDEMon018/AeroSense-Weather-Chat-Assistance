# AeroSense — Weather Chat Assistant

AeroSense is a bilingual, AI-powered weather chat assistant built with **Next.js (App Router)**. It combines live data from OpenWeatherMap with a server-side Google Gemini proxy to deliver short, practical recommendations about weather, clothing, activities, food, and safety. The UI supports English and Japanese, includes voice input, and offers a ChatGPT-style sidebar for managing conversations.

> Best experienced on Chromium browsers (voice input uses the Web Speech API).

---

## 🌟 Features

- **Bilingual output** — answers always match the selected UI language (EN / JA)
- **Smart city detection** — handles English and Japanese text, including variations like `市`, `県`, `区`
- **Weather insights** — temperature, conditions, humidity, wind, visibility, "feels like"
- **Voice input** — transcribes speech and feeds directly into the chat flow
- **Chat sidebar** — create new chats, search, rename, delete, and revisit saved conversations
- **Persistence** — works with local storage or IndexedDB; easy to connect to a server database for deployment
- **Clean UI** — dark/light mode, compacting header on scroll, "scroll to latest" button, safe HTML formatting

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/CoDIngDEMon018/AeroSense-Weather-Chat-Assistance.git
cd AeroSense-Weather-Chat-Assistance
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment variables
Create a `.env.local` file in the project root:
```env
NEXT_PUBLIC_OPENWEATHER_API_KEY=your_openweather_key
GEMINI_API_KEY=your_gemini_key
```

**Important:**
- The Gemini key is used only on the server through the built-in API proxy route
- Do not expose `GEMINI_API_KEY` on the client

### 4. Start development server
```bash
npm run dev
```

Open: `http://localhost:3000`

---

## 🧩 Architecture

AeroSense uses a clean and predictable structure:
```
src/
  app/
    page.tsx                # Main chat UI
    api/
      gemini/route.ts       # Server route calling Gemini
  components/
    Sidebar.tsx             # Chat sidebar (new, search, saved chats)
    SidebarPrompt.tsx       # Quick message input inside sidebar
  hooks/
    useVoiceInput.ts        # Web Speech API wrapper
  lib/
    api.ts                  # fetchWeather() + gemini fetch helpers
    constants.ts
  styles/
    globals.css
```

### High-level flow:

1. User types or speaks a question
2. City parser analyzes English/Japanese text and updates the selected city
3. Weather data is fetched from OpenWeatherMap
4. A structured request is sent to `/api/gemini` along with:
   - user query
   - selected language
   - weather snapshot
5. Gemini returns a concise, language-correct answer
6. UI renders a weather card + formatted assistant message

---

## 🗂️ Sidebar, Chats & Persistence

The sidebar works similarly to ChatGPT:

- New Chat
- Search chats
- List of saved history
- Rename / Delete
- Collapsible layout

AeroSense supports two storage modes:

### Local-only (default)
- Uses localStorage or IndexedDB depending on your setup
- Great for offline or personal use

---

## 🎨 UI Notes

- Weather card displays the city actually used for the API call
- Dropdown menus (rename/delete) use opaque backgrounds so they remain readable over the blurred sidebar
- Assistant replies use:
  - bold emphasis on temperatures, percentages, time expressions
  - highlighting for items like umbrella, jacket, sunscreen
  - URL auto-linking
- Header collapses smoothly when scrolling down
- Persistent dark/light theme stored in localStorage

---

## 🛠️ Development Details

### Weather API
- OpenWeatherMap — "Current Weather Data" endpoint
- Extracts conditions, temperature, humidity, wind, and visibility

### Gemini API (via Server Route)
All calls are routed through: `/app/api/gemini/route.ts`
- Server enforces system instruction + language
- Returns JSON with text + sources

### Voice Input
- Uses Web Speech API (best on Chrome)
- Feeds transcript to city detection and user message field

---

## ⭐ Need help extending AeroSense?

I can generate:
- Prisma schema + server chat storage
- IndexedDB offline sync module
- Cleaner Sidebar with animations
- Chat export/import (JSON)
- Auto-title generation using Gemini

Just ask!
