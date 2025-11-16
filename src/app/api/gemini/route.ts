import { NextRequest, NextResponse } from 'next/server';


const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 


const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

export async function POST(req: NextRequest) {
    if (!GEMINI_API_KEY) {
        return NextResponse.json(
            { error: 'Server-side Gemini API key not configured.' },
            { status: 500 }
        );
    }

    try {
        const { promptText, systemInstruction, language } = await req.json();

        //default ouput
        let finalSystemInstruction: string = systemInstruction || '';
        if (language === 'ja-JP') {
            finalSystemInstruction += '\n\nAlways answer ONLY in Japanese (日本語) regardless of input language. Use natural, friendly Japanese.';
        } else if (language === 'en-US') {
            finalSystemInstruction += '\n\nAlways answer ONLY in English regardless of input language. Use natural, friendly English.';
        }

       
        const payload = {
            
            contents: [{ parts: [{ text: promptText }] }], 
            
            
            systemInstruction: {
                role: "system", 
                parts: [{ text: finalSystemInstruction }] 
            },
            
            
            tools: [{ googleSearch: {} }], 
        };

        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('External Gemini API Error:', response.status, errorText);
            
            let errorMessage = `Gemini API Error: ${response.status}`;
            let errorDetails = errorText;

            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message || errorMessage;
                errorDetails = JSON.stringify(errorJson.error) || errorDetails;
            } catch {
                
            }

            return NextResponse.json(
                { error: errorMessage, details: errorDetails },
                { status: response.status }
            );
        }

        const result = await response.json();
        const candidate = result.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
            const text = candidate.content.parts[0].text;
            let sources: { uri: string; title: string }[] = [];
            
            const groundingMetadata = candidate.groundingMetadata;
            if (groundingMetadata && groundingMetadata.groundingAttributions) {
                type GroundingAttr = { web?: { uri?: string; title?: string } };
                sources = (groundingMetadata.groundingAttributions as GroundingAttr[]).map((attr) => ({
                    uri: attr.web?.uri || '',
                    title: attr.web?.title || 'External Source',
                }));
            }
            return NextResponse.json({ text, sources });
        }

        return NextResponse.json(
            { error: 'Could not parse response from Gemini API.' },
            { status: 500 }
        );

    } catch (err) {
        console.error('Proxy Route Error:', err);
        return NextResponse.json(
            { error: 'Internal server error during Gemini call.' },
            { status: 500 }
        );
    }
}
