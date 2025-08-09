const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");

const uid = process.argv[2];
if (!uid) {
  console.error("❌ UID argument missing. Usage: node bot.js <UID>");
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

let appState;
try {
  const raw = fs.readFileSync(appStatePath, "utf-8");
  if (!raw.trim()) throw new Error("File is empty");
  appState = JSON.parse(raw);
} catch (err) {
  log("❌ appstate.json is invalid or empty.");
  process.exit(1);
}

let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("UID missing");
} catch (err) {
  log("❌ admin.txt is invalid or empty.");
  process.exit(1);
}

let autoMessage = "";
try {
  autoMessage = fs.readFileSync(autoMsgPath, "utf-8").trim();
  if (!autoMessage) log("⚠️ Warning: automsg.txt is empty.");
} catch {
  log("⚠️ automsg.txt not found or empty.");
  autoMessage = "";
}

let speed = 40;
try {
  const sp = fs.readFileSync(speedPath, "utf-8").trim();
  if (sp && !isNaN(sp)) speed = Math.max(10, Math.min(300, Number(sp)));
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
  "bc", "mc", "bcchod", "chutiya", "chod", "lund", "gandu",
  "madarchod", "behanchod", "bhadwa", "haramkhor",
];

function containsAbuse(text) {
  text = text.toLowerCase();
  return abusiveWords.some(word => text.includes(word));
}

const abuseCooldown = new Map();
const COOLDOWN_MS = speed * 1000;

login(loginOptions, async (err, api) => {
  if (err) {
    log("❌ [LOGIN FAILED]: " + err);
    process.exit(1);
  }

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 — Ready to lock and rock!");

  // Anti-sleep indicator every 5 mins
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot is active... still alive ✅");
    }
  }, 300000);

  // Auto save appstate every 10 mins
  setInterval(() => {
    try {
      const newAppState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
      log("💾 Appstate saved ✅");
    } catch (e) {
      log("❌ Appstate save failed: " + e);
    }
  }, 600000);

  api.listenMqtt(async (err, event) => {
    if (err) return log("❌ Listen error: " + err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    if (event.type === "message") {
      log(`📩 ${senderID}: ${event.body} (Group: ${threadID})`);
    }

    // Group Name Lock: /gclock [new name]
    if (event.type === "message" && body.startsWith("/gclock")) {
      if (senderID !== BOSS_UID) return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      const newName = event.body.slice(7).trim();
      GROUP_THREAD_ID = threadID;

      if (newName.length > 0) {
        await api.setTitle(newName, threadID);
        LOCKED_GROUP_NAME = newName;
        api.sendMessage(`🔒 Naam lock ho gaya: "${LOCKED_GROUP_NAME}"`, threadID);
      } else {
        try {
          const info = await api.getThreadInfo(threadID);
          if (info && info.threadName) {
            LOCKED_GROUP_NAME = info.threadName;
            api.sendMessage(`🔒 Naam lock ho gaya: "${LOCKED_GROUP_NAME}"`, threadID);
          } else {
            api.sendMessage("❌ Naam lock karne mein problem hui.", threadID);
          }
        } catch {
          api.sendMessage("❌ Naam lock karne mein problem hui.", threadID);
        }
      }
    }

    // Nickname Lock: /nicklock on/off
    if (event.type === "message" && body.startsWith("/nicklock")) {
      if (senderID !== BOSS_UID) return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      const arg = event.body.slice(9).trim().toLowerCase();
      if (arg === "on") {
        nickLockEnabled = true;
        originalNicknames = {};
        api.sendMessage("🔒 Nickname lock on ho gaya", threadID);
      } else if (arg === "off") {
        nickLockEnabled = false;
        api.sendMessage("🔓 Nickname lock off ho gaya", threadID);
      } else {
        api.sendMessage("❌ Invalid argument. Use /nicklock on or /nicklock off", threadID);
      }
    }

    // Enforce nickname lock when enabled
    if (nickLockEnabled && event.type === "event" && event.logMessageType === "log:thread-nickname") {
      const changedUser = event.logMessageData && event.logMessageData.participant_id;
      if (!changedUser) return;

      if (!originalNicknames[changedUser]) {
        try {
          const info = await api.getThreadInfo(threadID);
          if (info.nicknames && info.nicknames[changedUser]) {
            originalNicknames[changedUser] = info.nicknames[changedUser];
          }
        } catch {}
      }

      // Reset nickname back if changed
      if (originalNicknames[changedUser]) {
        try {
          await api.changeNickname(originalNicknames[changedUser], threadID, changedUser);
          log(`🔄 Reset nickname for ${changedUser}`);
        } catch {}
      }
    }

    // Auto abuse for abusive messages
    if (event.type === "message" && containsAbuse(event.body) && senderID !== BOSS_UID) {
      const key = `${threadID}_${senderID}`;
      const last = abuseCooldown.get(key) || 0;
      const now = Date.now();

      if (now - last > COOLDOWN_MS) {
        abuseCooldown.set(key, now);
        if (autoMessage && autoMessage.length > 0) {
          await api.sendMessage(autoMessage, threadID);
          log(`🚫 Auto abused ${senderID} in ${threadID}`);
        }
      }
    }

    // /abuse command to abuse mentioned users or sender
    if (event.type === "message" && body.startsWith("/abuse")) {
      if (senderID !== BOSS_UID) return api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);

      let mention
