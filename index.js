const express = require("express");
const helmet = require("helmet");
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

const bots = new Map();

app.post("/start-bot", (req, res) => {
  try {
    const { appstate, admin, automsg, speed } = req.body;
    if (!appstate || !admin) return res.status(400).send("AppState and Admin UID required");

    const userFolder = path.join(usersDir, admin);
    if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });

    fs.writeFileSync(path.join(userFolder, "appstate.json"), appstate, "utf-8");
    fs.writeFileSync(path.join(userFolder, "admin.txt"), admin, "utf-8");
    fs.writeFileSync(path.join(userFolder, "automsg.txt"), automsg || "", "utf-8");
    fs.writeFileSync(path.join(userFolder, "speed.txt"), (speed || 40).toString(), "utf-8");

    if (bots.has(admin)) {
      bots.get(admin).kill("SIGINT");
      bots.delete(admin);
    }

    const botProcess = spawn("node", ["bot.js", admin], { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] });

    botProcess.stdout.on("data", data => {
      console.log(`[BOT ${admin}] ${data.toString()}`);
      const logFile = path.join(userFolder, "logs.txt");
      fs.appendFileSync(logFile, data.toString());
    });

    botProcess.stderr.on("data", data => {
      console.error(`[BOT ${admin} ERROR] ${data.toString()}`);
      const logFile = path.join(userFolder, "logs.txt");
      fs.appendFileSync(logFile, data.toString());
    });

    botProcess.on("exit", code => {
      console.log(`[BOT ${admin}] exited with code ${code}`);
      bots.delete(admin);
    });

    bots.set(admin, botProcess);

    res.send("🤖 Bot started successfully!");
  } catch (e) {
    console.error(e);
    res.status(500).send("❌ Error starting bot: " + e.message);
  }
});

app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("UID required to stop bot");

  if (bots.has(uid)) {
    bots.get(uid).kill("SIGINT");
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
