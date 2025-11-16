import { useState, useCallback, useEffect } from 'react';

// Minimal typings for browsers' Web Speech API (standard + webkit)
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionResultLike {
    transcript: string;
}

interface SpeechRecognitionEventLike {
    results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
}

interface SpeechRecognitionErrorLike {
    error: string;
}

interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (() => void) | null;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
}

interface WindowWithSpeechRecognition extends Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

const SpeechRecognitionCtor: SpeechRecognitionConstructor | undefined =
    typeof window !== 'undefined'
        ? ((window as WindowWithSpeechRecognition).SpeechRecognition ||
             (window as WindowWithSpeechRecognition).webkitSpeechRecognition)
        : undefined;

export const useVoiceInput = (onTranscript: (transcript: string) => void, language: string = 'ja-JP') => {
    const [isListening, setIsListening] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);

    const isSupported = !!SpeechRecognitionCtor;

    
    const [recognition, setRecognition] = useState<SpeechRecognitionInstance | null>(null);

    useEffect(() => {
        if (isSupported && SpeechRecognitionCtor) {
            const rec = new SpeechRecognitionCtor();
            rec.continuous = false; 
            rec.interimResults = false;
            rec.lang = language; 

            rec.onstart = () => {
                setIsListening(true);
                setVoiceError(null);
            };

            rec.onresult = (event: SpeechRecognitionEventLike) => {
                try {
                    if (event.results && event.results[0] && event.results[0][0]) {
                        const transcript = event.results[0][0].transcript;
                        console.log('Voice transcript received:', transcript);
                        onTranscript(transcript);
                    } else {
                        console.warn('No valid transcript in voice recognition result');
                    }
                } catch (error) {
                    console.error('Error processing voice transcript:', error);
                    setVoiceError('Error processing voice input');
                }
            };

            rec.onerror = (event: SpeechRecognitionErrorLike) => {
                console.error('Speech recognition error:', event.error);
                if (event.error !== 'no-speech') {
                    setVoiceError(`Voice error: ${event.error}.`);
                }
                setIsListening(false);
            };

            rec.onend = () => {
                setIsListening(false);
            };

            setRecognition(rec);
        }
    }, [isSupported, onTranscript, language]);

    const startListening = useCallback(() => {
        if (!recognition) {
            setVoiceError('Voice recognition not initialized or supported.');
            return;
        }

        // Stop any previous instance before starting
        if (isListening) {
            recognition.stop();
            return;
        }

        try {
            recognition.start();
        } catch (e: unknown) {
            
            if (e instanceof Error && e.name !== 'InvalidStateError') {
                setVoiceError(`Voice start error: ${e.message}`);
            }
        }
    }, [recognition, isListening]);

    return {
        isListening,
        voiceError,
        isSupported,
        startListening,
    };
};
