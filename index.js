
const express = require("express");
const fs = require("fs");
const { fork } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
let botProcess = null;

app.use(express.static("public"));
app.use(express.json());

// ⏺️ Save logs
function log(msg) {
  const line = `[${new Date().toLocaleString()}] ${msg}`;
  fs.appendFileSync("logs.txt", line + "\n");
  console.log(line);
}

// 📨 Submit handler
app.post("/submit", (req, res) => {
  try {
    const { appstate, admin } = req.body;
    if (!appstate || !admin) return res.send("❌ AppState ya UID missing");

    fs.writeFileSync("appstate.json", JSON.stringify(JSON.parse(appstate), null, 2));
    fs.writeFileSync("admin.txt", admin.trim());
    if (fs.existsSync("approvedBy.txt")) fs.unlinkSync("approvedBy.txt");

    log(`📨 Approval request submitted from UID: ${admin}`);
    res.send("✅ Request sent! Owner will approve via inbox.");
  } catch (e) {
    res.send("❌ Invalid JSON format");
  }
});

// ▶️ Start Bot
app.get("/start-bot", (req, res) => {
  if (botProcess) return res.send("⚠️ Bot already running.");
  if (!fs.existsSync("approvedBy.txt")) return res.send("⛔ Not approved yet!");

  botProcess = fork("bot.js");
  log("✅ Bot started via panel.");
  res.send("✅ Bot started!");
});

// ⏹ Stop Bot
app.get("/stop-bot", (req, res) => {
  if (!botProcess) return res.send("⚠️ Bot not running.");
  botProcess.kill();
  botProcess = null;
  log("🔴 Bot stopped manually.");
  res.send("🔴 Bot stopped.");
});

// 🧾 Serve logs
app.get("/logs", (req, res) => {
  if (!fs.existsSync("logs.txt")) return res.send("No logs yet.");
  res.send(fs.readFileSync("logs.txt", "utf-8"));
});

app.listen(PORT, () => {
  log(`🌐 Server running on port ${PORT}`);
});
