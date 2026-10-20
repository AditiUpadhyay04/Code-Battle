const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { generateCodingProblem } = require("./geminiService");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const vm = require("vm");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const DIFFICULTY_TIMERS = { Easy: 10 * 60, Medium: 20 * 60, Hard: 30 * 60 };
let matchmakingPools = { Easy: [], Medium: [], Hard: [] };
let activeRooms = {};

// Helper: Sanitize function names (handle names starting with numbers like 3Sum -> _3Sum)
function getSafeFunctionName(prob) {
  let fnName = prob?.function_name;
  if (!fnName && prob?.title) {
    fnName = prob.title
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (w, i) =>
        i === 0 ? w.toLowerCase() : w.toUpperCase(),
      )
      .replace(/\s+/g, "");
  }
  if (fnName && /^\d/.test(fnName)) {
    fnName = `_${fnName}`;
  }
  return fnName || "solution";
}

// ─── STRICT DIFFICULTY PROBLEM RESOLVER ───
async function getStrictBattleProblem(difficulty = "Easy") {
  const cleanDifficulty = ["Easy", "Medium", "Hard"].includes(difficulty)
    ? difficulty
    : "Easy";

  try {
    const { data: dbProblems, error } = await supabase
      .from("problems")
      .select("*")
      .ilike("difficulty", cleanDifficulty);

    let chosenProblem = null;

    if (!error && dbProblems && dbProblems.length > 0) {
      chosenProblem = dbProblems[Math.floor(Math.random() * dbProblems.length)];
    }

    if (!chosenProblem) {
      console.log(`⚡ Generating on-demand [${cleanDifficulty}] problem...`);
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Gemini Timeout")), 4000),
        );
        const generated = await Promise.race([
          generateCodingProblem(cleanDifficulty, "Arrays"),
          timeoutPromise,
        ]);

        if (generated && generated.title) {
          const { data: saved } = await supabase
            .from("problems")
            .insert([
              {
                title: generated.title.trim(),
                description: generated.description,
                difficulty: cleanDifficulty,
                base_code: generated.base_code,
                example: generated.example,
                base_codes: generated.base_codes,
                sample_cases: generated.sample_cases,
                hidden_cases: generated.hidden_cases,
              },
            ])
            .select()
            .single();

          chosenProblem = saved || {
            ...generated,
            difficulty: cleanDifficulty,
          };
        }
      } catch (genErr) {
        console.warn("⚠️ On-demand generation error:", genErr.message);
      }
    }

    if (!chosenProblem) {
      const fallbackList = {
        Easy: {
          id: 101,
          title: "Two Sum",
          difficulty: "Easy",
          description:
            "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
          base_code: "function twoSum(nums, target) {\n  // Write code here\n}",
          sample_cases: [
            { input: "nums = [2,7,11,15], target = 9", expected: "[0,1]" },
          ],
          hidden_cases: [
            { input: "nums = [3,2,4], target = 6", expected: "[1,2]" },
          ],
        },
        Medium: {
          id: 201,
          title: "3Sum",
          difficulty: "Medium",
          description:
            "Given an integer array nums, return all unique triplets [nums[i], nums[j], nums[k]] such that i != j != k and nums[i] + nums[j] + nums[k] == 0.",
          base_code: "function _3Sum(nums) {\n  // Write code here\n}",
          sample_cases: [
            {
              input: "nums = [-1,0,1,2,-1,-4]",
              expected: "[[-1,-1,2],[-1,0,1]]",
            },
          ],
          hidden_cases: [{ input: "nums = [0,1,1]", expected: "[]" }],
        },
        Hard: {
          id: 301,
          title: "Trapping Rain Water",
          difficulty: "Hard",
          description:
            "Given n non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining.",
          base_code: "function trap(height) {\n  // Write code here\n}",
          sample_cases: [
            { input: "height = [0,1,0,2,1,0,1,3,2,1,2,1]", expected: "6" },
          ],
          hidden_cases: [{ input: "height = [4,2,0,3,2,5]", expected: "9" }],
        },
      };
      chosenProblem = fallbackList[cleanDifficulty];
    }

    generateCodingProblem(cleanDifficulty, "Arrays")
      .then(async (fresh) => {
        if (fresh && fresh.title) {
          await supabase.from("problems").insert([
            {
              title: fresh.title.trim(),
              description: fresh.description,
              difficulty: cleanDifficulty,
              base_code: fresh.base_code,
              example: fresh.example,
              base_codes: fresh.base_codes,
              sample_cases: fresh.sample_cases,
              hidden_cases: fresh.hidden_cases,
            },
          ]);
        }
      })
      .catch(() => {});

    return chosenProblem;
  } catch (err) {
    console.error("❌ Problem retrieval error:", err.message);
    return null;
  }
}

function getRankTier(rating) {
  if (rating >= 2100) return "Master";
  if (rating >= 1800) return "Diamond";
  if (rating >= 1500) return "Platinum";
  if (rating >= 1300) return "Gold";
  if (rating >= 1200) return "Silver";
  if (rating >= 1100) return "Bronze II";
  return "Bronze I";
}

async function updatePlayerMatchStats(winnerName, loserName) {
  try {
    let updatedProfiles = {};
    const { data: winUser } = await supabase
      .from("profiles")
      .select("*")
      .ilike("username", winnerName.trim())
      .single();
    const { data: loseUser } = await supabase
      .from("profiles")
      .select("*")
      .ilike("username", loserName.trim())
      .single();

    if (winUser) {
      const winMatches = (Number(winUser.matches_played) || 0) + 1;
      const totalWins = (Number(winUser.wins) || 0) + 1;
      const winRating = (Number(winUser.elo_rating) || 1000) + 25;
      const { data: updatedWin } = await supabase
        .from("profiles")
        .update({
          matches_played: winMatches,
          wins: totalWins,
          streak: (Number(winUser.streak) || 0) + 1,
          elo_rating: winRating,
          rank: getRankTier(winRating),
          win_rate: `${Math.round((totalWins / winMatches) * 100)}%`,
        })
        .eq("id", winUser.id)
        .select()
        .single();
      if (updatedWin) updatedProfiles[winnerName] = updatedWin;
    }

    if (loseUser) {
      const loseMatches = (Number(loseUser.matches_played) || 0) + 1;
      const loseWins = Number(loseUser.wins) || 0;
      const loseRating = Math.max(
        100,
        (Number(loseUser.elo_rating) || 1000) - 15,
      );
      const { data: updatedLose } = await supabase
        .from("profiles")
        .update({
          matches_played: loseMatches,
          streak: 0,
          elo_rating: loseRating,
          rank: getRankTier(loseRating),
          win_rate: `${Math.round((loseWins / loseMatches) * 100)}%`,
        })
        .eq("id", loseUser.id)
        .select()
        .single();
      if (updatedLose) updatedProfiles[loserName] = updatedLose;
    }

    return updatedProfiles;
  } catch (e) {
    console.error("❌ Stats update error:", e.message);
    return null;
  }
}

// ─── ROBUST NODE VM IN-MEMORY EVALUATION ───
// ─── ROBUST NODE VM IN-MEMORY EVALUATION (SAFE LOOKUP) ───
function executeSandbox(userCode, rawInput, rawExpected, funcName) {
  try {
    let argsArray = [];

    if (typeof rawInput === "string") {
      const trimmed = rawInput.trim();

      if (trimmed.includes("=") && !trimmed.startsWith("[")) {
        const regex =
          /[a-zA-Z0-9_]+\s*=\s*(\[.*?\]|\{.*?\}|".*?"|'.*?'|[^,]+)/g;
        let match;
        while ((match = regex.exec(trimmed)) !== null) {
          const val = match[1].trim();
          try {
            argsArray.push(JSON.parse(val));
          } catch {
            argsArray.push(val.replace(/^["']|["']$/g, ""));
          }
        }
      } else {
        try {
          argsArray = [JSON.parse(trimmed)];
        } catch {
          argsArray = [trimmed];
        }
      }
    } else if (Array.isArray(rawInput)) {
      argsArray = [rawInput];
    } else {
      argsArray = [rawInput];
    }

    const sandbox = {
      args: argsArray,
      result: undefined,
      console: { log: () => {} },
    };

    const context = vm.createContext(sandbox);

    // Safe property lookup bina direct variable execution ke:
    const safeLookupKey = JSON.stringify(funcName || "solution");

    const scriptText = `
      ${userCode}
      
      let fn = null;
      const targetName = ${safeLookupKey};

      // 1. Check exact name in context
      if (typeof this[targetName] === 'function') {
        fn = this[targetName];
      }

      // 2. Check underscore prefixed name (_3Sum)
      if (!fn && typeof this['_' + targetName] === 'function') {
        fn = this['_' + targetName];
      }

      // 3. Fallback: Pick the last declared user function in scope
      if (!fn) {
        const keys = Object.keys(this).filter(k => typeof this[k] === 'function' && !['executeSandbox', 'log'].includes(k));
        if (keys.length > 0) fn = this[keys[keys.length - 1]];
      }

      if (!fn) throw new Error("Function definition not found.");
      result = fn(...args);
    `;

    const script = new vm.Script(scriptText);
    script.runInContext(context, { timeout: 2000 });

    const actual = sandbox.result;
    let expected = rawExpected;

    try {
      if (
        typeof expected === "string" &&
        (expected.startsWith("{") || expected.startsWith("["))
      ) {
        expected = JSON.parse(expected);
      }
    } catch {}

    const isMatch =
      JSON.stringify(actual) === JSON.stringify(expected) ||
      String(actual).trim().toLowerCase() ===
        String(expected).trim().toLowerCase();

    return {
      passed: isMatch,
      actual:
        actual !== undefined
          ? typeof actual === "object"
            ? JSON.stringify(actual)
            : String(actual)
          : "undefined",
      isError: false,
    };
  } catch (e) {
    return {
      passed: false,
      actual: `Error: ${e.message}`,
      isError: true,
    };
  }
}

// ─── API ROUTES ───
app.get("/", (req, res) => res.send("CodeBattle Realtime Engine Online 🚀"));

app.post("/api/auth/check-username", async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== "string" || !username.trim()) {
      return res.status(400).json({
        success: false,
        error: "Username is required",
      });
    }

    const cleanUsername = username.trim();

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (error) {
      console.error("CHECK USERNAME SUPABASE ERROR:", error);

      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      exists: Boolean(data),
      user: data || null,
    });
  } catch (err) {
    console.error("CHECK USERNAME SERVER ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Server check error",
    });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin)
    return res.status(400).json({ error: "Username & PIN required" });
  try {
    const { data, error } = await supabase
      .from("profiles")
      .insert([
        {
          username: username.trim(),
          pin: pin.toString(),
          elo_rating: 1000,
          rank: "Bronze I",
          matches_played: 0,
          wins: 0,
          win_rate: "0%",
          streak: 0,
        },
      ])
      .select()
      .single();
    if (error) throw error;
    return res.json({ success: true, user: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin)
    return res.status(400).json({ error: "Username & PIN required" });
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("username", username.trim())
      .single();
    if (error || !data)
      return res.status(404).json({ error: "User not found" });
    if (data.pin !== pin.toString())
      return res.status(401).json({ error: "Incorrect PIN" });
    const { pin: _, ...userSafeData } = data;
    return res.json({ success: true, user: userSafeData });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("username, rank, elo_rating")
      .order("elo_rating", { ascending: false })
      .limit(5);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ leaderboard: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── SOCKET REALTIME LOGIC ───
io.on("connection", (socket) => {
  console.log("⚡ User Connected:", socket.id);

  // 1. Instant Matchmaking Pool Queue
  socket.on("find_match", ({ username, difficulty }) => {
    const chosenDiff = ["Easy", "Medium", "Hard"].includes(difficulty)
      ? difficulty
      : "Easy";

    Object.keys(matchmakingPools).forEach((diff) => {
      matchmakingPools[diff] = matchmakingPools[diff].filter(
        (p) => p.id !== socket.id,
      );
    });

    matchmakingPools[chosenDiff].push({
      id: socket.id,
      username: username || "Guest",
      difficulty: chosenDiff,
    });

    if (matchmakingPools[chosenDiff].length >= 2) {
      const p1 = matchmakingPools[chosenDiff].shift();
      const p2 = matchmakingPools[chosenDiff].shift();
      const roomId = `battle_${p1.id}_${p2.id}`;

      activeRooms[roomId] = {
        roomId,
        difficulty: chosenDiff,
        players: {
          [p1.id]: { username: p1.username, accepted: false },
          [p2.id]: { username: p2.username, accepted: false },
        },
        acceptedCount: 0,
        timeLeft: DIFFICULTY_TIMERS[chosenDiff] || 600,
        isStarted: false,
        timerInterval: null,
      };

      const s1 = io.sockets.sockets.get(p1.id);
      const s2 = io.sockets.sockets.get(p2.id);

      if (s1 && s2) {
        s1.join(roomId);
        s2.join(roomId);

        io.to(roomId).emit("pre_match_found", {
          roomId,
          players: [p1.username, p2.username],
          difficulty: chosenDiff,
        });
      }
    }
  });

  // 2. Accept Match
  socket.on("accept_match", async ({ roomId }) => {
    const room = activeRooms[roomId];
    if (!room || !room.players || !room.players[socket.id]) return;

    socket.join(roomId);

    if (!room.players[socket.id].accepted) {
      room.players[socket.id].accepted = true;
      room.acceptedCount += 1;
    }

    io.to(roomId).emit("player_accepted_update", {
      acceptedPlayers: Object.values(room.players).map((p) => ({
        username: p.username,
        accepted: p.accepted,
      })),
    });

    if (room.acceptedCount === 2 && !room.isStarted) {
      room.isStarted = true;

      try {
        const selectedProblem = await getStrictBattleProblem(room.difficulty);
        room.problem = selectedProblem;

        io.to(roomId).emit("match_start", {
          roomId,
          problem: selectedProblem,
          difficulty: room.difficulty,
          players: Object.values(room.players).map((p) => p.username),
          duration: room.timeLeft,
        });

        if (room.timerInterval) clearInterval(room.timerInterval);

        room.timerInterval = setInterval(() => {
          const currentRoom = activeRooms[roomId];
          if (!currentRoom) {
            clearInterval(room.timerInterval);
            return;
          }

          if (currentRoom.timeLeft > 0) {
            currentRoom.timeLeft--;
            io.to(roomId).emit("timer_tick", {
              timeLeft: currentRoom.timeLeft,
            });
          } else {
            clearInterval(currentRoom.timerInterval);
            io.to(roomId).emit("battle_result", {
              status: "Failed",
              message: "⌛ TIME OUT! The match ended in a draw.",
            });
            delete activeRooms[roomId];
          }
        }, 1000);
      } catch (err) {
        console.error("Match start error:", err.message);
      }
    }
  });

  // 3. Create Custom Room
  socket.on("create_custom_room", ({ username, difficulty }) => {
    const chosenDiff = ["Easy", "Medium", "Hard"].includes(difficulty)
      ? difficulty
      : "Easy";
    const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    const roomId = `custom_${roomCode}`;

    activeRooms[roomId] = {
      roomId,
      roomCode,
      difficulty: chosenDiff,
      players: {
        [socket.id]: { username: username || "Player 1", accepted: true },
      },
      acceptedCount: 1,
      isCustom: true,
      timeLeft: DIFFICULTY_TIMERS[chosenDiff] || 600,
      isStarted: false,
      timerInterval: null,
    };

    socket.join(roomId);

    socket.emit("custom_room_created", {
      roomId,
      roomCode,
      difficulty: chosenDiff,
    });
  });

  // 4. Join Custom Room
  socket.on("join_custom_room", async ({ username, roomCode }) => {
    const cleanCode = roomCode.toString().trim();
    const roomId = `custom_${cleanCode}`;
    const room = activeRooms[roomId];

    if (!room) {
      return socket.emit("custom_room_error", {
        message: "Room not found. Check the 6-digit code.",
      });
    }

    if (Object.keys(room.players).length >= 2) {
      return socket.emit("custom_room_error", {
        message: "Room is already full.",
      });
    }

    room.players[socket.id] = {
      username: username || "Player 2",
      accepted: true,
    };
    room.acceptedCount = 2;
    room.isStarted = true;
    socket.join(roomId);

    try {
      const selectedProblem = await getStrictBattleProblem(room.difficulty);
      room.problem = selectedProblem;

      io.to(roomId).emit("match_start", {
        roomId,
        problem: selectedProblem,
        difficulty: room.difficulty,
        players: Object.values(room.players).map((p) => p.username),
        duration: room.timeLeft,
      });

      if (room.timerInterval) clearInterval(room.timerInterval);

      room.timerInterval = setInterval(() => {
        const currentRoom = activeRooms[roomId];
        if (!currentRoom) {
          clearInterval(room.timerInterval);
          return;
        }

        if (currentRoom.timeLeft > 0) {
          currentRoom.timeLeft--;
          io.to(roomId).emit("timer_tick", {
            timeLeft: currentRoom.timeLeft,
          });
        } else {
          clearInterval(currentRoom.timerInterval);
          io.to(roomId).emit("battle_result", {
            status: "Failed",
            message: "⌛ TIME OUT! The match ended in a draw.",
          });
          delete activeRooms[roomId];
        }
      }, 1000);
    } catch (err) {
      console.error("1v1 Custom Room start error:", err.message);
    }
  });

  // 5. Code Run (Sample Cases + Progress Sync)
  socket.on("run_code", async ({ roomId, code, problemId }) => {
    console.log("✅ BACKEND RECEIVED run_code EVENT");
    try {
      let targetRoomId = roomId;
      let room = activeRooms[targetRoomId];

      if (!room) {
        targetRoomId = Object.keys(activeRooms).find(
          (rId) => activeRooms[rId]?.players?.[socket.id],
        );
        room = activeRooms[targetRoomId];
      }

      let prob = room?.problem;
      if (!prob && problemId) {
        const { data: dbProb } = await supabase
          .from("problems")
          .select("*")
          .eq("id", problemId)
          .maybeSingle();
        prob = dbProb;
      }

      const sampleCases = prob?.sample_cases || [];
      const functionName = getSafeFunctionName(prob);

      let testResults = [];
      let allPassed = true;
      let runtimeError = null;
      let passedCount = 0;

      for (let i = 0; i < sampleCases.length; i++) {
        const tc = sampleCases[i];
        const expectedVal = tc.expected !== undefined ? tc.expected : tc.output;
        const res = executeSandbox(code, tc.input, expectedVal, functionName);

        if (res.isError) {
          runtimeError = res.actual;
          allPassed = false;
          break;
        }

        if (res.passed) {
          passedCount++;
        } else {
          allPassed = false;
        }

        testResults.push({
          caseNumber: i + 1,
          input:
            typeof tc.input === "object"
              ? JSON.stringify(tc.input)
              : String(tc.input),
          expected:
            typeof expectedVal === "object"
              ? JSON.stringify(expectedVal)
              : String(expectedVal),
          actual: res.actual,
          passed: res.passed,
        });
      }

      socket.emit("run_result", {
        success: allPassed,
        compileError: runtimeError,
        testResults,
      });
    } catch (err) {
      socket.emit("run_result", {
        success: false,
        compileError: err.message,
        testResults: [],
      });
    }
  });

  // 6. Code Submit (Final Evaluation + Progress Sync + Winner Assignment)
  socket.on("submit_code", async ({ roomId, code, problemId, username }) => {
    try {
      if (!code || code.trim().length < 10) {
        return socket.emit("evaluation_result", {
          success: false,
          compileError: "Please write code before submitting.",
          testResults: [],
        });
      }

      let targetRoomId = roomId;
      let room = activeRooms[targetRoomId];

      if (!room) {
        targetRoomId = Object.keys(activeRooms).find(
          (rId) => activeRooms[rId]?.players?.[socket.id],
        );
        room = activeRooms[targetRoomId];
      }

      let prob = room?.problem;
      if (!prob && problemId) {
        const { data: dbProb } = await supabase
          .from("problems")
          .select("*")
          .eq("id", problemId)
          .maybeSingle();
        prob = dbProb;
      }

      const sampleCases = prob?.sample_cases || [];
      const hiddenCases = prob?.hidden_cases || [];
      const allTestcases = [
        ...sampleCases.map((tc) => ({ ...tc, isHidden: false })),
        ...hiddenCases.map((tc) => ({ ...tc, isHidden: true })),
      ];

      const functionName = getSafeFunctionName(prob);

      let testResults = [];
      let allPassed = true;
      let runtimeError = null;
      let passedCount = 0;

      for (let i = 0; i < allTestcases.length; i++) {
        const tc = allTestcases[i];
        const expectedVal = tc.expected !== undefined ? tc.expected : tc.output;
        const res = executeSandbox(code, tc.input, expectedVal, functionName);

        if (res.isError) {
          runtimeError = res.actual;
          allPassed = false;
          break;
        }
        if (!res.passed) {
          allPassed = false;
        } else {
          passedCount++;
        }

        testResults.push({
          caseNumber: i + 1,
          isHidden: tc.isHidden,
          input: tc.isHidden ? "Hidden Case" : String(tc.input),
          expected: tc.isHidden ? "Hidden Output" : String(expectedVal),
          actual: tc.isHidden ? (res.passed ? "Passed" : "Failed") : res.actual,
          passed: res.passed,
        });
      }

      socket.emit("evaluation_result", {
        success: allPassed,
        compileError: runtimeError,
        testResults,
      });

      if (allPassed && !runtimeError && testResults.length > 0) {
        let winnerUsername = username || room?.players?.[socket.id]?.username;
        let loserUsername = null;

        if (room && room.players) {
          const loserId = Object.keys(room.players).find(
            (id) => id !== socket.id,
          );
          loserUsername = room.players[loserId]?.username;
        }

        if (room?.timerInterval) clearInterval(room.timerInterval);

        const updatedProfiles = await updatePlayerMatchStats(
          winnerUsername,
          loserUsername || "Opponent",
        );

        socket.emit("battle_result", {
          status: "Success",
          isWinner: true,
          message: "🎉 ACCEPTED! All test cases passed.",
          updatedUser: updatedProfiles ? updatedProfiles[winnerUsername] : null,
        });

        socket.to(targetRoomId).emit("battle_result", {
          status: "Success",
          isWinner: false,
          message: "Match Ended! Opponent solved all test cases first.",
          updatedUser:
            loserUsername && updatedProfiles
              ? updatedProfiles[loserUsername]
              : null,
        });

        delete activeRooms[targetRoomId];
      }
    } catch (err) {
      socket.emit("evaluation_result", {
        success: false,
        compileError: err.message,
        testResults: [],
      });
    }
  });

  // ─── SURRENDER / FORFEIT MATCH ───
  socket.on("surrender_match", async ({ roomId, username }) => {
    try {
      let targetRoomId = roomId;
      let room = activeRooms[targetRoomId];

      if (!room) {
        targetRoomId = Object.keys(activeRooms).find(
          (rId) => activeRooms[rId]?.players?.[socket.id],
        );
        room = activeRooms[targetRoomId];
      }

      if (!room || !room.isStarted) return;

      if (room.timerInterval) clearInterval(room.timerInterval);

      const surrenderingUser =
        username || room.players[socket.id]?.username || "Player";
      const opponentId = Object.keys(room.players).find(
        (id) => id !== socket.id,
      );
      const opponentUser = opponentId
        ? room.players[opponentId]?.username
        : "Opponent";

      // Stats update (Opponent = Winner, Surrendering User = Loser)
      const updatedProfiles = await updatePlayerMatchStats(
        opponentUser,
        surrenderingUser,
      );

      // 1. Surrender karne wale ko Defeat bhejo
      socket.emit("battle_result", {
        status: "Defeat",
        isWinner: false,
        message: `🏳️ You surrendered the match.`,
        updatedUser: updatedProfiles ? updatedProfiles[surrenderingUser] : null,
      });

      // 2. Opponent ko Victory bhejo
      if (opponentId) {
        socket.to(targetRoomId).emit("battle_result", {
          status: "Success",
          isWinner: true,
          message: `🏆 Opponent (${surrenderingUser}) forfeited. You win!`,
          updatedUser: updatedProfiles ? updatedProfiles[opponentUser] : null,
        });
      }

      delete activeRooms[targetRoomId];
    } catch (err) {
      console.error("Surrender error:", err.message);
    }
  });

  socket.on("code_update", ({ roomId, code }) =>
    socket.to(roomId).emit("opponent_code", code),
  );

  // 7. Leave / Decline Match Handler (Notifies Opponent with Modal Popup)
  socket.on("leave_queue", () => {
    Object.keys(matchmakingPools).forEach((diff) => {
      matchmakingPools[diff] = matchmakingPools[diff].filter(
        (p) => p.id !== socket.id,
      );
    });

    Object.keys(activeRooms).forEach((roomId) => {
      const room = activeRooms[roomId];
      if (room.players && room.players[socket.id]) {
        const decliningPlayerName =
          room.players[socket.id]?.username || "Opponent";

        // Agar match start nahi hua tha (PreMatch stage mein decline kiya)
        if (!room.isStarted) {
          socket.to(roomId).emit("match_declined_by_opponent", {
            title: "🚫 MATCH DECLINED",
            message: `${decliningPlayerName} declined the match request. Returning to lobby...`,
          });
        }

        if (room.timerInterval) clearInterval(room.timerInterval);
        delete activeRooms[roomId];
      }
    });

    socket.emit("queue_left");
  });

  socket.on("disconnect", () => {
    Object.keys(matchmakingPools).forEach((diff) => {
      matchmakingPools[diff] = matchmakingPools[diff].filter(
        (p) => p.id !== socket.id,
      );
    });

    Object.keys(activeRooms).forEach((roomId) => {
      const room = activeRooms[roomId];
      if (room.players && room.players[socket.id]) {
        if (room.timerInterval) clearInterval(room.timerInterval);
        socket.to(roomId).emit("opponent_disconnected_draw", {
          message: "Opponent disconnected. Match ended.",
        });
        delete activeRooms[roomId];
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () =>
  console.log(`🚀 Advanced backend running on port ${PORT}`),
);
