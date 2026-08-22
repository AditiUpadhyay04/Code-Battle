require("dotenv").config();
const { GoogleGenAI, Type } = require("@google/genai");

const QUESTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
    example: { type: Type.STRING },
    base_code: { type: Type.STRING },
    base_codes: {
      type: Type.OBJECT,
      properties: {
        javascript: { type: Type.STRING },
        python: { type: Type.STRING },
        cpp: { type: Type.STRING },
        java: { type: Type.STRING },
      },
      required: ["javascript"],
    },
    sample_cases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          input: { type: Type.STRING },
          expected: { type: Type.STRING },
        },
        required: ["input", "expected"],
      },
    },
    hidden_cases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          input: { type: Type.STRING },
          expected: { type: Type.STRING },
        },
        required: ["input", "expected"],
      },
    },
  },
  required: [
    "title",
    "description",
    "difficulty",
    "example",
    "base_code",
    "base_codes",
    "sample_cases",
    "hidden_cases",
  ],
};

async function generateCodingProblem(difficulty = "Easy", category = "Arrays") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing in backend .env");
  }

  const ai = new GoogleGenAI({ apiKey });
  const cleanDifficulty = ["Easy", "Medium", "Hard"].includes(difficulty)
    ? difficulty
    : "Easy";

  const prompt = `Generate a genuine LeetCode-style problem strictly matching difficulty: ${cleanDifficulty}.
Topic: ${category}

STRICT REQUIREMENTS:
1. "difficulty" must be exactly "${cleanDifficulty}".
2. base_code must provide an executable JavaScript starter function.
3. sample_cases: Provide 2 valid test cases with clear input & expected strings.
4. hidden_cases: Provide 3 edge cases (e.g. negative numbers, empty arrays, duplicates).`;

  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: QUESTION_SCHEMA,
      temperature: 0.7,
    },
  });

  const rawText = response.text;
  if (!rawText) throw new Error("Empty response received from Gemini.");

  const parsed = JSON.parse(rawText);
  parsed.difficulty = cleanDifficulty;

  return parsed;
}

module.exports = { generateCodingProblem };
