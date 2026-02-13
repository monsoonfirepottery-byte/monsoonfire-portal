"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorError = void 0;
class ConnectorError extends Error {
    code;
    retryable;
    meta;
    constructor(code, message, retryable, meta = {}) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.meta = meta;
        this.name = "ConnectorError";
    }
}
exports.ConnectorError = ConnectorError;
