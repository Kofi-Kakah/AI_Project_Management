import type { RequestHandler } from "express";
import {
  MembershipStatus,
  type OrganizationRole,
  type OrganizationRole as OrganizationRoleType,
} from "../../generated/prisma/enums";
import { prisma } from "../config/db";
import { AppError } from "../utils/AppError";

declare global {
  namespace Express {
    interface Request {
      organization?: {
        id: string;
        userId: string;
        role: OrganizationRoleType;
      };
    }
  }
}

export function requireOrganizationRole(
  allowedRoles?: readonly OrganizationRole[],
): RequestHandler {
  return async (req, _res, next) => {
    const userId = req.auth?.userId;
    if (!userId) {
      next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
      return;
    }

    const organizationId = req.params.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      next(new AppError("Organization ID is required", 400, "VALIDATION_ERROR"));
      return;
    }

    try {
      const membership = await prisma.membership.findUnique({
        where: {
          organizationId_userId: { organizationId, userId },
        },
        select: { organizationId: true, userId: true, role: true, status: true },
      });

      if (!membership || membership.status !== MembershipStatus.ACTIVE) {
        next(new AppError("Organization not found", 404, "NOT_FOUND"));
        return;
      }
      if (allowedRoles && !allowedRoles.includes(membership.role)) {
        next(new AppError("Insufficient organization permissions", 403, "FORBIDDEN"));
        return;
      }

      req.organization = {
        id: membership.organizationId,
        userId: membership.userId,
        role: membership.role,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
