const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");

const uid = process.argv[2];
if (!uid) {
  console.error("❌ UID argument missing");
  process.exit(1);
}

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

let appState, BOSS_UID, autoMessage = "", speed = 40;

try {
  appState = JSON.parse(fs.readFileSync(appStatePath, "utf-8"));
} catch {
  log("❌ appstate.json invalid or missing");
  process.exit(1);
}

try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("admin.txt empty");
} catch {
  log("❌ admin.txt invalid or missing");
  process.exit(1);
}

try {
  autoMessage = fs.readFileSync(autoMsgPath, "utf-8").trim();
} catch {
  log("⚠️ automsg.txt missing or empty");
  autoMessage = "";
}

try {
  speed = parseInt(fs.readFileSync(speedPath, "utf-8").trim());
  if (isNaN(speed) || speed < 10) speed = 40;
} catch {
  speed = 40;
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
  return abusiveWords.some(word => text.includes(word));
}

const abuseCooldown = new Map();

login(loginOptions, (err, api) => {
  if (err) return log("❌ LOGIN FAILED: " + err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE — Ready to serve!");

  // Anti-sleep (typing indicator)
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot alive signal sent");
    }
  }, 300000);

  // Appstate auto-save
  setInterval(() => {
    try {
      const newAppState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
      log("💾 Appstate saved");
    } catch (e) {
      log("❌ Appstate save failed: " + e);
    }
  }, 600000);

  // Auto abuse message interval (if autoMessage set)
  if (autoMessage) {
    setInterval(() => {
      if (GROUP_THREAD_ID) {
        api.sendMessage(autoMessage, GROUP_THREAD_ID);
        log("💬 Auto reply sent");
      }
    }, speed * 1000);
  }

  api.listenMqtt(async (err, event) => {
    if (err) return log("❌ Listen error: " + err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    if (event.type === "message") {
      log(`📩 ${senderID}: ${event.body} (Group: ${threadID})`);
    }

    // Ignore if sender not boss and command received
    if (senderID !== BOSS_UID) return;

    // /help command
    if (body === "/help") {
      const helpText = `
Commands:
- /gclock <new group name> : Lock group name
- /gclock remove : Unlock group name (restore original)
- /nicklock on : Enable nickname lock
- /nicklock off : Disable nickname lock
- /abuse : Start auto abuse messages
- /stopabuse : Stop auto abuse messages
      `.trim();
      api.sendMessage(helpText, threadID);
      return;
    }

    // /gclock command
    if (body.startsWith("/gclock")) {
      GROUP_THREAD_ID = threadID;

      if (body.includes("remove")) {
        // unlock group
        try {
          const info = await api.getThreadInfo(threadID);
          await api.setTitle(info.threadName, threadID);
          LOCKED_GROUP_NAME = null;
          api.sendMessage("🔓 Group name unlocked.", threadID);
          log("Group name unlocked");
        } catch (e) {
          api.sendMessage("❌ Failed to unlock group name.", threadID);
          log("Unlock group name error: " + e);
        }
      } else {
        const newName = event.body.slice(7).trim();
        if (!newName) {
          api.sendMessage("❌ Provide a name after /gclock", threadID);
          return;
        }
        try {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          api.sendMessage(`🔒 Group name locked to "${newName}"`, threadID);
          log(`Group locked with name "${newName}"`);
        } catch (e) {
          api.sendMessage("❌ Failed to lock group name.", threadID);
          log("Lock group name error: " + e);
        }
      }
      return;
    }

    // /nicklock commands
    if (body === "/nicklock on") {
      nickLockEnabled = true;
      api.sendMessage("🔒 Nickname lock enabled.", threadID);
      log("Nickname lock enabled");
      return;
    }
    if (body === "/nicklock off") {
      nickLockEnabled = false;
      api.sendMessage("🔓 Nickname lock disabled.", threadID);
      log("Nickname lock disabled");
      return;
    }

    // Abuse checker - auto abuse mentioned user if message contains abusive words
    if (nickLockEnabled && event.type === "message" && event.mentions && event.mentions[BOSS_UID]) {
      const text = event.body || "";
      if (containsAbuse(text)) {
        const lastAbuseTime = abuseCooldown.get(senderID) || 0;
        if (Date.now() - lastAbuseTime > speed * 1000) {
          api.sendMessage(autoMessage, threadID);
          abuseCooldown.set(senderID, Date.now());
          log(`Abused ${senderID}`);
        }
      }
    }
  });
});
