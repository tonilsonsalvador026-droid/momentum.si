const jwt = require("jsonwebtoken");

function authMiddleware(requiredRole = null) {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
      return res.status(401).json({ error: "Token não fornecido." });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Token inválido." });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;

      // Se a rota exigir uma role específica (ex: "admin")
if (requiredRole && decoded.role.toLowerCase() !== requiredRole.toLowerCase()) {
  console.log("Acesso negado: role do utilizador =>", decoded.role, " | role exigida =>", requiredRole);
  return res.status(403).json({ error: "Permissão negada." });
}

      next();
    } catch (err) {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }
  };
}

module.exports = authMiddleware;