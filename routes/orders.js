const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

router.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey123";

/* =====================================================
    CREATE orders + order_items TABLES IF NOT EXISTS
===================================================== */
(async () => {
  try {
    const conn = await pool.getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        totalAmount DECIMAL(10,2) NOT NULL,
        paymentMethod VARCHAR(50),
        address JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orderId INT NOT NULL,
        productId INT NOT NULL,
        name VARCHAR(255),
        price DECIMAL(10,2),
        quantity INT,
        image VARCHAR(255),
        FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
      );
    `);

    conn.release();
    console.log("✅ Orders tables ready");
  } catch (err) {
    console.error("❌ Error creating orders tables:", err);
  }
})();

/* =====================================================
    AUTH MIDDLEWARE
===================================================== */
function authMiddleware(req, res, next) {
  const token = req.cookies.authToken;
  if (!token) return res.status(401).json({ error: "Not logged in" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // user.id, user.email
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* =====================================================
    PLACE ORDER  → POST /api/orders
===================================================== */
router.post("/orders", authMiddleware, async (req, res) => {
  try {
    const { items, totalAmount, address, paymentMethod } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items in order" });
    }

    const conn = await pool.getConnection();

    // Insert into orders table
    const [orderResult] = await conn.query(
      `INSERT INTO orders (userId, totalAmount, paymentMethod, address) 
       VALUES (?, ?, ?, ?)`,
      [
        req.user.id,
        totalAmount,
        paymentMethod,
        JSON.stringify(address)
      ]
    );

    const orderId = orderResult.insertId;

    // Insert each item
    const orderItemsData = items.map(item => [
      orderId,
      item.id || 0,
      item.name || "",
      item.price || item.finalPrice || 0,
      item.quantity || 1,
      item.image || ""
    ]);

    await conn.query(
      `INSERT INTO order_items (orderId, productId, name, price, quantity, image)
       VALUES ?`,
      [orderItemsData]
    );

    conn.release();

    res.json({
      message: "Order placed successfully",
      orderId,
    });

  } catch (err) {
    console.error("❌ Order error:", err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

/* =====================================================
    GET ALL ORDERS OF LOGGED-IN USER
    GET /api/orders/my
===================================================== */
router.get("/orders/my", authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM orders WHERE userId = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load orders" });
  }
});

/* =====================================================
    GET SINGLE ORDER WITH ITEMS
    GET /api/orders/:id
===================================================== */
router.get("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;

    // order data
    const [orderRows] = await pool.query(
      `SELECT * FROM orders WHERE id = ?`,
      [orderId]
    );
    if (orderRows.length === 0)
      return res.status(404).json({ error: "Order not found" });

    // order items
    const [items] = await pool.query(
      `SELECT * FROM order_items WHERE orderId = ?`,
      [orderId]
    );

    res.json({
      order: orderRows[0],
      items,
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

module.exports = router;
