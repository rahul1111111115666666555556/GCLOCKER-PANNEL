const express = require("express");
const { fork } = require("child_process");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;
let logs = "";

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Paste AppState + Admin UID + Start Bot
app.post("/paste-start", (req, res) => {
  const { data, uid } = req.body;

  try {
    JSON.parse(data);
    fs.writeFileSync("appstate.json", data);
    fs.writeFileSync("admin.txt", uid || "");

    if (botProcess) return res.send("⚠️ Bot already running.");

    botProcess = fork("bot.js");

    botProcess.stdout.on("data", (d) => {
      logs += d.toString();
      if (logs.length > 5000) logs = logs.slice(-5000); // trim
    });

    botProcess.stderr.on("data", (d) => {
      logs += "[ERR] " + d.toString();
      if (logs.length > 5000) logs = logs.slice(-5000);
    });

    botProcess.on("exit", () => {
      logs += "\n[Bot exited]";
      botProcess = null;
    });

    res.send("🟢 Bot started successfully!");
  } catch (err) {
    res.send("❌ Invalid AppState JSON!");
  }
});

// Stop Bot
app.get("/stop-bot", (req, res) => {
  if (!botProcess) return res.send("⚠️ Bot is not running.");
  botProcess.kill();
  botProcess = null;
  res.send("🔴 Bot stopped successfully!");
});

// Show Status
app.get("/status", (req, res) => {
  res.send(botProcess ? "🟢 Bot is running" : "🔴 Bot is stopped");
});

// Show Logs
app.get("/logs", (req, res) => {
  res.send(logs || "📭 No logs yet...");
});

app.listen(PORT, () => {
  console.log(`🌐 Panel running at http://localhost:${PORT}`);
});
