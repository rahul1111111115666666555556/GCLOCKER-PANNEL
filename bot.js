const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");

const uid = process.argv[2];
const userDir = path.join(__dirname, "users", uid);
const appStatePath = path.join(userDir, "appstate.json");
const adminPath = path.join(userDir, "admin.txt");
const logPath = path.join(userDir, "logs.txt");
const autoMsgPath = path.join(userDir, "automsg.txt");
const speedPath = path.join(userDir, "speed.txt");

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
  log("❌ appstate.json is invalid or empty.");
  process.exit(1);
}

let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("admin.txt empty");
} catch (err) {
  log("❌ admin.txt is invalid or empty.");
  process.exit(1);
}

let autoMessage = "";
try {
  autoMessage = fs.readFileSync(autoMsgPath, "utf-8").trim();
  if (!autoMessage) log("⚠️ automsg.txt is empty.");
} catch {
  log("⚠️ automsg.txt not found or empty.");
  autoMessage = "";
}

let speed = 40;
try {
  speed = parseInt(fs.readFileSync(speedPath, "utf-8"), 10);
  if (isNaN(speed) || speed < 5) speed = 40;
} catch {
  log("⚠️ speed.txt not found or invalid, using 40 seconds.");
}

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

let abuseTarget = null;
const abusiveWords = [
  "bc",
  "mc",
  "bcchod",
  "chutiya",
  "chod",
  "lund",
  "gandu",
  "madarchod",
  "behanchod",
  "bhadwa",
  "haramkhor",
];

function containsAbuse(text) {
  text = text.toLowerCase();
  return abusiveWords.some((word) => text.includes(word));
}

const abuseCooldown = new Map();

const loginOptions = {
  appState,
  userAgent:
    "Mozilla/5.0 (Linux; Android 12; Redmi Note 10 Pro Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36",
};

login(loginOptions, async (err, api) => {
  if (err) return log("❌ [LOGIN FAILED]: " + err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 — Ready to lock and rock!");

  // Anti-sleep typing indicator every 5 min
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot is alive.");
    }
  }, 300000);

  // Save appstate every 10 min
  setInterval(() => {
    try {
      const newState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newState, null, 2));
      log("💾 Appstate saved.");
    } catch (e) {
      log("❌ Failed to save appstate: " + e);
    }
  }, 600000);

  // Auto reply abusive messages timer (interval controlled by speed)
  setInterval(() => {
    if (GROUP_THREAD_ID && abuseTarget && autoMessage) {
      api.sendMessage({
        body: autoMessage,
        mentions: [{ tag: "", id: abuseTarget }],
      }, GROUP_THREAD_ID);
      log(`⚠️ Sent auto abuse reply to ${abuseTarget}`);
    }
  }, speed * 1000);

  api.listenMqtt(async (err, event) => {
    if (err) return log("❌ Listen error: " + err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    if (event.type === "message") {
      log(`📩 ${senderID}: ${event.body} (Group: ${threadID})`);
    }

    // Commands - only from BOSS_UID
    if (event.type === "message" && body.startsWith("/")) {
      if (senderID !== BOSS_UID) {
        api.sendMessage("⛔ Sirf boss hi commands chala sakta hai!", threadID);
        return;
      }

      if (body.startsWith("/help")) {
        const helpMsg = `🛠️ Commands:\n
/gclock [name] - Lock group name
/gunlock - Unlock group name
/nicklock on - Enable nickname lock
/nicklock off - Disable nickname lock
/abuse @uid - Start auto abuse reply to tagged user
/stopabuse - Stop auto abuse replies
/automsg [text] - Update auto reply message
/speed [seconds] - Update auto reply speed (min 5)
`;
        api.sendMessage(helpMsg, threadID);
        return;
      }

      if (body.startsWith("/gclock")) {
        const newName = event.body.slice(7).trim();
        if (!newName) {
          api.sendMessage("❌ Naam nahi diya /gclock ke saath!", threadID);
          return;
        }
        try {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          GROUP_THREAD_ID = threadID;
          api.sendMessage(`🔒 Group name locked as: "${LOCKED_GROUP_NAME}"`, threadID);
          return;
        } catch (e) {
          api.sendMessage("❌ Group name lock failed: " + e.message, threadID);
          return;
        }
      }

      if (body.startsWith("/gunlock")) {
        LOCKED_GROUP_NAME = null;
        api.sendMessage("🔓 Group name unlock kar diya gaya.", threadID);
        return;
      }

      if (body.startsWith("/nicklock on")) {
        nickLockEnabled = true;
        originalNicknames = {};
        api.sendMessage("✅ Nickname lock enabled.", threadID);
        return;
      }

      if (body.startsWith("/nicklock off")) {
        nickLockEnabled = false;
        originalNicknames = {};
        api.sendMessage("❌ Nickname lock disabled.", threadID);
        return;
      }

      if (body.startsWith("/automsg ")) {
        const newMsg = event.body.slice(9).trim();
        if (!newMsg) {
          api.sendMessage("❌ Auto message empty hai.", threadID);
          return;
        }
        autoMessage = newMsg;
        fs.writeFileSync(autoMsgPath, newMsg);
        api.sendMessage("💾 Auto reply message updated.", threadID);
        return;
      }

      if (body.startsWith("/speed ")) {
        const newSpeed = parseInt(event.body.slice(7).trim(), 10);
        if (isNaN(newSpeed) || newSpeed < 5) {
          api.sendMessage("❌ Speed invalid ya bahut kam hai (min 5s).", threadID);
          return;
        }
        speed = newSpeed;
        fs.writeFileSync(speedPath, String(speed));
        api.sendMessage(`⏱️ Speed set to ${speed} seconds.`, threadID);
        return;
      }

      if (body.startsWith("/abuse ")) {
        const mention = event.mentions && Object.keys(event.mentions)[0];
        if (!mention) {
          api.sendMessage("❌ Koi user mention karo /abuse ke saath.", threadID);
          return;
        }
        abuseTarget = mention;
        abuseCooldown.clear();
        api.sendMessage(`⚠️ Abusing started for user: ${mention}`, threadID);
        return;
      }

      if (body.startsWith("/stopabuse")) {
        abuseTarget = null;
        api.sendMessage("🛑 Abuse stopped.", threadID);
        return;
      }
    }

    // Revert group name if locked and changed
    if (LOCKED_GROUP_NAME && threadID === GROUP_THREAD_ID) {
      try {
        const info = await api.getThreadInfo(threadID);
        if (info.name !== LOCKED_GROUP_NAME) {
          await api.setTitle(LOCKED_GROUP_NAME, threadID);
          log("🔒 Group name reverted to locked name.");
        }
      } catch (e) {
        log("❌ Error reverting group name: " + e.message);
      }
    }

    // Nickname lock revert
    if (nickLockEnabled && (event.type === "change_thread_nickname" || event.type === "change_thread_image")) {
      try {
        if (!originalNicknames[senderID]) {
          originalNicknames[senderID] = event.nickname || "";
        }
        if (event.nickname && event.nickname !== originalNicknames[senderID]) {
          await api.changeNickname(originalNicknames[senderID], threadID, senderID);
          log(`✅ Nickname reverted for ${senderID}`);
        }
      } catch (e) {
        log("❌ Nickname revert error: " + e.message);
      }
    }

    // Auto reply on abusive messages from abuseTarget
    if (
      event.type === "message" &&
      abuseTarget &&
      senderID === abuseTarget &&
      containsAbuse(event.body || "")
    ) {
      const now = Date.now();
      const lastSent = abuseCooldown.get(senderID) || 0;

      if (now - lastSent > speed * 1000) {
        api.sendMessage({
          body: autoMessage,
          mentions: [{ tag: "", id: senderID }],
        }, threadID);
        abuseCooldown.set(senderID, now);
        log(`⚠️ Sent auto abuse reply to ${senderID}`);
      }
    }
  });
});
