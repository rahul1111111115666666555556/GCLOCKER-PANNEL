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

let speedSec = 40; // default 40 sec
try {
  const speedRaw = fs.readFileSync(speedPath, "utf-8").trim();
  speedSec = parseInt(speedRaw, 10);
  if (isNaN(speedSec) || speedSec < 5) speedSec = 40;
} catch {
  log("⚠️ speed.txt not found or invalid, using default 40s.");
}

if (process.argv[3]) {
  try {
    fs.writeFileSync(autoMsgPath, process.argv[3], "utf-8");
    autoMessage = process.argv[3];
    log("💾 Auto reply message updated from start argument.");
  } catch (e) {
    log("❌ Failed to update auto reply message: " + e);
  }
}

if (process.argv[4]) {
  try {
    let spd = parseInt(process.argv[4], 10);
    if (!isNaN(spd) && spd >= 5) {
      fs.writeFileSync(speedPath, String(spd), "utf-8");
      speedSec = spd;
      log("⏱️ Speed updated from start argument: " + spd + " seconds.");
    }
  } catch (e) {
    log("❌ Failed to update speed: " + e);
  }
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
  return abusiveWords.some((word) => text.includes(word));
}

const abuseCooldown = new Map();
const COOLDOWN_MS = () => speedSec * 1000;

login(loginOptions, async (err, api) => {
  if (err) return log("❌ [LOGIN FAILED]: " + err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 — Ready to lock and rock!");

  // Anti-sleep typing indicator
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot is active... still alive ✅");
    }
  }, 300000);

  // Save appstate every 10 minutes
  setInterval(() => {
    try {
      const newAppState = api.getAppState();
      fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
      log("💾 Appstate saved ✅");
    } catch (e) {
      log("❌ Appstate save failed: " + e);
    }
  }, 600000);

  // Auto message interval
  setInterval(async () => {
    if (GROUP_THREAD_ID && autoMessage) {
      try {
        await api.sendMessage(autoMessage, GROUP_THREAD_ID);
        log("⏱️ Auto reply message sent.");
      } catch (e) {
        log("❌ Auto reply send error: " + e);
      }
    }
  }, speedSec * 1000);

  api.listenMqtt(async (err, event) => {
    if (err) return log("❌ Listen error: " + err);

    const senderID = event.senderID;
    const threadID = event.threadID;
    const bodyRaw = event.body || "";
    const body = bodyRaw.toLowerCase();

    if (event.type === "message") {
      log(`📩 ${senderID}: ${bodyRaw} (Group: ${threadID})`);
    }

    // Ignore own messages except commands
    if (senderID === api.getCurrentUserID() && !body.startsWith("/")) return;

    // COMMANDS
    if (body.startsWith("/")) {
      const args = body.trim().split(" ");
      const cmd = args[0];

      if (cmd === "/help") {
        let helpMsg = 
`🤖 BOT Commands:
/gclock <name>  - Lock group name
/gunlock        - Unlock group name
/nicklock on    - Enable nickname lock
/nicklock off   - Disable nickname lock
/abuse          - Test abuse detection auto reply
/help           - Show this help`;
        await api.sendMessage(helpMsg, threadID);
        return;
      }

      if (senderID !== BOSS_UID) {
        await api.sendMessage("⛔ Tu boss nahi hai 😤", threadID);
        return;
      }

      if (cmd === "/gclock") {
        const newName = args.slice(1).join(" ").trim();
        if (!newName) {
          await api.sendMessage("❌ Group name nahi diya.", threadID);
          return;
        }
        try {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          GROUP_THREAD_ID = threadID;
          await api.sendMessage(`🔒 Naam lock ho gaya: "${newName}"`, threadID);
          log(`🔒 Group name locked: ${newName}`);
        } catch (e) {
          await api.sendMessage("❌ Naam lock karte waqt error aaya.", threadID);
          log("❌ /gclock error: " + e);
        }
        return;
      }

      if (cmd === "/gunlock") {
        if (!LOCKED_GROUP_NAME || threadID !== GROUP_THREAD_ID) {
          await api.sendMessage("❌ Group name pehle lock nahi hai ya ye group nahi hai.", threadID);
          return;
        }
        try {
          const info = await api.getThreadInfo(threadID);
          await api.setTitle(info.name, threadID);
          LOCKED_GROUP_NAME = null;
          GROUP_THREAD_ID = null;
          await api.sendMessage("🔓 Naam lock hata diya gaya.", threadID);
          log("🔓 Group name unlock hua.");
        } catch (e) {
          await api.sendMessage("❌ Naam unlock karte waqt error aaya.", threadID);
          log("❌ /gunlock error: " + e);
        }
        return;
      }

      if (cmd === "/nicklock") {
        const param = args[1];
        if (param === "on") {
          nickLockEnabled = true;
          originalNicknames = {};
          await api.sendMessage("🔒 Nickname lock on kar diya.", threadID);
          log("🔒 Nickname lock enabled.");
        } else if (param === "off") {
          nickLockEnabled = false;
          originalNicknames = {};
          await api.sendMessage("🔓 Nickname lock off kar diya.", threadID);
          log("🔓 Nickname lock disabled.");
        } else {
          await api.sendMessage("❌ Usage: /nicklock on | off", threadID);
        }
        return;
      }

      if (cmd === "/abuse") {
        // Just test abuse reply
        if (!autoMessage) {
          await api.sendMessage("⚠️ Auto reply message empty.", threadID);
          return;
        }
        const mention = [
          {
            tag: `@${senderID}`,
            id: senderID,
            fromIndex: 0,
            length: senderID.length + 1,
          },
        ];
        await api.sendMessage(
          {
            body: `@${senderID} ${autoMessage}`,
            mentions: mention,
          },
          threadID
        );
        log(`⚠️ /abuse command by ${senderID}, sent auto reply.`);
        return;
      }
    }

    // NICKNAME LOCK
    if (nickLockEnabled && event.type === "change_thread_name") {
      return;
    }
    if (nickLockEnabled && event.type === "change_nickname") {
      if (event.author == BOSS_UID) return;
      if (!originalNicknames[event.author])
        originalNicknames[event.author] = event.oldNickname || "";
      try {
        await api.changeNickname(
          originalNicknames[event.author],
          threadID,
          event.author
        );
        log(`🔒 Nickname revert for ${event.author}`);
      } catch (e) {
        log("❌ Nicklock revert error: " + e);
      }
    }

    // ABUSE DETECTION WITH MENTIONED USER ONLY
    if (
      event.type === "message" &&
      containsAbuse(body) &&
      senderID !== BOSS_UID
    ) {
      // Check if sender is mentioned in last message by admin (BOSS_UID)
      try {
        const lastMessages = await api.getThreadHistory(threadID, 5);
        const mentionedIds = [];
        lastMessages.forEach(m => {
          if (m.senderID === BOSS_UID && m.mentions)
            m.mentions.forEach(u => mentionedIds.push(u.id));
        });

        if (!mentionedIds.includes(senderID)) return; // ignore if sender not mentioned

      } catch (e) {
        log("❌ Error checking mentions: " + e);
        return;
      }

      if (!autoMessage) {
        log("⚠️ Auto reply message empty, skipping abuse reply.");
        return;
      }

      const key = `${threadID}-${senderID}`;
      const now = Date.now();

      if (abuseCooldown.has(key) && now - abuseCooldown.get(key) < speedSec * 1000) {
        return;
      }
      abuseCooldown.set(key, now);

      try {
        const mention = [
          {
            tag: `@${senderID}`,
            id: senderID,
            fromIndex: 0,
            length: senderID.length + 1,
          },
        ];

        await api.sendMessage(
          {
            body: `@${senderID} ${autoMessage}`,
            mentions: mention,
          },
          threadID
        );

        log(`⚠️ Abuse detected from ${senderID}, sent auto reply.`);
      } catch (e) {
        log("❌ Abuse auto reply error: " + e);
      }
    }
  });
});
