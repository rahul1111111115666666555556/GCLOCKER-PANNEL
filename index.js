const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer(); // For future if needed, currently not used

// Keep track of running bots: { uid: childProcess }
const bots = new Map();

function ensureUserDir(uid) {
  const userDir = path.join(__dirname, "users", uid);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  return userDir;
}

app.post("/start-bot", (req, res) => {
  const { appstate, admin, automsg, speed } = req.body;
  if (!appstate || !admin) return res.status(400).send("AppState and Admin UID required.");

  if (bots.has(admin)) {
    return res.status(400).send("Bot already running for this UID.");
  }

  const userDir = ensureUserDir(admin);

  // Save files
  try {
    fs.writeFileSync(path.join(userDir, "appstate.json"), appstate, "utf-8");
    fs.writeFileSync(path.join(userDir, "admin.txt"), admin, "utf-8");
    fs.writeFileSync(path.join(userDir, "automsg.txt"), automsg || "", "utf-8");
    const speedVal = parseInt(speed, 10);
    fs.writeFileSync(path.join(userDir, "speed.txt"), (!isNaN(speedVal) && speedVal >= 5) ? String(speedVal) : "40", "utf-8");
  } catch (e) {
    return res.status(500).send("Failed to save user data: " + e.message);
  }

  // Spawn bot.js child process
  const botProcess = spawn("node", ["bot.js", admin, automsg || ""]);

  botProcess.stdout.on("data", (data) => {
    const logLine = data.toString();
    const logPath = path.join(userDir, "logs.txt");
    fs.appendFileSync(logPath, logLine);
    console.log(`[BOT ${admin}] ${logLine.trim()}`);
  });

  botProcess.stderr.on("data", (data) => {
    console.error(`[BOT ERR ${admin}] ${data.toString().trim()}`);
  });

  botProcess.on("exit", (code) => {
    console.log(`[BOT ${admin}] exited with code ${code}`);
    bots.delete(admin);
  });

  bots.set(admin, botProcess);
  res.send("Bot started successfully for UID: " + admin);
});

app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID required to stop bot.");

  const botProcess = bots.get(uid);
  if (!botProcess) return res.status(404).send("No running bot found for this UID.");

  botProcess.kill();
  bots.delete(uid);
  res.send("Bot stopped for UID: " + uid);
});

app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID required.");

  const logPath = path.join(__dirname, "users", uid, "logs.txt");
  if (!fs.existsSync(logPath)) return res.send("No logs available.");

  const logs = fs.readFileSync(logPath, "utf-8");
  res.send(logs);
});

server.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
