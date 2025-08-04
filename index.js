const express = require("express");
const { fork } = require("child_process");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
let botProcess = null;

app.use(express.static("public"));
app.use(express.json());

// ✅ Serve panel
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ✅ Handle paste + start
app.post("/paste-start", (req, res) => {
  const { data } = req.body;
  try {
    JSON.parse(data); // validate JSON
    fs.writeFileSync("appstate.json", data);
    if (botProcess) return res.send("⚠️ Bot already running.");
    botProcess = fork("bot.js");
    res.send("🟢 Bot started successfully!");
  } catch (err) {
    res.send("❌ Invalid JSON format!");
  }
});

// ✅ Status route
app.get("/status", (req, res) => {
  res.send(botProcess ? "🟢 Bot is running" : "🔴 Bot is stopped");
});

app.listen(PORT, () => {
  console.log(`🌐 Panel running at http://localhost:${PORT}`);
});
