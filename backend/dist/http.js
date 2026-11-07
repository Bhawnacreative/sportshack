export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}
export function asyncHandler(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}
export function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function errorHandler(error, _req, res, next) {
    if (res.headersSent) {
        next(error);
        return;
    }
    if (error instanceof ApiError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ error: "The request body is not valid JSON." });
        return;
    }
    console.error("API error", error);
    res.status(500).json({ error: "Something went wrong on the academy API." });
}
