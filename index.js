const express = require("express");
const { fork } = require("child_process");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;

// ✅ Middleware for JSON body
app.use(express.json());
// ✅ Serve frontend
app.use(express.static("public"));

// ✅ Home page
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ✅ Paste appstate + start bot
app.post("/paste-start", (req, res) => {
  const { data } = req.body;

  try {
    JSON.parse(data); // Validate
    fs.writeFileSync("appstate.json", data);

    if (botProcess) return res.send("⚠️ Bot already running!");

    botProcess = fork("bot.js");
    res.send("🟢 Bot started successfully!");
  } catch (err) {
    res.send("❌ Invalid JSON format! Paste a correct appstate.");
  }
});

// ✅ Stop bot
app.get("/stop-bot", (req, res) => {
  if (!botProcess) return res.send("⚠️ Bot is not running.");
  botProcess.kill();
  botProcess = null;
  res.send("🔴 Bot stopped successfully!");
});

// ✅ Bot status
app.get("/status", (req, res) => {
  res.send(botProcess ? "🟢 Bot is running" : "🔴 Bot is stopped");
});

app.listen(PORT, () => {
  console.log(`🌐 Panel running at http://localhost:${PORT}`);
});
