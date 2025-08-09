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

if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir, { recursive: true });

app.use(express.static(publicDir));
app.use(express.json({ limit: "10mb" }));

// Multer setup for auto reply message file upload
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

// Map to keep track of running bots by UID
const bots = new Map();

// Start bot endpoint
app.post("/start-bot", (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).send("File upload error: " + err.message);

    const { appstate, admin, speed, uid, automsg } = req.body;

    if (!uid || !appstate || !admin) {
      return res.status(400).send("UID, AppState and Admin UID are required");
    }

    const userDir = path.join(usersDir, uid);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

    // Save appstate.json
    try {
      fs.writeFileSync(path.join(userDir, "appstate.json"), appstate, "utf-8");
    } catch (e) {
      return res.status(500).send("Failed to save appstate.json");
    }

    // Save admin.txt
    try {
      fs.writeFileSync(path.join(userDir, "admin.txt"), admin, "utf-8");
    } catch (e) {
      return res.status(500).send("Failed to save admin.txt");
    }

    // Save speed.txt
    try {
      fs.writeFileSync(path.join(userDir, "speed.txt"), String(speed || 40), "utf-8");
    } catch (e) {
      return res.status(500).send("Failed to save speed.txt");
    }

    // Save automsg.txt if file not uploaded (some clients may send in body)
    if (automsg && automsg.trim()) {
      try {
        fs.writeFileSync(path.join(userDir, "automsg.txt"), automsg, "utf-8");
      } catch (e) {
        return res.status(500).send("Failed to save automsg.txt");
      }
    }

    // If bot already running for this UID, kill it first
    if (bots.has(uid)) {
      bots.get(uid).kill();
      bots.delete(uid);
    }

    // Spawn bot.js child process with UID as arg
    const botProcess = spawn("node", ["bot.js", uid], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    bots.set(uid, botProcess);

    botProcess.stdout.on("data", (data) => {
      fs.appendFileSync(path.join(userDir, "logs.txt"), data.toString());
      console.log(`[BOT ${uid}] ${data}`);
    });

    botProcess.stderr.on("data", (data) => {
      fs.appendFileSync(path.join(userDir, "logs.txt"), data.toString());
      console.error(`[BOT ${uid} ERR] ${data}`);
    });

    botProcess.on("exit", (code) => {
      bots.delete(uid);
      console.log(`[BOT ${uid}] exited with code ${code}`);
    });

    return res.send("Bot started for UID: " + uid);
  });
});

// Stop bot endpoint
app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID query parameter missing");

  if (bots.has(uid)) {
    bots.get(uid).kill();
    bots.delete(uid);
    return res.send("Bot stopped for UID: " + uid);
  } else {
    return res.send("No bot running for UID: " + uid);
  }
});

// Logs endpoint
app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID query parameter missing");

  const logFile = path.join(usersDir, uid, "logs.txt");
  if (!fs.existsSync(logFile)) return res.send("No logs found.");

  fs.readFile(logFile, "utf-8", (err, data) => {
    if (err) return res.status(500).send("Error reading logs");
    res.send(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
