// server.js
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const User = require("./models/User");
const Message = require("./models/Message");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create a safe filename
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      uniqueSuffix + "-" + file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")
    );
  },
});

const fileFilter = (req, file, cb) => {
  // Add file type restrictions if needed
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type"), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter,
});

// Session configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: false,
    httpOnly: true,
  },
});

app.use(sessionMiddleware);

// Authentication middleware
const authenticateUser = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Routes
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const user = new User({ username, password });
    await user.save();

    req.session.userId = user._id;
    req.session.username = user.username;
    await req.session.save(); // Ensure session is saved

    res.json({
      message: "Registration successful",
      userId: user._id,
      username: user.username,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    req.session.userId = user._id;
    req.session.username = user.username;
    await req.session.save(); // Ensure session is saved

    res.json({
      message: "Login successful",
      userId: user._id,
      username: user.username,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ message: "Logged out successfully" });
});

// Socket.IO handling
const userSockets = new Map();

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

app.post("/api/upload", authenticateUser, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    fileUrl,
    fileName: req.file.originalname,
    fileType: req.file.mimetype,
  });
});

io.use((socket, next) => {
  if (socket.request.session && socket.request.session.userId) {
    socket.userId = socket.request.session.userId;
    next();
  } else {
    next(new Error("Authentication failed"));
  }
});

io.on("connection", async (socket) => {
  console.log("User connected:", socket.userId);

  socket.on("join-room", async (room) => {
    socket.join(room);
    console.log(`User ${socket.userId} joined room ${room}`);

    try {
      // Load previous messages
      const messages = await Message.find({ room })
        .populate("sender", "username")
        .sort("-createdAt")
        .limit(50);

      socket.emit("previous-messages", messages.reverse());
    } catch (error) {
      console.error("Error loading messages:", error);
    }
  });

  socket.on("leave-room", (room) => {
    socket.leave(room);
    console.log(`User ${socket.userId} left room ${room}`);
  });

  socket.on("send-message", async (data) => {
    try {
      const { content, room, fileUrl, fileName, fileType } = data;

      // Create and save the message
      const message = new Message({
        sender: socket.userId,
        content: content || "",
        room: room,
        fileUrl: fileUrl,
        fileName: fileName,
        fileType: fileType,
      });

      await message.save();
      console.log("Message saved:", message);

      // Populate the sender information before broadcasting
      const populatedMessage = await Message.findById(message._id).populate(
        "sender",
        "username"
      );

      io.to(room).emit("new-message", populatedMessage);
    } catch (error) {
      console.error("Error sending message:", error);
      socket.emit("message-error", "Failed to send message");
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.userId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
