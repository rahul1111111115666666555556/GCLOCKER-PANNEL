const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const multer = require("multer");
const helmet = require("helmet");

const app = express();
app.use(helmet());
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");
const usersDir = path.join(__dirname, "users");

if (!fs.existsSync(usersDir)) {
  fs.mkdirSync(usersDir, { recursive: true });
}

// Serve static files (html)
app.use(express.static(publicDir));
app.use(express.json({ limit: "10mb" }));

// Multer setup for automsg.txt upload via multipart/form-data
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uid = req.body.uid;
    if (!uid) return cb(new Error("UID missing"));
    const userDir = path.join(usersDir, uid);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    cb(null, "automsg.txt");
  },
});
const upload = multer({ storage }).single("automsgFile");

// Keep track of running bot processes by UID
const bots = new Map();

// Upload automsg file (optional - if you want separate upload endpoint)
app.post("/upload-automsg-file", (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).send("❌ Upload error: " + err.message);
    res.send("✅ automsg.txt uploaded successfully");
  });
});

// Start bot endpoint - expects JSON body { appstate, admin, automsg, uid? }
app.post("/start-bot", async (req, res) => {
  const { appstate, admin, automsg = "", uid } = req.body;
  if (!appstate || !admin) return res.status(400).send("❌ appstate and admin UID required");

  const userUID = uid || admin;
  const userDir = path.join(usersDir, userUID);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

  try {
    // Save appstate.json, admin.txt, automsg.txt
    fs.writeFileSync(path.join(userDir, "appstate.json"), appstate, "utf-8");
    fs.writeFileSync(path.join(userDir, "admin.txt"), admin, "utf-8");
    fs.writeFileSync(path.join(userDir, "automsg.txt"), automsg, "utf-8");
  } catch (e) {
    return res.status(500).send("❌ Failed to save files: " + e.message);
  }

  // If bot already running, kill it
  if (bots.has(userUID)) {
    const oldProc = bots.get(userUID);
    oldProc.kill("SIGKILL");
    bots.delete(userUID);
  }

  // Spawn bot.js with UID argument
  const botProcess = spawn("node", ["bot.js", userUID], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  bots.set(userUID, botProcess);

  const logPath = path.join(userDir, "logs.txt");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  botProcess.stdout.on("data", (data) => {
    const log = data.toString();
    logStream.write(log);
    console.log(`[BOT ${userUID} STDOUT] ${log.trim()}`);
  });

  botProcess.stderr.on("data", (data) => {
    const log = data.toString();
    logStream.write(log);
    console.error(`[BOT ${userUID} STDERR] ${log.trim()}`);
  });

  botProcess.on("close", (code) => {
    bots.delete(userUID);
    logStream.write(`[${new Date().toLocaleTimeString()}] Bot exited with code ${code}\n`);
    console.log(`[BOT ${userUID}] exited with code ${code}`);
  });

  res.send(`🟢 Bot started for UID: ${userUID}`);
});

// Stop bot
app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("❌ UID required");
  if (!bots.has(uid)) return res.status(400).send("❌ No running bot for UID");

  const proc = bots.get(uid);
  proc.kill("SIGKILL");
  bots.delete(uid);

  res.send(`🔴 Bot stopped for UID: ${uid}`);
});

// Serve logs
app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("❌ UID required");

  const logPath = path.join(usersDir, uid, "logs.txt");
  if (!fs.existsSync(logPath)) return res.send("No logs found.");

  const logs = fs.readFileSync(logPath, "utf-8");
  res.send(logs);
});

// 404 fallback
app.use((req, res) => {
  res.status(404).send("404 Not Found");
});

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
