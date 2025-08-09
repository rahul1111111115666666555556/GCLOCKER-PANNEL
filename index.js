const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const bots = new Map(); // Map<UID, ChildProcess>

const USERS_DIR = path.join(__dirname, "users");
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });

// POST /start-bot
app.post("/start-bot", (req, res) => {
  const { appstate, admin, automsg } = req.body;
  if (!appstate || !admin) return res.status(400).send("AppState and Admin UID required.");

  const uid = admin; // UID used as folder & bot key

  const userDir = path.join(USERS_DIR, uid);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

  // Save files
  try {
    fs.writeFileSync(path.join(userDir, "appstate.json"), appstate);
    fs.writeFileSync(path.join(userDir, "admin.txt"), admin);
    if (automsg && automsg.trim().length > 0) {
      fs.writeFileSync(path.join(userDir, "automsg.txt"), automsg);
    }
  } catch (e) {
    console.error("Error saving files:", e);
    return res.status(500).send("Failed to save files.");
  }

  // If bot is already running for this UID, kill first
  if (bots.has(uid)) {
    bots.get(uid).kill();
    bots.delete(uid);
  }

  // Spawn bot.js process
  // Pass UID and automsg as args
  const botProcess = spawn("node", [
    path.join(__dirname, "bot.js"),
    uid,
    automsg || "",
  ]);

  botProcess.stdout.on("data", (data) => {
    console.log(`[BOT ${uid}] ${data}`);
    appendLog(uid, data.toString());
  });
  botProcess.stderr.on("data", (data) => {
    console.error(`[BOT ${uid} ERROR] ${data}`);
    appendLog(uid, data.toString());
  });
  botProcess.on("exit", (code) => {
    console.log(`[BOT ${uid}] exited with code ${code}`);
    bots.delete(uid);
  });

  bots.set(uid, botProcess);

  return res.send(`Bot started for UID ${uid}`);
});

// GET /stop-bot?uid=...
app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID query param required.");

  if (bots.has(uid)) {
    bots.get(uid).kill();
    bots.delete(uid);
    return res.send(`Bot stopped for UID ${uid}`);
  } else {
    return res.send(`No running bot found for UID ${uid}`);
  }
});

// GET /logs?uid=...
app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID query param required.");

  const logFile = path.join(USERS_DIR, uid, "logs.txt");
  if (!fs.existsSync(logFile)) return res.send("No logs found.");

  fs.readFile(logFile, "utf-8", (err, data) => {
    if (err) return res.status(500).send("Failed to read logs.");
    res.send(data);
  });
});

// Helper to append logs to logs.txt
function appendLog(uid, text) {
  const logFile = path.join(USERS_DIR, uid, "logs.txt");
  fs.appendFile(logFile, text, (err) => {
    if (err) console.error("Failed to append log:", err);
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
