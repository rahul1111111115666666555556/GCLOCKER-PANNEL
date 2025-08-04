const express = require("express");
const fileUpload = require("express-fileupload");
const { fork } = require("child_process");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;

app.use(fileUpload());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.post("/upload", (req, res) => {
  if (!req.files || !req.files.appstate) return res.send("❌ File not received");
  const appstate = req.files.appstate;
  appstate.mv("appstate.json", (err) => {
    if (err) return res.send("❌ Failed to save appstate");
    res.send("✅ Appstate uploaded successfully!");
  });
});

app.get("/start-bot", (req, res) => {
  if (botProcess) return res.send("⚠️ Bot already running!");
  botProcess = fork("bot.js");
  res.send("🟢 Bot started successfully!");
});

app.get("/stop-bot", (req, res) => {
  if (!botProcess) return res.send("⚠️ Bot is not running!");
  botProcess.kill();
  botProcess = null;
  res.send("🔴 Bot stopped successfully!");
});

app.get("/status", (req, res) => {
  res.send(botProcess ? "🟢 Bot is running" : "🔴 Bot is stopped");
});

app.listen(PORT, () => {
  console.log(`🌐 [PANEL] Bot control panel running on port ${PORT}`);
});
