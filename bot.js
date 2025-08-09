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
const autoMsgPath = path.join(userDir, "automsg.txt");
const speedPath = path.join(userDir, "speed.txt");
const logPath = path.join(userDir, "logs.txt");

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
  log("❌ appstate.json invalid or missing.");
  process.exit(1);
}

let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("UID missing");
} catch (err) {
  log("❌ admin.txt invalid or missing.");
  process.exit(1);
}

let autoMessage = "";
try {
  autoMessage = fs.readFileSync(autoMsgPath, "utf-8").trim();
  if (!autoMessage) log("⚠️ automsg.txt is empty.");
} catch {
  log("⚠️ automsg.txt not found.");
  autoMessage = "";
}

let speedSeconds = 40;
try {
  const sp = fs.readFileSync(speedPath, "utf-8").trim();
  speedSeconds = parseInt(sp) || 40;
} catch {
  log("⚠️ speed.txt not found. Using default 40 seconds.");
}

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let nickLockEnabled = false;
let originalNicknames = {};
let abuseActive = false;
let abuseTargetUID = null;

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
function canAbuse(uid) {
  const last = abuseCooldown.get(uid) || 0;
  return Date.now() - last > speedSeconds * 1000;
}

const commands = {
  help: async (api, threadID) => {
    const msg = `📜 Commands List:
    /gclock [name] - Lock group name
    /gunlock - Unlock group name (revert)
    /nicklock on - Enable nickname lock
    /nicklock off - Disable nickname lock
    /abuse start [mentionUID] - Start auto abuse to that user
    /abuse stop - Stop auto abuse
    /help - Show this message`;
    await api.sendMessage(msg, threadID);
  },

  gclock: async (api, threadID, args) => {
    if (!args.length) return api.sendMessage("⚠️ Usage: /gclock [new group name]", threadID);
    const newName = args.join(" ");
    try {
      await api.setTitle(newName, threadID);
      LOCKED_GROUP_NAME = newName;
      GROUP_THREAD_ID = threadID;
      await api.sendMessage(`🔒 Group name locked as "${newName}"`, threadID);
      log(`Group name locked as: ${newName}`);
    } catch {
      await api.sendMessage("❌ Failed to lock group name.", threadID);
    }
  },

  gunlock: async (api, threadID) => {
    if (!GROUP_THREAD_ID) return api.sendMessage("⚠️ Group name not locked.", threadID);
    try {
      await api.setTitle(LOCKED_GROUP_NAME, GROUP_THREAD_ID);
      await api.sendMessage(`🔓 Group name unlocked (reverted to "${LOCKED_GROUP_NAME}")`, threadID);
      GROUP_THREAD_ID = null;
      LOCKED_GROUP_NAME = null;
      log("Group name unlocked.");
    } catch {
      await api.sendMessage("❌ Failed to unlock group name.", threadID);
    }
  },

  nicklock: async (api, threadID, args) => {
    if (!args.length) return api.sendMessage("⚠️ Usage: /nicklock on|off", threadID);
    const param = args[0].toLowerCase();
    if (param === "on") {
      nickLockEnabled = true;
      originalNicknames = {};
      await api.sendMessage("🔒 Nickname lock enabled", threadID);
      log("Nickname lock enabled.");
    } else if (param === "off") {
      nickLockEnabled = false;
      originalNicknames = {};
      await api.sendMessage("🔓 Nickname lock disabled", threadID);
      log("Nickname lock disabled.");
    } else {
      await api.sendMessage("⚠️ Usage: /nicklock on|off", threadID);
    }
  },

  abuse: async (api, threadID, args) => {
    if (!args.length) return api.sendMessage("⚠️ Usage: /abuse start [mentionUID]|stop", threadID);

    const action = args[0].toLowerCase();

    if (action === "start") {
      if (args.length < 2) return api.sendMessage("⚠️ Usage: /abuse start [mentionUID]", threadID);
      abuseActive = true;
      GROUP_THREAD_ID = threadID;
      abuseTargetUID = args[1];
      await api.sendMessage(`🚩 Auto abuse started for UID: ${abuseTargetUID}`, threadID);
      log(`Auto abuse started for UID: ${abuseTargetUID}`);
    } else if (action === "stop") {
      abuseActive = false;
      abuseTargetUID = null;
      await api.sendMessage("🛑 Auto abuse stopped", threadID);
      log("Auto abuse stopped.");
    } else {
      await api.sendMessage("⚠️ Usage: /abuse start [mentionUID]|stop", threadID);
    }
  },
};

login(loginOptions, (err, api) => {
  if (err) return log("❌ [LOGIN FAILED]: " + err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 Ready to lock, nicklock & abuse!");

  // Anti-sleep (typing indicator)
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot active (typing indicator).");
    }
  }, 300000);

  // Save appstate every 10 minutes
  setInterval(() => {
    try {
      const newAppState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
      log("💾 AppState saved.");
    } catch (e) {
      log("❌ Failed saving appstate: " + e);
    }
  }, 600000);

  api.listenMqtt(async (err, event) => {
    if (err) return log("❌ Listen error: " + err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const body = (event.body || "").toLowerCase();

    // Group name lock revert on title change by others
    if (event.type === "change_thread_title" && GROUP_THREAD_ID && LOCKED_GROUP_NAME && event.threadID === GROUP_THREAD_ID) {
      if (event.author !== BOSS_UID) {
        try {
          await api.setTitle(LOCKED_GROUP_NAME, GROUP_THREAD_ID);
          log("🔒 Group name reverted to locked name.");
        } catch (e) {
          log("❌ Failed to revert group name: " + e);
        }
      }
    }

    // Nickname lock revert on nick change by others
    if (event.type === "change_thread_nickname" && nickLockEnabled && threadID) {
      if (event.author !== BOSS_UID) {
        try {
          if (!originalNicknames[event.author]) {
            // Save original nickname once
            originalNicknames[event.author] = event.nickname;
          } else {
            await api.changeNickname(originalNicknames[event.author], threadID, event.author);
            log(`🔒 Reverted nickname for ${event.author}`);
          }
        } catch (e) {
          log("❌ Failed to revert nickname: " + e);
        }
      }
    }

    if (event.type === "message") {
      log(`📩 ${senderID}: ${event.body || ""} (Group: ${threadID})`);

      // Auto abuse on abuse words + cooldown + abuse active + matching group + sender not boss + target UID check
      if (
        abuseActive &&
        senderID !== BOSS_UID &&
        threadID === GROUP_THREAD_ID &&
        abuseTargetUID &&
        containsAbuse(body) &&
        canAbuse(senderID)
      ) {
        abuseCooldown.set(senderID, Date.now());
        await api.sendMessage(autoMessage || "Abe teri ma ki chut!", threadID);
        log(`⚠️ Auto abuse sent to ${senderID}`);
        return;
      }

      // Command handler (only BOSS_UID can run commands)
      if (body.startsWith("/")) {
        const parts = body.slice(1).split(" ");
        const cmd = parts[0];
        const args = parts.slice(1);

        if (commands[cmd]) {
          if (senderID !== BOSS_UID) {
            return api.sendMessage("⛔ Sirf boss use kar sakta hai ye command!", threadID);
          }
          try {
            await commands[cmd](api, threadID, args);
          } catch (e) {
            log("❌ Command error: " + e);
          }
        }
      }
    }
  });
});
