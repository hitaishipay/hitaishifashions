const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require("path");
require("dotenv").config();
require("./db");

const app = express();

// ✅ CORS FIRST
app.use(
  cors({
    origin: "http://localhost:5500",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// ✅ Then security and parsers
app.use(helmet());
app.use(bodyParser.json());
app.use(cookieParser());

// ✅ CORS headers for images
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
});

// ✅ API routes FIRST (before static)
const registerRoute = require("./routes/register");
const contactusRoute = require("./routes/contactus");
const productsRoute = require("./routes/products");

app.use("/api", registerRoute);
app.use("/api", contactusRoute);
app.use("/api", productsRoute);

// ✅ Static uploads
app.use(
  "/uploads",
  cors({
    origin: "http://localhost:5500",
    credentials: true,
  }),
  express.static(path.join(__dirname, "uploads"))
);

// ✅ Static frontend LAST
app.use(express.static(path.join(__dirname, "public")));

// ✅ Fallback (optional)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

// ✅ Start server
app.listen(5000, () => console.log("🚀 Server running on http://localhost:5000"));
