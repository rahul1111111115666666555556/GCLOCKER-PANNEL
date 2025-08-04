const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");

const appStatePath = "appstate.json";
const appState = JSON.parse(fs.readFileSync(appStatePath, "utf-8"));

const BOSS_UID = "61578924387878"; // 👑 Mera boss

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

const loginOptions = {
  appState,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FBAV/350.0.0.8.103",
};

login(loginOptions, (err, api) => {
  if (err) return console.error("❌ [LOGIN FAILED]:", err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  console.log("🤖 [BOT] Online ho gaya bhai! 🔥");

  // 💤 Anti-sleep
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      console.log("💤 Bot zinda hai...");
    }
  }, 300000);

  // 💾 Appstate backup
  setInterval(() => {
    try {
      const newAppState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
      console.log("💾 Appstate updated");
    } catch (e) {
      console.error("❌ Appstate backup failed:", e);
    }
  }, 600000);

  // 🧠 Listener
  api.listenMqtt(async (err, event) => {
    if (err) return console.error("❌ Listen error:", err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    if (event.type === "message") {
      console.log(`📩 ${senderID}: ${event.body} (Group: ${threadID})`);
    }

    // 🔒 /gclock
    if (event.type === "message" && body.startsWith("/gclock")) {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      try {
        const newName = event.body.slice(7).trim();
        GROUP_THREAD_ID = threadID;

        if (newName.length > 0) {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          api.sendMessage(`🔒 Naam lock ho gaya: "${LOCKED_GROUP_NAME}"`, threadID);
        } else {
          const info = await api.getThreadInfo(threadID);
          LOCKED_GROUP_NAME = info.name;
          api.sendMessage(`🔒 Current naam lock kiya gaya: "${LOCKED_GROUP_NAME}"`, threadID);
        }
      } catch (e) {
        api.sendMessage("❌ Naam lock nahi hua bhai 😩", threadID);
        console.error("❌ [GCLOCK ERROR]:", e);
      }
    }

    // 🔁 Revert group name
    if (event.logMessageType === "log:thread-name" && threadID === GROUP_THREAD_ID) {
      const changedName = event.logMessageData.name;
      if (LOCKED_GROUP_NAME && changedName !== LOCKED_GROUP_NAME) {
        try {
          await api.setTitle(LOCKED_GROUP_NAME, threadID);
          api.sendMessage(`⚠️ Naam wapas kar diya: "${LOCKED_GROUP_NAME}"`, threadID);
        } catch (e) {
          api.sendMessage("❌ Wapas set nahi kar paya. Admin bana! 😭", threadID);
        }
      }
    }

    // 🔐 /nicklock on
    if (event.type === "message" && body.startsWith("/nicklock on")) {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Sirf boss chala sakta hai 😎", threadID);

      try {
        const nickToLock = event.body.slice(13).trim();
        const info = await api.getThreadInfo(threadID);
        originalNicknames = {};
        nickLockEnabled = true;

        for (const u of info.userInfo) {
          originalNicknames[u.id] = nickToLock || u.nickname || "";
          if (nickToLock) {
            await api.changeNickname(nickToLock, threadID, u.id);
          }
        }

        api.sendMessage(`🔐 Nickname lock on! Sab ban gaye: "${nickToLock}"`, threadID);
      } catch (err) {
        api.sendMessage("❌ Nickname lock nahi laga 😵", threadID);
      }
    }

    // 🔓 /nicklock off
    if (event.type === "message" && body === "/nicklock off") {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Only boss allowed 😤", threadID);

      nickLockEnabled = false;
      originalNicknames = {};
      api.sendMessage("🔓 Nickname lock hata diya gaya 😌", threadID);
    }

    // 🔁 Revert nicknames
    if (nickLockEnabled && event.logMessageType === "log:user-nickname") {
      const changedUID = event.logMessageData.participant_id;
      const newNick = event.logMessageData.nickname;
      const originalNick = originalNicknames[changedUID];

      if (originalNick !== undefined && newNick !== originalNick) {
        try {
          await api.changeNickname(originalNick, threadID, changedUID);
          console.log(`↩️ Nickname reverted: ${newNick} → ${originalNick}`);
        } catch (err) {
          console.error("❌ Nick revert fail:", err);
        }
      }
    }
  });
});
