import { SESSION_COOKIE } from "../constants.js";
import { verifySessionToken } from "../session.js";
export function requireAuth(req, res, next) {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? verifySessionToken(token) : null;
    if (!user) {
        res.status(401).json({ error: "Please sign in to continue." });
        return;
    }
    req.user = user;
    next();
}
export function requireRole(role) {
    return (req, res, next) => {
        requireAuth(req, res, () => {
            if (req.user?.role !== role) {
                res.status(403).json({
                    error: "You do not have access to this area.",
                });
                return;
            }
            next();
        });
    };
}
