const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");

const appState = JSON.parse(fs.readFileSync("appstate.json", "utf-8"));
const BOSS_UID = fs.readFileSync("admin.txt", "utf-8").trim();

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

login({ appState }, (err, api) => {
  if (err) return console.error("❌ Login failed:", err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  console.log("🤖 BOT is ready!");

  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1000);
      console.log("💤 Bot active...");
    }
  }, 300000);

  setInterval(() => {
    try {
      const updated = api.getAppState();
      fs.writeFileSync("appstate.json", JSON.stringify(updated, null, 2));
    } catch (e) {
      console.error("❌ Failed to save appstate:", e);
    }
  }, 600000);

  api.listenMqtt(async (err, event) => {
    if (err) return console.error("❌ Listen error:", err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    if (event.type === "message") {
      console.log(`📩 ${senderID}: ${event.body}`);
    }

    if (event.type === "message" && body.startsWith("/gclock")) {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ You are not the boss!", threadID);

      try {
        const newName = body.slice(7).trim();
        GROUP_THREAD_ID = threadID;

        if (newName) {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          api.sendMessage(`🔒 Locked group name: ${newName}`, threadID);
        } else {
          const info = await api.getThreadInfo(threadID);
          LOCKED_GROUP_NAME = info.name;
          api.sendMessage(`🔒 Locked current group name: ${LOCKED_GROUP_NAME}`, threadID);
        }
      } catch (e) {
        api.sendMessage("❌ Couldn't lock group name!", threadID);
      }
    }

    if (event.logMessageType === "log:thread-name" && threadID === GROUP_THREAD_ID) {
      const changedName = event.logMessageData.name;
      if (LOCKED_GROUP_NAME && changedName !== LOCKED_GROUP_NAME) {
        await api.setTitle(LOCKED_GROUP_NAME, threadID);
        api.sendMessage(`⚠️ Group name changed — restored: ${LOCKED_GROUP_NAME}`, threadID);
      }
    }

    if (event.type === "message" && body.startsWith("/nicklock on")) {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Only boss allowed!", threadID);

      const nickToLock = body.slice(13).trim();
      const info = await api.getThreadInfo(threadID);
      originalNicknames = {};
      nickLockEnabled = true;

      for (const u of info.userInfo) {
        originalNicknames[u.id] = nickToLock || u.nickname || "";
        if (nickToLock) {
          await api.changeNickname(nickToLock, threadID, u.id);
        }
      }

      api.sendMessage(`🔐 Nickname lock enabled: "${nickToLock}"`, threadID);
    }

    if (event.type === "message" && body === "/nicklock off") {
      if (senderID !== BOSS_UID)
        return api.sendMessage("⛔ Only boss can disable!", threadID);

      nickLockEnabled = false;
      originalNicknames = {};
      api.sendMessage("🔓 Nickname lock disabled", threadID);
    }

    if (nickLockEnabled && event.logMessageType === "log:user-nickname") {
      const changedUID = event.logMessageData.participant_id;
      const newNick = event.logMessageData.nickname;
      const originalNick = originalNicknames[changedUID];

      if (originalNick && newNick !== originalNick) {
        await api.changeNickname(originalNick, threadID, changedUID);
        console.log(`↩️ Nickname reverted: ${newNick} → ${originalNick}`);
      }
    }
  });
});
