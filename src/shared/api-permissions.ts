export const API_PERMISSIONS = ["TRACE_READ", "LOTS_READ", "LOTS_WRITE", "ANALYTICS_READ"] as const;
export type ApiPermission = (typeof API_PERMISSIONS)[number];
