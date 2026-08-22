// Function to intelligently extract parameter names from sample case inputs
export const extractParams = (sampleCases) => {
  if (!sampleCases || sampleCases.length === 0) return ["input"];
  const firstInput = sampleCases[0]?.input;

  if (typeof firstInput === "string" && firstInput.includes("=")) {
    // Matches variable names before '=' (e.g. 's = "anagram", t = "nagaram"' -> ['s', 't'])
    const matches = [...firstInput.matchAll(/([a-zA-Z0-9_]+)\s*=/g)];
    if (matches.length > 0) {
      return matches.map((m) => m[1]);
    }
  }

  return ["input"];
};

export const generateTemplate = (lang, functionName, sampleCases = []) => {
  // Python/Rust style ke liye camelCase ko snake_case mein badalne ke liye
  const snakeCaseName = functionName.replace(/([A-Z])/g, "_$1").toLowerCase();

  // Extract parameter names dynamically
  const params = extractParams(sampleCases);
  const rawParamsStr = params.join(", ");

  const templates = {
    javascript: `function ${functionName}(${rawParamsStr}) {\n    // Write your JS code here\n    \n}`,
    typescript: `function ${functionName}(${params.map((p) => `${p}: any`).join(", ")}): any {\n    // Write your TS code here\n    \n}`,
    python: `def ${snakeCaseName}(${rawParamsStr}):\n    # Write your Python code here\n    pass`,
    python3: `def ${snakeCaseName}(${rawParamsStr}):\n    # Write your Python 3 code here\n    pass`,
    cpp: `#include <iostream>\nusing namespace std;\n\nclass Solution {\npublic:\n    void ${functionName}(${params.map((p) => `auto ${p}`).join(", ")}) {\n        // Write your C++ code here\n        \n    }\n};`,
    c: `void ${functionName}(${params.map((p) => `void* ${p}`).join(", ")}) {\n    // Write your C code here\n    \n}`,
    java: `class Solution {\n    public Object ${functionName}(${params.map((p) => `Object ${p}`).join(", ")}) {\n        // Write your Java code here\n        return null;\n    }\n}`,
    csharp: `public class Solution {\n    public object ${functionName}(${params.map((p) => `object ${p}`).join(", ")}) {\n        // Write your C# code here\n        return null;\n    }\n}`,
    go: `func ${functionName}(${params.map((p) => `${p} interface{}`).join(", ")}) {\n    // Write your Go code here\n    \n}`,
    kotlin: `class Solution {\n    fun ${functionName}(${params.map((p) => `${p}: Any`).join(", ")}) {\n        // Write your Kotlin code here\n        \n    }\n}`,
    swift: `class Solution {\n    func ${functionName}(${params.map((p) => `_ ${p}: Any`).join(", ")}) {\n        // Write your Swift code here\n        \n    }\n}`,
    rust: `impl Solution {\n    pub fn ${snakeCaseName}(${rawParamsStr}) {\n        // Write your Rust code here\n        \n    }\n}`,
    ruby: `def ${snakeCaseName}(${rawParamsStr})\n    # Write your Ruby code here\nend`,
    php: `class Solution {\n    function ${functionName}(${params.map((p) => `$${p}`).join(", ")}) {\n        // Write your PHP code here\n        \n    }\n}`,
    dart: `class Solution {\n    void ${functionName}(${params.map((p) => `dynamic ${p}`).join(", ")}) {\n        // Write your Dart code here\n        \n    }\n}`,
    scala: `object Solution {\n    def ${functionName}(${params.map((p) => `${p}: Any`).join(", ")}): Unit = {\n        // Write your Scala code here\n        \n    }\n}`,
    elixir: `defmodule Solution do\n  def ${snakeCaseName}(${rawParamsStr}) do\n    # Write your Elixir code here\n  end\nend`,
    erlang: `-module(solution).\n-export([${snakeCaseName}/${params.length}]).\n\n${snakeCaseName}(${params.map((p) => p.toUpperCase()).join(", ")}) ->\n  %% Write your Erlang code here\n  ok.`,
    racket: `(define (${functionName.toLowerCase()} ${params.join(" ")})\n  ;; Write your Racket code here\n  (void)\n)`,
  };

  return templates[lang] || `// Start coding here...`;
};
