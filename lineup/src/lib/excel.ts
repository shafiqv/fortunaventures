import ExcelJS from "exceljs";
import { gameState, leagueRounds, leagueTeams, membersOf } from "./service";
import { prettyWhen } from "./dates";
import type { League } from "./db";

/** First worksheet of an .xlsx as tab-separated text (feeds the same parsers as copy/paste). */
export async function xlsxToText(buf: ArrayBuffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return "";
  const lines: string[] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= Math.max(ws.columnCount, 1); c++) {
      const cell = row.getCell(c);
      if (cell.isMerged && cell.master.address !== cell.address) { cells.push(""); continue; } // merged header: only the first cell holds text
      const v = cell.value as unknown;
      cells.push(v == null ? "" : typeof v === "object" ? String((v as { text?: string; result?: unknown }).text ?? (v as { result?: unknown }).result ?? "") : String(v));
    }
    lines.push(cells.join("\t"));
  });
  return lines.join("\n");
}

/** Workbook for the organizer: "Rosters" mirrors his sheet layout; "Lineups" lists every upcoming match. */
export async function leagueWorkbook(league: League): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const teams = leagueTeams(league.id);

  const ros = wb.addWorksheet("Rosters");
  ros.columns = [{ width: 26 }, { width: 26 }, { width: 26 }];
  for (const t of teams) {
    const h = ros.addRow([t.name]);
    ros.mergeCells(h.number, 1, h.number, 3);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2A5B" } };
    h.alignment = { horizontal: "center" };
    const names = membersOf(t.id).map((m) => m.name || m.email);
    for (let i = 0; i < names.length; i += 3) ros.addRow(names.slice(i, i + 3));
  }

  const lu = wb.addWorksheet("Lineups");
  lu.addRow(["Date / time", "Team", "Opponent", "Courts", "Line", "Player 1", "Player 2", "Sitting out (in)", "Out", "No reply / maybe"]).font = { bold: true };
  lu.columns = [{ width: 22 }, { width: 22 }, { width: 22 }, { width: 8 }, { width: 6 }, { width: 22 }, { width: 22 }, { width: 34 }, { width: 28 }, { width: 28 }];
  for (const round of leagueRounds(league.id))
    for (const m of round.matchups)
      for (const g of m.games) {
        const { team, rows, lineup } = gameState(g.id);
        const nm = (id: number | null) => (id == null ? "OPEN" : rows.find((r) => r.user_id === id)?.name || rows.find((r) => r.user_id === id)?.email || "");
        const per = team.format === "doubles" ? 2 : 1;
        const lines = g.lines ?? team.lines;
        const out = rows.filter((r) => r.status === "out").map((r) => r.name || r.email).join(", ");
        const pend = rows.filter((r) => r.status === "none" || r.status === "maybe").map((r) => r.name || r.email).join(", ");
        for (let l = 1; l <= lines; l++) {
          const ps = lineup.slots.filter((s) => s.line === l).map((s) => nm(s.userId));
          lu.addRow([l === 1 ? prettyWhen(g.starts_at) : "", l === 1 ? team.name : "", l === 1 ? g.opponent : "", l === 1 ? lines : "", l, ps[0] ?? "", per > 1 ? ps[1] ?? "" : "",
            l === 1 ? lineup.bench.map(nm).join(", ") : "", l === 1 ? out : "", l === 1 ? pend : ""]);
        }
      }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
