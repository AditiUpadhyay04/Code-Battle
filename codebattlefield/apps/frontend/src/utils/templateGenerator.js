export const generateTemplate = (lang, functionName) => {
  // Python/Rust style ke liye camelCase ko snake_case mein badalne ke liye
  const snakeCaseName = functionName.replace(/([A-Z])/g, "_$1").toLowerCase();

  const templates = {
    javascript: `function ${functionName}() {\n    // Write your JS code here\n}`,
    typescript: `function ${functionName}(): any {\n    // Write your TS code here\n}`,
    python: `def ${snakeCaseName}():\n    # Write your Python code here\n    pass`,
    python3: `def ${snakeCaseName}():\n    # Write your Python 3 code here\n    pass`,
    cpp: `#include <iostream>\nclass Solution {\npublic:\n    void ${functionName}() {\n        // Write your C++ code here\n    }\n};`,
    c: `void ${functionName}() {\n    // Write your C code here\n}`,
    java: `class Solution {\n    public void ${functionName}() {\n        // Write your Java code here\n    }\n}`,
    csharp: `public class Solution {\n    public void ${functionName}() {\n        // Write your C# code here\n    }\n}`,
    go: `func ${functionName}() {\n    // Write your Go code here\n}`,
    kotlin: `class Solution {\n    fun ${functionName}() {\n        // Write your Kotlin code here\n    }\n}`,
    swift: `class Solution {\n    func ${functionName}() {\n        // Write your Swift code here\n    }\n}`,
    rust: `impl Solution {\n    pub fn ${snakeCaseName}() {\n        // Write your Rust code here\n    }\n}`,
    ruby: `def ${snakeCaseName}\n    # Write your Ruby code here\nend`,
    php: `class Solution {\n    function ${functionName}() {\n        // Write your PHP code here\n    }\n}`,
    dart: `class Solution {\n  void ${functionName}() {\n    // Write your Dart code here\n  }\n}`,
    scala: `object Solution {\n    def ${functionName}(): Unit = {\n        // Write your Scala code here\n    }\n}`,
    elixir: `defmodule Solution do\n  def ${snakeCaseName} do\n    # Write your Elixir code here\n  end\nend`,
    erlang: `-module(solution).\n-export([${snakeCaseName}/0]).\n\n${snakeCaseName}() ->\n  %% Write your Erlang code here\n  ok.`,
    racket: `(define (${functionName.toLowerCase()})\n  ;; Write your Racket code here\n  (void)\n)`
  };

  return templates[lang] || `// Start coding here...`;
};