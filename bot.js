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

const appState = JSON.parse(fs.readFileSync(appStatePath, "utf-8"));
const BOSS_UID = loadTextFile(adminPath, "admin.txt");
if (!BOSS_UID) {
  log("❌ admin.txt is empty, exiting.");
  process.exit(1);
}

let autoMessage = loadTextFile(autoMsgPath, "automsg.txt");
let speed = 40;
const spdRaw = loadTextFile(speedPath, "speed.txt");
const spdNum = parseInt(spdRaw, 10);
if (!isNaN(spdNum) && spdNum >= 5) speed = spdNum;

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};

const abusiveWords = [
  "bc", "mc", "bcchod", "chutiya", "chod", "lund", "gandu",
  "madarchod", "behanchod", "bhadwa", "haramkhor"
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

  // Anti-sleep indicator every 5 mins
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot is alive.");
    }
  }, 300000);

  // Auto save appstate every 10 mins
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
      const body = (event.body || "").toLowerCase();

      if (event.type === "message") {
        log(`📩 ${senderID}: ${event.body} (Group: ${threadID})`);
      }

      // Handle commands only from BOSS_UID
      if (event.type === "message" && senderID === BOSS_UID) {
        if (body.startsWith("/help")) {
          const helpMsg = `
Commands:
/gclock [name] - Lock group name
/gclock remove - Unlock group name
/nicklock on - Enable nickname lock
/nicklock off - Disable nickname lock
/abuse [@id] - Start auto abuse on mentioned user
/stopabuse - Stop auto abuse
/automsg [message] - Set auto reply message
/speed [seconds] - Set auto message speed
/status - Show current bot status
/help - Show this help
          `;
          api.sendMessage(helpMsg, threadID);
          return;
        }

        if (body.startsWith("/gclock")) {
          GROUP_THREAD_ID = threadID;
          const param = event.body.slice(7).trim();
          if (param === "remove") {
            if (!LOCKED_GROUP_NAME) {
              api.sendMessage("Group name is not locked.", threadID);
              return;
            }
            const info = await api.getThreadInfo(threadID);
            await api.setTitle(info.threadName, threadID);
            LOCKED_GROUP_NAME = null;
            api.sendMessage("🔓 Group name unlocked.", threadID);
          } else if (param.length > 0) {
            await api.setTitle(param, threadID);
            LOCKED_GROUP_NAME = param;
            api.sendMessage(`🔒 Group name locked to: "${param}"`, threadID);
          } else {
            api.sendMessage("Usage: /gclock [name] or /gclock remove", threadID);
          }
          return;
        }

        if (body.startsWith("/nicklock")) {
          const param = event.body.slice(9).trim();
          if (param === "on") {
            nickLockEnabled = true;
            originalNicknames = {};
            const info = await api.getThreadInfo(threadID);
            for (const participant of info.participantIDs) {
              const nick = await api.getUserNickname(participant, threadID);
              if (nick) originalNicknames[participant] = nick;
            }
            api.sendMessage("🔒 Nickname lock enabled.", threadID);
          } else if (param === "off") {
            nickLockEnabled =
