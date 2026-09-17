import type { AttendanceStatus } from "../../shared/attendance";

export interface AttendanceReview {
  meetingId: string;
  dealId: string;
  startTime: string;
  status: AttendanceStatus;
  noteId: string;
  reviewedAt: string;
}

// Evidence-reviewed corrections only, not name matching or keyword inference.
// IDs deliberately replace names/note bodies: keep personal details in HubSpot.
// Each review is bound to the exact meeting, deal AND start time so it cannot
// leak onto an earlier no-show or a later rebooked appointment.
// Reviewed against strategist notes on 17 September 2026; no CRM writes.
export const attendanceReviews: readonly AttendanceReview[] = [
  {
    meetingId: "329071457765",
    dealId: "292486212081",
    startTime: "2026-09-16T05:30:00Z",
    status: "sat",
    noteId: "329486288332",
    reviewedAt: "2026-09-17",
  },
  {
    meetingId: "328319620576",
    dealId: "291721061872",
    startTime: "2026-09-15T03:00:00Z",
    status: "cancelled",
    noteId: "329082423800",
    reviewedAt: "2026-09-17",
  },
  {
    meetingId: "328334974403",
    dealId: "286658721249",
    startTime: "2026-09-15T04:00:00Z",
    status: "rescheduled",
    noteId: "328922594779",
    reviewedAt: "2026-09-17",
  },
];
