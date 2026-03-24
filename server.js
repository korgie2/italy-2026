const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "trip_data.json");
const PORT = 3000;

let state = { tripData: null, packingData: {} };

if (fs.existsSync(DATA_FILE)) {
  try { state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch(e) { console.log("Starting fresh"); }
}

function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state), "utf8");
}

const clients = new Set();

function sendToSocket(socket, obj) {
  const data = JSON.stringify(obj);
  const buf = Buffer.from(data);
  let header;
  if (buf.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = buf.length;
  } else if (buf.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(buf.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(buf.length), 2);
  }
  try { socket.write(Buffer.concat([header, buf])); } catch(e) {}
}

function broadcast(msg, exclude) {
  for (const ws of clients) {
    if (ws !== exclude && ws._wsOpen) sendToSocket(ws, msg);
  }
}

const server = http.createServer((req, res) => {
  const htmlPath = path.join(__dirname, "index.html");
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(htmlPath).pipe(res);
    } else {
      res.writeHead(404); res.end("App not found - upload index.html");
    }
  } else {
    res.writeHead(404); res.end("Not found");
  }
});

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") { socket.destroy(); return; }
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );
  socket._wsOpen = true;
  clients.add(socket);
  console.log("[+] Client connected (" + clients.size + " total)");
  sendToSocket(socket, { type: "init", tripData: state.tripData, packingData: state.packingData });

  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b1 = buf[0], b2 = buf[1];
      const opcode = b1 & 0x0f;
      if (opcode === 8) { socket._wsOpen = false; socket.destroy(); return; }
      const masked = (b2 & 0x80) !== 0;
      let payloadLen = b2 & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (buf.length < 4) break;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buf.length < 10) break;
        payloadLen = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const total = offset + (masked ? 4 : 0) + payloadLen;
      if (buf.length < total) break;
      const mask = masked ? buf.slice(offset, offset + 4) : null;
      if (masked) offset += 4;
      const payload = Buffer.from(buf.slice(offset, offset + payloadLen));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buf = buf.slice(total);
      if (opcode === 1) {
        try {
          const msg = JSON.parse(payload.toString("utf8"));
          if (msg.type === "update_trip") { state.tripData = msg.data; saveState(); broadcast({ type: "update_trip", data: msg.data }, socket); }
          else if (msg.type === "update_packing") { state.packingData = msg.data; saveState(); broadcast({ type: "update_packing", data: msg.data }, socket); }
        } catch(e) {}
      }
    }
  });
  socket.on("close", () => { socket._wsOpen = false; clients.delete(socket); console.log("[-] Client left (" + clients.size + " total)"); });
  socket.on("error", () => { socket._wsOpen = false; clients.delete(socket); });
});

server.listen(PORT, () => {
  console.log("Italy 2026 running on http://5.161.64.70:" + PORT);
});
