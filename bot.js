const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");

const uid = process.argv[2];
if (!uid) {
  console.error("❌ UID argument missing! Usage: node bot.js <UID>");
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
  try {
    fs.appendFileSync(logPath, line + "\n");
  } catch (e) {
    console.error("❌ Failed to write logs.txt: " + e);
  }
}

function loadJsonFile(filePath, description) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) throw new Error(`${description} is empty`);
    return JSON.parse(raw);
  } catch (e) {
    log(`❌ Error loading ${description}: ${e.message}`);
    process.exit(1);
  }
}

function loadTextFile(filePath, description) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) log(`⚠️ Warning: ${description} is empty.`);
    return raw;
  } catch {
    log(`⚠️ Warning: ${description} not found.`);
    return "";
  }
}

log(`Starting bot for UID: ${uid}`);

const appState = loadJsonFile(appStatePath, "appstate.json");
const BOSS_UID = loadTextFile(adminPath, "admin.txt");
if (!BOSS_UID) {
  log("❌ admin.txt is empty, exiting.");
  process.exit(1);
}
let autoMessage = loadTextFile(autoMsgPath, "automsg.txt");
if (!autoMessage) {
  log("⚠️ automsg.txt empty. Auto abuse messages will be blank!");
}

let speed = 40;
try {
  const spdRaw = fs.readFileSync(speedPath, "utf-8");
  const spdNum = parseInt(spdRaw, 10);
  if (!isNaN(spdNum) && spdNum >= 5) speed = spdNum;
} catch {
  log("⚠️ speed.txt missing or invalid, using 40s default.");
}

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

let abuseTarget = null;

const abusiveWords = [
  "bc", "mc", "bcchod", "chutiya", "chod", "lund", "gandu", "madarchod", "behanchod", "bhadwa", "haramkhor"
];

function containsAbuse(text) {
  text = text.toLowerCase();
  return abusiveWords.some(word => text.includes(word));
}

const abuseCooldown = new Map();

const loginOptions = {
  appState,
  userAgent:
    "Mozilla/5.0 (Linux; Android 12; Redmi Note 10 Pro Build/SKQ1.210908.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36",
};

login(loginOptions, async (err, api) => {
  if (err) {
    log("❌ [LOGIN FAILED]: " + err);
    process.exit(1);
  }

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 — Ready to lock and rock!");

  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot is alive.");
    }
  }, 300000);

  setInterval(() => {
    try {
      const newState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newState, null, 2));
      log("💾 Appstate saved.");
    } catch (e) {
      log("❌ Failed to save appstate: " + e);
    }
  }, 600000);

  api.listenMqtt(async (err, event) => {
    if (err) {
      log("❌ Listen error: " + err);
      return;
    }

    try {
      const senderID = event.senderID;
      const threadID = event.threadID;
      const bodyRaw = event.body || "";
      const body = bodyRaw.toLowerCase();

      // Log every message
      if (event.type === "message") {
        log(`📩 ${senderID}: ${bodyRaw} (Group: ${threadID})`);
      }

      // Auto abuse logic on abusive words if abuseTarget is set
      if (containsAbuse(bodyRaw)) {
        if (senderID === BOSS_UID) return; // Boss ko abuse nahi karna

        if (abuseTarget === null) {
          abuseTarget = senderID; // Jo pehla abusive message bheje, use target banao
          log(`⚠️ Abuse mode ON for user ${senderID} (auto set)`);
        }

        if (abuseTarget === senderID) {
          const now = Date.now();
          const lastTime = abuseCooldown.get(senderID) || 0;
          if (now - lastTime < speed * 1000) return; // cooldown active
          abuseCooldown.set(senderID, now);
          await api.sendMessage(`@${senderID} ${autoMessage}`, threadID, { mentions: [{ id: senderID, tag: "@" + senderID }] });
          log(`⚠️ Auto abuse replied to ${senderID}`);
        }
      }

      // Commands
      if (event.type === "message" && body.startsWith("/")) {
        if (senderID !== BOSS_UID) {
          api.sendMessage("⛔ Sirf boss hi commands chala sakta hai!", threadID);
          return;
        }

        if (body.startsWith("/help")) {
          const helpMsg = `
🛠️ Commands:
/gclock [name] - Lock group name
/gunlock - Unlock group name
/nicklock on - Enable nickname lock
/nicklock off - Disable nickname lock
/abuse - Start auto abuse mode (auto target first abuser)
/stopabuse - Stop auto abuse mode
/help - Show this message

Note: Auto reply message aur speed panel se set karo.
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
            log(`🔒 Group name locked: ${LOCKED_GROUP_NAME}`);
          } catch (e) {
            api.sendMessage("❌ Group lock failed: " + e.message, threadID);
          }
          return;
        }

        if (body.startsWith("/gunlock")) {
          if (!LOCKED_GROUP_NAME) {
            api.sendMessage("⚠️ Group name is not locked!", threadID);
            return;
          }
          try {
            await api.setTitle("Group Chat", threadID);
            LOCKED_GROUP_NAME = null;
            GROUP_THREAD_ID = null;
            api.sendMessage("🔓 Group name unlocked!", threadID);
            log("🔓 Group name unlocked");
          } catch (e) {
            api.sendMessage("❌ Unlock failed: " + e.message, threadID);
          }
          return;
        }

        if (body.startsWith("/nicklock on")) {
          if (nickLockEnabled) {
            api.sendMessage("⚠️ Nickname lock already enabled.", threadID);
            return;
          }
          try {
            nickLockEnabled = true;
            originalNicknames = {};
            const members = await api.getThreadInfo(threadID);
            for (const m of members.userInfo) {
              originalNicknames[m.id] = m.nickname || "";
            }
            api.sendMessage("🔒 Nickname lock enabled.", threadID);
            log("🔒 Nickname lock enabled");
          } catch (e) {
            api.sendMessage("❌ Nick lock failed: " + e.message, threadID);
          }
          return;
        }

        if (body.startsWith("/nicklock off")) {
          if (!nickLockEnabled) {
            api.sendMessage("⚠️ Nickname lock is not enabled.", threadID);
            return;
          }
          try {
            nickLockEnabled = false;
            for (const uid in originalNicknames) {
              await api.changeNickname(originalNicknames[uid], uid, threadID);
            }
            originalNicknames = {};
            api.sendMessage("🔓 Nickname lock disabled.", threadID);
            log("🔓 Nickname lock disabled");
          } catch (e) {
            api.sendMessage("❌ Nick unlock failed: " + e.message, threadID);
          }
          return;
        }

        if (body.startsWith("/abuse")) {
          abuseTarget = null; // Reset abuseTarget to start fresh
          api.sendMessage("⚠️ Auto abuse mode enabled. Pehla abusive user target banega.", threadID);
          log("⚠️ Abuse mode enabled by boss");
          return;
        }

        if (body.startsWith("/stopabuse")) {
          abuseTarget = null;
          api.sendMessage("🛑 Auto abuse mode disabled.", threadID);
          log("🛑 Abuse mode disabled by boss");
          return;
        }
      }

      // Nickname lock enforcement
      if (nickLockEnabled && event.type === "change_nickname") {
        const { author, nick } = event;
        if (!originalNicknames[author]) return;
        if (nick !== originalNicknames[author]) {
          try {
            await api.changeNickname(originalNicknames[author], author, threadID);
            log(`🔄 Reverted nickname change by ${author}`);
          } catch (e) {
            log("❌ Failed to revert nickname: " + e.message);
          }
        }
      }
    } catch (e) {
      log("❌ Event handler error: " + e.message);
    }
  });
});
