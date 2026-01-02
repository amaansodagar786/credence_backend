const adminMiddleware = (req, res, next) => {
  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Admin access only" });
  }
  next();
};

module.exports = adminMiddleware;
