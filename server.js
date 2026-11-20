import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import { LanMatch } from "./lan-match.js";
import { ROOM_SIZE } from "./js/lan-rules.js";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ...["audio", "engine", "lan", "lan-avatar", "lan-rules", "lan-view", "levels", "main", "textures", "weapon-art", "weapons"]
    .map((name) => ["/js/" + name + ".js", ["js/" + name + ".js", "text/javascript"]]),
  ["/node_modules/three/build/three.module.js", ["node_modules/three/build/three.module.js", "text/javascript"]],
]);

const server = createServer(async (request, response) => {
  const pathname = request.url.split("?")[0];
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, {
      "Content-Type": file[1] + "; charset=utf-8",
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    }).end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    console.error(error.message);
    response.writeHead(500).end();
  }
});

function lanAddresses() {
  const { address: bound, port } = server.address();
  if (bound === "127.0.0.1" || bound === "::1") return [];
  if (bound !== "0.0.0.0" && bound !== "::") return ["http://" + bound + ":" + port + "/"];
  const interfaces = Object.entries(networkInterfaces());
  const physical = interfaces.filter(([name]) =>
    !/vethernet|virtual|vmware|loopback|wsl|tailscale|wireguard|^(?:tun|tap|utun)\d+$|\bvpn\b/i.test(name));
  const addresses = (list) => list.flatMap(([, entries]) => entries
    .filter(({ family, internal, address }) => family === "IPv4" && !internal && !address.startsWith("169.254."))
    .map(({ address }) => "http://" + address + ":" + port + "/"));
  const preferred = addresses(physical);
  return [...new Set(preferred.length ? preferred : addresses(interfaces))];
}

const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048 });
const rooms = new Map();
const codes = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function roomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => codes[randomInt(codes.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  const payload = JSON.stringify(message);
  for (const { socket } of room.players) {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 128 * 1024) socket.send(payload);
  }
}

function sendRoom(room) {
  broadcast(room, {
    type: "room",
    code: room.code,
    mode: room.mode,
    host: room.players[0].id,
    playing: Boolean(room.match),
    note: room.note || "",
    members: room.players.map(({ id, name, slot }) => ({ id, name, slot })),
  });
}

function resetRoom(room) {
  if (!room.match) return;
  for (const player of room.players) room.match.remove(player);
  room.match = null;
}

function leave(socket) {
  const room = socket.room;
  if (!room) return;
  const player = socket.player;
  room.match?.remove(player);
  room.players.splice(room.players.indexOf(player), 1);
  socket.room = null;
  socket.player = null;
  if (!room.players.length) {
    rooms.delete(room.code);
    return;
  }
  if (room.match && room.mode === "pvp" && room.players.length < 2) {
    resetRoom(room);
    room.note = "对手已离开，等待其他玩家加入。";
  }
  sendRoom(room);
}

function join(socket, room, name) {
  const slots = new Set(room.players.map((player) => player.slot));
  const slot = Array.from({ length: ROOM_SIZE }, (_, i) => i).find((i) => !slots.has(i));
  const player = { id: socket.id, slot, name, socket };
  room.players.push(player);
  room.note = "";
  socket.room = room;
  socket.player = player;
  sendRoom(room);
}

function handleMessage(socket, message, now) {
  if (!message || typeof message !== "object") return;
  const room = socket.room;
  const error = (text) => send(socket, { type: "error", text });
  if (message.type === "create" || message.type === "join") {
    if (room) return error("请先离开当前房间。");
    const name = typeof message.name === "string" ? message.name.trim().replace(/\s+/g, " ").slice(0, 18) : "";
    if (!name) return error("请输入玩家昵称。");
    if (message.type === "create") {
      if (!["pvp", "coop"].includes(message.mode)) return error("请选择游戏模式。");
      const created = { code: roomCode(), mode: message.mode, players: [], match: null };
      rooms.set(created.code, created);
      join(socket, created, name);
    } else {
      if (typeof message.code !== "string") return error("请输入房间码。");
      const target = rooms.get(message.code.trim().toUpperCase());
      if (!target) return error("找不到这个房间，请核对房间码。");
      if (target.match) return error("对局已开始，请等房主返回房间。");
      if (target.players.length >= ROOM_SIZE) return error("房间已满。");
      join(socket, target, name);
    }
    return;
  }
  if (!room) return;

  const match = room.match;
  if (message.type === "input") {
    match?.input(socket.player, message, now);
  } else if (message.type === "leave") {
    leave(socket);
    send(socket, { type: "left" });
  } else if (room.players[0] === socket.player) {
    if (message.type === "start" && !match) {
      if (room.players.length < 2) return error("至少需要两名玩家。");
      room.match = new LanMatch(room.mode, room.players);
      room.match.start();
      sendRoom(room);
    } else if (message.type === "next" && match?.phase === "cleared") {
      match.start(match.level + 1, true);
    } else if (message.type === "retry" && match?.phase === "failed") {
      match.start(match.level);
    } else if (message.type === "lobby" && match) {
      resetRoom(room);
      sendRoom(room);
    }
  }
}

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/lan" || request.headers.origin !== "http://" + request.headers.host || sockets.clients.size >= 64) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  sockets.handleUpgrade(request, socket, head, (connection) => sockets.emit("connection", connection));
});

sockets.on("connection", (socket) => {
  socket.id = randomUUID();
  socket.alive = true;
  socket.lastWindow = performance.now();
  socket.messageCount = 0;
  send(socket, { type: "hello", id: socket.id, addresses: lanAddresses() });
  socket.on("pong", () => { socket.alive = true; });
  socket.on("error", () => socket.terminate());
  socket.on("close", () => leave(socket));
  socket.on("message", (raw, binary) => {
    if (binary) return;
    const now = performance.now();
    if (now - socket.lastWindow >= 1000) {
      socket.lastWindow = now;
      socket.messageCount = 0;
    }
    if (++socket.messageCount > 160) return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    handleMessage(socket, message, now);
  });
});

const tick = 1 / 60;
let lastTick = performance.now();
let accumulator = 0;
let frame = 0;
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  while (accumulator >= tick) {
    accumulator -= tick;
    frame += 1;
    for (const room of rooms.values()) {
      if (!room.match) continue;
      room.match.update(tick, now);
      if (frame % 2 === 0) broadcast(room, room.match.snapshot());
    }
  }
}, 8).unref();

setInterval(() => {
  for (const socket of sockets.clients) {
    if (!socket.alive) socket.terminate();
    else {
      socket.alive = false;
      socket.ping();
    }
  }
}, 15000).unref();

server.listen(port, host, () => {
  console.log("INK & IRON 本机 http://127.0.0.1:" + server.address().port + "/");
  for (const address of lanAddresses()) console.log("INK & IRON 局域网 " + address);
});
