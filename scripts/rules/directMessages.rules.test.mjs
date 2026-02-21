import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const [host, portText] = EMULATOR_HOST.split(":");
const port = Number(portText || "8085");
const projectId = `rules-directmessages-${Date.now()}`;

const RULES_PATH = resolve(process.cwd(), "firestore.rules");
const THREAD_FOR_MEMBER = "thread-member";
const THREAD_NOT_FOR_MEMBER = "thread-outsider";
const MEMBER_UID = "member-user";
const PEER_UID = "peer-user";
const OUTSIDER_UID = "outsider-user";
const STAFF_UID = "staff-user";

let testEnv;

function authedDb(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedDirectMessagesData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "directMessages", THREAD_FOR_MEMBER), {
      subject: "Member thread",
      kind: "support",
      participantUids: [MEMBER_UID, PEER_UID],
      createdAt: new Date("2026-02-01T10:00:00.000Z"),
      updatedAt: new Date("2026-02-01T12:00:00.000Z"),
      lastMessagePreview: "latest member thread preview",
      lastMessageAt: new Date("2026-02-01T12:00:00.000Z"),
      lastMessageId: "<msg-001@monsoonfire.local>",
      lastSenderName: "Member",
      lastSenderEmail: "member@example.com",
      references: [],
      lastReadAtByUid: {
        [MEMBER_UID]: new Date("2026-02-01T12:00:00.000Z"),
      },
    });

    await setDoc(doc(db, "directMessages", THREAD_NOT_FOR_MEMBER), {
      subject: "Outsider thread",
      kind: "direct",
      participantUids: ["another-user", "another-peer"],
      createdAt: new Date("2026-02-01T09:00:00.000Z"),
      updatedAt: new Date("2026-02-01T11:00:00.000Z"),
      lastMessagePreview: "latest outsider thread preview",
      lastMessageAt: new Date("2026-02-01T11:00:00.000Z"),
      lastMessageId: "<msg-002@monsoonfire.local>",
      lastSenderName: "Another User",
      lastSenderEmail: "another@example.com",
      references: [],
      lastReadAtByUid: {},
    });

    await setDoc(doc(db, "directMessages", THREAD_FOR_MEMBER, "messages", "msg-001"), {
      messageId: "<msg-001@monsoonfire.local>",
      subject: "Member thread",
      body: "hello member",
      fromUid: MEMBER_UID,
      fromName: "Member",
      fromEmail: "member@example.com",
      replyToEmail: "member@example.com",
      toUids: [PEER_UID],
      toEmails: ["peer@example.com"],
      sentAt: new Date("2026-02-01T12:00:00.000Z"),
      inReplyTo: null,
      references: [],
    });

    await setDoc(doc(db, "directMessages", THREAD_NOT_FOR_MEMBER, "messages", "msg-002"), {
      messageId: "<msg-002@monsoonfire.local>",
      subject: "Outsider thread",
      body: "hello outsider",
      fromUid: "another-user",
      fromName: "Another User",
      fromEmail: "another@example.com",
      replyToEmail: "another@example.com",
      toUids: ["another-peer"],
      toEmails: ["another-peer@example.com"],
      sentAt: new Date("2026-02-01T11:00:00.000Z"),
      inReplyTo: null,
      references: [],
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedDirectMessagesData();
});

after(async () => {
  await testEnv.cleanup();
});

describe("directMessages rules", () => {
  describe("thread visibility", () => {
    it("allows a participant to read a thread document", async () => {
      const db = authedDb(MEMBER_UID);
      await assertSucceeds(getDoc(doc(db, "directMessages", THREAD_FOR_MEMBER)));
    });

    it("denies non-participant thread reads", async () => {
      const db = authedDb(OUTSIDER_UID);
      await assertFails(getDoc(doc(db, "directMessages", THREAD_FOR_MEMBER)));
    });

    it("denies anonymous thread reads", async () => {
      const db = anonDb();
      await assertFails(getDoc(doc(db, "directMessages", THREAD_FOR_MEMBER)));
    });

    it("allows staff to read threads", async () => {
      const db = authedDb(STAFF_UID, { staff: true, roles: ["staff"] });
      await assertSucceeds(getDoc(doc(db, "directMessages", THREAD_NOT_FOR_MEMBER)));
    });

    it("allows participant filtered thread query and returns only authorized docs", async () => {
      const db = authedDb(MEMBER_UID);
      const threadsQuery = query(
        collection(db, "directMessages"),
        where("participantUids", "array-contains", MEMBER_UID),
        orderBy("lastMessageAt", "desc")
      );

      const snap = await assertSucceeds(getDocs(threadsQuery));
      const ids = snap.docs.map((docSnap) => docSnap.id);
      assert.deepEqual(ids, [THREAD_FOR_MEMBER]);
    });

    it("denies non-participant attempts to enumerate another user's threads", async () => {
      const db = authedDb(OUTSIDER_UID);
      const threadsQuery = query(
        collection(db, "directMessages"),
        where("participantUids", "array-contains", MEMBER_UID),
        orderBy("lastMessageAt", "desc")
      );
      await assertFails(getDocs(threadsQuery));
    });
  });

  describe("messages subcollection", () => {
    it("allows participants to read thread messages", async () => {
      const db = authedDb(MEMBER_UID);
      await assertSucceeds(getDoc(doc(db, "directMessages", THREAD_FOR_MEMBER, "messages", "msg-001")));
    });

    it("denies non-participant message reads", async () => {
      const db = authedDb(OUTSIDER_UID);
      await assertFails(getDoc(doc(db, "directMessages", THREAD_FOR_MEMBER, "messages", "msg-001")));
    });

    it("allows staff to read thread messages", async () => {
      const db = authedDb(STAFF_UID, { staff: true, roles: ["staff"] });
      await assertSucceeds(getDoc(doc(db, "directMessages", THREAD_NOT_FOR_MEMBER, "messages", "msg-002")));
    });

    it("allows participant message create in their thread", async () => {
      const db = authedDb(MEMBER_UID);
      const messagesRef = collection(db, "directMessages", THREAD_FOR_MEMBER, "messages");
      await assertSucceeds(
        addDoc(messagesRef, {
          messageId: "<msg-003@monsoonfire.local>",
          subject: "Member thread",
          body: "new message by participant",
          fromUid: MEMBER_UID,
          fromName: "Member",
          fromEmail: "member@example.com",
          replyToEmail: "member@example.com",
          toUids: [PEER_UID],
          toEmails: ["peer@example.com"],
          sentAt: new Date("2026-02-01T12:05:00.000Z"),
          inReplyTo: "<msg-001@monsoonfire.local>",
          references: [],
        })
      );
    });

    it("denies message create from non-participants", async () => {
      const db = authedDb(OUTSIDER_UID);
      const messagesRef = collection(db, "directMessages", THREAD_FOR_MEMBER, "messages");
      await assertFails(
        addDoc(messagesRef, {
          messageId: "<msg-004@monsoonfire.local>",
          subject: "Member thread",
          body: "outsider write attempt",
          fromUid: OUTSIDER_UID,
          fromName: "Outsider",
          fromEmail: "outsider@example.com",
          replyToEmail: "outsider@example.com",
          toUids: [MEMBER_UID],
          toEmails: ["member@example.com"],
          sentAt: new Date("2026-02-01T12:06:00.000Z"),
          inReplyTo: "<msg-001@monsoonfire.local>",
          references: [],
        })
      );
    });

    it("allows staff message create with valid shape", async () => {
      const db = authedDb(STAFF_UID, { staff: true, roles: ["staff"] });
      const messagesRef = collection(db, "directMessages", THREAD_FOR_MEMBER, "messages");
      await assertSucceeds(
        addDoc(messagesRef, {
          messageId: "<msg-005@monsoonfire.local>",
          subject: "Member thread",
          body: "staff moderation note",
          fromUid: STAFF_UID,
          fromName: "Staff",
          fromEmail: "staff@example.com",
          replyToEmail: "staff@example.com",
          toUids: [MEMBER_UID],
          toEmails: ["member@example.com"],
          sentAt: new Date("2026-02-01T12:07:00.000Z"),
          inReplyTo: "<msg-001@monsoonfire.local>",
          references: [],
        })
      );
    });
  });

  describe("thread field protections", () => {
    it("denies participant attempts to change participantUids", async () => {
      const db = authedDb(MEMBER_UID);
      const threadRef = doc(db, "directMessages", THREAD_FOR_MEMBER);
      await assertFails(
        updateDoc(threadRef, {
          participantUids: [MEMBER_UID],
          updatedAt: new Date("2026-02-01T12:10:00.000Z"),
        })
      );
    });

    it("allows staff updates limited to allowed mutable fields", async () => {
      const db = authedDb(STAFF_UID, { staff: true, roles: ["staff"] });
      const threadRef = doc(db, "directMessages", THREAD_FOR_MEMBER);
      await assertSucceeds(
        updateDoc(threadRef, {
          lastMessagePreview: "staff updated preview",
          updatedAt: new Date("2026-02-01T12:12:00.000Z"),
        })
      );
    });
  });
});
