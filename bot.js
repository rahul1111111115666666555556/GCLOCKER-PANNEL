const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");

const appStatePath = "appstate.json";
const adminPath = "admin.txt";
const approvedByPath = "approvedBy.txt";
const OWNER_UID = "61578840237242"; // ✅ Fixed

// ✅ Load AppState
let appState;
try {
  const raw = fs.readFileSync(appStatePath, "utf-8");
  if (!raw.trim()) throw new Error("File empty");
  appState = JSON.parse(raw);
} catch (err) {
  console.error("❌ appstate.json invalid ya missing");
  process.exit(1);
}

// ✅ Load Admin UID (user who submitted)
let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("admin.txt missing");
} catch (err) {
  console.error("❌ admin.txt missing ya invalid");
  process.exit(1);
}

// ✅ Check approval
if (!fs.existsSync(approvedByPath)) {
  console.error("⛔ Bot not approved. Wait for inbox YES reply.");
  process.exit(1);
}

// ✅ Notify owner
function notifyOwner(api) {
  try {
    const approvedBy = fs.readFileSync(approvedByPath, "utf-8").trim();
    const msg = `✅ Bot Approved & Started\n👤 Admin UID: ${approvedBy}\n🕒 ${new Date().toLocaleString()}`;
    api.sendMessage(msg, OWNER_UID);
  } catch (e) {
    console.error("❌ Couldn’t notify owner in inbox:", e);
  }
}

// 🔁 Globals
let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

// 🟢 Login bot
login({
  appState,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
}, (err, api) => {
  if (err) return console.error("❌ Login failed:", err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  console.log("🤖 BOT STARTED — Group control ready");

  notifyOwner(api);

  // 💤 Anti-sleep
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1000);
      console.log("💤 Bot pinged group.");
    }
  }, 300000);

  // 💾 Save AppState every 10 min
  setInterval(() => {
    try {
      fs.writeFileSync(appStatePath, JSON.stringify(api.getAppState(), null, 2));
      console.log("💾 AppState backed up.");
    } catch (err) {
      console.error("❌ AppState save failed:", err);
    }
  }, 600000);

  // 📡 Event Listener
  api.listenMqtt(async (err, event) => {
    if (err) return console.error("❌ Event error:", err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    if (event.type === "message") {
      console.log(`💬 ${senderID}: ${event.body}`);
    }

    // /gclock
    if (event.type === "message" && body.startsWith("/gclock")) {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Tu boss nahi hai!", threadID);

      try {
        const newName = body.slice(7).trim();
        GROUP_THREAD_ID = threadID;

        if (newName) {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          api.sendMessage(`🔒 Naam lock ho gaya: ${newName}`, threadID);
        } else {
          const info = await api.getThreadInfo(threadID);
          LOCKED_GROUP_NAME = info.name;
          api.sendMessage(`🔒 Current naam lock kiya gaya: ${LOCKED_GROUP_NAME}`, threadID);
        }
      } catch (e) {
        api.sendMessage("❌ Naam lock fail 😩", threadID);
      }
    }

    // 🔁 Revert Group Name
    if (event.logMessageType === "log:thread-name" && threadID === GROUP_THREAD_ID) {
      const changedName = event.logMessageData.name;
      if (LOCKED_GROUP_NAME && changedName !== LOCKED_GROUP_NAME) {
        try {
          await api.setTitle(LOCKED_GROUP_NAME, threadID);
          api.sendMessage(`⚠️ Naam badla gaya tha. Wapas set: "${LOCKED_GROUP_NAME}"`, threadID);
        } catch (e) {
          api.sendMessage("❌ Wapas nahi hua. Admin rights chahiye!", threadID);
        }
      }
    }

    // /nicklock on
    if (event.type === "message" && body.startsWith("/nicklock on")) {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Sirf boss chala sakta hai!", threadID);

      try {
        const nickToLock = event.body.slice(13).trim();
        const info = await api.getThreadInfo(threadID);
        originalNicknames = {};
        nickLockEnabled = true;

        for (const user of info.userInfo) {
          originalNicknames[user.id] = nickToLock || user.nickname || "";
          if (nickToLock) {
            await api.changeNickname(nickToLock, threadID, user.id);
          }
        }

        api.sendMessage(`🔐 Nickname lock: "${nickToLock}" ✅`, threadID);
      } catch (err) {
        api.sendMessage("❌ Nickname lock failed 😵", threadID);
      }
    }

    // /nicklock off
    if (event.type === "message" && body === "/nicklock off") {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Tu boss nahi hai!", threadID);

      nickLockEnabled = false;
      originalNicknames = {};
      api.sendMessage("🔓 Nickname lock removed ✅", threadID);
    }

    // Revert Nickname
    if (nickLockEnabled && event.logMessageType === "log:user-nickname") {
      const changedUID = event.logMessageData.participant_id;
      const newNick = event.logMessageData.nickname;
      const originalNick = originalNicknames[changedUID];

      if (originalNick !== undefined && newNick !== originalNick) {
        try {
          await api.changeNickname(originalNick, threadID, changedUID);
          console.log(`↩️ Reverted nick: ${newNick} → ${originalNick}`);
        } catch (err) {
          console.error("❌ Nick revert failed:", err);
        }
      }
    }
  });
});
