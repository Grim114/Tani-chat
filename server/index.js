import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  },
});

const port = Number(process.env.PORT) || 3001;
const messageHistory = [];
const directMessageHistory = new Map();
const maxHistory = 100;

function getDirectMessageKey(firstId, secondId) {
  return [firstId, secondId].sort().join(":");
}

function broadcastMembers() {
  const members = [...io.sockets.sockets.values()]
    .filter((socket) => socket.data.name)
    .map((socket) => ({ id: socket.id, name: socket.data.name }));
  io.emit("chat:members", members);
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

io.on("connection", (socket) => {
  socket.emit("chat:history", messageHistory);
  io.emit("chat:online", io.engine.clientsCount);
  broadcastMembers();

  socket.on("chat:join", (name) => {
    const safeName = typeof name === "string" ? name.trim().slice(0, 24) : "";
    if (safeName) {
      socket.data.name = safeName;
      io.emit("chat:system", {
        id: `system-${socket.id}`,
        text: `${safeName} joined the chat`,
        time: new Date().toISOString(),
      });
      broadcastMembers();
    }
  });

  socket.on("chat:message", (text) => {
    if (typeof text !== "string") return;
    const trimmedText = text.trim().slice(0, 1000);
    if (!trimmedText || !socket.data.name) return;

    const message = {
      id: `${socket.id}-${Date.now()}`,
      name: socket.data.name,
      text: trimmedText,
      time: new Date().toISOString(),
    };
    messageHistory.push(message);
    if (messageHistory.length > maxHistory) messageHistory.shift();
    io.emit("chat:message", message);
  });

  socket.on("dm:open", (peerId) => {
    if (typeof peerId !== "string" || peerId === socket.id || !socket.data.name) return;
    const peer = io.sockets.sockets.get(peerId);
    if (!peer?.data.name) {
      socket.emit("dm:error", "That person is no longer online.");
      return;
    }

    const key = getDirectMessageKey(socket.id, peerId);
    socket.emit("dm:history", {
      peerId,
      peerName: peer.data.name,
      messages: directMessageHistory.get(key) ?? [],
    });
  });

  socket.on("dm:message", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const { to, text } = payload;
    if (typeof to !== "string" || typeof text !== "string" || !socket.data.name) return;
    if (to === socket.id) return;

    const peer = io.sockets.sockets.get(to);
    if (!peer?.data.name) {
      socket.emit("dm:error", "That person is no longer online.");
      return;
    }

    const trimmedText = text.trim().slice(0, 1000);
    if (!trimmedText) return;

    const message = {
      id: `${socket.id}-${Date.now()}`,
      name: socket.data.name,
      text: trimmedText,
      time: new Date().toISOString(),
    };
    const key = getDirectMessageKey(socket.id, to);
    const history = directMessageHistory.get(key) ?? [];
    history.push(message);
    if (history.length > maxHistory) history.shift();
    directMessageHistory.set(key, history);

    socket.emit("dm:message", { peerId: to, peerName: peer.data.name, message });
    peer.emit("dm:message", { peerId: socket.id, peerName: socket.data.name, message });
  });

  socket.on("disconnect", () => {
    if (socket.data.name) {
      io.emit("chat:system", {
        id: `system-${socket.id}-left`,
        text: `${socket.data.name} left the chat`,
        time: new Date().toISOString(),
      });
    }
    io.emit("chat:online", io.engine.clientsCount);
    broadcastMembers();
  });
});

httpServer.listen(port, () => {
  console.log(`Chat server listening on http://localhost:${port}`);
});
