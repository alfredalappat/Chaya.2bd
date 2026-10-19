'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'Chaya.2bd' }));

function reqBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

function getBaseUrl(value) { return String(value).replace(/\/$/, ''); }

app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /ws\nSitemap: ' + getBaseUrl(reqBase(req)) + '/sitemap.xml\n'));

app.get('/sitemap.xml', (req, res) => {
  const base = getBaseUrl(reqBase(req));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url></urlset>`);
});

app.get('/', (req, res, next) => {
  fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    const base = getBaseUrl(reqBase(req));
    res.type('html').send(html.replaceAll('https://YOUR-RENDER-DOMAIN.onrender.com', base));
  });
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const clients = new Map();
const waiting = [];
const rooms = new Map();
const BOT_FALLBACK_MS = 5000;
const MAX_MESSAGE_LENGTH = 600;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 8;

// ✅ SIMPLIFIED: Single 'replies' array with a natural mix of English and Manglish
const botRules = [
  { keys: ['hi', 'hello', 'hey', 'hii', 'helo', 'ഹായ്'], replies: ['Hey! How is your day going?', 'Hii, enthokkeyundu?', 'Hi there. What are you up to?', 'Hey, sugamano?'] },
  { keys: ['sugamano', 'sukhamano', 'how are you', 'how r u', 'how are u'], replies: ['I am doing good, thanks. How about you?', 'Sugham aanu. Ninakko?', 'Pretty good. How has your day been?'] },
  { keys: ['evideya', 'evideyaanu', 'where are you', 'which place'], replies: ['I am around Kerala. Which place are you from?', 'Njan Kerala side aanu. Nee evideya?', 'Somewhere in Kerala for now. Where are you from?'] },
  { keys: ['thrissur', 'trichur'], replies: ['Thrissur is a nice place. Do you go for Pooram?', 'Thrissur aano? Pooram ishtamano?', 'Adipoli. Thrissur-il favourite spot etha?'] },
  { keys: ['kochi', 'ernakulam'], replies: ['Kochi has a nice vibe. Are you studying or working?', 'Kochi aano? Padikkukayaano work aano?', 'Kochi vibe vere level alle.'] },
  { keys: ['bore', 'bored', 'bore adikkunnu'], replies: ['Let us find a good topic then. Music, movies, or travel?', 'Enna oru topic pidikkam. Movies aano music aano?', 'Bore adikkumbol nee entha cheyyar?'] },
  { keys: ['movie', 'cinema', 'padam', 'film'], replies: ['What was the last movie you watched?', 'Last kandha padam etha?', 'Comedy aano thriller aano ishtam?'] },
  { keys: ['music', 'song', 'paattu', 'pattu'], replies: ['What kind of music do you listen to?', 'Ethu type paattukala kelkkar?', 'Ippo repeat-il kelkkunna song undo?'] },
  { keys: ['college', 'class', 'student', 'padikk', 'study'], replies: ['Which subject or course are you in?', 'Eth course aanu?', 'College life ippo fun aano stress aano?'] },
  { keys: ['work', 'job', 'office', 'working'], replies: ['What kind of work do you do?', 'Entha work cheyyunne?', 'Office life engane pokunnu?'] },
  { keys: ['food', 'foodie', 'biriyani', 'porotta', 'food kazh'], replies: ['What is your favourite food?', 'Favourite food etha?', 'Biriyani aano porotta aano team?'] },
  { keys: ['relationship', 'love', 'crush', 'single', 'breakup'], replies: ['That can be a whole conversation. What is your take on it?', 'Athine kurichu kure parayan undallo. Ninte opinion entha?', 'Hmm, athu complicated topic aanu.'] },
  { keys: ['game', 'gaming', 'pubg', 'bgmi', 'free fire'], replies: ['What games do you play these days?', 'Ethu games aanu kalikkar?', 'Mobile aano PC gaming aano?'] },
  { keys: ['weather', 'mazha', 'rain'], replies: ['Rainy weather is perfect for a relaxed day. Do you like rain?', 'Mazha ishtamano?', 'Mazha peyyumbol chaya + snacks best alle?'] },
  { keys: ['instagram', 'insta', 'social media'], replies: ['Do you spend much time on social media?', 'Insta kure use cheyyarundo?', 'Interesting pages vallathum follow cheyyunnundo?'] },
  { keys: ['age', 'how old', 'vayass'], replies: ['I prefer keeping personal details private here. What do you like doing in your free time?', 'Personal details private aayi vechalo. Free time-il entha cheyyar?'] },
  { keys: ['name', 'who are you', 'perentha', 'ninte peru'], replies: ['You can call me Chaya chat partner. What should I call you?', 'Enne Chaya chat partner ennu vilikkam. Ninne entha vilikkendathu?'] },
  { keys: ['thank', 'thanks', 'nanni'], replies: ['You are welcome. What else is on your mind?', 'Athinentha! Vere enthelum para.', 'Welcome! Ennit entha vishesham?'] },
  { keys: ['bye', 'good night', 'gn', 'pokatte'], replies: ['Already leaving? It was nice chatting with you.', 'Povaano? Chat cheythathu nannayirunnu.', 'Sheri, take care. Pinne kanam!'] },
  { keys: ['what', 'why', 'how', 'entha', 'engane', 'enthina'], replies: ['That is a good question. What made you think of that?', 'Ath interesting question aanu. Kurachude parayamo?', 'Manassilayi. Nee uddeshichathu onnu koodi parayamo?'] }
];

// ✅ SIMPLIFIED: Flat array of mixed English/Manglish fallback strings
const fallbackReplies = [
  'Oh really? Tell me a little more.',
  'Angane aano? Kurachude para.',
  'I get you. What happened after that?',
  'Manassilayi. Ennittu entha sambhaviche?',
  'Interesting. What do you think about it?',
  'Interesting aanu. Athine kurichu nee entha vicharikkunne?',
  'Fair enough. Anything else going on?',
  'Sheri. Vere enthelum vishesham undo?',
  'I am not sure I got that. Can you explain it another way?',
  'Njan correct aayi manassilakkiyilla. Onnu koodi parayamo?',
  'What would you do in that situation?',
  'Aa situation-il nee enthu cheyyum?',
  'That sounds like a story. How did it start?',
  'Athoru story aanennu thonnunnu. Engane thudangi?',
  'Got it. What do you usually do on weekends?',
  'Sheri. Weekend-il nee usually entha cheyyar?',
  'By the way, are you more of a morning person or a night owl?',
  'Let us switch topics if you want. Movies, music, or travel?',
  'Venel topic maattam. Movies, music, travel etha venam?'
];

function choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastCounts() {
  const realUsers = [...clients.values()].filter(c => c.ws.readyState === WebSocket.OPEN).length;
  const fakeUsers = Math.floor(Math.random() * 51) + 50;
  const totalOnline = realUsers + fakeUsers;
  
  for (const client of clients.values()) {
    send(client.ws, { type: 'presence', online: totalOnline });
  }
}

function removeFromQueue(id) {
  const idx = waiting.indexOf(id);
  if (idx !== -1) waiting.splice(idx, 1);
}

function safeSendRoom(room, fromId, payload) {
  for (const id of room.members) {
    if (id === fromId) continue;
    const c = clients.get(id);
    if (c) send(c.ws, payload);
  }
}

function clearRoom(roomId, reason, notify = true) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearTimeout(room.botTimer);
  clearTimeout(room.botLeaveTimer);
  rooms.delete(roomId);
  for (const id of room.members) {
    const client = clients.get(id);
    if (client) {
      client.roomId = null;
      client.botTurns = 0;
      if (notify && id !== reason) {
        send(client.ws, { type: 'partner_left', message: 'The other person left the chat.' });
      }
    }
  }
}

function createRoom(aId, bId, kind) {
  const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const room = { id: roomId, members: [aId, bId], kind, botTimer: null, botLeaveTimer: null, botMaxTurns: 3 };
  rooms.set(roomId, room);
  
  for (const id of room.members) {
    const c = clients.get(id);
    if (c) { 
      c.roomId = roomId; 
      c.state = 'chatting'; 
      c.botTurns = 0; 
    }
  }
  
  for (const id of room.members) {
    const c = clients.get(id);
    if (c) {
      send(c.ws, { type: 'matched', roomId, partnerType: 'person' });
    }
  }
  return room;
}

function startBotFallback(clientId) {
  const client = clients.get(clientId);
  if (!client || client.roomId || client.state !== 'waiting') return;
  removeFromQueue(clientId);
  createRoom(clientId, `bot_${clientId}`, 'bot');
}

function matchmake(clientId) {
  const client = clients.get(clientId);
  if (!client || client.roomId || client.state !== 'waiting') return;
  removeFromQueue(clientId);
  
  while (waiting.length) {
    const otherId = waiting.shift();
    const other = clients.get(otherId);
    if (!other || other.state !== 'waiting' || other.roomId || other.ws.readyState !== WebSocket.OPEN) continue;
    clearTimeout(other.botTimer);
    createRoom(clientId, otherId, 'human');
    return;
  }
  
  waiting.push(clientId);
  client.botTimer = setTimeout(() => startBotFallback(clientId), BOT_FALLBACK_MS);
  send(client.ws, { type: 'waiting', message: 'Finding someone to chat with.' });
}

function leaveCurrent(clientId, reason = 'next') {
  const client = clients.get(clientId);
  if (!client) return;
  clearTimeout(client.botTimer);
  removeFromQueue(clientId);
  if (client.roomId) {
    const room = rooms.get(client.roomId);
    if (room) {
      if (room.kind === 'human') {
        safeSendRoom(room, clientId, { type: 'partner_left', message: 'The other person left the chat.' });
      }
      clearRoom(room.id, clientId, false);
    }
  }
  client.roomId = null;
  client.state = 'idle';
  client.botTurns = 0;
  send(client.ws, { type: 'ended', reason });
}

// ✅ SIMPLIFIED: No more language detection, just picks a random string from the replies array
function botReply(text) {
  const normalized = text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const rule = botRules.find(r => r.keys.some(k => normalized.includes(k)));
  
  if (rule) {
    return choose(rule.replies);
  }
  return choose(fallbackReplies);
}

function typingDelay(text) {
  return Math.min(4300, Math.max(900, 500 + text.length * 32 + Math.random() * 900));
}

function onMessage(clientId, raw) {
  const client = clients.get(clientId);
  if (!client) return;
  
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return send(client.ws, { type: 'error', message: 'Invalid message format.' }); }
  
  const now = Date.now();
  client.rate = (client.rate || []).filter(t => now - t < RATE_WINDOW_MS);
  if (client.rate.length >= RATE_MAX) return send(client.ws, { type: 'error', message: 'Please slow down for a moment.' });
  
  if (msg.type === 'start') {
    if (client.roomId) leaveCurrent(clientId, 'restart');
    client.state = 'waiting';
    matchmake(clientId);
    return;
  }
  
  if (msg.type === 'next' || msg.type === 'end') {
    leaveCurrent(clientId, msg.type);
    if (msg.type === 'next') { 
      client.state = 'waiting'; 
      matchmake(clientId); 
    }
    broadcastCounts();
    return;
  }
  
  if (msg.type === 'typing') {
    const room = rooms.get(client.roomId);
    if (room && room.kind === 'human') safeSendRoom(room, clientId, { type: 'typing', active: !!msg.active });
    return;
  }
  
  if (msg.type === 'chat') {
    const text = String(msg.text || '').trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LENGTH) return send(client.ws, { type: 'error', message: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
    
    client.rate.push(now);
    const room = rooms.get(client.roomId);
    if (!room) return send(client.ws, { type: 'error', message: 'You are not in a chat. Tap Start Chat to find someone.' });
    
    send(client.ws, { type: 'message', from: 'you', text, time: now });
    
    if (room.kind === 'human') {
      safeSendRoom(room, clientId, { type: 'message', from: 'stranger', text, time: now });
    } else {
      client.botTurns = (client.botTurns || 0) + 1;
      send(client.ws, { type: 'typing', active: true, bot: true });
      
      // ✅ SIMPLIFIED: Just pass the text, no language parameter needed
      const reply = botReply(text);
      const delay = typingDelay(reply);
      
      clearTimeout(room.botTimer);
      room.botTimer = setTimeout(() => {
        const current = clients.get(clientId);
        if (!current || current.roomId !== room.id || current.ws.readyState !== WebSocket.OPEN) return;
        
        send(current.ws, { type: 'typing', active: false, bot: true });
        send(current.ws, { type: 'message', from: 'partner', text: reply, time: Date.now() });
        
        if (current.botTurns >= room.botMaxTurns) {
          const naturalGoodbyes = [
            'Okay, I have to go now. Talk later!',
            'Nice chatting, but I gotta run. Bye!',
            'I am leaving now. Take care!',
            'Sheri, njan pokunnu. Pinne kanam!'
          ];
          
          send(current.ws, { type: 'message', from: 'partner', text: choose(naturalGoodbyes), time: Date.now() });
          
          room.botLeaveTimer = setTimeout(() => {
            const still = clients.get(clientId);
            if (still && still.roomId === room.id && still.ws.readyState === WebSocket.OPEN) {
              clearRoom(room.id, null, false);
              send(still.ws, { type: 'partner_left', message: 'The other person left the chat.' });
              still.state = 'waiting';
              matchmake(clientId);
            }
          }, 2500);
        }
      }, delay);
    }
  }
}

wss.on('connection', (ws) => {
  const id = `u_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  clients.set(id, { id, ws, roomId: null, state: 'idle', botTurns: 0, botTimer: null, rate: [], lastPong: Date.now() });
  ws.isAlive = true;
  ws.on('pong', () => { 
    ws.isAlive = true; 
    const c = clients.get(id); 
    if (c) c.lastPong = Date.now(); 
  });
  
  send(ws, { type: 'welcome', id });
  broadcastCounts();
  
  ws.on('message', raw => onMessage(id, raw));
  ws.on('close', () => {
    leaveCurrent(id, 'disconnect');
    clients.delete(id);
    broadcastCounts();
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const [id, client] of clients) {
    if (client.ws.isAlive === false) { client.ws.terminate(); continue; }
    client.ws.isAlive = false;
    client.ws.ping();
  }
  broadcastCounts();
}, 15000);

const countRefresh = setInterval(broadcastCounts, 5000);

const originalCreateRoom = createRoom;
createRoom = function(aId, bId, kind) {
  const room = originalCreateRoom(aId, bId, kind);
  if (kind === 'bot') {
    room.botMaxTurns = 3 + Math.floor(Math.random() * 4);
  }
  return room;
};

server.listen(PORT, '0.0.0.0', () => console.log(`Chaya.2bd listening on ${PORT}`));

process.on('SIGTERM', () => { 
  clearInterval(heartbeat); 
  clearInterval(countRefresh); 
  server.close(() => process.exit(0)); 
});
