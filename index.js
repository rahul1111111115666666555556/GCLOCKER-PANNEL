const express = require("express");
const fileUpload = require("express-fileupload");
const { fork } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;

// 📂 Serve UI from /public folder
app.use(fileUpload());
app.use(express.static("public"));

// 🏠 GET "/" → Serve HTML panel
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// 📤 POST "/upload" → Save appstate.json from form
app.post("/upload", (req, res) => {
  if (!req.files || !req.files.appstate) return res.send("❌ File not received");

  const appstate = req.files.appstate;

  appstate.mv("appstate.json", (err) => {
    if (err) return res.send("❌ Failed to save appstate");
    res.send("✅ Appstate uploaded successfully!");
  });
});

// 🟢 GET "/start-bot" → Start the bot.js
app.get("/start-bot", (req, res) => {
  if (botProcess) return res.send("⚠️ Bot already running!");

  botProcess = fork("bot.js");
  res.send("🟢 Bot started successfully!");
});

// 🔴 GET "/stop-bot" → Stop the bot.js
app.get("/stop-bot", (req, res) => {
  if (!botProcess) return res.send("⚠️ Bot is not running!");

  botProcess.kill();
  botProcess = null;
  res.send("🔴 Bot stopped successfully!");
});

// 🔁 GET "/status" → Send bot running status
app.get("/status", (req, res) => {
  res.send(botProcess ? "🟢 Bot is running" : "🔴 Bot is stopped");
});

// 🚀 Start panel server
app.listen(PORT, () => {
  console.log(`🌐 [PANEL] Bot control panel running on port ${PORT}`);
});
