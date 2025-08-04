const express = require("express");
const fs = require("fs");
const { fork } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
let botProcess = null;

app.use(express.static("public"));
app.use(express.json());

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  fs.appendFileSync("logs.txt", line + "\n");
  console.log(line);
}

// Start bot
app.post("/start-bot", (req, res) => {
  const { appstate, admin } = req.body;
  if (!appstate || !admin) return res.send("❌ AppState or UID missing!");

  try {
    fs.writeFileSync("appstate.json", JSON.stringify(JSON.parse(appstate), null, 2));
    fs.writeFileSync("admin.txt", admin.trim());

    if (botProcess) {
      botProcess.kill();
      botProcess = null;
    }

    botProcess = fork("bot.js");
    log("✅ Bot started successfully!");
    res.send("✅ Bot started!");
  } catch (e) {
    res.send("❌ Invalid AppState JSON!");
  }
});

// Live logs
app.get("/logs", (req, res) => {
  if (!fs.existsSync("logs.txt")) return res.send("📭 No logs yet.");
  res.send(fs.readFileSync("logs.txt", "utf-8"));
});

app.listen(PORT, () => {
  log(`🌐 Panel running at port ${PORT}`);
});
