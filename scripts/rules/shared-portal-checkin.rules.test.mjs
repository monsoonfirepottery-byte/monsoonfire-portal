import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
let env;
const db = (uid) => env.authenticatedContext(uid).firestore();
before(async () => {
  env = await initializeTestEnvironment({ projectId: `rules-shared-${Date.now()}`, firestore: { host, port: Number(port), rules: readFileSync(resolve("firestore.rules"), "utf8") } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await setDoc(doc(admin, "monsoonfireCheckin/v1/userProfiles/owner"), { role: "owner" });
    await setDoc(doc(admin, "profiles/maker"), { displayName: "Maker", membershipTier: "Apprentice", updatedAt: new Date() });
    await setDoc(doc(admin, "profiles/without-tier"), { displayName: "Maker", updatedAt: new Date() });
    await setDoc(doc(admin, "profiles/legacy"), { displayName: "Maker", membershipTier: "Legacy historical tier", updatedAt: new Date() });
    await setDoc(doc(admin, "profiles/legacy-null"), { displayName: "Maker", membershipTier: null, updatedAt: new Date() });
  });
});
after(async () => { await env.cleanup(); });

describe("shared Portal and Check-in rules", () => {
  it("allows a client to create and read their appointment but denies other clients", async () => {
    const path = "monsoonfireCheckin/v1/appointments/one";
    const appointment = { clientUID: "maker", clientName: "Maker", kind: "dropoff", title: "Pottery", itemCount: 1, serviceMode: "humanAssisted", windowLabel: "Morning", status: "scheduled", updatedAt: new Date() };
    await assertSucceeds(setDoc(doc(db("maker"), path), appointment));
    await assertSucceeds(getDoc(doc(db("maker"), path)));
    await assertFails(getDoc(doc(db("other"), path)));
    await assertFails(setDoc(doc(db("other"), "monsoonfireCheckin/v1/appointments/two"), appointment));
    await assertSucceeds(getDoc(doc(db("owner"), path)));
  });
  it("blocks self-escalation and protects billing data from clients and staff", async () => {
    await assertFails(setDoc(doc(db("maker"), "monsoonfireCheckin/v1/userProfiles/maker"), { role: "owner", updatedAt: new Date() }));
    await assertSucceeds(setDoc(doc(db("maker"), "monsoonfireCheckin/v1/userProfiles/maker"), { role: "client", displayName: "Maker", updatedAt: new Date() }));
    await assertFails(setDoc(doc(db("newmaker"), "profiles/newmaker"), { membershipTier: "Master", updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db("maker"), "profiles/maker"), { membershipTier: "Master", updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db("maker"), "profiles/maker"), { membershipTier: deleteField(), updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db("without-tier"), "profiles/without-tier"), { membershipTier: "Master", updatedAt: new Date() }));
    await assertSucceeds(updateDoc(doc(db("legacy"), "profiles/legacy"), { displayName: "Updated legacy", updatedAt: new Date() }));
    await assertSucceeds(updateDoc(doc(db("legacy-null"), "profiles/legacy-null"), { displayName: "Updated legacy", updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db("legacy"), "profiles/legacy"), { membershipTier: "Master", updatedAt: new Date() }));
    await assertSucceeds(updateDoc(doc(db("maker"), "profiles/maker"), { displayName: "Maker Updated", updatedAt: new Date() }));
    await assertFails(getDoc(doc(db("maker"), "billingAccounts/maker")));
    await assertFails(getDoc(doc(env.authenticatedContext("staff", { staff: true }).firestore(), "firingTickets/ticket")));
  });
  it("allows only the check-in owner to manage windows and private owner alerts", async () => {
    const window = "monsoonfireCheckin/v1/studioWindows/window";
    const alert = "monsoonfireCheckin/v1/ownerAlerts/alert";
    await assertSucceeds(setDoc(doc(db("owner"), window), { isActive: true }));
    await assertSucceeds(getDoc(doc(db("maker"), window)));
    await assertFails(setDoc(doc(db("maker"), window), { isActive: false }));
    await assertSucceeds(setDoc(doc(db("owner"), alert), { message: "Fixture" }));
    await assertFails(getDoc(doc(db("maker"), alert)));
  });
});
