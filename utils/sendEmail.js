const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

module.exports = async (to, subject, html) => {
  await transporter.sendMail({
    from: `"Accounting Portal" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
};
