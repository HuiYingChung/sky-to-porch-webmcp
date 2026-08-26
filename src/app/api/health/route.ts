/**
 * Health-check API route.
 * Returns the service status and capability metadata.
 *
 * WP-05-004: liveData=true reflects the optional server-side historical NOAA
 * HMS live-retrieval capability. This means the capability exists, not that
 * NOAA is currently available or that the observation is current.
 * Returned observations are completed historical NOAA HMS daily data, never
 * an incomplete current-day product or real-time safety assessment.
 */
import { NextResponse } from "next/server";
import { CURRENT_STAGE } from "@/lib/foundation";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "sky-to-porch",
    stage: CURRENT_STAGE,
    liveData: true,
    liveDataNote:
      "Optional server-side historical NOAA HMS retrieval is available for fire/smoke queries. " +
      "liveData=true means the capability exists, not that NOAA is currently available or " +
      "that an observation is current. Supported live choices are Latest completed day, " +
      "Past 7 days, or a custom inclusive range of 1–7 UTC dates beginning 2005-08-05.",
    liveTimeOptions: ["latest_completed_day", "past_7d", "custom_1_to_7_utc_days"],
    liveCommonStartDate: "2005-08-05",
    liveMaxRangeDays: 7,
    ai: false,
  });
}
