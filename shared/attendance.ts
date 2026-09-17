export type AttendanceStatus =
  | "sat"
  | "no_show_or_reschedule"
  | "cancelled"
  | "rescheduled"
  | "awaiting_confirmation"
  | "upcoming";

export interface AttendanceResult {
  status: AttendanceStatus;
  reason: string;
  evidenceUrl?: string;
}

export interface AttendanceItem extends AttendanceResult {
  key: string;
  meetingId: string;
  dealId?: string;
  client: string;
  date: string;
  url?: string;
}

export const attendanceLabels: Record<AttendanceStatus, string> = {
  sat: "Sat",
  no_show_or_reschedule: "No-show / to reschedule",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  awaiting_confirmation: "Awaiting confirmation",
  upcoming: "Upcoming / in progress",
};
