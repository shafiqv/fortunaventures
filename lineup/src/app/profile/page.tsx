import { requireUser } from "@/lib/auth";
import { saveProfile } from "../actions";

export default async function Profile() {
  const u = await requireUser();
  return (
    <>
      <h1>Your profile</h1>
      <form action={saveProfile} className="card">
        <label>Name</label><input name="name" defaultValue={u.name} required />
        <label>Email</label><input value={u.email} disabled />
        <label>Mobile (for text alerts)</label><input name="phone" type="tel" defaultValue={u.phone} placeholder="+14165550123" />
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input type="checkbox" name="sms" defaultChecked={!!u.sms_opt_in} style={{ width: "auto" }} />
          Yes, text me availability requests and spare offers. (Msg &amp; data rates may apply. You can turn this off any time.)
        </label>
        <p><button>Save</button></p>
      </form>
    </>
  );
}
