import { Repo } from "@automerge/automerge-repo";
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket";
import express from "express";
import { WebSocketServer } from "ws";

// Automerge WebSocket server, modified from v0.1.4 of
// https://github.com/automerge/automerge-repo-sync-server/blob/main/src/server.js

(async function () {
  const wss = new WebSocketServer({ noServer: true });

  const PORT =
    process.env.PORT !== undefined ? parseInt(process.env.PORT) : 3000;
  const app = express();

  const config = {
    network: [new NodeWSServerAdapter(wss)],
    peerId: "a",
  };
  const serverRepo = new Repo(config);

  // Create a default document for the benchmarks to use.
  // For Quill, we set its starting state to "\n".
  // TODO: could creating this handle cause the server to do extra work
  // updating it?
  const docHandle = serverRepo.create();
  await docHandle.whenReady();
  docHandle.change((doc) => (doc.text = "\n"));

  app.get("/", (req, res) => {
    res.send(`👍 @automerge/automerge-repo-sync-server is running`);
  });

  const server = app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });

  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (socket) => {
      wss.emit("connection", socket, request);
    });
  });
})();
