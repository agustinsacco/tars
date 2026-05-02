import { GoogleGenAI } from '@google/genai';

async function test() {
    console.log('Initializing client...');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    console.log('Making API call...');
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: 'Hello! Please say hi.'
        });

        console.log('Response text:', response.text);

        // Let's see if we can access the original fetch response headers somehow
        console.log('Response keys:', Object.keys(response));

        // Maybe the web client or something has it
        if ((response as any).headers) {
            console.log('Headers:', (response as any).headers);
        } else {
            console.log('No headers found on response.');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
