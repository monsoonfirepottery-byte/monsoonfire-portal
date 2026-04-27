"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const discord_1 = require("./discord");
(0, node_test_1.default)("getSupportAgentProfile returns Ember metadata for support surfaces", () => {
    const profile = (0, discord_1.getSupportAgentProfile)();
    strict_1.default.equal(profile.displayName, "Ember");
    strict_1.default.equal(profile.fromName, "Ember at Monsoon Fire");
    strict_1.default.equal(profile.avatarAssetPath, "/support-agent/ember-avatar.svg");
    strict_1.default.equal(profile.startup.operatingMode, "hybrid_warm_touch");
    strict_1.default.match(profile.startup.northStar, /accompanied and clearly directed/i);
    strict_1.default.equal(profile.startup.fileReferences[0], "config/studiobrain/agents/ember/startup-profile.json");
    strict_1.default.match(profile.startup.channelPacks.discord.firstTouch, /AI support guide/i);
});
(0, node_test_1.default)("draftDiscordSupportReply returns a safe template reply for pickup coordination", async () => {
    const draft = await (0, discord_1.draftDiscordSupportReply)({
        channelId: "channel-1",
        senderName: "Betsy",
        question: "Could I do 8 PM instead or porch drop-off if that is easier?",
    });
    strict_1.default.equal(draft.persona.displayName, "Ember");
    strict_1.default.equal(draft.policySlug, "firing-scheduling");
    strict_1.default.equal(draft.replyMode, "template");
    strict_1.default.equal(draft.humanReviewRequired, false);
    strict_1.default.match(draft.reply, /same-day pickup is not guaranteed/i);
});
(0, node_test_1.default)("draftDiscordSupportReply routes access-code requests into human review", async () => {
    const draft = await (0, discord_1.draftDiscordSupportReply)({
        channelId: "channel-1",
        senderName: "Taylor",
        question: "Can you send me the door code and address for tonight?",
    });
    strict_1.default.equal(draft.replyMode, "human_review");
    strict_1.default.equal(draft.humanReviewRequired, true);
    strict_1.default.equal(draft.riskState, "high_risk");
    strict_1.default.match(draft.reply, /needs human review/i);
});
(0, node_test_1.default)("draftDiscordSupportReply can use one nuanced model draft when the question is safe but more bespoke", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        output_text: "Thanks for laying that out so clearly. Pickup timing can still shift, so I cannot promise an exact same-day window here, but I can keep your latest note in view and help route the next safe update in this channel.",
    }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
    const draft = await (0, discord_1.draftDiscordSupportReply)({
        channelId: "channel-1",
        senderName: "Betsy",
        question: "Sorry for changing this again, but I am trying to figure out whether today around 8 PM might work for my reservation status, and if not whether porch drop-off is sometimes the easier path for a few bisque pieces.",
    }, {
        apiKey: "sk-test",
        model: "gpt-5.4-mini",
        fetchImpl,
    });
    strict_1.default.equal(draft.replyMode, "model");
    strict_1.default.equal(draft.usedModel, true);
    strict_1.default.equal(draft.model?.version, "gpt-5.4-mini");
    strict_1.default.match(draft.reply, /cannot promise an exact same-day window/i);
});
