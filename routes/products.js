const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");

// parsing middleware for text fields (multer handles files)
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// ✅ Create MySQL connection pool (adjust config if needed)
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "2142",
  database: "hitaishifashions",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Ensure table exists (unchanged)
(async () => {
  try {
    const connection = await pool.getConnection();
    await connection.query(`
     CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255),
      department VARCHAR(100),
      category VARCHAR(100),
      subcategory VARCHAR(100),
      fullCategory VARCHAR(255),
      brand VARCHAR(255),
      actualPrice DECIMAL(10,2),
      discount INT,
      finalPrice DECIMAL(10,2),
      stock INT,
      description TEXT,
      attributes JSON,
      images JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )

    `);
    connection.release();
  } catch (err) {
    console.error("Table creation error:", err);
  }
})();
// Upload new product (unchanged)
router.post("/upload-product", upload.array("images", 5), async (req, res) => {
  try {
    const {
      name,
      department,
      category,
      subcategory,
      brand,
      actualPrice,
      discount,
      finalPrice,
      stock,
      description,
      ...rest
    } = req.body;

    // ✅ Build full category hierarchy string
    let fullCategory = department || "";
    if (category) fullCategory += ` > ${category}`;
    if (subcategory) fullCategory += ` > ${subcategory}`;

    // ✅ Collect image paths
    const images = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const attributes = JSON.stringify(rest);

    // ✅ Insert into DB
    const sql = `
      INSERT INTO products 
      (name, department, category, subcategory, fullCategory, brand, actualPrice, discount, finalPrice, stock, description, attributes, images)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await pool.query(sql, [
      name,
      department || null,
      category || null,
      subcategory || null,
      fullCategory,
      brand,
      actualPrice,
      discount,
      finalPrice,
      stock,
      description,
      attributes,
      JSON.stringify(images),
    ]);

    res.json({ message: "✅ Product uploaded successfully!" });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Server error during upload" });
  }
});

// Fetch all products
router.get("/products", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// Fetch single product by id
router.get("/products/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await pool.query("SELECT * FROM products WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Fetch single error:", err);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

// Edit product - handle removedImages (JSON string), optional new uploads
router.put("/products/edit/:id", upload.array("images", 10), async (req, res) => {
  try {
    const { id } = req.params;
    // req.body may contain removedImages (JSON string or array) and other fields
    let {
      name,
      category,
      brand,
      actualPrice,
      discount,
      finalPrice,
      stock,
      description,
      attributes
    } = req.body;

    // Normalize numeric fields
    actualPrice = actualPrice || 0;
    finalPrice = finalPrice || 0;
    discount = discount || 0;
    stock = stock || 0;

    // Fetch current images
    const [rows] = await pool.query("SELECT images FROM products WHERE id = ?", [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: "Product not found" });
    let currentImages = rows[0].images || [];

    // Ensure parsed array
    try {
      if (typeof currentImages === "string") {
        currentImages = currentImages.startsWith("[") ? JSON.parse(currentImages) : [currentImages];
      }
    } catch {
      currentImages = Array.isArray(currentImages) ? currentImages : [currentImages].filter(Boolean);
    }

    // Handle removedImages sent from frontend: can be JSON string or comma-separated
    let removedImages = [];
    if (req.body.removedImages) {
      try {
        removedImages = typeof req.body.removedImages === "string" ? JSON.parse(req.body.removedImages) : req.body.removedImages;
      } catch {
        // fallback: comma separated
        removedImages = (req.body.removedImages || "").split(",").map(s => s.trim()).filter(Boolean);
      }
    }

    // Remove files physically for those in removedImages (safety: only delete files that start with /uploads)
    for (const r of removedImages) {
      try {
        // r might be like "/uploads/123.jpg" or "uploads/123.jpg" or "123.jpg"
        let filenamePath = r;
        if (!filenamePath.startsWith("/")) filenamePath = "/" + filenamePath;
        if (!filenamePath.startsWith("/uploads")) {
          // if only filename provided, transform
          if (path.basename(filenamePath)) filenamePath = `/uploads/${path.basename(filenamePath)}`;
        }
        const fullFsPath = path.join(process.cwd(), filenamePath);
        // Only delete if the file exists and is inside uploads folder
        if (fullFsPath.includes(path.join(process.cwd(), "uploads"))) {
          if (fs.existsSync(fullFsPath)) fs.unlinkSync(fullFsPath);
        }
      } catch (err) {
        console.warn("Could not delete file:", r, err.message);
      }
    }

    // Filter currentImages removing any removedImages entries
    const normalizedRemoved = removedImages.map(r => {
      if (!r) return "";
      return r.startsWith("/uploads") ? r : (r.startsWith("/") ? r : `/uploads/${path.basename(r)}`);
    });
    currentImages = currentImages.filter(ci => !normalizedRemoved.includes(ci) && !normalizedRemoved.includes(path.basename(ci)));

    // Handle newly uploaded files (replace/append)
    const uploaded = (req.files || []).map(f => `/uploads/${f.filename}`);
    // Strategy: append newly uploaded images to the remaining currentImages
    const finalImages = [...currentImages, ...uploaded];

    await pool.query(
      `UPDATE products SET name=?, category=?, brand=?, actualPrice=?, discount=?, finalPrice=?, stock=?, description=?, attributes=?, images=? WHERE id=?`,
      [
        name || null,
        category || null,
        brand || null,
        parseFloat(actualPrice) || 0,
        parseInt(discount) || 0,
        parseFloat(finalPrice) || 0,
        parseInt(stock) || 0,
        description || null,
        attributes || "{}",
        JSON.stringify(finalImages),
        id,
      ]
    );

    res.json({ message: "Product updated successfully!", images: finalImages });
  } catch (err) {
    console.error("Edit error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

// Endpoint to delete a single image from product and filesystem
// Accepts body { filename: "uploads/xxx.jpg" } or query param ?filename=...
router.delete("/products/image/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const filename = req.body.filename || req.query.filename;
    if (!filename) return res.status(400).json({ error: "filename required" });

    // Normalize path: ensure it starts with /uploads
    let filePath = filename;
    if (!filePath.startsWith("/uploads")) {
      // allow "uploads/..." or basename
      filePath = filePath.startsWith("/") ? filePath : `/${filePath}`;
      if (!filePath.startsWith("/uploads")) filePath = `/uploads/${path.basename(filePath)}`;
    }

    // remove physical file if exists
    const fullFsPath = path.join(process.cwd(), filePath);
    if (fullFsPath.includes(path.join(process.cwd(), "uploads")) && fs.existsSync(fullFsPath)) {
      fs.unlinkSync(fullFsPath);
    }

    // Update DB: remove this filename from images JSON
    const [rows] = await pool.query("SELECT images FROM products WHERE id = ?", [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: "Product not found" });
    let currentImages = rows[0].images || [];
    try {
      if (typeof currentImages === "string") {
        currentImages = currentImages.startsWith("[") ? JSON.parse(currentImages) : [currentImages];
      }
    } catch {
      currentImages = Array.isArray(currentImages) ? currentImages : [currentImages].filter(Boolean);
    }
    const filtered = currentImages.filter(ci => {
      // compare basename and full path
      return path.basename(ci) !== path.basename(filePath) && ci !== filePath && ci !== filePath.replace(/^\//, "");
    });

    await pool.query("UPDATE products SET images = ? WHERE id = ?", [JSON.stringify(filtered), id]);

    res.json({ message: "Image removed", images: filtered });
  } catch (err) {
    console.error("Delete image error:", err);
    res.status(500).json({ error: "Failed to delete image" });
  }
});

// Delete product (unchanged)
router.delete("/products/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // delete image files as well
    const [rows] = await pool.query("SELECT images FROM products WHERE id = ?", [id]);
    if (rows && rows[0] && rows[0].images) {
      let currentImages = rows[0].images;
      try {
        currentImages = typeof currentImages === "string" ? JSON.parse(currentImages) : currentImages;
      } catch {
        currentImages = Array.isArray(currentImages) ? currentImages : [currentImages].filter(Boolean);
      }
      for (const ci of currentImages) {
        try {
          let fp = ci;
          if (!fp.startsWith("/")) fp = `/${fp}`;
          if (!fp.startsWith("/uploads")) fp = `/uploads/${path.basename(fp)}`;
          const fullFsPath = path.join(process.cwd(), fp);
          if (fullFsPath.includes(path.join(process.cwd(), "uploads")) && fs.existsSync(fullFsPath)) {
            fs.unlinkSync(fullFsPath);
          }
        } catch(e) { /* ignore */ }
      }
    }

    await pool.query("DELETE FROM products WHERE id=?", [id]);
    res.json({ message: "Product deleted successfully!" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});
router.get("/products/related", async (req, res) => {
  const name = req.query.name || "";
  const keyword = name.split(" ")[0]; // use first word for better match

  try {
    const [rows] = await pool.query(
      "SELECT id, name, price, brand, image FROM products WHERE name LIKE ? LIMIT 6",
      [`%${keyword}%`]
    );

    // Always return an array (even empty)
    res.json(rows);
  } catch (err) {
    console.error("Error fetching related products:", err);
    res.status(500).json({ error: "Failed to fetch related products" });
  }
});



module.exports = router;
