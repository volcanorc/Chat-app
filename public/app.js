let socket;
let currentRoom = null;
let selectedFile = null;

function toggleEmojiPanel() {
  const panel = document.getElementById("emoji-panel");
  panel.classList.toggle("hidden");
}

function addEmoji(emoji) {
  const input = document.getElementById("message-input");
  input.value += emoji;
  document.getElementById("emoji-panel").classList.add("hidden");
}

function toggleForms() {
  document.getElementById("login-form").classList.toggle("hidden");
  document.getElementById("register-form").classList.toggle("hidden");
}

async function register() {
  const username = document.getElementById("register-username").value;
  const password = document.getElementById("register-password").value;

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });

    const data = await response.json();
    if (response.ok) {
      sessionStorage.setItem("userId", data.userId);
      sessionStorage.setItem("username", data.username);
      initializeChat();
    } else {
      alert(data.error);
    }
  } catch (error) {
    alert("Registration failed");
  }
}

async function login() {
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });

    const data = await response.json();
    if (response.ok) {
      sessionStorage.setItem("userId", data.userId);
      sessionStorage.setItem("username", data.username);
      initializeChat();
    } else {
      alert(data.error);
    }
  } catch (error) {
    alert("Login failed");
  }
}

async function logout() {
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    });
    if (socket) {
      socket.disconnect();
    }
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("username");
    document.getElementById("auth-container").classList.remove("hidden");
    document.getElementById("chat-container").classList.add("hidden");
  } catch (error) {
    alert("Logout failed");
  }
}

function initializeChat() {
  document.getElementById("auth-container").classList.add("hidden");
  document.getElementById("chat-container").classList.remove("hidden");

  // Initialize Socket.IO with credentials
  socket = io({
    withCredentials: true,
    auth: {
      userId: sessionStorage.getItem("userId"),
    },
  });

  socket.on("connect", () => {
    console.log("Connected to server");
  });

  socket.on("connect_error", (error) => {
    console.error("Connection error:", error);
    alert("Connection failed. Please try logging in again.");
    document.getElementById("auth-container").classList.remove("hidden");
    document.getElementById("chat-container").classList.add("hidden");
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("username");
  });

  socket.on("previous-messages", (messages) => {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";
    messages.forEach((message) => {
      appendMessage(message);
    });
  });

  socket.on("new-message", (message) => {
    appendMessage(message);
  });
}

function joinRoom(room) {
  if (currentRoom) {
    socket.emit("leave-room", currentRoom);
  }
  currentRoom = room;
  socket.emit("join-room", room);
  document.getElementById("messages").innerHTML = "";
  // Update room label
  document.getElementById(
    "current-room-label"
  ).textContent = `Current Room: ${room}`;
}

function appendMessage(message) {
  const messagesDiv = document.getElementById("messages");
  const messageElement = document.createElement("div");
  messageElement.className = "message";

  const username = message.sender ? message.sender.username : "Unknown User";

  let messageContent = `
      <span class="username">${username}:</span>
  `;

  if (message.content) {
    messageContent += `<span class="content">${message.content}</span>`;
  }

  if (message.fileUrl) {
    const isImage = message.fileType?.startsWith("image/");
    if (isImage) {
      messageContent += `
              <div class="file-attachment">
                  <img src="${message.fileUrl}" alt="${message.fileName}" style="max-width: 200px; max-height: 200px;"/>
                  <div class="file-name">📎 ${message.fileName}</div>
              </div>
          `;
    } else {
      messageContent += `
              <div class="file-attachment">
                  <a href="${message.fileUrl}" target="_blank" download>
                      📎 ${message.fileName}
                  </a>
              </div>
          `;
    }
  }

  messageContent += `
      <span class="timestamp">${new Date(
        message.createdAt
      ).toLocaleTimeString()}</span>
  `;

  messageElement.innerHTML = messageContent;
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById("message-input");
  const content = input.value.trim();

  if ((!content && !selectedFile) || !currentRoom) {
    return;
  }

  try {
    let fileData = null;
    if (selectedFile) {
      const formData = new FormData();
      formData.append("file", selectedFile);

      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("File upload failed");
        }

        fileData = await response.json();
        console.log("File uploaded successfully:", fileData);
      } catch (error) {
        console.error("File upload error:", error);
        alert("Failed to upload file. Please try again.");
        return;
      }
    }

    // Emit the message with file data if present
    socket.emit("send-message", {
      content: content,
      room: currentRoom,
      fileUrl: fileData?.fileUrl,
      fileName: fileData?.fileName,
      fileType: fileData?.fileType,
    });

    input.value = "";
    clearFileSelection();
  } catch (error) {
    console.error("Error sending message:", error);
    alert("Failed to send message. Please try again.");
  }
}

document.getElementById("file-input").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (file) {
    selectedFile = file;
    document.getElementById("file-name").textContent = file.name;
    document.getElementById("file-preview").classList.remove("hidden");
  }
});

function clearFileSelection() {
  selectedFile = null;
  document.getElementById("file-input").value = "";
  document.getElementById("file-preview").classList.add("hidden");
  document.getElementById("file-name").textContent = "";
}

socket.on("message-error", (error) => {
  console.error("Message error:", error);
  alert("Failed to send message. Please try again.");
});

// Handle Enter key in message input
document.getElementById("message-input").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const picker = document.createElement("emoji-picker");
  document.getElementById("emoji-picker").appendChild(picker);

  // Handle emoji selection
  picker.addEventListener("emoji-click", (event) => {
    const messageInput = document.getElementById("message-input");
    const emoji = event.detail.unicode;
    messageInput.value += emoji;
    document.getElementById("emoji-picker").classList.add("hidden");
  });

  // Toggle emoji picker
  document.getElementById("emoji-button").addEventListener("click", () => {
    document.getElementById("emoji-picker").classList.toggle("hidden");
  });

  // Close emoji picker when clicking outside
  document.addEventListener("click", (event) => {
    const emojiPicker = document.getElementById("emoji-picker");
    const emojiButton = document.getElementById("emoji-button");
    if (
      !emojiPicker.contains(event.target) &&
      !emojiButton.contains(event.target)
    ) {
      emojiPicker.classList.add("hidden");
    }
  });
});

document.addEventListener("click", (event) => {
  const emojiPanel = document.getElementById("emoji-panel");
  const emojiButton = event.target.closest(".emoji-container button");

  if (!emojiButton && !event.target.closest(".emoji-panel")) {
    emojiPanel.classList.add("hidden");
  }
});
