const express = require("express");
const { fork } = require("child_process");
const fs = require("fs");

const OWNER_UID = "61578840237242";
const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;
let logs = "";
let pendingApproval = false;

app.use(express.json());
app.use(express.static("public"));

app.get("/", (_, res) => res.sendFile(__dirname + "/public/index.html"));

// ⏳ Step 1: Just save files
app.post("/submit", (req, res) => {
  const { data, uid } = req.body;
  try {
    JSON.parse(data);
    fs.writeFileSync("appstate.json", data);
    fs.writeFileSync("admin.txt", uid);
    pendingApproval = true;
    res.send("✅ Appstate + UID submitted. Waiting for owner approval.");
  } catch {
    res.send("❌ Invalid Appstate JSON!");
  }
});

// ✅ Step 2: Only owner can start bot
app.get("/approve-bot", (req, res) => {
  try {
    const currentUID = fs.readFileSync("admin.txt", "utf-8").trim();
    if (currentUID !== OWNER_UID) return res.send("⛔ Only owner can approve bot start.");

    if (botProcess) return res.send("⚠️ Bot already running.");
    if (!pendingApproval) return res.send("⚠️ No pending request to approve.");

    botProcess = fork("bot.js");
    pendingApproval = false;

    botProcess.stdout.on("data", (d) => {
      logs += d.toString();
      if (logs.length > 5000) logs = logs.slice(-5000);
    });

    botProcess.stderr.on("data", (d) => {
      logs += "[ERR] " + d.toString();
      if (logs.length > 5000) logs = logs.slice(-5000);
    });

    botProcess.on("exit", () => {
      logs += "\n[Bot exited]";
      botProcess = null;
    });

    res.send("✅ Approved. Bot started!");
  } catch (err) {
    res.send("❌ Approval failed.");
  }
});

// 🔴 Stop bot
app.get("/stop-bot", (_, res) => {
  if (!botProcess) return res.send("⚠️ Bot is not running.");
  botProcess.kill();
  botProcess = null;
  res.send("🔴 Bot stopped.");
});

// 🔍 Status
app.get("/status", (_, res) => {
  res.send(botProcess ? "🟢 Bot is running" : pendingApproval ? "⏳ Awaiting approval..." : "🔴 Bot is stopped");
});

// 📜 Logs
app.get("/logs", (_, res) => {
  res.send(logs || "📭 No logs yet...");
});

app.listen(PORT, () => {
  console.log(`🌐 PANEL running at http://localhost:${PORT}`);
});
