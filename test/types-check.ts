import SolMarrow, { SolMarrowError, verifyWebhook, type Account } from "../index.js";
async function check(): Promise<void> {
  const sm = new SolMarrow({ apiKey: "smk_x" });
  const ws = await sm.listWorkspaces();
  const accts: Account[] = await sm.listAccounts(ws[0].id);
  await sm.createPost(ws[0].id, { text: "hi", accountIds: accts.map((a) => a.id), scheduleAt: new Date() });
  await sm.createDraft(ws[0].id, "draft");
  const e = new SolMarrowError("x", 400);
  const n: number = e.status;
  verifyWebhook("{}", "t=1,v1=x", "s");
  void n;
}
void check;
