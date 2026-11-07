import { ObjectId } from "mongodb";
import { DEMO_COACH, DEMO_SCOUT, PLAYER_DEFAULT_PASSWORD, } from "./constants.js";
import { daysAgoISO, todayISO } from "./date.js";
import { getDb } from "./db.js";
import { hashPassword } from "./password.js";
import { computeReadinessForPlayer } from "./readiness.js";
const globalForSeed = globalThis;
function isDuplicateKeyError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000);
}
async function seedUser(users, username, password, role, name) {
    try {
        await users.updateOne({ username }, {
            $setOnInsert: {
                passwordHash: hashPassword(password),
                role,
                name,
                createdAt: new Date(),
            },
        }, { upsert: true });
    }
    catch (error) {
        if (!isDuplicateKeyError(error))
            throw error;
    }
}
export async function ensureBaseData() {
    if (!globalForSeed.seedPromise) {
        globalForSeed.seedPromise = (async () => {
            const db = await getDb();
            const users = db.collection("users");
            await Promise.all([
                users.createIndex({ username: 1 }, { unique: true }),
                db.collection("players").createIndex({ sport: 1, name: 1 }),
                db
                    .collection("sessions")
                    .createIndex({ date: -1, sport: 1 }),
                db.collection("matches").createIndex({ date: -1, sport: 1 }),
            ]);
            await seedUser(users, DEMO_COACH.username, DEMO_COACH.password, "coach", "Coach");
            await seedUser(users, DEMO_SCOUT.username, DEMO_SCOUT.password, "scout", "Scout");
        })().catch((error) => {
            globalForSeed.seedPromise = undefined;
            throw error;
        });
    }
    return globalForSeed.seedPromise;
}
export async function findUserByUsername(username) {
    const db = await getDb();
    return db
        .collection("users")
        .findOne({ username: username.trim().toLowerCase() });
}
export async function getPlayers() {
    const db = await getDb();
    return db
        .collection("players")
        .find()
        .sort({ name: 1 })
        .toArray();
}
export async function getSessions() {
    const db = await getDb();
    return db
        .collection("sessions")
        .find()
        .sort({ date: -1, createdAt: -1 })
        .toArray();
}
export async function getSessionById(id) {
    const db = await getDb();
    return db.collection("sessions").findOne({ _id: id });
}
export async function getMatches() {
    const db = await getDb();
    return db
        .collection("matches")
        .find()
        .sort({ date: -1, createdAt: -1 })
        .toArray();
}
export async function getAcademyData() {
    const [players, sessions, matches] = await Promise.all([
        getPlayers(),
        getSessions(),
        getMatches(),
    ]);
    return { players, sessions, matches };
}
export function toPlayerView(player) {
    return {
        id: player._id.toHexString(),
        name: player.name,
        age: player.age,
        sport: player.sport,
        joinedOn: player.joinedOn,
    };
}
export function toSessionView(session) {
    return {
        id: session._id.toHexString(),
        date: session.date,
        sport: session.sport,
        status: session.status,
        attendance: session.attendance.map((entry) => ({
            playerId: entry.playerId.toHexString(),
            present: entry.present,
        })),
        createdAt: session.createdAt.toISOString(),
        closedAt: session.closedAt?.toISOString(),
    };
}
export function toMatchView(match) {
    return {
        id: match._id.toHexString(),
        date: match.date,
        sport: match.sport,
        opponent: match.opponent,
        scores: match.scores.map((entry) => ({
            playerId: entry.playerId.toHexString(),
            score: entry.score,
        })),
        createdAt: match.createdAt.toISOString(),
    };
}
export function toAcademyView(players, sessions, matches) {
    return {
        players: players.map(toPlayerView),
        sessions: sessions.map(toSessionView),
        matches: matches.map(toMatchView),
    };
}
export function buildReadinessRows(players, sessions, matches) {
    return players
        .map((player) => ({
        ...toPlayerView(player),
        ...computeReadinessForPlayer(player, sessions, matches),
    }))
        .sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name));
}
export async function getReadinessRows() {
    const { players, sessions, matches } = await getAcademyData();
    return buildReadinessRows(players, sessions, matches);
}
export async function getPlayerAccounts() {
    const db = await getDb();
    const [players, users] = await Promise.all([
        getPlayers(),
        db.collection("users").find({ role: "player" }).toArray(),
    ]);
    const usernameByPlayer = new Map(users
        .filter((user) => user.playerId)
        .map((user) => [user.playerId.toHexString(), user.username]));
    return players.map((player) => ({
        ...toPlayerView(player),
        username: usernameByPlayer.get(player._id.toHexString()) ?? "—",
    }));
}
export async function getPlayerRecordView(playerId) {
    const db = await getDb();
    const [player, sessions, matches] = await Promise.all([
        db.collection("players").findOne({ _id: playerId }),
        db
            .collection("sessions")
            .find({ "attendance.playerId": playerId })
            .sort({ date: -1, createdAt: -1 })
            .toArray(),
        db
            .collection("matches")
            .find({ "scores.playerId": playerId })
            .sort({ date: -1, createdAt: -1 })
            .toArray(),
    ]);
    if (!player)
        return null;
    return {
        player: toPlayerView(player),
        sessions: sessions.map(toSessionView),
        matches: matches.map(toMatchView),
        stats: computeReadinessForPlayer(player, sessions, matches),
    };
}
export async function getSessionDetail(sessionId) {
    const session = await getSessionById(sessionId);
    if (!session)
        return null;
    const players = await getPlayersByIds(session.attendance.map((entry) => entry.playerId));
    const playerById = new Map(players.map((player) => [player._id.toHexString(), player]));
    return {
        session: toSessionView(session),
        players: session.attendance.flatMap((entry) => {
            const player = playerById.get(entry.playerId.toHexString());
            return player ? [toPlayerView(player)] : [];
        }),
    };
}
export async function getPresentPlayerIds(date, sport) {
    const db = await getDb();
    const sessions = await db
        .collection("sessions")
        .find({ date, sport })
        .toArray();
    const present = new Set();
    for (const session of sessions) {
        for (const entry of session.attendance) {
            if (entry.present)
                present.add(entry.playerId.toHexString());
        }
    }
    return present;
}
export async function getPlayersByIds(ids) {
    if (ids.length === 0)
        return [];
    const db = await getDb();
    return db
        .collection("players")
        .find({ _id: { $in: ids } })
        .toArray();
}
function slugifyUsername(name) {
    const base = name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 24);
    return base || "player";
}
export async function createPlayerWithAccount(input) {
    const db = await getDb();
    const users = db.collection("users");
    const players = db.collection("players");
    const baseUsername = slugifyUsername(input.name);
    const passwordHash = hashPassword(PLAYER_DEFAULT_PASSWORD);
    const joinedOn = input.joinedOn ?? todayISO();
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const username = attempt === 0 ? baseUsername : `${baseUsername}${attempt + 1}`;
        const playerId = new ObjectId();
        try {
            await users.insertOne({
                _id: new ObjectId(),
                username,
                passwordHash,
                role: "player",
                name: input.name,
                playerId,
                createdAt: new Date(),
            });
        }
        catch (error) {
            if (isDuplicateKeyError(error))
                continue;
            throw error;
        }
        try {
            await players.insertOne({
                _id: playerId,
                name: input.name,
                age: input.age,
                sport: input.sport,
                joinedOn,
                createdAt: new Date(),
            });
        }
        catch (error) {
            await users.deleteOne({ playerId });
            throw error;
        }
        return {
            playerId,
            username,
            password: PLAYER_DEFAULT_PASSWORD,
        };
    }
    throw new Error("Could not create a unique player login. Try a slightly different name.");
}
export async function createSession(date, sport) {
    const db = await getDb();
    const players = await db
        .collection("players")
        .find({ sport })
        .sort({ name: 1 })
        .toArray();
    if (players.length === 0) {
        throw new Error("Add at least one player for this sport first.");
    }
    const sessionId = new ObjectId();
    await db.collection("sessions").insertOne({
        _id: sessionId,
        date,
        sport,
        status: "open",
        attendance: players.map((player) => ({
            playerId: player._id,
            present: false,
        })),
        createdAt: new Date(),
    });
    return sessionId;
}
export async function saveAttendance(sessionId, attendance, close) {
    const db = await getDb();
    const update = { attendance };
    if (close) {
        update.status = "closed";
        update.closedAt = new Date();
    }
    const result = await db
        .collection("sessions")
        .updateOne({ _id: sessionId, status: "open" }, { $set: update });
    return result.matchedCount > 0;
}
export async function insertMatch(input) {
    const db = await getDb();
    const matchId = new ObjectId();
    await db.collection("matches").insertOne({
        _id: matchId,
        ...input,
        createdAt: new Date(),
    });
    return matchId;
}
export async function seedDemoData() {
    const db = await getDb();
    const existingPlayers = await db
        .collection("players")
        .countDocuments();
    if (existingPlayers > 0) {
        throw new Error("The academy already has players. Sample data only loads into an empty academy.");
    }
    const joinedOn = daysAgoISO(20);
    const aarav = await createPlayerWithAccount({
        name: "Aarav Kumar",
        age: 14,
        sport: "Football",
        joinedOn,
    });
    const bhavna = await createPlayerWithAccount({
        name: "Bhavna Singh",
        age: 13,
        sport: "Football",
        joinedOn,
    });
    const chirag = await createPlayerWithAccount({
        name: "Chirag Mahto",
        age: 15,
        sport: "Football",
        joinedOn,
    });
    const players = [aarav, bhavna, chirag];
    const mark = (present) => players.map((player) => ({
        playerId: player.playerId,
        present: present.some((entry) => entry.playerId.equals(player.playerId)),
    }));
    const dates = [daysAgoISO(12), daysAgoISO(9), daysAgoISO(6), daysAgoISO(3)];
    await db.collection("sessions").insertMany([
        {
            _id: new ObjectId(),
            date: dates[0],
            sport: "Football",
            status: "closed",
            attendance: mark([aarav, bhavna]),
            createdAt: new Date(),
            closedAt: new Date(),
        },
        {
            _id: new ObjectId(),
            date: dates[1],
            sport: "Football",
            status: "closed",
            attendance: mark([aarav, bhavna, chirag]),
            createdAt: new Date(),
            closedAt: new Date(),
        },
        {
            _id: new ObjectId(),
            date: dates[2],
            sport: "Football",
            status: "closed",
            attendance: mark([chirag]),
            createdAt: new Date(),
            closedAt: new Date(),
        },
        {
            _id: new ObjectId(),
            date: dates[3],
            sport: "Football",
            status: "closed",
            attendance: mark([aarav, chirag]),
            createdAt: new Date(),
            closedAt: new Date(),
        },
    ]);
    await db.collection("matches").insertMany([
        {
            _id: new ObjectId(),
            date: dates[0],
            sport: "Football",
            opponent: "Ranchi Rangers",
            scores: [
                { playerId: aarav.playerId, score: 2 },
                { playerId: bhavna.playerId, score: 1 },
            ],
            createdAt: new Date(),
        },
        {
            _id: new ObjectId(),
            date: dates[1],
            sport: "Football",
            opponent: "Bokaro Blues",
            scores: [
                { playerId: aarav.playerId, score: 1 },
                { playerId: bhavna.playerId, score: 0 },
            ],
            createdAt: new Date(),
        },
        {
            _id: new ObjectId(),
            date: dates[2],
            sport: "Football",
            opponent: "Dumka United",
            scores: [{ playerId: chirag.playerId, score: 3 }],
            createdAt: new Date(),
        },
    ]);
    return { players: 3, sessions: 4, matches: 3 };
}
