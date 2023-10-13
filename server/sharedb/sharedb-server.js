var http = require("http");
var process = require("process");
var ShareDB = require("sharedb");
var richText = require("rich-text");
var WebSocket = require("ws");
var WebSocketJSONStream = require("@teamwork/websocket-json-stream");

// Modified from https://github.com/share/sharedb/blob/master/examples/rich-text/server.js

const docID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const port = process.env.PORT || 3000;

ShareDB.types.register(richText.type);
var backend = new ShareDB();
createDoc(startServer);

// Create initial document then fire callback
function createDoc(callback) {
  var connection = backend.connect();
  var doc = connection.get("a", docID);
  doc.fetch(function (err) {
    if (err) throw err;
    if (doc.type === null) {
      doc.create([], "rich-text", callback);
      return;
    }
    callback();
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("sharedb-server");
  });

  // Connect any incoming WebSocket connection to ShareDB
  var wss = new WebSocket.Server({ server: server });
  wss.on("connection", function (ws) {
    var stream = new WebSocketJSONStream(ws);
    // Prevent server crashes on errors.
    // From https://github.com/share/sharedb/issues/275#issuecomment-483690349
    stream.on("error", (error) => {
      // Tends to print "WebSocket CLOSING or CLOSED."
      console.log(error.message);
      console.error(error.message);
    });
    backend.listen(stream);
  });

  server.listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
}
