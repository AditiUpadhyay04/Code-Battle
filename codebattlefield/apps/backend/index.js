// ========================== IMPORTS ==========================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

// ========================== APP SETUP ==========================
const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ========================== SUPABASE ==========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ========================== SOCKET SERVER ==========================
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// ========================== LANGUAGE IDS ==========================
const JUDGE0_LANG_IDS = {
  javascript: 93,
  python: 92,
  cpp: 75,
  java: 91
};

// ========================== TIMERS ==========================
const DIFFICULTY_TIMERS = {
  Easy: 10 * 60,
  Medium: 20 * 60,
  Hard: 30 * 60
};

// ========================== MEMORY ==========================
let matchmakingPools = {
  Easy: [],
  Medium: [],
  Hard: []
};

let activeRooms = {};

// ========================== SOCKET CONNECTION ==========================
io.on('connection', (socket) => {

  console.log("User Connected:", socket.id);

  // =========================================================
  // FIND MATCH
  // =========================================================
  socket.on('find_match', async ({ username, difficulty }) => {

    const chosenDifficulty = difficulty || 'Easy';

    // remove duplicate queue
    Object.keys(matchmakingPools).forEach(diff => {
      matchmakingPools[diff] =
        matchmakingPools[diff].filter(player => player.id !== socket.id);
    });

    matchmakingPools[chosenDifficulty].push({
      id: socket.id,
      username,
      difficulty: chosenDifficulty
    });

    console.log(
      `${username} joined ${chosenDifficulty} queue`
    );

    // ================= MATCH FOUND =================
    if (matchmakingPools[chosenDifficulty].length >= 2) {

      const p1 = matchmakingPools[chosenDifficulty].shift();
      const p2 = matchmakingPools[chosenDifficulty].shift();

      const roomId = `battle_${p1.id}_${p2.id}`;

      activeRooms[roomId] = {
        roomId,
        difficulty: chosenDifficulty,
        players: {
          [p1.id]: {
            username: p1.username,
            accepted: false
          },
          [p2.id]: {
            username: p2.username,
            accepted: false
          }
        },
        acceptedCount: 0,
        timeLeft: DIFFICULTY_TIMERS[chosenDifficulty],
        timerInterval: null,
        problem: null
      };

      socket.join(roomId);

      const s1 = io.sockets.sockets.get(p1.id);
      const s2 = io.sockets.sockets.get(p2.id);

      if (s1 && s2) {

        s1.join(roomId);
        s2.join(roomId);

        io.to(roomId).emit('pre_match_found', {
          roomId,
          players: [p1.username, p2.username],
          difficulty: chosenDifficulty
        });

        console.log("Pre Match Found:", roomId);
      }
    }
  });

  // =========================================================
  // ACCEPT MATCH
  // =========================================================
  socket.on('accept_match', async ({ roomId }) => {

    const room = activeRooms[roomId];

    if (!room) return;

    if (!room.players[socket.id]) return;

    if (!room.players[socket.id].accepted) {
      room.players[socket.id].accepted = true;
      room.acceptedCount++;
    }

    io.to(roomId).emit('player_accepted_update', {
      acceptedPlayers:
        Object.values(room.players)
    });

    // ================= BOTH ACCEPTED =================
    if (room.acceptedCount === 2) {

      try {

        const { data: problems, error } =
          await supabase
            .from('problems')
            .select('*')
            .eq('difficulty', room.difficulty);

        if (error || !problems || problems.length === 0) {

          io.to(roomId).emit('battle_error', {
            message: 'No problems found'
          });

          return;
        }

        const selectedProblem =
          problems[Math.floor(Math.random() * problems.length)];

        room.problem = selectedProblem;

        io.to(roomId).emit('match_start', {
          roomId,
          problem: selectedProblem,
          players:
            Object.values(room.players)
              .map(p => p.username),
          duration: room.timeLeft
        });

        console.log("Battle Started");

        // ================= TIMER =================
        room.timerInterval = setInterval(() => {

          if (!activeRooms[roomId]) {
            clearInterval(room.timerInterval);
            return;
          }

          if (room.timeLeft > 0) {

            room.timeLeft--;

            io.to(roomId).emit('timer_tick', {
              timeLeft: room.timeLeft
            });

          } else {

            clearInterval(room.timerInterval);

            io.to(roomId).emit('battle_result', {
              status: 'Failed',
              message: '⌛ TIME OUT'
            });

            delete activeRooms[roomId];
          }

        }, 1000);

      } catch (err) {

        console.log(err.message);

        io.to(roomId).emit('battle_error', {
          message: 'Battle creation failed'
        });
      }
    }
  });

  // =========================================================
  // CODE UPDATE
  // =========================================================
  socket.on('code_update', ({ roomId, code }) => {

    socket.to(roomId).emit('opponent_code', code);

  });

  // =========================================================
  // SUBMIT CODE
  // =========================================================
  socket.on('submit_code', async ({
    roomId,
    code,
    language
  }) => {

    try {

      const room = activeRooms[roomId];

      if (!room) return;

      const languageId =
        JUDGE0_LANG_IDS[language.toLowerCase()] || 93;

      // ================= TEST CASES =================
      const testCases =
        room.problem?.test_cases || [];

      if (testCases.length === 0) {

        socket.emit('battle_result', {
          status: 'Failed',
          message: 'No test cases found'
        });

        return;
      }

      let allPassed = true;

      // ================= RUN ALL TEST CASES =================
      for (const tc of testCases) {

        const response = await axios.post(
          'https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true',
          {
            source_code: code,
            language_id: languageId,
            stdin: tc.input
          },
          {
            headers: {
              'x-rapidapi-key': process.env.JUDGE0_API_KEY,
              'x-rapidapi-host': 'judge0-ce.p.rapidapi.com',
              'Content-Type': 'application/json'
            }
          }
        );

        const actualOutput =
          response.data.stdout
            ? response.data.stdout.trim()
            : '';

        const expectedOutput =
          tc.expected.trim();

        console.log("Actual:", actualOutput);
        console.log("Expected:", expectedOutput);

        // ================= WRONG ANSWER =================
        if (actualOutput !== expectedOutput) {

          allPassed = false;

          socket.emit('battle_result', {
            status: 'Failed',
            message:
              `❌ Wrong Answer\n\nExpected: ${expectedOutput}\nReceived: ${actualOutput}`
          });

          break;
        }
      }

      // ================= SUCCESS =================
      if (allPassed) {

        if (room.timerInterval) {
          clearInterval(room.timerInterval);
        }

        socket.emit('battle_result', {
          status: 'Success',
          isWinner: true,
          message: '🏆 Accepted! All test cases passed.'
        });

        socket.to(roomId).emit('battle_result', {
          status: 'Success',
          isWinner: false,
          message: 'Opponent solved the problem first.'
        });

        delete activeRooms[roomId];
      }

    } catch (err) {

      console.log(err.message);

      socket.emit('battle_result', {
        status: 'Failed',
        message: 'Compilation Error or Judge0 Error'
      });
    }
  });

  // =========================================================
  // LEAVE QUEUE
  // =========================================================
  socket.on('leave_queue', () => {

    Object.keys(matchmakingPools).forEach(diff => {

      matchmakingPools[diff] =
        matchmakingPools[diff]
          .filter(p => p.id !== socket.id);

    });

    socket.emit('queue_left');

  });

  // =========================================================
  // DISCONNECT
  // =========================================================
  socket.on('disconnect', () => {

    Object.keys(matchmakingPools).forEach(diff => {

      matchmakingPools[diff] =
        matchmakingPools[diff]
          .filter(p => p.id !== socket.id);

    });

    Object.keys(activeRooms).forEach(roomId => {

      const room = activeRooms[roomId];

      if (room.players[socket.id]) {

        if (room.timerInterval) {
          clearInterval(room.timerInterval);
        }

        socket.to(roomId).emit(
          'opponent_disconnected_draw',
          {
            message:
              'Opponent disconnected'
          }
        );

        delete activeRooms[roomId];
      }
    });

    console.log("User Disconnected:", socket.id);
  });

});

// ========================== SERVER ==========================
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});