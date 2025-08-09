
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

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logPath, line + "\n");
}

// Load appstate
let appState;
try {
  const raw = fs.readFileSync(appStatePath, "utf-8");
  if (!raw.trim()) throw new Error("File is empty");
  appState = JSON.parse(raw);
} catch (err) {
  log("❌ appstate.json is invalid or empty.");
  process.exit(1);
}

// Load admin UID
let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("UID missing");
} catch (err) {
  log("❌ admin.txt is invalid or empty.");
  process.exit(1);
}

// Load auto reply message from file (initial)
let autoMessage = "";
try {
  autoMessage = fs.readFileSync(autoMsgPath, "utf-8").trim();
  if (!autoMessage) log("⚠️ Warning: automsg.txt is empty.");
} catch {
  log("⚠️ automsg.txt not found or empty.");
  autoMessage = "";
}

// Update auto reply message if passed as 3rd argument on bot start
if (process.argv[3]) {
  try {
    fs.writeFileSync(autoMsgPath, process.argv[3], "utf-8");
    autoMessage = process.argv[3];
    log("💾 Auto reply message updated from start argument.");
  } catch (e) {
    log("❌ Failed to update auto reply message: " + e);
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

// List of abusive words
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

// Cooldown map to prevent spam replies: threadID+senderID => last reply timestamp
const abuseCooldown = new Map();
const COOLDOWN_MS = 40 * 1000; // 40 seconds cooldown

login(loginOptions, async (err, api) => {
  if (err) return log("❌ [LOGIN FAILED]: " + err);

  api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
  log("🤖 BOT ONLINE 🔥 — Ready to lock and rock!");

  // Anti-sleep (typing indicator every 5 min)
  setInterval(() => {
    if (GROUP_THREAD_ID) {
      api.sendTypingIndicator(GROUP_THREAD_ID, true);
      setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1500);
      log("💤 Bot is active... still alive ✅");
    }
  }, 300000);

  // Appstate backup every 10 min
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

    if (event.type !== "message") return;

    const senderID = event.senderID;
    const threadID = event.threadID;
    const bodyRaw = event.body || "";
    const body = bodyRaw.toLowerCase();

    log(`📩 ${senderID}: ${bodyRaw} (Group: ${threadID})`);

    // ===== BOSS COMMANDS =====
    if (senderID === BOSS_UID) {
      if (body === "/help") {
        api.sendMessage(
          `
📜 *COMMANDS LIST* 📜

🔒 /gclock [name] - Lock group name to [name]
🔓 /gunlock - Unlock group name
👤 /nicklock on - Enable nickname lock
👤 /nicklock off - Disable nickname lock

🆘 /help - Show this message
          `.trim(),
          threadID
        );
        return;
      }

      if (body.startsWith("/gclock")) {
        const newName = event.body.slice(7).trim();
        if (!newName) {
          api.sendMessage("⚠️ Naam dena padega lock karne ke liye!", threadID);
          return;
        }
        try {
          await api.setTitle(newName, threadID);
          LOCKED_GROUP_NAME = newName;
          GROUP_THREAD_ID = threadID;
          api.sendMessage(`🔒 Group name locked as: "${newName}"`, threadID);
          log(`🔒 Group name locked to "${newName}"`);
        } catch (e) {
          api.sendMessage("❌ Group name lock failed.", threadID);
          log("❌ Group name lock error: " + e);
        }
        return;
      }

      if (body === "/gunlock") {
        try {
          if (!LOCKED_GROUP_NAME || GROUP_THREAD_ID !== threadID) {
            api.sendMessage("⚠️ Pehle group lock karo phir unlock karo!", threadID);
            return;
          }
          const threadInfo = await api.getThreadInfo(threadID);
          await api.setTitle(threadInfo.name, threadID); // unlock by resetting to current name
          LOCKED_GROUP_NAME = null;
          GROUP_THREAD_ID = null;
          api.sendMessage("🔓 Group name unlocked.", threadID);
          log("🔓 Group unlocked");
        } catch (e) {
          api.sendMessage("❌ Group unlock failed.", threadID);
          log("❌ Group unlock error: " + e);
        }
        return;
      }

      if (body === "/nicklock on") {
        nickLockEnabled = true;
        originalNicknames = {};
        api.sendMessage("✅ Nickname lock enabled.", threadID);
        log("✅ Nicklock enabled");
        return;
      }

      if (body === "/nicklock off") {
        nickLockEnabled = false;
        originalNicknames = {};
        api.sendMessage("❌ Nickname lock disabled.", threadID);
        log("❌ Nicklock disabled");
        return;
      }
    }

    // ===== NICKLOCK LOGIC =====
    if (
      nickLockEnabled &&
      GROUP_THREAD_ID === threadID &&
      event.isGroup &&
      event.type === "message"
    ) {
      try {
        if (!originalNicknames[senderID]) {
          const nick = (await api.getUserInfo(senderID))[senderID].name;
          originalNicknames[senderID] = nick;
        }

        const currentNick = (await api.getUserInfo(senderID))[senderID].name;

        if (currentNick !== originalNicknames[senderID]) {
          await api.changeNickname(originalNicknames[senderID], senderID, threadID);
          log(`⚠️ Reset nickname of ${senderID} to ${originalNicknames[senderID]}`);
        }
      } catch (e) {
        log("❌ Nicklock error: " + e);
      }
    }

    // ===== ABUSE DETECTION AND AUTO REPLY =====
    if (containsAbuse(body) && senderID !== BOSS_UID) {
      if (!autoMessage) {
        log("⚠️ Auto reply message empty, skipping abuse reply.");
        return;
      }

      const key = `${threadID}-${senderID}`;
      const now = Date.now();

      if (abuseCooldown.has(key) && now - abuseCooldown.get(key) < COOLDOWN_MS) {
        return; // cooldown active
      }
      abuseCooldown.set(key, now);

      try {
        const threadInfo = await api.getThreadInfo(threadID);
        if (
          threadInfo.participantIDs.includes(BOSS_UID) ||
          threadID === BOSS_UID
        ) {
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
        }
      } catch (e) {
        log("❌ Abuse auto reply error: " + e);
      }
    }
  });
});
