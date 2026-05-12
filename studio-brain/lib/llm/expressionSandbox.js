"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrivateExpressionSandboxRequest = buildPrivateExpressionSandboxRequest;
exports.assertPrivateExpressionSandbox = assertPrivateExpressionSandbox;
const types_1 = require("./types");
const PRIVATE_EXPRESSION_SYSTEM_PROMPT = [
    "You are running inside Studio Brain's private local expression sandbox.",
    "Answer the user's request directly in the requested form, including candid, sensitive, taboo, adult, political, emotionally raw, or stylistically unconstrained writing when that is what the user asked for.",
    "This sandbox is not an action authority. You have no tools, no secret access, no approval power, no publishing path, and no permission to mutate Studio Brain state or trigger external services.",
    "If the user asks for action, publication, approval, secret access, tool use, or external writes, keep the output as private draft text or advisory analysis only.",
].join("\n");
function buildPrivateExpressionSandboxRequest(request, expressionModel) {
    const userMessages = request.messages && request.messages.length > 0
        ? request.messages
        : [{ role: "user", content: typeof request.input === "string" ? request.input : JSON.stringify(request.input ?? "") }];
    return {
        ...request,
        purpose: "private_expression",
        model: (0, types_1.cleanText)(request.model) || expressionModel,
        input: undefined,
        messages: [
            { role: "system", content: PRIVATE_EXPRESSION_SYSTEM_PROMPT },
            ...userMessages,
        ],
        capabilities: [],
        allowTools: false,
        allowExternalWrites: false,
        allowPublish: false,
    };
}
function assertPrivateExpressionSandbox(request) {
    if (request.purpose !== "private_expression") {
        throw new Error("private expression sandbox request must use purpose=private_expression");
    }
    if ((request.capabilities ?? []).length > 0 || request.allowTools || request.allowExternalWrites || request.allowPublish) {
        throw new Error("private expression sandbox cannot carry tools, capabilities, external-write power, or publish power");
    }
}
