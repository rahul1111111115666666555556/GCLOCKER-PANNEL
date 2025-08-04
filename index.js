const express = require("express");
const fs = require("fs");
const { fork } = require("child_process");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_DIR = path.join(__dirname, "users");
const MAX_USERS = 20;

if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR);

app.use(express.static("public"));
app.use(express.json());

let processes = {}; // UID => child process

app.post("/start-bot", (req, res) => {
  const { appstate, admin } = req.body;
  if (!appstate || !admin) return res.send("❌ AppState or Admin UID missing!");

  const userDir = path.join(USERS_DIR, admin);
  const existingUsers = fs.readdirSync(USERS_DIR).filter(uid =>
    fs.existsSync(path.join(USERS_DIR, uid, "appstate.json"))
  );

  // ✅ 20 user limit logic
  if (!existingUsers.includes(admin) && existingUsers.length >= MAX_USERS) {
    return res.send("❌ Limit reached: Only 20 users allowed.");
  }

  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

  try {
    fs.writeFileSync(path.join(userDir, "appstate.json"), JSON.stringify(JSON.parse(appstate), null, 2));
    fs.writeFileSync(path.join(userDir, "admin.txt"), admin);

    if (processes[admin]) processes[admin].kill();
    processes[admin] = fork("bot.js", [admin]);

    res.send(`✅ Bot started for UID: ${admin}`);
  } catch (e) {
    res.send("❌ Invalid AppState JSON!");
  }
});

app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.send("❌ UID missing in query.");

  const logPath = path.join(USERS_DIR, uid, "logs.txt");
  if (!fs.existsSync(logPath)) return res.send("📭 No logs yet.");

  res.send(fs.readFileSync(logPath, "utf-8"));
});

app.listen(PORT, () => {
  console.log(`🌐 AROHI X ANURAG multi-user panel running on port ${PORT}`);
});
