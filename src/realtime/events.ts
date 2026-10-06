export const REALTIME_CLIENT_EVENTS = {
  joinOrganization: "organization:join",
  leaveOrganization: "organization:leave",
  joinProject: "project:join",
  leaveProject: "project:leave",
} as const;

export const REALTIME_SERVER_EVENTS = {
  taskCreated: "task:created",
  taskUpdated: "task:updated",
  taskDeleted: "task:deleted",
  commentCreated: "comment:created",
  commentUpdated: "comment:updated",
  commentDeleted: "comment:deleted",
  projectCreated: "project:created",
  projectUpdated: "project:updated",
  projectDeleted: "project:deleted",
  teamCreated: "team:created",
  teamUpdated: "team:updated",
  teamDeleted: "team:deleted",
  memberInvited: "member:invited",
  memberJoined: "member:joined",
  memberRoleUpdated: "member:role-updated",
} as const;
