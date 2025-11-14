const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const xss = require("xss");

// 📨 Configure your email sender
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "hitaishitrainings@gmail.com", // your email
    pass: "pmer cxjx vlie xwud"          // use Gmail App Password
  }
});

router.post("/contact", async (req, res) => {
  try {
    const name = xss(req.body.name);
    const email = xss(req.body.email);
    const subject = xss(req.body.subject);
    const message = xss(req.body.message);

    // 💌 Email to your team
    const mailOptions = {
      from: `"${name}" <${email}>`,
      to: "info@hitaishifashion.com",
      subject: `New Contact Message: ${subject}`,
      html: `
        <h3>New Contact Form Message</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `
    };

    // 💌 Auto-confirmation email to user
    const userMail = {
      from: "info@hitaishifashion.com",
      to: email,
      subject: "We received your message!",
      html: `
        <p>Hi ${name},</p>
        <p>Thank you for reaching out to <strong>Hitaishi Fashion</strong>! We’ve received your message and our team will get back to you shortly.</p>
        <p><strong>Your Message:</strong></p>
        <p>${message}</p>
        <br>
        <p>Warm regards,<br>Team Hitaishi Fashion</p>
      `
    };

    await transporter.sendMail(mailOptions);
    await transporter.sendMail(userMail);

    res.status(200).json({ success: true, message: "Message sent successfully!" });
  } catch (err) {
    console.error("❌ Email send error:", err);
    res.status(500).json({ success: false, message: "Failed to send message. Please try again later." });
  }
});

module.exports = router;
