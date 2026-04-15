import test from "node:test";
import assert from "node:assert/strict";
import { draftDiscordSupportReply, getSupportAgentProfile } from "./discord";

test("getSupportAgentProfile returns Ember metadata for support surfaces", () => {
  const profile = getSupportAgentProfile();
  assert.equal(profile.displayName, "Ember");
  assert.equal(profile.fromName, "Ember at Monsoon Fire");
  assert.equal(profile.avatarAssetPath, "/support-agent/ember-avatar.svg");
  assert.equal(profile.startup.operatingMode, "hybrid_warm_touch");
  assert.match(profile.startup.northStar, /accompanied and clearly directed/i);
  assert.equal(
    profile.startup.fileReferences[0],
    "config/studiobrain/agents/ember/startup-profile.json",
  );
  assert.match(profile.startup.channelPacks.discord.firstTouch, /AI support guide/i);
});

test("draftDiscordSupportReply returns a safe template reply for pickup coordination", async () => {
  const draft = await draftDiscordSupportReply({
    channelId: "channel-1",
    senderName: "Betsy",
    question: "Could I do 8 PM instead or porch drop-off if that is easier?",
  });

  assert.equal(draft.persona.displayName, "Ember");
  assert.equal(draft.policySlug, "firing-scheduling");
  assert.equal(draft.replyMode, "template");
  assert.equal(draft.humanReviewRequired, false);
  assert.match(draft.reply, /same-day pickup is not guaranteed/i);
});

test("draftDiscordSupportReply routes access-code requests into human review", async () => {
  const draft = await draftDiscordSupportReply({
    channelId: "channel-1",
    senderName: "Taylor",
    question: "Can you send me the door code and address for tonight?",
  });

  assert.equal(draft.replyMode, "human_review");
  assert.equal(draft.humanReviewRequired, true);
  assert.equal(draft.riskState, "high_risk");
  assert.match(draft.reply, /needs human review/i);
});

test("draftDiscordSupportReply can use one nuanced model draft when the question is safe but more bespoke", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_text:
          "Thanks for laying that out so clearly. Pickup timing can still shift, so I cannot promise an exact same-day window here, but I can keep your latest note in view and help route the next safe update in this channel.",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  const draft = await draftDiscordSupportReply(
    {
      channelId: "channel-1",
      senderName: "Betsy",
      question:
        "Sorry for changing this again, but I am trying to figure out whether today around 8 PM might work for my reservation status, and if not whether porch drop-off is sometimes the easier path for a few bisque pieces.",
    },
    {
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      fetchImpl,
    },
  );

  assert.equal(draft.replyMode, "model");
  assert.equal(draft.usedModel, true);
  assert.equal(draft.model?.version, "gpt-5.4-mini");
  assert.match(draft.reply, /cannot promise an exact same-day window/i);
});
