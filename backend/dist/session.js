import { createHmac, timingSafeEqual } from "node:crypto";
import { AUTH_SECRET, NODE_ENV } from "./config.js";
import { SESSION_COOKIE } from "./constants.js";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
function sign(value) {
    return createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}
export function createSessionToken(user) {
    const payload = {
        ...user,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${sign(body)}`;
}
export function verifySessionToken(token) {
    const [body, signature] = token.split(".");
    if (!body || !signature)
        return null;
    const expected = sign(body);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(providedBuffer, expectedBuffer)) {
        return null;
    }
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!payload ||
            typeof payload.exp !== "number" ||
            payload.exp < Math.floor(Date.now() / 1000) ||
            typeof payload.uid !== "string" ||
            typeof payload.name !== "string" ||
            !["coach", "player", "scout"].includes(payload.role)) {
            return null;
        }
        return {
            uid: payload.uid,
            role: payload.role,
            name: payload.name,
            playerId: payload.playerId,
        };
    }
    catch {
        return null;
    }
}
export function setSessionCookie(res, user) {
    res.cookie(SESSION_COOKIE, createSessionToken(user), {
        httpOnly: true,
        sameSite: "lax",
        secure: NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_MAX_AGE * 1000,
    });
}
export function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        sameSite: "lax",
        secure: NODE_ENV === "production",
        path: "/",
    });
}
export function homeForRole(role) {
    if (role === "coach")
        return "/coach";
    if (role === "scout")
        return "/scout";
    return "/player";
}
