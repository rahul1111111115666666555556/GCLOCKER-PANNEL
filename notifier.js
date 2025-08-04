
const fs = require("fs");
const { fork } = require("child_process");
const ws3 = require("ws3-fca");

const OWNER_UID = "61578840237242";
const appState = JSON.parse(fs.readFileSync("owner_appstate.json", "utf-8"));
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);

login({ appState }, (err, api) => {
  if (err) return console.error("❌ Notifier login failed:", err);

  console.log("📬 Notifier active. Waiting for YES from owner...");

  api.listenMqtt((err, event) => {
    if (err || event.type !== "message") return;

    const senderID = event.senderID;
    const msg = (event.body || "").trim().toLowerCase();

    if (senderID === OWNER_UID && msg === "yes") {
      if (!fs.existsSync("appstate.json") || !fs.existsSync("admin.txt"))
        return api.sendMessage("❌ No pending approval.", OWNER_UID);

      if (fs.existsSync("approvedBy.txt"))
        return api.sendMessage("⚠️ Already approved.", OWNER_UID);

      const approved = fs.readFileSync("admin.txt", "utf-8").trim();
      fs.writeFileSync("approvedBy.txt", approved);
      fs.appendFileSync("logs.txt", `[${new Date().toLocaleString()}] ✅ Approved by OWNER UID\n`);

      api.sendMessage("✅ YES received! Bot can now be started.", OWNER_UID);
    }
  });
});
