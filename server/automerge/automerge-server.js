const http = require("http");
const { WebSocket, WebSocketServer } = require("ws");

// Our own bare-bones WebSocket server that stores (in-memory) & echoes
// updates to a single document.

const host = process.env.HOST || "localhost";
const port = process.env.PORT || 3001;

const heartbeatInterval = 30000;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("automerge-custom-server");
});

/** @type Set<WebSocket> */
const clients = new Set();

/** @type ArrayBuffer[] */
const updateHistory = [];

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.binaryType = "arraybuffer";

  ws.on("message", (data) => onMessage(ws, data));
  ws.on("close", () => onClose(ws));
  ws.on("error", () => onClose(ws));

  onOpen(ws);
});

/** @param{WebSocket} ws */
function onOpen(ws) {
  // Hearbeats to keep the connection alive.
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else clearInterval(interval);
  }, heartbeatInterval);

  // Send the current update history.
  for (const update of updateHistory) {
    ws.send(update);
  }
  ws.send("loaded");
}

/**
 *
 * @param {WebSocket} ws
 * @param {ArrayBuffer} data
 */
function onMessage(ws, data) {
  updateHistory.push(data);
  // Echo to all other clients.
  for (const client of clients) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/** @param{WebSocket} ws */
function onClose(ws) {
  clients.delete(ws);
}

server.listen(port, host, () => {
  console.log(`automerge-custom-server running at http://${host}:${port}/`);
});
