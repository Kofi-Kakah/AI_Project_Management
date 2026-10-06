import { randomBytes } from "node:crypto";
import {
  MembershipStatus,
  OrganizationRole,
  type OrganizationRole as OrganizationRoleType,
} from "../../../generated/prisma/enums";
import { prisma } from "../../config/db";
import { AppError } from "../../utils/AppError";

function slugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 88)
    .replace(/-+$/g, "");
  return slug || "organization";
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createOrganization(userId: string, name: string) {
  const slug = `${slugBase(name)}-${randomBytes(4).toString("hex")}`;
  try {
    return await prisma.organization.create({
      data: {
        name,
        slug,
        memberships: {
          create: {
            userId,
            role: OrganizationRole.OWNER,
            status: MembershipStatus.ACTIVE,
            joinedAt: new Date(),
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        memberships: {
          where: { userId, status: MembershipStatus.ACTIVE },
          select: { id: true, role: true, status: true, joinedAt: true },
        },
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError("An organization with this slug already exists", 409, "ORGANIZATION_CONFLICT");
    }
    throw error;
  }
}

export async function listOrganizations(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: MembershipStatus.ACTIVE },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      joinedAt: true,
      organization: {
        select: { id: true, name: true, slug: true, createdAt: true },
      },
    },
  });
  return memberships.map(({ role, joinedAt, organization }) => ({ ...organization, role, joinedAt }));
}

export async function getOrganization(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true },
  });
  if (!organization) throw new AppError("Organization not found", 404, "NOT_FOUND");
  return organization;
}

export async function listOrganizationMembers(organizationId: string) {
  return prisma.membership.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      role: true,
      status: true,
      joinedAt: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true, avatarUrl: true } },
    },
  });
}

export async function listMyInvitations(userId: string) {
  return prisma.membership.findMany({
    where: { userId, status: MembershipStatus.INVITED },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      organization: { select: { id: true, name: true, slug: true } },
      invitedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function inviteMember(
  organizationId: string,
  invitedById: string,
  email: string,
  role: OrganizationRoleType,
) {
  const invitedUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, emailVerifiedAt: true, disabledAt: true },
  });
  if (!invitedUser || !invitedUser.emailVerifiedAt || invitedUser.disabledAt) {
    throw new AppError("A verified account for this email was not found", 404, "USER_NOT_FOUND");
  }

  const existing = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: invitedUser.id } },
    select: { id: true, status: true },
  });
  if (existing) {
    throw new AppError("This user already has a membership in the organization", 409, "MEMBERSHIP_EXISTS");
  }

  try {
    return await prisma.membership.create({
      data: {
        organizationId,
        userId: invitedUser.id,
        invitedById,
        role,
        status: MembershipStatus.INVITED,
      },
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError("This user already has a membership in the organization", 409, "MEMBERSHIP_EXISTS");
    }
    throw error;
  }
}

export async function acceptInvitation(organizationId: string, membershipId: string, userId: string) {
  const accepted = await prisma.membership.updateMany({
    where: {
      id: membershipId,
      organizationId,
      userId,
      status: MembershipStatus.INVITED,
    },
    data: { status: MembershipStatus.ACTIVE, joinedAt: new Date() },
  });
  if (accepted.count !== 1) {
    throw new AppError("Invitation not found", 404, "NOT_FOUND");
  }

  return prisma.membership.findUniqueOrThrow({
    where: { id: membershipId },
    select: {
      id: true,
      role: true,
      status: true,
      joinedAt: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
}

export async function updateMemberRole(
  organizationId: string,
  membershipId: string,
  actor: { userId: string; role: OrganizationRoleType },
  role: OrganizationRoleType,
) {
  const target = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId, status: MembershipStatus.ACTIVE },
    select: { id: true, userId: true, role: true },
  });
  if (!target) throw new AppError("Member not found", 404, "NOT_FOUND");
  if (target.role === OrganizationRole.OWNER) {
    throw new AppError("The organization owner role cannot be changed here", 409, "OWNER_ROLE_PROTECTED");
  }
  if (actor.role === OrganizationRole.ADMIN && (target.role !== OrganizationRole.MEMBER || role !== OrganizationRole.MEMBER)) {
    throw new AppError("Admins can only manage regular members", 403, "FORBIDDEN");
  }
  if (target.userId === actor.userId && target.role !== role) {
    throw new AppError("You cannot change your own organization role", 403, "FORBIDDEN");
  }

  return prisma.membership.update({
    where: { id: target.id },
    data: { role },
    select: {
      id: true,
      role: true,
      status: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });
}
