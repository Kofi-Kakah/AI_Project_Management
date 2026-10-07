import type { RequestHandler } from "express";
import { prisma } from "../config/db";
import { AppError } from "../utils/AppError";

export const requirePlatformAdmin: RequestHandler = async (req, _res, next) => {
  const userId = req.auth?.userId;
  if (!userId) {
    next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true, disabledAt: true },
    });
    if (!user || user.disabledAt || !user.isPlatformAdmin) {
      next(
        new AppError(
          "Platform administrator access required",
          403,
          "FORBIDDEN",
        ),
      );
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
