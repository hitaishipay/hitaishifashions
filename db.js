// db.js
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "localhost",           // your MySQL host
  user: "root",                // your MySQL username
  password: "2142",            // your MySQL password
  database: "hitaishifashions", // your database name
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

(async () => {
  try {
    const conn = await pool.getConnection();
    console.log("✅ Connected to MySQL Database!");
    conn.release();
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
  }
})();

module.exports = pool;
