const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
app.use(helmet());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const usersDir = path.join(__dirname, "users");
if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir);

// Multer setup for single file upload with fieldname 'automsgFile'
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uid = req.body.admin;
      if (!uid) return cb(new Error("Missing UID"));
      const userFolder = path.join(usersDir, uid);
      if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });
      cb(null, userFolder);
    },
    filename: (req, file, cb) => {
      cb(null, "automsg.txt");
    },
  }),
  limits: { fileSize: 1024 * 1024 }, // max 1MB
});

const bots = new Map();

app.post("/start-bot", upload.single("automsgFile"), (req, res) => {
  try {
    const { appstate, admin } = req.body;
    if (!appstate || !admin) return res.status(400).send("AppState and Admin UID required");

    const userFolder = path.join(usersDir, admin);
    if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });

    // Save appstate.json
    fs.writeFileSync(path.join(userFolder, "appstate.json"), appstate, "utf-8");

    // Save admin.txt
    fs.writeFileSync(path.join(userFolder, "admin.txt"), admin, "utf-8");

    // If automsgFile was uploaded, multer already saved it as automsg.txt

    // If no automsgFile upload in this request, but automsg text sent in body (for fallback)
    if (!req.file && req.body.automsg) {
      fs.writeFileSync(path.join(userFolder, "automsg.txt"), req.body.automsg, "utf-8");
    }

    // If bot already running, kill first
    if (bots.has(admin)) {
      const oldProc = bots.get(admin);
      oldProc.kill("SIGINT");
      bots.delete(admin);
    }

    // Spawn bot.js child process
    const botProcess = spawn("node", ["bot.js", admin], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    botProcess.stdout.on("data", (data) => {
      console.log(`[BOT ${admin}] ${data.toString()}`);
      const logFile = path.join(userFolder, "logs.txt");
      fs.appendFileSync(logFile, data.toString());
    });

    botProcess.stderr.on("data", (data) => {
      console.error(`[BOT ${admin} ERROR] ${data.toString()}`);
      const logFile = path.join(userFolder, "logs.txt");
      fs.appendFileSync(logFile, data.toString());
    });

    botProcess.on("exit", (code) => {
      console.log(`[BOT ${admin}] exited with code ${code}`);
      bots.delete(admin);
    });

    bots.set(admin, botProcess);

    res.send("🤖 Bot started successfully!");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Error starting bot: " + err.message);
  }
});

app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID required to stop bot");

  if (bots.has(uid)) {
    const proc = bots.get(uid);
    proc.kill("SIGINT");
    bots.delete(uid);
    return res.send(`🛑 Bot stopped for UID ${uid}`);
  } else {
    return res.status(404).send("Bot not running for this UID");
  }
});

app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID required for logs");

  const logFile = path.join(usersDir, uid, "logs.txt");
  if (!fs.existsSync(logFile)) return res.send("No logs found.");

  fs.readFile(logFile, "utf-8", (err, data) => {
    if (err) return res.send("Error reading logs.");
    res.send(data);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
