// ===== Chat client =====

const app = document.getElementById("app");
const dialog = document.getElementById("join-dialog");
const joinForm = document.getElementById("join-form");
const list = document.getElementById("messages-inner");
const scroller = document.getElementById("messages");
const composer = document.getElementById("composer");
const input = document.getElementById("message-input");

let nickname = "";
let lastId = 0;
let polling = false;
let pollTimer = null;

// ---------- helpers ----------

// Same name -> same color, every time
function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 75% 72%)`;
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom() {
  scroller.scrollTop = scroller.scrollHeight;
}

// ---------- links ----------

const URL_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function linkify(text) {
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    let raw = match[0];
    const start = match.index;

    // Trailing punctuation usually belongs to the sentence, not the link
    const trailing = raw.match(/[.,!?;:)\]]+$/);
    if (trailing) raw = raw.slice(0, -trailing[0].length);

    // Build the real URL and make sure it's http(s) only
    const href = raw.startsWith("www.") ? "https://" + raw : raw;
    let url;
    try {
      url = new URL(href);
    } catch {
      continue;                           // not a valid URL, leave it as plain text
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    // Plain text before the link
    fragment.append(document.createTextNode(text.slice(lastIndex, start)));

    const a = document.createElement("a");
    a.href = url.href;
    a.textContent = raw;                  // textContent, never innerHTML
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    fragment.append(a);

    lastIndex = start + raw.length;
  }

  fragment.append(document.createTextNode(text.slice(lastIndex)));
  return fragment;
}

// ---------- rendering ----------

// IMPORTANT: textContent / text nodes, never innerHTML, so a message can't inject HTML or scripts
function addMessage({ name, text, own = false }) {
  const msg = document.createElement("div");
  msg.className = "msg" + (own ? " own" : "");

  const meta = document.createElement("div");
  meta.className = "meta";

  const who = document.createElement("span");
  who.className = "name";
  who.textContent = own ? "You" : name;
  if (!own) who.style.color = colorFor(name);

  const time = document.createElement("span");
  time.textContent = timeNow();

  meta.append(who, time);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.append(linkify(text));

  msg.append(meta, bubble);
  list.append(msg);
  scrollToBottom();
}

function addSystem(text) {
  const note = document.createElement("div");
  note.className = "system";
  note.textContent = text;
  list.append(note);
  scrollToBottom();
}

// ---------- join modal ----------

// Block Escape: the only way in is submitting the form
dialog.addEventListener("cancel", (e) => e.preventDefault());
dialog.showModal();
document.getElementById("nickname").focus();

// Random passphrase, using the browser's secure random numbers
const WORDS = ["amber", "river", "falcon", "maple", "orbit", "velvet", "lantern", "cobalt",
  "meadow", "pixel", "harbor", "ember", "willow", "comet", "juniper", "saffron",
  "quartz", "tundra", "marble", "breeze", "copper", "violet", "thunder", "pebble"];

function passphrase(count = 4) {
  const picks = new Uint32Array(count);
  crypto.getRandomValues(picks);
  return Array.from(picks, (n) => WORDS[n % WORDS.length]).join("-");
}

document.getElementById("generate").addEventListener("click", () => {
  const pw = document.getElementById("password");
  pw.value = passphrase();
  pw.type = "text";                       // show it so you can share it
  const note = document.getElementById("generated-note");
  note.hidden = false;
  note.textContent = "Share this with the people you want in the room.";
});

function showJoinError(message) {
  const box = document.getElementById("join-error");
  box.textContent = message;              // textContent again, never innerHTML
  box.hidden = false;
}

joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("join-error").hidden = true;

  const nick = document.getElementById("nickname").value.trim();
  const password = document.getElementById("password").value;
  const submitBtn = joinForm.querySelector(".primary");
  submitBtn.disabled = true;
  let result;
  try {
    const res = await fetch("/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: nick, password }),
    });
    result = await res.json();
  } catch {
    result = { ok: false, error: "Could not reach the server." };
  }
  submitBtn.disabled = false;
  if (!result.ok) {
    showJoinError(result.error);
    return;
  }

  nickname = nick;
  lastId = result.since;                  // start after the join, so no old history
  dialog.close();
  document.getElementById("password").value = "";
  document.getElementById("password").type = "password";
  app.removeAttribute("inert");
  input.focus();
  addSystem("You joined the room");
  startPolling();
});

// ---------- sending ----------

// ---------- sending ----------

// ---------- sending ----------

// To add a command: add one entry here. `hidden: true` keeps it out of the suggestions.
const COMMANDS = [
  {
    name: "agent",
    hint: "<question>",
    description: "Ask the AI assistant",
    run: async (arg) => {
      if (!arg) { addSystem("Usage: /agent your question"); return; }
      await send("/agent", { text: arg });
    },
  },
];

async function send(url, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) { addSystem("Slow down a little."); return; }
    const result = await res.json();
    if (!result.ok) addSystem(result.error);
    else poll();
  } catch {
    addSystem("Message failed to send.");
  }
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  closeCommands();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  // "/name rest of the message"
  const m = text.match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  const cmd = m && COMMANDS.find((c) => c.name === m[1].toLowerCase());

  if (cmd) await cmd.run((m[2] || "").trim());
  else await send("/send", { text });      // unknown "/something" is just a normal message
});


// ---------- command autocomplete ----------

const commandList = document.getElementById("commands");
let matches = [];
let selected = 0;

function closeCommands() {
  commandList.hidden = true;
  matches = [];
}

function renderCommands() {
  commandList.replaceChildren();
  matches.forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "command" + (i === selected ? " active" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === selected));

    const name = document.createElement("span");
    name.className = "cmd-name";
    name.textContent = "/" + c.name;

    const hint = document.createElement("span");
    hint.className = "cmd-hint";
    hint.textContent = c.hint || "";

    const desc = document.createElement("span");
    desc.className = "cmd-desc";
    desc.textContent = c.description || "";

    li.append(name, hint, desc);
    // mousedown (not click) so the input doesn't lose focus first
    li.addEventListener("mousedown", (e) => { e.preventDefault(); chooseCommand(i); });
    commandList.append(li);
  });
  commandList.hidden = false;
}

function updateCommands() {
  // only while typing the command word itself: "/" plus letters, no space yet
  const m = input.value.match(/^\/([a-z]*)$/i);
  if (!m) return closeCommands();

  const typed = m[1].toLowerCase();
  matches = COMMANDS.filter((c) => !c.hidden && c.name.startsWith(typed));
  if (!matches.length) return closeCommands();

  selected = 0;
  renderCommands();
}

function chooseCommand(i) {
  input.value = "/" + matches[i].name + " ";
  closeCommands();
  input.focus();
}

input.addEventListener("input", updateCommands);

input.addEventListener("keydown", (e) => {
  if (commandList.hidden) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    selected = (selected + 1) % matches.length;
    renderCommands();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selected = (selected - 1 + matches.length) % matches.length;
    renderCommands();
  } else if (e.key === "Tab" || e.key === "Enter") {
    e.preventDefault();                      // Enter completes instead of sending
    chooseCommand(selected);
  } else if (e.key === "Escape") {
    closeCommands();
  }
});

input.addEventListener("blur", () => setTimeout(closeCommands, 100));



// ---------- receiving (polling) ----------

async function poll() {
  if (polling) return;                    // never run two polls at once
  polling = true;
  try {
    const res = await fetch(`/messages?after=${lastId}`);
    if (res.status === 401) {
      addSystem("You were disconnected. Refresh to rejoin.");
      stopPolling();
      return;
    }
    const data = await res.json();

    for (const m of data.messages) {
      if (m.kind === "system") {
        addSystem(m.text);
      } else {
        addMessage({ name: m.name, text: m.text, own: m.name === nickname });
      }
      lastId = m.id;
    }
    document.getElementById("online").textContent = `${data.online} online`;
  } catch {
    // network hiccup: try again next tick
  } finally {
    polling = false;
  }
}

function startPolling() {
  poll();
  pollTimer = setInterval(poll, 1500);
}

function stopPolling() {
  clearInterval(pollTimer);
}

// ---------- leaving ----------

document.getElementById("leave").addEventListener("click", async () => {
  stopPolling();
  try {
    await fetch("/leave", { method: "POST" });
  } catch {}
  location.reload();
});