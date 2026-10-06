import type { RequestHandler } from "express";
import { OrganizationRole } from "../../../generated/prisma/enums";
import { AppError } from "../../utils/AppError";
import {
  acceptInvitation,
  createOrganization,
  getOrganization,
  inviteMember,
  listMyInvitations,
  listOrganizationMembers,
  listOrganizations,
  updateMemberRole,
} from "./organizations.service";

function authenticatedUserId(req: Parameters<RequestHandler>[0]): string {
  const userId = req.auth?.userId;
  if (!userId) throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  return userId;
}

function activeOrganization(req: Parameters<RequestHandler>[0]) {
  const organization = req.organization;
  if (!organization) {
    throw new AppError("Organization access was not authorized", 403, "FORBIDDEN");
  }
  return organization;
}

function routeParam(req: Parameters<RequestHandler>[0], name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("A valid route parameter is required", 400, "VALIDATION_ERROR");
  }
  return value;
}

export const create: RequestHandler = async (req, res, next) => {
  try {
    const organization = await createOrganization(authenticatedUserId(req), req.body.name);
    res.status(201).json({ organization });
  } catch (error) {
    next(error);
  }
};

export const list: RequestHandler = async (req, res, next) => {
  try {
    res.json({ organizations: await listOrganizations(authenticatedUserId(req)) });
  } catch (error) {
    next(error);
  }
};

export const get: RequestHandler = async (req, res, next) => {
  try {
    res.json({ organization: await getOrganization(activeOrganization(req).id) });
  } catch (error) {
    next(error);
  }
};

export const listMembers: RequestHandler = async (req, res, next) => {
  try {
    res.json({ members: await listOrganizationMembers(activeOrganization(req).id) });
  } catch (error) {
    next(error);
  }
};

export const listInvitations: RequestHandler = async (req, res, next) => {
  try {
    res.json({ invitations: await listMyInvitations(authenticatedUserId(req)) });
  } catch (error) {
    next(error);
  }
};

export const invite: RequestHandler = async (req, res, next) => {
  try {
    const organization = activeOrganization(req);
    if (organization.role === OrganizationRole.ADMIN && req.body.role === OrganizationRole.ADMIN) {
      throw new AppError("Admins can only invite regular members", 403, "FORBIDDEN");
    }
    const membership = await inviteMember(
      organization.id,
      authenticatedUserId(req),
      req.body.email,
      req.body.role,
    );
    res.status(201).json({ invitation: membership });
  } catch (error) {
    next(error);
  }
};

export const accept: RequestHandler = async (req, res, next) => {
  try {
    const membership = await acceptInvitation(
      routeParam(req, "organizationId"),
      routeParam(req, "membershipId"),
      authenticatedUserId(req),
    );
    res.json({ membership });
  } catch (error) {
    next(error);
  }
};

export const updateRole: RequestHandler = async (req, res, next) => {
  try {
    const organization = activeOrganization(req);
    const membership = await updateMemberRole(
      organization.id,
      routeParam(req, "membershipId"),
      { userId: authenticatedUserId(req), role: organization.role },
      req.body.role,
    );
    res.json({ membership });
  } catch (error) {
    next(error);
  }
};
