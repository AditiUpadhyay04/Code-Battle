import { useEffect, useState, useMemo } from "react";
import { io } from "socket.io-client";
import Editor from "@monaco-editor/react";
import { generateTemplate } from "./utils/templateGenerator";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const AVAILABLE_LANGUAGES = [
  { id: "cpp", name: "C++" },
  { id: "java", name: "Java" },
  { id: "python3", name: "Python3" },
  { id: "python", name: "Python" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "csharp", name: "C#" },
  { id: "c", name: "C" },
  { id: "go", name: "Go" },
  { id: "kotlin", name: "Kotlin" },
  { id: "swift", name: "Swift" },
  { id: "rust", name: "Rust" },
  { id: "ruby", name: "Ruby" },
  { id: "php", name: "PHP" },
  { id: "dart", name: "Dart" },
  { id: "scala", name: "Scala" },
  { id: "elixir", name: "Elixir" },
  { id: "erlang", name: "Erlang" },
  { id: "racket", name: "Racket" },
];

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

function App() {
  const socket = useMemo(() => io(BACKEND_URL), []);

  const [appState, setAppState] = useState("AuthLogin");
  const [inputUsername, setInputUsername] = useState("");
  const [inputPin, setInputPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [loadingUser, setLoadingUser] = useState(false);

  // Custom Room States
  const [customRoomCode, setCustomRoomCode] = useState("");
  const [joinInputCode, setJoinInputCode] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState("");

  const [userId, setUserId] = useState(null);
  const [userStats, setUserStats] = useState({
    username: "",
    rank: "Bronze I",
    matches_played: 0,
    wins: 0,
    win_rate: "0%",
    streak: 0,
    elo_rating: 1000,
  });

  const [isRunningTestcases, setIsRunningTestcases] = useState(false);
  const [runResults, setRunResults] = useState(null);

  const [leaderboard, setLeaderboard] = useState([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState("Easy");

  const [roomId, setRoomId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [problem, setProblem] = useState(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");

  const [timerSeconds, setTimerSeconds] = useState(600);
  const [confirmationCountdown, setConfirmationCountdown] = useState(5);
  const [acceptedList, setAcceptedList] = useState([]);
  const [hasAcceptedCurrentMatch, setHasAcceptedCurrentMatch] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState({
    status: "",
    title: "",
    message: "",
  });

  const [consoleTab, setConsoleTab] = useState("testcases");
  const [selectedTestCaseIndex, setSelectedTestCaseIndex] = useState(0);
  const [testResults, setTestResults] = useState([]);
  const [compileError, setCompileError] = useState("");
  const [isRunningCode, setIsRunningCode] = useState(false);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/leaderboard`);
      const data = await response.json();
      if (data && data.leaderboard) {
        setLeaderboard(data.leaderboard);
      }
    } catch (err) {
      console.error("Leaderboard backend link failed:", err);
    }
  };

  const syncSilentUserData = async (usernameTarget) => {
    if (!usernameTarget) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/check-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameTarget }),
      });
      const data = await res.json();
      if (data && data.exists && data.user) {
        setUserStats({
          username: data.user.username,
          elo_rating: data.user.elo_rating ?? 1000,
          rank: data.user.rank || "Bronze I",
          matches_played: data.user.matches_played ?? 0,
          wins: data.user.wins ?? 0,
          win_rate: data.user.win_rate || "0%",
          streak: data.user.streak ?? 0,
        });
      }
    } catch (e) {
      console.warn("Profile sync error:", e);
    }
  };

  const loadLanguageCode = (currentProblem, lang) => {
    if (!currentProblem) return;
    let rawCode = "";

    if (currentProblem.base_codes && currentProblem.base_codes[lang]) {
      rawCode = currentProblem.base_codes[lang];
    } else {
      let camelCaseFuncName = (currentProblem.title || "solution")
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
          index === 0 ? word.toLowerCase() : word.toUpperCase(),
        )
        .replace(/\s+/g, "");

      if (/^\d/.test(camelCaseFuncName)) {
        camelCaseFuncName = `_${camelCaseFuncName}`;
      }

      rawCode = generateTemplate(lang, camelCaseFuncName);
    }
    let formattedCode = typeof rawCode === "string" ? rawCode : "";
    setCode(formattedCode.replace(/\\n/g, "\n").replace(/\\t/g, "    "));
  };

  // ─── STABLE SOCKET LISTENERS ───
  useEffect(() => {
    fetchLeaderboard();

    const handlePreMatch = (data) => {
      setRoomId(data.roomId);
      setPlayers(data.players || []);
      setAcceptedList(
        (data.players || []).map((p) => ({ username: p, accepted: false })),
      );
      setAppState("PreMatch");
      setConfirmationCountdown(5);
      setHasAcceptedCurrentMatch(false);
    };

    const handleCustomRoomCreated = ({
      roomId: customId,
      roomCode,
      difficulty,
    }) => {
      console.log("Custom room ready:", roomCode);
      setRoomId(customId);
      setCustomRoomCode(roomCode);
      if (difficulty) setSelectedDifficulty(difficulty);
      setIsCreatingRoom(true);
    };

    const handleCustomRoomError = ({ message }) => {
      console.error("Custom Room Error:", message);
      setRoomError(message);
      setTimeout(() => setRoomError(""), 4000);
    };

    const handlePlayerAcceptedUpdate = (data) => {
      setAcceptedList(data.acceptedPlayers || []);
    };

    const handleMatchStart = (data) => {
      setAppState("BattleActive");
      setRoomId(data.roomId);
      setProblem(data.problem);
      if (data.difficulty) setSelectedDifficulty(data.difficulty);
      setPlayers(data.players || []);

      setOpponentProgress({ passed: 0, total: 0, percentage: 0 });

      // 🧹 6-Digit Code aur Custom Room States Clear
      setCustomRoomCode("");
      setJoinInputCode("");
      setIsCreatingRoom(false);
      setRoomError("");

      const initialTime = data.duration || data.timer || 600;
      setTimerSeconds(initialTime);

      setIsRunningCode(false);
      setIsRunningTestcases(false);
      setTestResults([]);
      setCompileError("");
      setIsCreatingRoom(false);

      loadLanguageCode(data.problem, language);
    };

    const handleTimerTick = (data) => {
      console.log("⏱️ Timer Tick Received:", data.timeLeft);
      setTimerSeconds(data.timeLeft);
    };

    const handleEvaluationResult = (data) => {
      setIsRunningCode(false);
      setTestResults(data.testResults || []);
      setCompileError(data.compileError || "");
      if (data.compileError) setConsoleTab("output");
    };

    const handleRunResult = (data) => {
      setIsRunningTestcases(false);
      setRunResults(data);
      if (data.results) setTestResults(data.results);
    };

    const handleBattleResult = (result) => {
      setIsRunningCode(false);
      setIsRunningTestcases(false);
      if (result.status === "Success") {
        setModalData({
          status: result.isWinner ? "Success" : "Defeat",
          title: result.isWinner ? "🏆 VICTORY!" : "💀 DEFEAT",
          message: result.message,
        });
      } else {
        setModalData({
          status: "Failed",
          title: "❌ MATCH OVER",
          message: result.message,
        });
      }

      if (result.updatedUser) {
        setUserStats({
          username: result.updatedUser.username,
          rank: result.updatedUser.rank || "Bronze I",
          matches_played: result.updatedUser.matches_played || 0,
          wins: result.updatedUser.wins || 0,
          win_rate: result.updatedUser.win_rate || "0%",
          streak: result.updatedUser.streak || 0,
          elo_rating: result.updatedUser.elo_rating || 1000,
        });
      }

      setAppState("MatchEnded");
      setShowModal(true);
      fetchLeaderboard();
    };

    const handleDisconnectDraw = (data) => {
      setIsRunningCode(false);
      setModalData({
        status: "Failed",
        title: "💔 DRAW",
        message: data.message,
      });
      setAppState("MatchEnded");
      setShowModal(true);
    };

    // 2. Event list mein add karo
    socket.on("pre_match_found", handlePreMatch);
    socket.on("custom_room_created", handleCustomRoomCreated);
    socket.on("custom_room_error", handleCustomRoomError);
    socket.on("player_accepted_update", handlePlayerAcceptedUpdate);
    socket.on("match_start", handleMatchStart);
    socket.on("timer_tick", handleTimerTick);
    socket.on("evaluation_result", handleEvaluationResult);
    socket.on("run_result", handleRunResult);
    socket.on("battle_result", handleBattleResult);
    socket.on("opponent_disconnected_draw", handleDisconnectDraw);

    return () => {
      socket.off("pre_match_found", handlePreMatch);
      socket.off("custom_room_created", handleCustomRoomCreated);
      socket.off("custom_room_error", handleCustomRoomError);
      socket.off("player_accepted_update", handlePlayerAcceptedUpdate);
      socket.off("match_start", handleMatchStart);
      socket.off("timer_tick", handleTimerTick);
      socket.off("evaluation_result", handleEvaluationResult);
      socket.off("run_result", handleRunResult);
      socket.off("battle_result", handleBattleResult);
      socket.off("opponent_disconnected_draw", handleDisconnectDraw);
    };
  }, [socket]);

  // Language switch sync (Iske theek neeche add karo)
  useEffect(() => {
    if (problem && appState === "BattleActive") {
      loadLanguageCode(problem, language);
    }
  }, [language]);

  useEffect(() => {
    if (appState === "WelcomeHub") {
      fetchLeaderboard();
      const currentName = userStats.username || inputUsername;
      if (currentName) syncSilentUserData(currentName);
    }
  }, [appState]);

  useEffect(() => {
    let interval = null;
    if (appState === "PreMatch" && confirmationCountdown > 0) {
      interval = setInterval(() => {
        setConfirmationCountdown((prev) => prev - 1);
      }, 1000);
    } else if (appState === "PreMatch" && confirmationCountdown === 0) {
      if (!hasAcceptedCurrentMatch) {
        handleLeaveQueue();
      }
    }
    return () => clearInterval(interval);
  }, [appState, confirmationCountdown, hasAcceptedCurrentMatch]);

  const handleCheckUsername = async () => {
    const trimmedName = inputUsername.trim();
    if (!trimmedName) return;

    setLoadingUser(true);
    setAuthError("");

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/check-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedName }),
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthError(data.error || "Server error checking username");
        return;
      }

      if (data.exists) {
        setAppState("PinVerify");
      } else {
        setAppState("PinRegister");
      }
    } catch (err) {
      console.error("Auth check error:", err);
      setAuthError("Server error checking username");
    } finally {
      setLoadingUser(false);
    }
  };

  const handleRegisterWithPin = async () => {
    if (inputPin.trim().length < 4) {
      setAuthError("PIN must be at least 4 digits long.");
      return;
    }

    setLoadingUser(true);
    setAuthError("");

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: inputUsername.trim(),
          pin: inputPin.trim(),
        }),
      });

      const data = await response.json();
      setLoadingUser(false);

      if (!response.ok || !data.success) {
        setAuthError(data.error || "System error during registration.");
        return;
      }

      setUserId(data.user.id);
      setUserStats({
        id: data.user.id,
        username: data.user.username,
        elo_rating: data.user.elo_rating || 1000,
        rank: data.user.rank || "Bronze I",
        matches_played: 0,
        wins: 0,
        win_rate: "0%",
        streak: 0,
      });

      setInputPin("");
      setAppState("WelcomeHub");
    } catch (err) {
      setLoadingUser(false);
      setAuthError("System error during profile storage.");
    }
  };

  const handleVerifyPin = async () => {
    if (inputPin.trim().length < 4) {
      setAuthError("Please enter your 4-digit PIN.");
      return;
    }

    setLoadingUser(true);
    setAuthError("");

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: inputUsername.trim(),
          pin: inputPin.trim(),
        }),
      });

      const data = await response.json();
      setLoadingUser(false);

      if (!response.ok || !data.success) {
        setAuthError(data.error || "❌ INVALID SECRET PIN! Access Denied.");
        return;
      }

      setUserId(data.user.id);
      setUserStats({
        id: data.user.id,
        username: data.user.username,
        elo_rating: data.user.elo_rating || 1000,
        rank: data.user.rank || "Bronze I",
        matches_played: data.user.matches_played || 0,
        wins: data.user.wins || 0,
        win_rate: data.user.win_rate || "0%",
        streak: data.user.streak || 0,
      });

      setInputPin("");
      setAppState("WelcomeHub");
    } catch (err) {
      setLoadingUser(false);
      setAuthError("Authentication server error.");
    }
  };

  const handleCreateCustomRoom = () => {
    setRoomError("");
    const activeUsername = userStats?.username || inputUsername.trim();

    if (!activeUsername) {
      setRoomError("Please login again to create a room.");
      return;
    }

    socket.emit("create_custom_room", {
      username: activeUsername,
      difficulty: selectedDifficulty || "Easy",
    });
  };

  const handleJoinCustomRoom = () => {
    const codeToJoin = joinInputCode.trim();
    if (!codeToJoin || codeToJoin.length < 6) {
      setRoomError("Please enter a valid 6-digit room code.");
      return;
    }

    const activeUsername = userStats?.username || inputUsername.trim();
    if (!activeUsername) {
      setRoomError("Please login again to join.");
      return;
    }

    setRoomError("");
    socket.emit("join_custom_room", {
      username: activeUsername,
      roomCode: codeToJoin,
    });
  };

  const handleLanguageChange = (e) => {
    const selectedLang = e.target.value;
    setLanguage(selectedLang);
    loadLanguageCode(problem, selectedLang);
  };

  const handleCodeChange = (value) => {
    setCode(value || "");
    if (roomId) socket.emit("code_update", { roomId, code: value || "" });
  };

  const handleStartMatchmaking = () => {
    setAppState("Searching");
    socket.emit("find_match", {
      userId: userId || userStats?.id,
      username: userStats.username || inputUsername.trim(),
      difficulty: selectedDifficulty,
    });
  };

  const handleAcceptMatch = () => {
    setHasAcceptedCurrentMatch(true);
    socket.emit("accept_match", { roomId });
  };

  const handleLeaveQueue = () => {
    socket.emit("leave_queue");
    setRoomId(null);
    setIsCreatingRoom(false);
    setAppState("WelcomeHub");
  };

  const handleRunCode = () => {
    if (!problem || !problem.id) {
      alert("Error: Problem data missing.");
      return;
    }

    setIsRunningTestcases(true);
    setConsoleTab("testcases");

    socket.emit("run_code", {
      roomId: roomId,
      code: code || "",
      problemId: problem.id,
      language: language || "javascript",
    });
  };

  const handleResetCode = () => {
    if (!problem) return;
    const confirmReset = window.confirm(
      "Are you sure you want to reset your code to starter template?",
    );
    if (confirmReset) {
      loadLanguageCode(problem, language);
      setTestResults([]);
      setCompileError("");
    }
  };

  const handleSurrenderMatch = () => {
    if (!roomId) return;
    const confirmSurrender = window.confirm(
      "Are you sure you want to surrender? This will count as an immediate defeat.",
    );
    if (confirmSurrender) {
      socket.emit("surrender_match", {
        roomId,
        username: userStats?.username || inputUsername.trim(),
      });
    }
  };
  const handleSubmitCode = () => {
    if (!roomId) {
      alert("Error: Room ID missing. Please rejoin the battle.");
      return;
    }

    if (!problem || !problem.id) {
      alert("Error: Problem data missing.");
      return;
    }

    setIsRunningCode(true);
    setConsoleTab("testcases");

    setTimeout(() => {
      setIsRunningCode(false);
    }, 4000);

    socket.emit("submit_code", {
      roomId,
      code: code || "",
      problemId: problem.id,
      language: language || "javascript",
      userId: userId || userStats?.id,
      username: userStats.username || inputUsername.trim(),
    });
  };

  const formatTimer = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (appState === "AuthLogin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[400px] bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 tracking-wider">
              ENTER CODEBATTLE
            </h1>
            <p className="text-slate-400 text-xs mt-1">
              Set your global battle tag to access profiles
            </p>
          </div>
          <div className="space-y-2 text-left">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Username / Player ID
            </label>
            <input
              type="text"
              value={inputUsername}
              onChange={(e) => setInputUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCheckUsername()}
              placeholder="e.g., CyberNinja"
              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 px-4 py-3 rounded-xl text-sm font-semibold outline-none transition-colors text-slate-200"
            />
            {authError && (
              <p className="text-xs font-bold text-rose-400 mt-1 text-center">
                {authError}
              </p>
            )}
          </div>
          <button
            disabled={loadingUser || !inputUsername.trim()}
            onClick={handleCheckUsername}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-extrabold text-sm tracking-wider transition-all shadow-lg"
          >
            {loadingUser ? "CHECKING ID..." : "CONTINUE"}
          </button>
        </div>
      </div>
    );
  }

  if (appState === "PinRegister") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[400px] bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-6 text-center">
          <div>
            <span className="text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 font-bold px-3 py-1 rounded-full border border-emerald-500/20">
              New Account Detected
            </span>
            <h2 className="text-xl font-black tracking-wide mt-3 text-slate-200">
              Set Secret Login PIN
            </h2>
            <p className="text-slate-400 text-xs mt-1">
              Secure{" "}
              <span className="text-blue-400 font-bold">"{inputUsername}"</span>{" "}
              so other players cannot steal your ranking points.
            </p>
          </div>
          <div className="space-y-2 text-left">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Create a Security PIN
            </label>
            <input
              type="password"
              maxLength={6}
              value={inputPin}
              onChange={(e) => setInputPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleRegisterWithPin()}
              placeholder="e.g., 4721"
              className="w-full text-center bg-slate-950 border border-slate-800 focus:border-emerald-500 px-4 py-3 rounded-xl text-lg font-mono tracking-widest outline-none transition-colors text-slate-200"
            />
            {authError && (
              <p className="text-xs font-bold text-rose-400 mt-1 text-center">
                {authError}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setAppState("AuthLogin");
                setInputPin("");
                setAuthError("");
              }}
              className="w-1/3 py-3 bg-slate-950 border border-slate-800 rounded-xl font-bold text-xs text-slate-400"
            >
              CANCEL
            </button>
            <button
              disabled={inputPin.length < 4 || loadingUser}
              onClick={handleRegisterWithPin}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-extrabold text-xs tracking-wider transition-all shadow-lg"
            >
              {loadingUser ? "CREATING..." : "CREATE PROFILE"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (appState === "PinVerify") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[400px] bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-6 text-center">
          <div>
            <span className="text-[10px] uppercase tracking-widest bg-blue-500/10 text-blue-400 font-bold px-3 py-1 rounded-full border border-blue-500/20">
              Welcome Back
            </span>
            <h2 className="text-xl font-black tracking-wide mt-3 text-slate-200">
              Enter Account PIN
            </h2>
            <p className="text-slate-400 text-xs mt-1">
              Account{" "}
              <span className="text-blue-400 font-bold">"{inputUsername}"</span>{" "}
              is protected. Enter your PIN to proceed.
            </p>
          </div>
          <div className="space-y-2 text-left">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Secret Security PIN
            </label>
            <input
              type="password"
              maxLength={6}
              value={inputPin}
              onChange={(e) => setInputPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleVerifyPin()}
              placeholder="••••"
              className="w-full text-center bg-slate-950 border border-slate-800 focus:border-blue-500 px-4 py-3 rounded-xl text-lg font-mono tracking-widest outline-none transition-colors text-slate-200"
            />
            {authError && (
              <p className="text-xs font-bold text-rose-400 mt-2 text-center">
                {authError}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setAppState("AuthLogin");
                setInputPin("");
                setAuthError("");
              }}
              className="w-1/3 py-3 bg-slate-950 border border-slate-800 rounded-xl font-bold text-xs text-slate-400"
            >
              BACK
            </button>
            <button
              disabled={inputPin.length < 4 || loadingUser}
              onClick={handleVerifyPin}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-extrabold text-xs tracking-wider transition-all shadow-lg"
            >
              {loadingUser ? "VERIFYING..." : "VERIFY & ENTER"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (appState === "WelcomeHub") {
    return (
      <div className="min-h-screen bg-slate-950 text-white font-sans p-6 flex flex-col justify-between selection:bg-blue-500/30">
        <header className="flex justify-between items-center max-w-6xl w-full mx-auto border-b border-slate-900 pb-4">
          <div className="text-xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">
            CODEBATTLE
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setAppState("AuthLogin");
                setUserStats({ username: "" });
              }}
              className="text-xs text-slate-500 hover:text-slate-400 font-bold"
            >
              LOGOUT ({userStats.username || "Guest"})
            </button>
            <div className="flex items-center gap-3 bg-slate-900/60 border border-slate-800/80 px-4 py-2 rounded-xl">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono font-bold tracking-wide text-slate-300">
                SERVER ONLINE
              </span>
            </div>
          </div>
        </header>

        <main className="max-w-6xl w-full mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 my-auto py-8">
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800/80 p-6 rounded-2xl shadow-xl flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-[4px] bg-gradient-to-r from-blue-500 to-indigo-500" />
              <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xl font-black text-blue-400 mb-4 shadow-inner">
                {userStats.username ? userStats.username[0].toUpperCase() : "?"}
              </div>
              <h2 className="text-lg font-bold tracking-wide">
                {userStats.username || "Player"}
              </h2>
              <span className="text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded-full font-black tracking-wider uppercase mt-1">
                {userStats.rank || "Bronze I"}
              </span>

              <div className="w-full border-t border-slate-800/60 my-5" />

              <div className="grid grid-cols-2 gap-2.5 w-full">
                <div className="bg-slate-950/40 p-2.5 border border-slate-800/40 rounded-xl">
                  <div className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    Battles
                  </div>
                  <div className="text-sm font-black text-slate-200 mt-0.5">
                    {userStats.matches_played || 0}
                  </div>
                </div>

                <div className="bg-slate-950/40 p-2.5 border border-slate-800/40 rounded-xl">
                  <div className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    Record (W / L)
                  </div>
                  <div className="text-sm font-black mt-0.5">
                    <span className="text-emerald-400">
                      {userStats.wins || 0}W
                    </span>
                    <span className="text-slate-600 mx-1">/</span>
                    <span className="text-rose-400">
                      {Math.max(
                        0,
                        (userStats.matches_played || 0) - (userStats.wins || 0),
                      )}
                      L
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/40 p-2.5 border border-slate-800/40 rounded-xl">
                  <div className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    Win Rate
                  </div>
                  <div className="text-sm font-black text-emerald-400 mt-0.5">
                    {userStats.win_rate || "0%"}
                  </div>
                </div>

                <div className="bg-slate-950/40 p-2.5 border border-slate-800/40 rounded-xl">
                  <div className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    Rating
                  </div>
                  <div className="text-sm font-black text-amber-400 mt-0.5">
                    🏆 {userStats.elo_rating || 1000}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border-2 border-blue-500/10 p-8 rounded-2xl shadow-2xl flex flex-col justify-between relative overflow-hidden">
            <div className="space-y-2">
              <h3 className="text-2xl font-black tracking-wide">
                Welcome to Arena
              </h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Ready to stress-test your data structure and algorithm runtime
                skills against developers worldwide in a real-time speed battle?
              </p>
            </div>

            <div className="bg-slate-950/60 p-4 border border-slate-800 rounded-xl text-center space-y-1 font-mono text-xs text-slate-400">
              <p className="text-[10px] font-black tracking-wider text-slate-500 uppercase mb-1">
                Combat Rules:
              </p>
              <p>• Clean compilation clears code cases</p>
              <p>• Server validation enforces constraints</p>
              <p>• Faster submittal takes complete victory</p>
            </div>

            <button
              onClick={() => setAppState("DifficultySelect")}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl font-extrabold text-sm tracking-widest uppercase transition-all shadow-lg shadow-blue-500/10"
            >
              Enter Battle Arena
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800/80 p-6 rounded-2xl shadow-xl flex flex-col justify-between">
            <div>
              <p className="text-xs font-black text-slate-400 tracking-wider uppercase mb-3">
                Top Arena Competitors
              </p>
              <div className="space-y-2">
                {leaderboard && leaderboard.length > 0 ? (
                  leaderboard.map((user, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-slate-950/40 border border-slate-800/40 p-3 rounded-xl font-mono text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`font-black w-4 ${idx === 0 ? "text-amber-400" : idx === 1 ? "text-slate-400" : "text-amber-600"}`}
                        >
                          #{idx + 1}
                        </span>
                        <span className="text-slate-300 font-sans font-semibold">
                          {user.username}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-black text-blue-400">
                          {user.rank || "Bronze I"}
                        </div>
                        <div className="text-[9px] text-slate-500">
                          {user.elo_rating} pts
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 text-xs italic text-center py-4">
                    No top players found.
                  </p>
                )}
              </div>
            </div>
          </div>
        </main>

        <footer className="text-center text-[10px] text-slate-600 border-t border-slate-900 pt-4 max-w-6xl w-full mx-auto">
          &copy; 2026 CODEBATTLE ENGINE // ALL SYSTEMS OPERATIONAL.
        </footer>
      </div>
    );
  }

  if (appState === "DifficultySelect") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[450px] bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl text-center space-y-6 relative">
          <button
            onClick={() => {
              setIsCreatingRoom(false);
              setRoomError("");
              setAppState("WelcomeHub");
            }}
            className="absolute top-4 left-4 text-xs text-slate-500 hover:text-slate-400 font-bold"
          >
            ← BACK
          </button>
          <div>
            <h1 className="text-3xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">
              CODE BATTLE
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Select battle difficulty level to enter the pool
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {["Easy", "Medium", "Hard"].map((diff) => (
              <button
                key={diff}
                type="button"
                onClick={() => setSelectedDifficulty(diff)}
                className={`py-4 rounded-xl font-bold tracking-wide transition-all border text-left px-6 relative flex items-center justify-between ${
                  selectedDifficulty === diff
                    ? "bg-blue-600/20 border-blue-500 text-blue-200"
                    : "bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <span>{diff} Match</span>
                <span
                  className={`text-[10px] uppercase px-2 py-0.5 rounded font-black ${
                    diff === "Easy"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : diff === "Medium"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-rose-500/20 text-rose-400"
                  }`}
                >
                  {diff === "Easy" ? "10m" : diff === "Medium" ? "20m" : "30m"}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleStartMatchmaking}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl font-extrabold text-lg transition-all shadow-lg shadow-blue-500/20"
          >
            START BATTLE SEARCH
          </button>

          {/* ─── 1v1 FRIEND CHALLENGE (CUSTOM ROOM) ─── */}
          <div className="mt-6 p-5 bg-slate-900/80 border border-slate-800 rounded-2xl w-full backdrop-blur-md">
            <h3 className="text-base font-bold text-white mb-1 text-center">
              ⚔️ 1v1 Friend Challenge
            </h3>
            <p className="text-xs text-slate-400 text-center mb-4">
              Create a private battle room or join using a 6-digit code.
            </p>

            {roomError && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg text-center font-medium">
                {roomError}
              </div>
            )}

            {!isCreatingRoom ? (
              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleCreateCustomRoom}
                  className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition duration-200 shadow-lg shadow-indigo-600/30"
                >
                  Create Room
                </button>

                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    placeholder="6-digit code"
                    maxLength={6}
                    value={joinInputCode}
                    onChange={(e) => setJoinInputCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-center text-sm font-mono placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleJoinCustomRoom}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition duration-200"
                  >
                    Join
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center p-4 bg-slate-950 border border-indigo-500/30 rounded-xl space-y-2">
                <p className="text-xs text-indigo-400 font-semibold tracking-wider uppercase">
                  Room Code Generated ({selectedDifficulty})
                </p>
                <div className="text-3xl font-black font-mono text-white tracking-widest my-1 select-all bg-indigo-950/40 py-2 rounded-lg border border-indigo-500/20">
                  {customRoomCode}
                </div>
                <p className="text-xs text-slate-400 animate-pulse">
                  Share this code with your friend. Match starts automatically
                  when they join.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingRoom(false);
                    setCustomRoomCode("");
                    setJoinInputCode("");
                    setRoomError("");
                    socket.emit("leave_queue");
                  }}
                  className="text-xs text-slate-500 hover:text-slate-300 underline pt-2 transition-colors cursor-pointer"
                >
                  Cancel Room
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (appState === "Searching") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans">
        <div className="text-center space-y-4">
          <div className="h-12 w-12 border-4 border-t-blue-500 border-slate-800 rounded-full animate-spin mx-auto" />
          <div>
            <h2 className="text-xl font-bold tracking-wide">
              Searching for Opponent...
            </h2>
            <p className="text-slate-500 text-sm mt-1">
              Pooling in{" "}
              <span className="text-blue-400 font-bold">
                {selectedDifficulty}
              </span>{" "}
              matchmaking arena
            </p>
          </div>
          <button
            onClick={handleLeaveQueue}
            className="px-6 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl font-bold text-xs tracking-wider text-slate-400 transition-colors"
          >
            CANCEL SEARCH
          </button>
        </div>
      </div>
    );
  }

  if (appState === "PreMatch") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[480px] bg-slate-900 border-2 border-indigo-500/30 p-8 rounded-2xl shadow-2xl text-center space-y-6">
          <div>
            <div className="text-xs font-black text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-3 py-1 rounded-full w-max mx-auto mb-2 border border-indigo-500/20">
              Opponent Found
            </div>
            <h2 className="text-2xl font-black">
              {players[0] || "User_1"}{" "}
              <span className="text-rose-500 text-sm italic">vs</span>{" "}
              {players[1] || "User_2"}
            </h2>
            <p className="text-slate-400 text-xs mt-1">
              Difficulty Tier Selected: {selectedDifficulty}
            </p>
          </div>

          <div className="text-5xl font-black text-amber-400 tracking-tighter bg-slate-950/60 w-24 h-24 flex items-center justify-center rounded-full mx-auto border border-slate-800 shadow-inner">
            {confirmationCountdown}
          </div>

          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 space-y-2 text-left">
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
              Acceptance Check:
            </p>
            {acceptedList &&
              acceptedList.map((player, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm font-mono"
                >
                  <span className="text-slate-300">{player.username}</span>
                  <span
                    className={
                      player.accepted
                        ? "text-emerald-400 font-bold"
                        : "text-amber-500 animate-pulse"
                    }
                  >
                    {player.accepted ? "READY ✅" : "WAITING... ⏱️"}
                  </span>
                </div>
              ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleLeaveQueue}
              className="flex-1 py-3 bg-slate-950 border border-slate-800 hover:border-rose-500/30 hover:text-rose-400 rounded-xl font-bold text-sm text-slate-400 transition-all"
            >
              DECLINE & LEAVE
            </button>
            <button
              onClick={handleAcceptMatch}
              disabled={hasAcceptedCurrentMatch}
              className={`flex-1 py-3 rounded-xl font-black text-sm transition-all shadow-md ${
                hasAcceptedCurrentMatch
                  ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10"
              }`}
            >
              {hasAcceptedCurrentMatch ? "ACCEPTED ✓" : "ACCEPT CHALLENGE"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] text-white select-none font-sans relative">
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div
            className={`w-[500px] bg-slate-900 border ${
              modalData.status === "Success"
                ? "border-emerald-500/50 shadow-emerald-500/20"
                : modalData.status === "Defeat"
                  ? "border-amber-600/50 shadow-amber-600/20"
                  : "border-rose-500/50 shadow-rose-500/20"
            } p-6 rounded-2xl shadow-2xl`}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`h-3 w-3 rounded-full ${modalData.status === "Success" ? "bg-emerald-500 animate-pulse" : modalData.status === "Defeat" ? "bg-amber-500" : "bg-rose-500"}`}
              />
              <h3
                className={`text-xl font-black tracking-wider ${modalData.status === "Success" ? "text-emerald-400" : modalData.status === "Defeat" ? "text-amber-500" : "text-rose-400"}`}
              >
                {modalData.title}
              </h3>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 mb-6 max-h-60 overflow-y-auto">
              <pre
                className={`text-sm font-mono whitespace-pre-wrap leading-6 ${modalData.status === "Success" ? "text-emerald-200/90" : modalData.status === "Defeat" ? "text-amber-200/90" : "text-rose-200/90"}`}
              >
                {modalData.message}
              </pre>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold text-xs tracking-wider"
              >
                CLOSE PREVIEW
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setRoomId(null);
                  setProblem(null);
                  setCode("");
                  setCustomRoomCode("");
                  setJoinInputCode("");
                  setIsCreatingRoom(false);
                  setRoomError("");
                  setTestResults([]);
                  setCompileError("");
                  setAppState("WelcomeHub");
                }}
                className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl font-bold text-xs tracking-wider shadow-md transition-all active:scale-95 cursor-pointer"
              >
                BACK TO LOBBY
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shadow-md shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-xs font-bold text-blue-400 bg-blue-500/5 px-3 py-1.5 border border-blue-500/10 rounded-lg">
            <span>{players[0] || "User_1"}</span>
            <span className="text-rose-500 font-black italic">VS</span>
            <span>{players[1] || "User_2"}</span>
          </div>
          <span
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider uppercase border ${
              selectedDifficulty === "Easy"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : selectedDifficulty === "Medium"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
            }`}
          >
            {selectedDifficulty}
          </span>

          <button
            type="button"
            onClick={handleSurrenderMatch}
            title="Forfeit / Resign match"
            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 active:scale-95 transition-all cursor-pointer flex items-center gap-1"
          >
            🏳️ Forfeit
          </button>
        </div>

        <div className="flex items-center gap-2 font-mono bg-slate-950 px-4 py-1.5 border border-slate-800 rounded-xl shadow-inner">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Time Left:
          </span>
          <span
            className={`text-sm font-black tracking-wide ${timerSeconds <= 60 ? "text-rose-500 animate-pulse" : "text-amber-400"}`}
          >
            {formatTimer(timerSeconds)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={language}
            onChange={handleLanguageChange}
            className="bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg text-xs font-bold text-slate-200 outline-none cursor-pointer hover:border-slate-600"
          >
            {AVAILABLE_LANGUAGES.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleRunCode}
            disabled={isRunningTestcases || isRunningCode}
            className={`px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 border ${
              isRunningTestcases
                ? "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600 active:scale-95 cursor-pointer shadow-md"
            }`}
          >
            {isRunningTestcases ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                Running...
              </>
            ) : (
              <>▶ Run Code</>
            )}
          </button>

          <button
            type="button"
            onClick={handleResetCode}
            title="Reset code to initial template"
            className="px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>↺</span> Reset
          </button>

          <button
            type="button"
            onClick={handleSubmitCode}
            disabled={isRunningCode || isRunningTestcases}
            className={`px-5 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 ${
              isRunningCode
                ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20 active:scale-95 cursor-pointer"
            }`}
          >
            {isRunningCode ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                Evaluating...
              </>
            ) : (
              <>🚀 Submit Solution</>
            )}
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <div className="w-1/3 bg-slate-900 border-r border-slate-800 p-6 overflow-y-auto space-y-6">
          {problem ? (
            <>
              <div className="space-y-2">
                <h2 className="text-xl font-black text-blue-400 tracking-wide">
                  {problem.title}
                </h2>
                <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                  {problem.description}
                </p>
              </div>

              <div className="bg-slate-950/40 border border-slate-800/80 p-4 rounded-xl font-mono text-xs text-slate-400 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Constraints:
                </p>
                <p>• Time Limit: 2000ms</p>
                <p>• Memory Allocation: 256MB</p>
                <p>• Hidden Compilation Testing Assertions: Enforced</p>
              </div>

              <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  Sample Assertions
                </p>
                {problem.sample_cases && Array.isArray(problem.sample_cases) ? (
                  problem.sample_cases.map((tc, index) => (
                    <div
                      key={index}
                      className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 font-mono text-xs"
                    >
                      <div className="text-blue-400 font-bold mb-1">
                        Sample Case {index + 1}:
                      </div>
                      <div className="text-slate-400">
                        <span className="text-slate-500">Input:</span>{" "}
                        {tc.input && tc.input.includes("=")
                          ? tc.input.split("=").slice(1).join("=").trim()
                          : tc.input}
                      </div>
                      <div className="text-emerald-400 mt-1">
                        <span className="text-slate-500">Output:</span>{" "}
                        {tc.expected}
                      </div>
                    </div>
                  ))
                ) : (
                  <pre className="text-xs text-slate-400 whitespace-pre-wrap">
                    {problem.example || "No sample cases specified."}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <p className="text-slate-500 italic flex items-center justify-center h-full">
              Synchronizing workspace configurations...
            </p>
          )}
        </div>

        <div className="flex-1 flex flex-col h-full bg-[#1e1e1e] overflow-hidden">
          <div className="flex-1 min-h-[55%]">
            <Editor
              height="100%"
              theme="vs-dark"
              language={language === "python3" ? "python" : language}
              value={code}
              onChange={handleCodeChange}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                automaticLayout: true,
                fontFamily: "Fira Code, monospace",
              }}
            />
          </div>

          <div className="h-[45%] bg-[#0e1626] border-t border-slate-800 flex flex-col font-mono">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/60">
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setConsoleTab("testcases")}
                  className={`px-3 py-1 rounded-md font-bold transition ${
                    consoleTab === "testcases"
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Test Cases
                </button>
                <button
                  type="button"
                  onClick={() => setConsoleTab("output")}
                  className={`px-3 py-1 rounded-md font-bold transition ${
                    consoleTab === "output"
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Console Output {compileError && "⚠️"}
                </button>
              </div>

              {testResults.length > 0 && (
                <span
                  className={`text-[11px] font-bold ${testResults.every((t) => t.passed) ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {testResults.filter((t) => t.passed).length} /{" "}
                  {testResults.length} Cases Passed
                </span>
              )}
            </div>

            <div className="flex-1 p-4 overflow-y-auto text-xs">
              {consoleTab === "testcases" ? (
                <div>
                  <div className="flex gap-2 mb-3">
                    {(problem?.sample_cases || []).map((_, idx) => {
                      const res = testResults[idx];
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedTestCaseIndex(idx)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold border transition ${
                            selectedTestCaseIndex === idx
                              ? "bg-slate-800 border-slate-600 text-white"
                              : "bg-slate-950 border-slate-800 text-slate-400"
                          } ${res ? (res.passed ? "text-emerald-400" : "text-rose-400") : ""}`}
                        >
                          Case {idx + 1} {res && (res.passed ? "✓" : "✗")}
                        </button>
                      );
                    })}
                  </div>

                  {problem?.sample_cases &&
                    problem.sample_cases[selectedTestCaseIndex] && (
                      <div className="space-y-2 bg-slate-950/40 p-3 rounded-xl border border-slate-800">
                        <div>
                          <span className="text-slate-500 text-[10px] uppercase font-bold">
                            Input:
                          </span>
                          <div className="text-slate-300 font-mono mt-0.5">
                            {problem.sample_cases[selectedTestCaseIndex].input}
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-500 text-[10px] uppercase font-bold">
                            Expected Output:
                          </span>
                          <div className="text-emerald-400 font-mono mt-0.5">
                            {
                              problem.sample_cases[selectedTestCaseIndex]
                                .expected
                            }
                          </div>
                        </div>
                        {testResults[selectedTestCaseIndex] && (
                          <div>
                            <span className="text-slate-500 text-[10px] uppercase font-bold">
                              Your Output:
                            </span>
                            <div
                              className={`font-mono mt-0.5 ${testResults[selectedTestCaseIndex].passed ? "text-emerald-400" : "text-rose-400 font-bold"}`}
                            >
                              {testResults[selectedTestCaseIndex].actual}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                </div>
              ) : (
                <div className="h-full">
                  {compileError ? (
                    <pre className="text-rose-400 whitespace-pre-wrap bg-rose-950/20 border border-rose-900/40 p-3 rounded-xl font-mono">
                      {compileError}
                    </pre>
                  ) : (
                    <p className="text-slate-500 italic">
                      No execution errors. Ready to run.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
