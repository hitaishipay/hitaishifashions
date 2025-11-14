const express = require("express");
const router = express.Router();
const pool = require("../db");
const nodemailer = require("nodemailer");
const xss = require("xss");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

router.use(cookieParser());

  // ⚙️ Use environment variable or fallback
  const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey123";

// =================== REGISTER USER ===================
router.post("/register", async (req, res) => {
  try {
    let { firstName, lastName, email, password, confirmPassword } = req.body;

    // 🔒 XSS sanitization
    firstName = xss(firstName?.trim());
    lastName = xss(lastName?.trim());
    email = xss(email?.trim());
    password = xss(password?.trim());
    confirmPassword = xss(confirmPassword?.trim());

    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: "All fields are required." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const profileImage = "/uploads/profile-images/default.png";

    const connection = await pool.getConnection();

    // ✅ Create users table if not exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        firstName VARCHAR(100),
        lastName VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        password VARCHAR(255),
        profileImage VARCHAR(255) DEFAULT '/uploads/profile-images/default.png',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🔍 Check existing email
    const [existing] = await connection.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      connection.release();
      return res.status(409).json({ error: "Email already registered." });
    }

    // 🧾 Insert plain password (no hashing)
    await connection.query(
      "INSERT INTO users (firstName, lastName, email, password, profileImage) VALUES (?, ?, ?, ?, ?)",
      [firstName, lastName, email, password, profileImage]
    );

    // 🔍 Fetch newly created user
    const [rows] = await connection.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = rows[0];
    connection.release();

    // 🎫 Create JWT token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1d" });

    // 🍪 HttpOnly cookie (XSS-safe)
    res.cookie("authToken", token, {
      httpOnly: true,
      secure: false, // ✅ set true on HTTPS
      sameSite: "lax",
      path: "/api",      // 🔥 MUST MATCH LOGIN
      maxAge: 24 * 60 * 60 * 1000,
    });

    // ✉️ Welcome Email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "hitaishitrainings@gmail.com",
        pass: "pmer cxjx vlie xwud", // Gmail App Password
      },
    });

    await transporter.sendMail({
      from: "Hitaishi Fashion <hitaishitrainings@gmail.com>",
      to: email,
      subject: "Welcome to Hitaishi Fashion",
      text: `Hello ${firstName},\n\nThank you for registering with Hitaishi Fashion!\n\nBest Regards,\nTeam Hitaishi`,
    });

    // ✅ Success Response (for localStorage)
    res.status(200).json({
      message: "Registration successful! Email sent.",
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profileImage: user.profileImage,
      },
    });
  } catch (err) {
    console.error("❌ Register Error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
// =================== GET LOGGED-IN USER ===================
// ✅ GET LOGGED-IN USER (fixed)
router.get("/user", async (req, res) => {
  const token = req.cookies.authToken; // ✅ correct cookie name
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.query(
      "SELECT id, firstName, lastName, email, profileImage FROM users WHERE id = ?",
      [decoded.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: "User not found" });

    res.json(rows[0]); // ✅ return user
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
});



// =================== LOGIN ===================
router.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body;

    email = xss(email?.trim());
    password = xss(password?.trim());

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = rows[0];
    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // 🎫 Generate token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1d" });

    // 🍪 HttpOnly cookie
    res.cookie("authToken", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/api",      // 🔥 MUST MATCH LOGIN
      maxAge: 24 * 60 * 60 * 1000,
    });

    // 💾 Send token + user to frontend for localStorage
    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profileImage: user.profileImage || "/uploads/default-profile.png",
      },
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// =================== LOGOUT ===================
router.post("/logout", (req, res) => {
  res.clearCookie("authToken", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/api",      // 🔥 MUST MATCH LOGIN
  });
  res.json({ message: "Logged out successfully." });
});

// =================== AUTH CHECK ===================
router.get("/check-auth", async (req, res) => {
  const token = req.cookies.authToken;
  if (!token) return res.status(401).json({ error: "Not logged in" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.query(
      "SELECT id, firstName, lastName, email, profileImage FROM users WHERE id = ?",
      [decoded.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });

    res.json({ loggedIn: true, user: rows[0] });
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

module.exports = router;
