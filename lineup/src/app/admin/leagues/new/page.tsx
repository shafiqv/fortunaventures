import { requireUser } from "@/lib/auth";
import CreateLeagueForm from "../../CreateLeagueForm";

export default async function NewLeague() {
  await requireUser();
  return (<><h1>New league</h1><CreateLeagueForm /></>);
}
