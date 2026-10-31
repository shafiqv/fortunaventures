/** Parse a roster pasted from Excel/Sheets: team header rows followed by rows of player names across columns. */
export function parseRoster(text: string) {
  const teams: { name: string; players: string[] }[] = [];
  const errors: string[] = [];
  const emoji = /\p{Extended_Pictographic}/u;
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split("\t").map((c) => c.trim());
    const nonEmpty = cells.filter(Boolean);
    if (!nonEmpty.length) continue;
    const single = nonEmpty.length === 1 && cells.findIndex(Boolean) === 0;
    const isHeader = single && (emoji.test(nonEmpty[0]) || nonEmpty[0].endsWith(":") || teams.length === 0);
    if (isHeader) { teams.push({ name: nonEmpty[0].replace(/:$/, "").trim(), players: [] }); continue; }
    if (!teams.length) { errors.push("Start with a team name row."); continue; }
    teams[teams.length - 1].players.push(...nonEmpty);
  }
  if (!teams.length) errors.push("No teams found.");
  return { teams: teams.filter((t) => t.players.length), errors };
}
