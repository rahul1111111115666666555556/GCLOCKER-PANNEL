const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const helmet = require("helmet");
const { spawn } = require("child_process");

const app = express();
app.use(helmet());
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const USERS_DIR = path.join(__dirname, "users");

// Multer setup for file upload (single file, field name: "automsgFile")
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve public folder (your HTML is here)
app.use(express.static(path.join(__dirname, "public")));

let botProcesses = {}; // uid -> child process

// Helper: Ensure user directory exists
function ensureUserDir(uid) {
  const userDir = path.join(USERS_DIR, uid);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  return userDir;
}

// Save file content to user folder
function saveUserFile(uid, filename, content) {
  const filePath = path.join(USERS_DIR, uid, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// Routes

// Start bot
app.post("/start-bot", upload.single("automsgFile"), (req, res) => {
  const { appstate, admin, automsg, speed } = req.body;

  if (!appstate || !admin) return res.status(400).send("AppState and Admin UID required.");

  const uid = admin.trim();
  const userDir = ensureUserDir(uid);

  try {
    // Save appstate.json
    saveUserFile(uid, "appstate.json", appstate);

    // Save admin.txt
    saveUserFile(uid, "admin.txt", uid);

    // Save automsg.txt (auto reply message)
    if (automsg) saveUserFile(uid, "automsg.txt", automsg);

    // Save speed.txt (optional)
    if (speed) {
      const spdNum = parseInt(speed, 10);
      if (!isNaN(spdNum) && spdNum >= 5) {
        saveUserFile(uid, "speed.txt", spdNum.toString());
      }
    }

    // Kill old bot if running
    if (botProcesses[uid]) {
      botProcesses[uid].kill();
      delete botProcesses[uid];
    }

    // Spawn new bot process
    const botProcess = spawn("node", ["bot.js", uid], { stdio: ["ignore", "pipe", "pipe"] });

    botProcesses[uid] = botProcess;

    botProcess.stdout.on("data", (data) => {
      console.log(`[BOT ${uid}] ${data.toString().trim()}`);
    });

    botProcess.stderr.on("data", (data) => {
      console.error(`[BOT ${uid} ERROR] ${data.toString().trim()}`);
    });

    botProcess.on("exit", (code) => {
      console.log(`[BOT ${uid}] exited with code ${code}`);
      delete botProcesses[uid];
    });

    res.send("🟢 Bot started successfully.");
  } catch (e) {
    console.error(e);
    res.status(500).send("❌ Failed to start bot: " + e.message);
  }
});

// Stop bot
app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID required to stop bot.");

  if (botProcesses[uid]) {
    botProcesses[uid].kill();
    delete botProcesses[uid];
    return res.send("🔴 Bot stopped successfully.");
  } else {
    return res.send("⚠️ No running bot found for this UID.");
  }
});

// Get logs
app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID required to get logs.");

  const logPath = path.join(USERS_DIR, uid, "logs.txt");
  if (!fs.existsSync(logPath)) return res.send("No logs found.");

  const logs = fs.readFileSync(logPath, "utf-8");
  res.send(logs);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
