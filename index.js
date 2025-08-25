const fca = require("ws3-fca");
const fs = require("fs");

// ==========================
// Utility functions
// ==========================
function setGroupTitle(api, threadID, newTitle, callback) {
  api.httpPost(
    "https://graph.facebook.com/graphql",
    {
      doc_id: "3454067814748025",
      variables: JSON.stringify({
        input: {
          actor_id: api.getCurrentUserID(),
          thread_id: threadID,
          new_title: newTitle
        }
      })
    },
    (err, data) => {
      if (err) return callback(err);
      callback(null, data);
    }
  );
}

function setNickname(api, threadID, userID, nickname, callback) {
  api.httpPost(
    "https://graph.facebook.com/graphql",
    {
      doc_id: "3370159499744685",
      variables: JSON.stringify({
        input: {
          actor_id: api.getCurrentUserID(),
          nickname: nickname,
          participant_id: userID,
          thread_id: threadID
        }
      })
    },
    (err, data) => {
      if (err) return callback(err);
      callback(null, data);
    }
  );
}

// ==========================
// Bot Start
// ==========================
const admin = process.argv[2];
const appStateFile = `./users/${admin}/appstate.json`;

if (!fs.existsSync(appStateFile)) {
  console.error("❌ AppState file missing for UID:", admin);
  process.exit(1);
}

let appState = JSON.parse(fs.readFileSync(appStateFile, "utf8"));

fca({ appState }, (err, api) => {
  if (err) return console.error("Login error:", err);

  console.log("✅ Bot logged in for UID:", admin);

  // Store locks
  let lockedGroupNames = {};  // threadID → locked name
  let lockedNicknames = {};   // threadID → {userID: nickname}

  api.listenMqtt((err, event) => {
    if (err) return console.error(err);

    // 📩 Messages (commands)
    if (event.type === "message" && event.body) {
      let msg = event.body.trim();

      // /help
      if (msg === "/help") {
        api.sendMessage(
          `📜 Available Commands:\n` +
          `/help → Show this menu\n` +
          `/ping → Bot replies with pong\n` +
          `/pong → Bot replies with ping\n` +
          `/uid → Show your UID\n` +
          `/gclock <name> → Lock group name\n` +
          `/nicklock on <nick> → Lock your nickname`,
          event.threadID
        );
      }

      // /ping
      if (msg === "/ping") {
        api.sendMessage("🏓 Pong!", event.threadID);
      }

      // /pong
      if (msg === "/pong") {
        api.sendMessage("Ping!", event.threadID);
      }

      // /uid
      if (msg === "/uid") {
        api.sendMessage(`🔑 Your UID: ${event.senderID}`, event.threadID);
      }

      // /gclock <name>
      if (msg.startsWith("/gclock")) {
        let newName = msg.split(" ").slice(1).join(" ");
        if (!newName) return api.sendMessage("❌ Please provide a group name.", event.threadID);

        lockedGroupNames[event.threadID] = newName;
        setGroupTitle(api, event.threadID, newName, (err) => {
          if (err) return api.sendMessage("❌ Failed to lock group name.", event.threadID);
          api.sendMessage("✅ Group name locked & auto-protected!", event.threadID);
        });
      }

      // /nicklock on <nick>
      if (msg.startsWith("/nicklock")) {
        let args = msg.split(" ");
        if (args[1] !== "on") {
          return api.sendMessage("⚠️ Usage: /nicklock on <nickname>", event.threadID);
        }

        let newNick = args.slice(2).join(" ");
        if (!newNick) return api.sendMessage("❌ Please provide a nickname.", event.threadID);

        if (!lockedNicknames[event.threadID]) lockedNicknames[event.threadID] = {};
        lockedNicknames[event.threadID][event.senderID] = newNick;

        setNickname(api, event.threadID, event.senderID, newNick, (err) => {
          if (err) return api.sendMessage("❌ Failed setting nick.", event.threadID);
          api.sendMessage("✅ Nickname locked & auto-protected!", event.threadID);
        });
      }
    }

    // 🔒 Auto enforcement (detect changes)
    if (event.type === "event") {
      // Someone changed group name
      if (event.logMessageType === "log:thread-name" && lockedGroupNames[event.threadID]) {
        let lockedName = lockedGroupNames[event.threadID];
        setGroupTitle(api, event.threadID, lockedName, () => {
          api.sendMessage("⚠️ Group name is locked. Reverted change.", event.threadID);
        });
      }

      // Someone changed a nickname
      if (event.logMessageType === "log:user-nickname" && lockedNicknames[event.threadID]) {
        let targetID = event.logMessageData.participant_id;
        let lockedName = lockedNicknames[event.threadID][targetID];
        if (lockedName) {
          setNickname(api, event.threadID, targetID, lockedName, () => {
            api.sendMessage(`⚠️ Nickname is locked. Reverted change for UID: ${targetID}`, event.threadID);
          });
        }
      }
    }
  });
});
