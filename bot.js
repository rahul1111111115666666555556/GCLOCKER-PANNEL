const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");
const HttpsProxyAgent = require("https-proxy-agent");

const uid = process.argv[2]; // UID passed from index.js
const userDir = path.join(__dirname, "users", uid);
const appStatePath = path.join(userDir, "appstate.json");
const adminPath = path.join(userDir, "admin.txt");
const logPath = path.join(userDir, "logs.txt");

// Logging function
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logPath, line + "\n");
}

// Load appstate
let appState;
try {
  const raw = fs.readFileSync(appStatePath, "utf-8");
  if (!raw.trim()) throw new Error("File is empty");
  appState = JSON.parse(raw);
} catch (err) {
  log("❌ appstate.json is invalid or empty.");
  process.exit(1);
}

// Load admin UID
let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("UID missing");
} catch (err) {
  log("❌ admin.txt is invalid or empty.");
  process.exit(1);
}

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

const proxyURL = "http://YOUR_INDIA_PROXY_IP:PORT"; // <- India proxy here
const proxyAgent = new HttpsProxyAgent(proxyURL);

const loginOptions = {
  appState,
  userAgent:
    "Mozilla/5.0 (Linux; Android 12; Redmi Note 10 Pro Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36", // realistic Android India UA
  agent: proxyAgent, // proxy for India IP
};

login(loginOptions, async (err, api) => {
  if (err) return log("❌ [LOGIN FAILED]: " + err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 — Ready to lock and rock!");

  // Anti-sleep
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot is active... still alive ✅");
    }
  }, 300000);

  // Appstate backup every 10 mins
  setInterval(() => {
    try {
      const newAppState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
      log("💾 Appstate saved ✅");
    } catch (e) {
      log("❌ Appstate save failed: " + e);
    }
  }, 600000);

  // Fetch original nicknames of all members in group
  async function fetchOriginalNicknames(threadID) {
    try {
      const info = await api.getThreadInfo(threadID);
      originalNicknames = {};
      for (const participant of info.participantIDs) {
        const userInfo = await api.getUserInfo(participant);
        originalNicknames[participant] = userInfo[participant]?.nickname || userInfo[participant]?.name || "";
      }
      log("📝 Original nicknames fetched for nicklock.");
    } catch (e) {
      log("❌ Failed to fetch original nicknames: " + e);
    }
  }

  // NickLock revert function
  async function revertNicknames(threadID) {
    for (const uid in originalNicknames) {
      try {
        await api.changeNickname(originalNicknames[uid], uid, threadID);
        log(`🔁 Reverted nickname of ${uid} to "${originalNicknames[uid]}"`);
        // wait small delay to avoid fb block
        await new Promise((r) => setTimeout(r, 1500));
      } catch (e) {
        log(`❌ Failed to revert nickname of ${uid}: ${e}`);
      }
    }
  }

  api.listenMqtt(async (err, event) => {
    if (err) return log("❌ Listen error: " + err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    if (event.type === "message") {
      log(`📩 ${senderID}: ${event.body} (Group: ${threadID})`);
    }

    // /help command
    if (event.type === "message" && body === "/help") {
      const helpText = `
📜 *COMMANDS LIST* 📜

🔒 /gclock [name] - Lock group name to [name]
🔓 /gunlock - Unlock group name
👤 /nicklock on - Enable nickname lock
👤 /nicklock off - Disable nickname lock
🆘 /help - Show this message
      `;
      if (senderID === BOSS_UID) {
        api.sendMessage(helpText, threadID);
      } else {
        api.sendMessage("⛔ You are not the boss 😤", threadID);
      }
      return;
    }

    // /gclock - Lock group name
    if (event.type === "message" && body.startsWith("/gclock")) {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      try {
        const newName = event.body.slice(7).trim();
        if (!newName) return api.sendMessage("⚠️ Group name cannot be empty.", threadID);

        await api.setTitle(newName, threadID);
        LOCKED_GROUP_NAME = newName;
        GROUP_THREAD_ID = threadID;
        api.sendMessage(`🔒 Naam lock ho gaya: "${LOCKED_GROUP_NAME}"`, threadID);
        log(`🔒 Group name locked to "${LOCKED_GROUP_NAME}"`);
      } catch (e) {
        api.sendMessage("❌ Failed to lock group name: " + e, threadID);
        log("❌ Failed to lock group name: " + e);
      }
      return;
    }

    // /gunlock - Unlock group name
    if (event.type === "message" && body === "/gunlock") {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      LOCKED_GROUP_NAME = null;
      GROUP_THREAD_ID = null;
      api.sendMessage("🔓 Group name lock hata diya gaya.", threadID);
      log("🔓 Group name unlocked.");
      return;
    }

    // /nicklock on
    if (event.type === "message" && body === "/nicklock on") {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      nickLockEnabled = true;
      GROUP_THREAD_ID = threadID;
      await fetchOriginalNicknames(threadID);
      api.sendMessage("👤 Nickname lock enabled. Koi bhi nickname change nahi kar payega.", threadID);
      log("👤 Nicklock enabled.");
      return;
    }

    // /nicklock off
    if (event.type === "message" && body === "/nicklock off") {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      nickLockEnabled = false;
      originalNicknames = {};
      api.sendMessage("👤 Nickname lock disabled.", threadID);
      log("👤 Nicklock disabled.");
      return;
    }

    // Detect nickname changes and revert if nicklock enabled
    if (event.type === "change_nickname" && nickLockEnabled && threadID === GROUP_THREAD_ID) {
      const changedUID = event.logMessageData?.actorFbId;
      const targetUID = event.logMessageData?.participantId;

      if (!changedUID || !targetUID) return;

      // Only revert if nickname changed by non-boss user
      if (changedUID !== BOSS_UID) {
        const oldNick = originalNicknames[targetUID] || "";
        if (oldNick) {
          try {
            await api.changeNickname(oldNick, targetUID, threadID);
            log(`🔁 Reverted nickname of ${targetUID} to "${oldNick}" due to nicklock.`);
          } catch (e) {
            log("❌ Error reverting nickname: " + e);
          }
        }
      }
      return;
    }

    // Detect group name changes and revert if locked
    if (event.type === "change_thread_title" && LOCKED_GROUP_NAME && threadID === GROUP_THREAD_ID) {
      if (event.logMessageData?.actorFbId !== BOSS_UID) {
        try {
          await api.setTitle(LOCKED_GROUP_NAME, threadID);
          log(`🔁 Reverted group name to "${LOCKED_GROUP_NAME}"`);
        } catch (e) {
          log("❌ Failed to revert group name: " + e);
        }
      }
      return;
    }
  });
});
