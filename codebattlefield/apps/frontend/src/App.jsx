import { useEffect, useState, useMemo } from 'react';
import { io } from 'socket.io-client';
import Editor from '@monaco-editor/react';
import { generateTemplate } from './utils/templateGenerator';
import { createClient } from '@supabase/supabase-js';

// Absolute Keys Configuration Map
const SUPABASE_URL = "https://dkdfzxkjvrgfzokmrpls.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_Rv1UlBNPw7_V23vUQRcUlW_tfC_F"; 
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const AVAILABLE_LANGUAGES = [
  { id: 'cpp', name: 'C++' }, { id: 'java', name: 'Java' }, { id: 'python3', name: 'Python3' },
  { id: 'python', name: 'Python' }, { id: 'javascript', name: 'JavaScript' }, { id: 'typescript', name: 'TypeScript' },
  { id: 'csharp', name: 'C#' }, { id: 'c', name: 'C' }, { id: 'go', name: 'Go' },
  { id: 'kotlin', name: 'Kotlin' }, { id: 'swift', name: 'Swift' }, { id: 'rust', name: 'Rust' },
  { id: 'ruby', name: 'Ruby' }, { id: 'php', name: 'PHP' }, { id: 'dart', name: 'Dart' },
  { id: 'scala', name: 'Scala' }, { id: 'elixir', name: 'Elixir' }, { id: 'erlang', name: 'Erlang' }, 
  { id: 'racket', name: 'Racket' }
];

function App() {
  const socket = useMemo(() => io('http://localhost:3001'), []);

  const [appState, setAppState] = useState('AuthLogin');
  const [inputUsername, setInputUsername] = useState('');
  const [inputPin, setInputPin] = useState('');
  const [authError, setAuthError] = useState('');
  const [loadingUser, setLoadingUser] = useState(false);

  const [userStats, setUserStats] = useState({
    username: "", rank: "Bronze I", matches_played: 0, win_rate: "0%", streak: 0, elo_rating: 1000
  });

  const [leaderboard, setLeaderboard] = useState([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState('Easy');
  
  const [roomId, setRoomId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [problem, setProblem] = useState(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState('javascript');
  
  const [timerSeconds, setTimerSeconds] = useState(600);
  const [confirmationCountdown, setConfirmationCountdown] = useState(5);
  const [acceptedList, setAcceptedList] = useState([]);
  const [hasAcceptedCurrentMatch, setHasAcceptedCurrentMatch] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState({ status: '', title: '', message: '' });

  const fetchLeaderboard = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, rank, elo_rating')
        .order('elo_rating', { ascending: false })
        .limit(5);
      if (!error && data) {
        setLeaderboard(data);
      }
    } catch (err) {
      console.error("Leaderboard loading error: ", err);
    }
  };

  useEffect(() => {
    fetchLeaderboard();

    socket.on('pre_match_found', (data) => {
      setRoomId(data.roomId);
      setPlayers(data.players || []);
      setAcceptedList((data.players || []).map(p => ({ username: p, accepted: false })));
      setAppState('PreMatch');
      setConfirmationCountdown(5);
      setHasAcceptedCurrentMatch(false);
    });

    socket.on('player_accepted_update', (data) => {
      setAcceptedList(data.acceptedPlayers || []);
    });

    socket.on('match_start', (data) => {
      setProblem(data.problem);
      setTimerSeconds(data.duration || 600);
      loadLanguageCode(data.problem, 'javascript');
      setLanguage('javascript');
      setAppState('BattleActive');
      setShowModal(false);
    });

    socket.on('timer_tick', (data) => {
      setTimerSeconds(data.timeLeft);
    });

    socket.on('battle_result', async (result) => {
      if (result.status === 'Success') {
        if (result.isWinner) {
          setModalData({ status: 'Success', title: '🏆 VICTORY!', message: result.message });
        } else {
          setModalData({ status: 'Defeat', title: '💀 DEFEAT', message: result.message });
        }
      } else {
        setModalData({ status: 'Failed', title: '❌ MATCH OVER / TIMEOUT', message: result.message });
      }
      setAppState('MatchEnded');
      setShowModal(true);
    });

    socket.on('opponent_disconnected_draw', (data) => {
      setModalData({ status: 'Failed', title: '💔 DRAW', message: data.message });
      setAppState('MatchEnded');
      setShowModal(true);
    });

    return () => {
      socket.off('pre_match_found');
      socket.off('player_accepted_update');
      socket.off('match_start');
      socket.off('timer_tick');
      socket.off('battle_result');
      socket.off('opponent_disconnected_draw');
    };
  }, [socket]);

  useEffect(() => {
    if (appState === 'WelcomeHub') {
      fetchLeaderboard();
      if (userStats.username) {
        syncSilentUserData(userStats.username);
      }
    }
  }, [appState]);

  useEffect(() => {
    let interval = null;
    if (appState === 'PreMatch' && confirmationCountdown > 0) {
      interval = setInterval(() => {
        setConfirmationCountdown(prev => prev - 1);
      }, 1000);
    } else if (appState === 'PreMatch' && confirmationCountdown === 0) {
      if (!hasAcceptedCurrentMatch) {
        handleLeaveQueue();
      }
    }
    return () => clearInterval(interval);
  }, [appState, confirmationCountdown, hasAcceptedCurrentMatch]);

  // 🎯 FIXED: Intelligent Identity Lookup Routing (Differentiating New vs Old User)
  const handleCheckUsername = async () => {
    const trimmedName = inputUsername.trim();
    if (!trimmedName) return;

    setLoadingUser(true);
    setAuthError('');

    try {
      const { data: user, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', trimmedName);

      setLoadingUser(false);

      // Check karein ki user array empty hai ya nahi
      if (error || !user || user.length === 0) {
        // CASE A: Username database mein nahi hai -> Naya registration block open karo
        setAppState('PinRegister');
      } else {
        // CASE B: User mil gaya -> Is an existing profile setup
        const existingUser = user[0];
        setUserStats({
          username: existingUser.username,
          pin: existingUser.pin || "",
          elo_rating: existingUser.elo_rating || 1000,
          rank: existingUser.rank || "Bronze I",
          matches_played: existingUser.matches_played || 0,
          win_rate: existingUser.win_rate || "0%",
          streak: existingUser.streak || 0
        });

        // Agar database row mein pehle se password field secure na ho toh register trigger karo
        if (!existingUser.pin) {
          setAppState('PinRegister');
        } else {
          // Absolute Old user flow -> Direct password verify popup state
          setAppState('PinVerify');
        }
      }
    } catch (err) {
      setLoadingUser(false);
      setAuthError('Connection anomaly detected during username handshake query.');
    }
  };

  const handleRegisterWithPin = async () => {
    if (inputPin.trim().length < 4) {
      setAuthError('PIN must be at least 4 digits long.');
      return;
    }

    setLoadingUser(true);
    setAuthError('');

    const targetUsername = inputUsername.trim();
    const targetPin = inputPin.trim();

    try {
      const { data: newUser, error } = await supabase
        .from('profiles')
        .insert([{ 
          username: targetUsername, 
          pin: targetPin, 
          elo_rating: 1000,
          rank: 'Bronze I'
        }])
        .select('*')
        .maybeSingle();

      setLoadingUser(false);

      if (!error && newUser) {
        setUserStats({
          username: newUser.username,
          pin: newUser.pin || targetPin,
          elo_rating: newUser.elo_rating || 1000,
          rank: newUser.rank || 'Bronze I',
          matches_played: 0,
          win_rate: '0%',
          streak: 0
        });
        setInputPin('');
        setAppState('WelcomeHub');
      } else {
        setUserStats({
          username: targetUsername,
          pin: targetPin,
          elo_rating: 1000,
          rank: 'Bronze I',
          matches_played: 0,
          win_rate: '0%',
          streak: 0
        });
        setInputPin('');
        setAppState('WelcomeHub');
      }
    } catch (err) {
      setLoadingUser(false);
      setAuthError('System error during profile storage.');
    }
  };

  const handleVerifyPin = () => {
    if (inputPin.trim() === userStats.pin) {
      setAuthError('');
      setInputPin('');
      setAppState('WelcomeHub');
    } else {
      setAuthError('❌ INVALID SECRET PIN! Access Denied.');
    }
  };

  const syncSilentUserData = async (usernameTarget) => {
    try {
      let { data: user } = await supabase.from('profiles').select('*').eq('username', usernameTarget).maybeSingle();
      if (user) {
        setUserStats({
          username: user.username,
          pin: user.pin || "",
          elo_rating: user.elo_rating || 1000,
          rank: user.rank || "Bronze I",
          matches_played: user.matches_played || 0,
          win_rate: user.win_rate || "0%",
          streak: user.streak || 0
        });
      }
    } catch (e) {
      console.warn("Silent profile re-index skip.");
    }
  };

  const loadLanguageCode = (currentProblem, lang) => {
    if (!currentProblem) return;
    let rawCode = "";
    
    if (currentProblem.base_codes && currentProblem.base_codes[lang]) {
      rawCode = currentProblem.base_codes[lang];
    } else {
      let camelCaseFuncName = currentProblem.title
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toLowerCase() : word.toUpperCase())
        .replace(/\s+/g, '');
      
      if (/^\d/.test(camelCaseFuncName)) {
        camelCaseFuncName = `_${camelCaseFuncName}`;
      }
      
      rawCode = generateTemplate(lang, camelCaseFuncName);
    }
    let formattedCode = typeof rawCode === 'string' ? rawCode : "";
    setCode(formattedCode.replace(/\\n/g, '\n').replace(/\\t/g, '    '));
  };

  const handleLanguageChange = (e) => {
    const selectedLang = e.target.value;
    setLanguage(selectedLang);
    loadLanguageCode(problem, selectedLang);
  };

  const handleCodeChange = (value) => {
    setCode(value);
    if (roomId) socket.emit('code_update', { roomId, code: value });
  };

  const handleStartMatchmaking = () => {
    setAppState('Searching');
    socket.emit('find_match', { 
      username: userStats.username, 
      difficulty: selectedDifficulty 
    });
  };

  const handleAcceptMatch = () => {
    setHasAcceptedCurrentMatch(true);
    socket.emit('accept_match', { roomId });
  };

  const handleLeaveQueue = () => {
    socket.emit('leave_queue');
    setRoomId(null);
    setAppState('WelcomeHub');
  };

  const handleSubmitCode = () => {
    if (!roomId) return;
    socket.emit('submit_code', { roomId, code, problemId: problem.id, language });
  };

  const formatTimer = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (appState === 'AuthLogin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[400px] bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-6 text-center">
          <div>
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 tracking-wider">ENTER CODEBATTLE</h1>
            <p className="text-slate-400 text-xs mt-1">Set your global battle tag to access profiles</p>
          </div>
          <div className="space-y-2 text-left">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Username / Player ID</label>
            <input 
              type="text"
              value={inputUsername}
              onChange={(e) => setInputUsername(e.target.value)}
              placeholder="e.g., CyberNinja"
              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 px-4 py-3 rounded-xl text-sm font-semibold outline-none transition-colors text-slate-200"
            />
          </div>
          <button 
            disabled={loadingUser || !inputUsername.trim()}
            onClick={handleCheckUsername}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-extrabold text-sm tracking-wider transition-all shadow-lg"
          >
            {loadingUser ? 'CHECKING ID...' : 'CONTINUE'}
          </button>
        </div>
      </div>
    );
  }

  if (appState === 'PinRegister') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[400px] bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-6 text-center">
          <div>
            <span className="text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 font-bold px-3 py-1 rounded-full border border-emerald-500/20">New Account Detected</span>
            <h2 className="text-xl font-black tracking-wide mt-3 text-slate-200">Set Secret Login PIN</h2>
            <p className="text-slate-400 text-xs mt-1">Secure <span className="text-blue-400 font-bold">"{inputUsername}"</span> so other players cannot steal your ranking points.</p>
          </div>
          <div className="space-y-2 text-left">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Create a Security PIN</label>
            <input 
              type="password"
              maxLength={6}
              value={inputPin}
              onChange={(e) => setInputPin(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g., 4721"
              className="w-full text-center bg-slate-950 border border-slate-800 focus:border-emerald-500 px-4 py-3 rounded-xl text-lg font-mono tracking-widest outline-none transition-colors text-slate-200"
            />
            {authError && <p className="text-xs font-bold text-rose-400 mt-1 text-center">{authError}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAppState('AuthLogin')} className="w-1/3 py-3 bg-slate-950 border border-slate-800 rounded-xl font-bold text-xs text-slate-400">CANCEL</button>
            <button 
              disabled={inputPin.length < 4}
              onClick={handleRegisterWithPin}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-extrabold text-xs tracking-wider transition-all shadow-lg"
            >
              CREATE PROFILE
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 🎯 FIXED STATE: "Welcome Back" flow explicitly for existing old accounts!
  if (appState === 'PinVerify') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans p-4">
        <div className="w-[400px] bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl space-y-6 text-center">
          <div>
            <span className="text-[10px] uppercase tracking-widest bg-blue-500/10 text-blue-400 font-bold px-3 py-1 rounded-full border border-blue-500/20">Welcome Back</span>
            <h2 className="text-xl font-black tracking-wide mt-3 text-slate-200">Enter Account PIN</h2>
            <p className="text-slate-400 text-xs mt-1">Account <span className="text-blue-400 font-bold">"{inputUsername}"</span> is locked. Please enter your secret validation PIN.</p>
          </div>
          <div className="space-y-2 text-left">
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Secret Security PIN</label>
            <input 
              type="password"
              maxLength={6}
              value={inputPin}
              onChange={(e) => setInputPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full text-center bg-slate-950 border border-slate-800 focus:border-blue-500 px-4 py-3 rounded-xl text-lg font-mono tracking-widest outline-none transition-colors text-slate-200"
            />
            {authError && <p className="text-xs font-bold text-rose-400 mt-2 text-center">{authError}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setAppState('AuthLogin'); setInputPin(''); setAuthError(''); }} className="w-1/3 py-3 bg-slate-950 border border-slate-800 rounded-xl font-bold text-xs text-slate-400">BACK</button>
            <button 
              disabled={inputPin.length < 4}
              onClick={handleVerifyPin}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl font-extrabold text-xs tracking-wider transition-all shadow-lg"
            >
              VERIFY & ENTER
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (appState === 'WelcomeHub') {
    return (
      <div className="min-h-screen bg-slate-950 text-white font-sans p-6 flex flex-col justify-between selection:bg-blue-500/30">
        <header className="flex justify-between items-center max-w-6xl w-full mx-auto border-b border-slate-900 pb-4">
          <div className="text-xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">CODEBATTLE</div>
          <div className="flex items-center gap-4">
            <button onClick={() => { setAppState('AuthLogin'); setUserStats({ username: "" }); }} className="text-xs text-slate-500 hover:text-slate-400 font-bold">
              LOGOUT ({userStats.username || 'Guest'})
            </button>
            <div className="flex items-center gap-3 bg-slate-900/60 border border-slate-800/80 px-4 py-2 rounded-xl">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono font-bold tracking-wide text-slate-300">SERVER ONLINE</span>
            </div>
          </div>
        </header>

        <main className="max-w-6xl w-full mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 my-auto py-8">
          
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800/80 p-6 rounded-2xl shadow-xl flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-[4px] bg-gradient-to-r from-blue-500 to-indigo-500" />
              <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xl font-black text-blue-400 mb-4 shadow-inner">
                {userStats.username ? userStats.username[0].toUpperCase() : '?' }
              </div>
              <h2 className="text-lg font-bold tracking-wide">{userStats.username || 'Player'}</h2>
              <span className="text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded-full font-black tracking-wider uppercase mt-1">
                {userStats.rank || 'Bronze I'}
              </span>

              <div className="w-full border-t border-slate-800/60 my-5" />

              <div className="grid grid-cols-3 gap-2 w-full">
                <div className="bg-slate-950/40 p-2 border border-slate-800/40 rounded-xl">
                  <div className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">Battles</div>
                  <div className="text-sm font-black text-slate-200">{userStats.matches_played || 0}</div>
                </div>
                <div className="bg-slate-950/40 p-2 border border-slate-800/40 rounded-xl">
                  <div className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">Win Rate</div>
                  <div className="text-sm font-black text-emerald-400">{userStats.win_rate || '0%'}</div>
                </div>
                <div className="bg-slate-950/40 p-2 border border-slate-800/40 rounded-xl">
                  <div className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">Rating</div>
                  <div className="text-sm font-black text-amber-400">🏆 {userStats.elo_rating || 1000}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border-2 border-blue-500/10 p-8 rounded-2xl shadow-2xl flex flex-col justify-between relative overflow-hidden">
            <div className="space-y-2">
              <h3 className="text-2xl font-black tracking-wide">Welcome to Arena</h3>
              <p className="text-slate-400 text-xs leading-relaxed">Ready to stress-test your data structure and algorithm runtime skills against developers worldwide in a real-time speed battle?</p>
            </div>

            <div className="bg-slate-950/60 p-4 border border-slate-800 rounded-xl text-center space-y-1 font-mono text-xs text-slate-400">
              <p className="text-[10px] font-black tracking-wider text-slate-500 uppercase mb-1">Combat Rules:</p>
              <p>• Clean compilation clears code cases</p>
              <p>• Server validation enforces constraints</p>
              <p>• Faster submittal takes complete victory</p>
            </div>

            <button 
              onClick={() => setAppState('DifficultySelect')}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl font-extrabold text-sm tracking-widest uppercase transition-all shadow-lg shadow-blue-500/10"
            >
              Enter Battle Arena
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800/80 p-6 rounded-2xl shadow-xl flex flex-col justify-between">
            <div>
              <p className="text-xs font-black text-slate-400 tracking-wider uppercase mb-3">Top Arena Competitors</p>
              <div className="space-y-2">
                {leaderboard && leaderboard.length > 0 ? (
                  leaderboard.map((user, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-950/40 border border-slate-800/40 p-3 rounded-xl font-mono text-xs">
                      <div className="flex items-center gap-3">
                        <span className={`font-black w-4 ${idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-slate-400' : 'text-amber-600'}`}>#{idx + 1}</span>
                        <span className="text-slate-300 font-sans font-semibold">{user.username}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-black text-blue-400">{user.rank || 'Bronze I'}</div>
                        <div className="text-[9px] text-slate-500">{user.elo_rating} pts</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 text-xs italic text-center py-4">No top players found.</p>
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

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] text-white select-none font-sans relative">
      {/* Game modules layout components go here */}
    </div>
  );
}

export default App;