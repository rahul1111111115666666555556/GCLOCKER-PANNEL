const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");

const uid = process.argv[2];
if (!uid) {
  console.error("❌ UID argument missing!");
  process.exit(1);
}

const userDir = path.join(__dirname, "users", uid);
const appStatePath = path.join(userDir, "appstate.json");
const adminPath = path.join(userDir, "admin.txt");
const logPath = path.join(userDir, "logs.txt");

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logPath, line + "\n");
}

let appState;
try {
  const raw = fs.readFileSync(appStatePath, "utf-8");
  if (!raw.trim()) throw new Error("appstate.json empty");
  appState = JSON.parse(raw);
} catch (err) {
  log("❌ appstate.json invalid or empty.");
  process.exit(1);
}

let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("admin.txt empty");
} catch (err) {
  log("❌ admin.txt invalid or empty.");
  process.exit(1);
}

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

const loginOptions = {
  appState,
  userAgent:
    "Mozilla/5.0 (Linux; Android 12; Redmi Note 10 Pro Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36",
};

login(loginOptions, async (err, api) => {
  if (err) return log("❌ [LOGIN FAILED]: " + err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 — Ready to rock!");

  // Anti-sleep: Typing indicator every 5 minutes if group locked
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot active and typing indicator sent.");
    }
  }, 300000);

  // Save appstate every 10 minutes
  setInterval(() => {
    try {
      const newAppState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
      log("💾 Appstate saved.");
    } catch (e) {
      log("❌ Appstate save failed: " + e);
    }
  }, 600000);

  api.listenMqtt(async (err, event) => {
    if (err) return log("❌ Listen error: " + err);

    if (event.type !== "message") return;

    const senderID = event.senderID;
    const threadID = event.threadID;
    const bodyRaw = event.body || "";
    const body = bodyRaw.toLowerCase();

    log(`📩 ${senderID}: ${bodyRaw} (Thread: ${threadID})`);

    if (senderID === BOSS_UID) {
      // /help command
      if (body === "/help") {
        api.sendMessage(
          `
📜 COMMANDS LIST:

🔒 /gclock [name]  - Lock group name to [name]
🔓 /gunlock        - Unlock group name
👤 /nicklock on    - Enable nickname lock
👤 /nicklock off   - Disable nickname lock
          `.trim(),
          threadID
        );
        return;
      }

      // /gclock [name]
      if (body.startsWith("/gclock")) {
        const newName = event.body.slice(7).trim();
        if (!newName) {
          api.sendMessage("⚠️ Please provide a name to lock the group.", threadID);
          return;
        }
        try {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          GROUP_THREAD_ID = threadID;
          api.sendMessage(`🔒 Group name locked as: "${newName}"`, threadID);
          log(`🔒 Group locked as "${newName}"`);
        } catch (e) {
          api.sendMessage("❌ Failed to lock group name.", threadID);
          log("❌ Group lock error: " + e);
        }
        return;
      }

      // /gunlock
      if (body === "/gunlock") {
        try {
          if (!LOCKED_GROUP_NAME || GROUP_THREAD_ID !== threadID) {
            api.sendMessage("⚠️ Lock the group first before unlocking.", threadID);
            return;
          }
          const threadInfo = await api.getThreadInfo(threadID);
          await api.setTitle(threadInfo.name, threadID);
          LOCKED_GROUP_NAME = null;
          GROUP_THREAD_ID = null;
          api.sendMessage("🔓 Group name unlocked.", threadID);
          log("🔓 Group unlocked");
        } catch (e) {
          api.sendMessage("❌ Failed to unlock group name.", threadID);
          log("❌ Group unlock error: " + e);
        }
        return;
      }

      // /nicklock on
      if (body === "/nicklock on") {
        nickLockEnabled = true;
        originalNicknames = {};
        api.sendMessage("✅ Nickname lock enabled.", threadID);
        log("✅ Nicklock enabled");
        return;
      }

      // /nicklock off
      if (body === "/nicklock off") {
        nickLockEnabled = false;
        originalNicknames = {};
        api.sendMessage("❌ Nickname lock disabled.", threadID);
        log("❌ Nicklock disabled");
        return;
      }
    }

    // Enforce nickname lock only if enabled & group locked & in locked group
    if (
      nickLockEnabled &&
      GROUP_THREAD_ID === threadID &&
      event.isGroup &&
      event.type === "message"
    ) {
      try {
        if (!originalNicknames[senderID]) {
          // Save original nickname once
          const info = await api.getUserInfo(senderID);
          originalNicknames[senderID] = info[senderID].name;
          log(`📌 Saved original nickname of ${senderID}: ${originalNicknames[senderID]}`);
        }
        const infoNow = await api.getUserInfo(senderID);
        const currentNick = infoNow[senderID].name;

        if (currentNick !== originalNicknames[senderID]) {
          await api.changeNickname(originalNicknames[senderID], senderID, threadID);
          log(`⚠️ Reset nickname of ${senderID} to "${originalNicknames[senderID]}"`);
        }
      } catch (e) {
        log("❌ Nicklock error: " + e);
      }
    }
  });
});
