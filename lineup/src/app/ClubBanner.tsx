import { CLUB_NAME, CLUB_URL } from "@/lib/brand";

/** Slim bar at the top of the homepage sending people to the club's real website. */
export default function ClubBanner() {
  return (
    <div className="club-banner" role="note">
      <span>Looking for the club itself?</span>{" "}
      <a href={CLUB_URL} rel="noopener">Visit the {CLUB_NAME} website →</a>
    </div>
  );
}
