const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "https://tibetankeys.com", // Your Firebase domain
    methods: ["GET", "POST"]
  }
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const GAME_DURATION = 60; 

// ELEMENTS CONFIG
const ELEMENTS = ["Fire", "Earth", "Air", "Water"];
const ELEMENT_COLORS = { "Fire": "#ff4444", "Earth": "#66ff66", "Air": "#ccffff", "Water": "#44aaff" };

const CHAR_POOL = "ཀཁགངཅཆཇཉཏཐདནཔཕབམཙཚཛཝཞཟའཡརལཤསཧཨ".split('');

let rooms = Array(10).fill().map((_, i) => ({
    id: i + 1, players: [], status: 'open', timer: 30,
    interval: null, gameInterval: null, spawnInterval: null
}));

function getName() {
    return AUSPICIOUS_NAMES[Math.floor(Math.random() * AUSPICIOUS_NAMES.length)];
}
const AUSPICIOUS_NAMES = ["Tashi", "Dawa", "Pema", "Karma", "Dorje", "Lhamo", "Nyima", "Sangye", "Sherab", "Jamyang"];

// --- HELPER: FILTER SAFE DATA ---
function getSafeRoomData(room) {
    return {
        id: room.id,
        players: room.players,
        status: room.status,
        timer: room.timer
    };
}

io.on('connection', (socket) => {
    socket.emit('update-lobby', getLobbyData());

    socket.on('join-room', (roomId) => {
        const room = rooms[roomId - 1];
        if (!room || room.status === 'playing' || room.players.length >= 4) return;
        if(room.players.find(p => p.id === socket.id)) return;

        const slot = room.players.length;
        const name = ELEMENTS[slot];
        
        const playerObj = { id: socket.id, name: name, color: ELEMENT_COLORS[name], score: 0 };
        room.players.push(playerObj);
        socket.join("room-" + roomId);

        if (room.players.length === 1) {
            room.status = 'waiting';
            room.timer = 30;
            startLobbyTimer(room);
        }

        io.emit('update-lobby', getLobbyData());
        io.to("room-" + roomId).emit('room-state', getSafeRoomData(room));
    });

    socket.on('leave-room', (roomId) => { leaveRoomLogic(socket, roomId); });
    
    socket.on('disconnect', () => {
        rooms.forEach(room => { if (room.players.find(p => p.id === socket.id)) leaveRoomLogic(socket, room.id); });
    });

    socket.on('player-score', (data) => {
        const room = rooms[data.roomId - 1];
        if(!room || room.status !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if(player) {
            player.score += data.points;
            io.to("room-" + room.id).emit('score-update', room.players);
        }
    });

    socket.on('enemy-killed', (data) => {
        io.to("room-" + data.roomId).emit('enemy-destroyed', { enemyId: data.enemyId, killerId: socket.id });
    });
});

function leaveRoomLogic(socket, roomId) {
    const room = rooms[roomId - 1];
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave("room-" + roomId);
    if (room.players.length === 0) resetRoom(room);
    io.emit('update-lobby', getLobbyData());
    if(room.players.length > 0) io.to("room-" + roomId).emit('room-state', getSafeRoomData(room));
}

function resetRoom(room) {
    clearInterval(room.interval); clearInterval(room.gameInterval); clearInterval(room.spawnInterval);
    room.status = 'open'; room.timer = 30; room.players = [];
    room.interval = null; room.gameInterval = null; room.spawnInterval = null;
}

function startLobbyTimer(room) {
    if (room.interval) clearInterval(room.interval);
    room.interval = setInterval(() => {
        if (room.players.length === 4 && room.status !== 'playing') { startCountdown(room); return; }
        room.timer--;
        io.to("room-" + room.id).emit('timer-update', room.timer);
        if(room.timer % 5 === 0) io.emit('update-lobby', getLobbyData());
        if (room.timer <= 0) startCountdown(room);
    }, 1000);
}

function startCountdown(room) {
    clearInterval(room.interval);
    room.status = 'playing';
    io.emit('update-lobby', getLobbyData());

    let count = 3;
    io.to("room-" + room.id).emit('start-sequence', count);

    let countInterval = setInterval(() => {
        count--;
        if (count > 0) {
            io.to("room-" + room.id).emit('start-sequence', count);
        } else {
            clearInterval(countInterval);
            io.to("room-" + room.id).emit('start-sequence', "GO!");
            startGame(room);
        }
    }, 1000);
}

function startGame(room) {
    io.to("room-" + room.id).emit('game-start', room.players);

    let gameTime = GAME_DURATION;
    room.gameInterval = setInterval(() => {
        gameTime--;
        io.to("room-" + room.id).emit('gametime-update', gameTime);
        if(gameTime <= 0) endGame(room);
    }, 1000);

    // --- SLOWER SPAWNS (900ms) + NO CENTER CHAOS ---
    room.spawnInterval = setInterval(() => {
        const type = Math.floor(Math.random() * 4); // ONLY 0, 1, 2, 3 (Edges Only)
        let startX, startY, velX, velY;
        const speed = 0.002 + (Math.random() * 0.003); // Slower speed too

        if (type === 0) { // Top
            startX = Math.random(); startY = -0.1; velX = (Math.random()-0.5)*speed; velY = speed;
        } else if (type === 1) { // Right
            startX = 1.1; startY = Math.random(); velX = -speed; velY = (Math.random()-0.5)*speed;
        } else if (type === 2) { // Bottom
            startX = Math.random(); startY = 1.1; velX = (Math.random()-0.5)*speed; velY = -speed;
        } else { // Left
            startX = -0.1; startY = Math.random(); velX = speed; velY = (Math.random()-0.5)*speed;
        }

        const enemy = {
            id: Math.random().toString(36).substr(2, 9),
            char: CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)],
            x: startX, y: startY, vx: velX, vy: velY
        };
        io.to("room-" + room.id).emit('spawn-enemy', enemy);
    }, 900); // 900ms Spawn Rate (Slower)
}

function endGame(room) {
    clearInterval(room.gameInterval); clearInterval(room.spawnInterval);
    io.to("room-" + room.id).emit('game-over', room.players);
    setTimeout(() => { resetRoom(room); io.emit('update-lobby', getLobbyData()); }, 10000);
}

function getLobbyData() { return rooms.map(r => ({ id: r.id, count: r.players.length, status: r.status, timeLeft: r.timer })); }

http.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });