
import { WeatherData, AssistantResponse, SYSTEM_PROMPT, OPENWEATHER_BASE_URL } from './constants';

const OPENWEATHER_API_KEY = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;

// ---------------------------
// 1. WEATHER API FETCHING
// ---------------------------
export async function fetchWeather(city: string): Promise<WeatherData> {
    if (!OPENWEATHER_API_KEY) throw new Error('OpenWeatherMap API key is not set.');

    const q = encodeURIComponent(city.trim());
    const url = `${OPENWEATHER_BASE_URL}?q=${q}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const response = await fetch(url);
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Weather API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return {
        city: data.name,
        temp: data.main.temp,
        feelsLike: data.main.feels_like,
        condition: data.weather[0].main,
        description: data.weather[0].description,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        visibilityKm: typeof data.visibility === 'number' ? Math.round((data.visibility / 1000) * 10) / 10 : undefined,
    };
}

// ---------------------------
// 2. GEMINI API FETCHING (Updated)
// ---------------------------


function buildGeminiPrompt(query: string, weather: WeatherData): string {
    
    return `
Weather Context:
City: ${weather.city}
Temperature: ${weather.temp}°C (Feels like ${weather.feelsLike}°C)
Conditions: ${weather.condition} (${weather.description})
Humidity: ${weather.humidity}%
Wind Speed: ${weather.windSpeed} m/s

User Question:
${query}
    `;
}


export async function fetchGeminiResponse(query: string, weather: WeatherData, language?: string, bilingual?: boolean): Promise<AssistantResponse> {
    let promptText = buildGeminiPrompt(query, weather);
    const systemInstruction = SYSTEM_PROMPT;
    // If bilingual is requested, instruct model to output a JSON object with 'en' and 'ja' fields
    if (bilingual) {
        promptText += `\n\nPlease provide the assistant reply in BOTH English and Japanese. Output ONLY a JSON object with keys \"en\" and \"ja\" where the values are the full assistant reply in each language. Do not include any extra commentary.`;
        // Avoid forcing system language in proxy; server will not add language constraint when language is undefined
        language = undefined;
    }

    const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            promptText: promptText, 
            systemInstruction: systemInstruction,
            language
        }),
    });

    if (!response.ok) {
        
        const errData = await response.json();
       
        throw new Error(errData.error || 'Local API Error');
    }

    
    const data: { text: string; sources: { uri: string; title: string }[] } = await response.json();

    // Normalize text: strip code fences and extract first JSON object/array if present.
    let text = (data.text || '').toString();
    // Extract ```json ... ``` blocks
    const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeFenceMatch && codeFenceMatch[1]) {
        text = codeFenceMatch[1].trim();
    } else {
        // Try to extract the first JSON object or array from the text
        const objMatch = text.match(/(\{[\s\S]*\})/);
        const arrMatch = text.match(/(\[[\s\S]*\])/);
        if (objMatch && objMatch[1]) text = objMatch[1];
        else if (arrMatch && arrMatch[1]) text = arrMatch[1];
    }

    return {
        text,
        sources: data.sources || []
    };
}

// ---------------------------
// 3. TRANSLATION HELPER
// ---------------------------
export async function translateText(text: string, targetLanguage: string): Promise<string> {
    if (!text) return '';
    const prompt = `Translate the following text to ${targetLanguage === 'ja-JP' ? 'Japanese (日本語)' : 'English'}.
Preserve formatting, lists, and any measurements. Only output the translated text, nothing else.\n\n${text}`;

    const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText: prompt, systemInstruction: '', language: targetLanguage }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Translation API error');
    }

    const data = await response.json();
    return data.text || '';
}

// Batch translate multiple texts in one model call. Returns array of translated strings in same order.
export async function batchTranslate(texts: string[], targetLanguage: string): Promise<string[]> {
    if (!texts || texts.length === 0) return [];
    // Build a prompt that asks for a JSON array of translations
    const langName = targetLanguage === 'ja-JP' ? 'Japanese (日本語)' : 'English';
    const joined = texts.map((t, i) => `${i + 1}. ${t}`).join('\n\n');
    const prompt = `Translate the following numbered items into ${langName}. Preserve formatting. Return a JSON array of translated strings in order and nothing else.\n\n${joined}`;

    const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText: prompt, systemInstruction: '', language: targetLanguage }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Batch translation API error');
    }

    const data = await response.json();
    try {
        const parsed = JSON.parse(data.text);
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch (e) {
        // Try to extract JSON substring
        const txt = data.text || '';
        const jsonMatch = txt.match(/\[([\s\S]*)\]/);
        if (jsonMatch) {
            try {
                const arr = JSON.parse(jsonMatch[0]);
                if (Array.isArray(arr)) return arr.map(String);
            } catch {}
        }
    }
    // fallback: return original texts
    return texts.map(t => t);
}
