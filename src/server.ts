import "dotenv/config";
import express from "express";
import { env } from "./env";
import { prisma } from "./libs/prisma";
import { redis } from "./libs/redis";

const app = express();
const PORT = env.PORT;

app.get("/health", async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        const pong = await redis.ping();
        res.json({ status: "ok", db: "connected" });
    } catch (error) {
        console.error("Database connection error:", error);
        res.status(500).json({ status: "error", db: "unreachable" });
    }
})

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
