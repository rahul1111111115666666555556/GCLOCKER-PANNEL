const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { spawn } = require("child_process");

const app = express();
const server = http.createServer(app);

const upload = multer({ dest: path.join(__dirname, "uploads") });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const bots = new Map();

// Helper: create user folders
function ensureUserDir(uid) {
  const userDir = path.join(__dirname, "users", uid);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  return userDir;
}

// POST /start-bot
// Receives { appstate, admin, automsg, speed }
app.post("/start-bot", upload.none(), (req, res) => {
  const { appstate, admin, automsg, speed } = req.body;
  if (!appstate || !admin || !automsg) {
    return res.status(400).send("❌ Missing appstate, admin UID, or automsg!");
  }

  if (bots.has(admin)) {
    return res.status(400).send("❌ Bot already running for this UID!");
  }

  const userDir = ensureUserDir(admin);

  // Save appstate.json
  try {
    fs.writeFileSync(path.join(userDir, "appstate.json"), appstate);
  } catch (e) {
    return res.status(500).send("❌ Failed to save appstate: " + e.message);
  }

  // Save admin.txt
  try {
    fs.writeFileSync(path.join(userDir, "admin.txt"), admin);
  } catch (e) {
    return res.status(500).send("❌ Failed to save admin UID: " + e.message);
  }

  // Save automsg.txt
  try {
    fs.writeFileSync(path.join(userDir, "automsg.txt"), automsg);
  } catch (e) {
    return res.status(500).send("❌ Failed to save automsg: " + e.message);
  }

  // Save speed.txt
  let speedNum = parseInt(speed, 10);
  if (isNaN(speedNum) || speedNum < 5) speedNum = 40;
  try {
    fs.writeFileSync(path.join(userDir, "speed.txt"), String(speedNum));
  } catch (e) {
    return res.status(500).send("❌ Failed to save speed: " + e.message);
  }

  // Spawn bot process
  const botProcess = spawn("node", ["bot.js", admin, automsg, speedNum], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  // Log output streams
  botProcess.stdout.on("data", (data) => {
    fs.appendFileSync(path.join(userDir, "logs.txt"), data.toString());
  });
  botProcess.stderr.on("data", (data) => {
    fs.appendFileSync(path.join(userDir, "logs.txt"), data.toString());
  });

  botProcess.on("exit", (code) => {
    fs.appendFileSync(path.join(userDir, "logs.txt"), `\n⚠️ Bot process exited with code ${code}\n`);
    bots.delete(admin);
  });

  bots.set(admin, botProcess);

  res.send("✅ Bot started successfully!");
});

// GET /stop-bot?uid=xxx
app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("❌ Missing UID!");

  if (!bots.has(uid)) {
    return res.status(400).send("❌ No running bot for this UID.");
  }

  const botProcess = bots.get(uid);
  botProcess.kill();
  bots.delete(uid);

  res.send("🛑 Bot stopped successfully!");
});

// GET /logs?uid=xxx
app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("❌ Missing UID!");

  const logPath = path.join(__dirname, "users", uid, "logs.txt");
  if (!fs.existsSync(logPath)) return res.send("📜 No logs found.");

  const logs = fs.readFileSync(logPath, "utf-8");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(logs);
});

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
