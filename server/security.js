const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/*
ROLE PRIORITY
Higher number = more permissions
*/
const rolePriority = {
  OWNER: 5,
  ADMIN: 4,
  DEVELOPER: 3,
  REVIEWER: 2,
  VIEWER: 1
};

/*
----------------------------------------
AUTHENTICATION MIDDLEWARE
----------------------------------------
Checks if the user is logged in
*/
function authenticate(req, res, next) {

  const header = req.headers["authorization"];

  if (!header) {
    return res.status(401).json({
      error: "Authorization token required"
    });
  }

  const token = header.split(" ")[1];

  try {

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();

  } catch (err) {

    return res.status(403).json({
      error: "Invalid token"
    });

  }

}

/*
----------------------------------------
RBAC PERMISSION CHECK
----------------------------------------
Ensures user has required role
*/
function requireRole(minRole) {

  return async function (req, res, next) {

    const projectId = parseInt(req.params.projectId);
    const userId = req.user.id;

    const membership = await prisma.projectMember.findFirst({
      where: {
        userId: userId,
        projectId: projectId
      }
    });

    if (!membership) {

      await writeAudit({
        userId,
        projectId,
        action: "ACCESS_ATTEMPT",
        status: "DENIED",
        message: "User not a project member"
      });

      return res.status(403).json({
        error: "Not a project member"
      });

    }

    if (rolePriority[membership.role] < rolePriority[minRole]) {

      await writeAudit({
        userId,
        projectId,
        action: "ACCESS_ATTEMPT",
        status: "DENIED",
        message: "Insufficient permissions"
      });

      return res.status(403).json({
        error: "Insufficient permissions"
      });

    }

    req.role = membership.role;

    next();

  };

}

/*
----------------------------------------
AUDIT LOG FUNCTION
----------------------------------------
Stores all important actions
*/
async function writeAudit({
  userId,
  projectId,
  action,
  status,
  branch,
  commitId,
  message
}) {

  try {

    await prisma.auditLog.create({
      data: {
        userId,
        projectId,
        action,
        status,
        branch,
        commitId,
        message
      }
    });

  } catch (err) {

    console.error("Audit log failed:", err.message);

  }

}

module.exports = {
  authenticate,
  requireRole,
  writeAudit
};
