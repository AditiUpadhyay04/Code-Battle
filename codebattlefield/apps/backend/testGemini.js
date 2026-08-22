require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });

  try {
    console.log("Testing with gemini-3.6-flash...");
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: "Return JSON: {\"status\": \"success\", \"message\": \"API working perfectly\"}",
      config: { responseMimeType: "application/json" }
    });

    console.log("✅ Success Response:\n", response.text);
  } catch (err) {
    console.error("❌ Error:\n", err.message);
  }
}

test();