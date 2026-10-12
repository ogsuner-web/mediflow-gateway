const { GoogleGenerativeAI } = require('@google/generative-ai');

// Modelos baratos con respaldo; alias "-latest" para no romperse cuando Google retira una versión.
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash'];

async function geminiGenerate(parts, { retries = 2 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Falta GEMINI_API_KEY en el gateway');
  const genAI = new GoogleGenerativeAI(key);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const name of MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent(parts);
        return result.response.text();
      } catch (err) { lastError = err; }
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 1000));
  }
  throw lastError || new Error('Gemini no respondió');
}

module.exports = { geminiGenerate };
